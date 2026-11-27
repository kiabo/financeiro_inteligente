#!/usr/bin/env bash
# Teste de restauração do backup do banco (spec 006). Rodar NO VPS (precisa de docker).
#   deploy/restore-test.sh [arquivo.vtxdb]     (sem argumento usa o backup mais recente)
# Decifra dentro do contêiner do app (que tem a BACKUP_ENCRYPTION_KEY), restaura num Postgres
# descartável e compara as contagens das tabelas principais com as do banco real.
# Nada é gravado no banco real; o Postgres temporário e os arquivos temporários somem no fim.
set -euo pipefail

BASE="/opt/financeiro-inteligente"
APP="${APP:-financeiro-main}"
DIR="${DIR:-$BASE/backups}"
PG_IMAGE="${PG_IMAGE:-postgres:17}"

FILE="${1:-}"
if [ -z "$FILE" ]; then
  FILE="$(ls -1t "$DIR"/financeiro-db-*.vtxdb 2>/dev/null | head -1 || true)"
fi
[ -n "$FILE" ] && [ -r "$FILE" ] || { echo "nenhum backup .vtxdb legível em $DIR" >&2; exit 2; }

WORK="$(mktemp -d)"
CID=""
cleanup() {
  [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "[1/4] decifrando $(basename "$FILE") no contêiner $APP"
docker exec -i "$APP" npx tsx scripts/decrypt-db-backup.ts - - < "$FILE" > "$WORK/db.dump"
[ -s "$WORK/db.dump" ] || { echo "dump vazio depois de decifrar" >&2; exit 3; }
chmod 644 "$WORK/db.dump"

echo "[2/4] subindo Postgres temporário ($PG_IMAGE)"
CID="$(docker run -d --rm -e POSTGRES_PASSWORD=restore-test -v "$WORK:/work:ro" "$PG_IMAGE")"
for _ in $(seq 1 60); do
  if docker logs "$CID" 2>&1 | grep -q "PostgreSQL init process complete" && docker exec "$CID" pg_isready -U postgres -q; then
    break
  fi
  sleep 1
done
docker exec "$CID" pg_isready -U postgres -q || { echo "Postgres temporário não ficou pronto" >&2; exit 4; }

echo "[3/4] restaurando (papéis e extensões do Supabase criados vazios antes)"
docker exec -i "$CID" psql -U postgres -q -v ON_ERROR_STOP=0 >/dev/null <<'SQL'
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_admin','dashboard_user']
  LOOP
    BEGIN EXECUTE format('CREATE ROLE %I NOLOGIN', r); EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
SQL
RC=0
docker exec "$CID" pg_restore -U postgres -d postgres --no-owner --no-acl /work/db.dump 2> "$WORK/restore.log" || RC=$?
ERRORS="$(grep -c 'error:' "$WORK/restore.log" || true)"
echo "    pg_restore terminou com código $RC e $ERRORS mensagem(ns) de erro (esperadas: objetos próprios do Supabase)"
if [ "$ERRORS" -gt 0 ]; then
  echo "    primeiras mensagens:"; grep 'error:' "$WORK/restore.log" | head -5 | sed 's/^/      /'
fi

echo "[4/4] comparando contagens com o banco real"
SQL="$(docker exec "$APP" npx tsx scripts/restore-compare.ts sql)"
docker exec "$CID" psql -U postgres -At -F'|' -c "$SQL" | docker exec -i "$APP" npx tsx scripts/restore-compare.ts compare
