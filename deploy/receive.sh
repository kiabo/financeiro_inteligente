#!/usr/bin/env bash
# Executado NO VPS como comando forçado da chave SSH de deploy (authorized_keys: command="...").
# Entrada: SSH_ORIGINAL_COMMAND = "dev" | "main"; stdin = tar.gz do código-fonte.
# Nada além de dev/main é aceito, então a chave do GitHub não abre shell no servidor.
set -euo pipefail

ENV_NAME="${SSH_ORIGINAL_COMMAND:-}"
BASE="/opt/financeiro-inteligente"

case "$ENV_NAME" in
  dev)  PORT=3101 ;;
  main) PORT=3102 ;;
  *) echo "ambiente inválido (use dev ou main)" >&2; exit 2 ;;
esac

APP="financeiro-$ENV_NAME"
ENV_SRC="$BASE/env/$ENV_NAME.env"
[ -r "$ENV_SRC" ] || { echo "faltando $ENV_SRC" >&2; exit 3; }

LOCK="$BASE/releases/.lock-$ENV_NAME"
exec 9>"$LOCK"
flock -n 9 || { echo "já existe um deploy de $ENV_NAME em andamento" >&2; exit 4; }

STAMP="$(date +%Y%m%d-%H%M%S)"
REL="$BASE/releases/$ENV_NAME/$STAMP"
mkdir -p "$REL"
tar -xzf - -C "$REL"
echo "[deploy] código recebido em $REL"

# Remove aspas externas (docker --env-file NÃO as interpreta).
RUNENV="$(mktemp)"
trap 'rm -f "$RUNENV"' EXIT
chmod 600 "$RUNENV"
grep -vE '^\s*(#|$)' "$ENV_SRC" \
  | sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)=[\"'](.*)[\"']\$/\1=\2/" > "$RUNENV"

getvar() { grep -E "^$1=" "$RUNENV" | head -1 | cut -d= -f2-; }
VITE_URL="$(getvar VITE_SUPABASE_URL)"
VITE_KEY="$(getvar VITE_SUPABASE_PUBLISHABLE_KEY)"
[ -n "$VITE_KEY" ] || VITE_KEY="$(getvar VITE_SUPABASE_ANON_KEY)"
[ -n "$VITE_URL" ] && [ -n "$VITE_KEY" ] || { echo "VITE_SUPABASE_URL / chave pública ausentes em $ENV_SRC" >&2; exit 5; }

IMAGE="$APP:$STAMP"
echo "[deploy] build $IMAGE"
docker build --pull \
  --build-arg VITE_SUPABASE_URL="$VITE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_KEY" \
  -t "$IMAGE" -t "$APP:latest" "$REL"

PREVIOUS="$(docker inspect --format '{{.Config.Image}}' "$APP" 2>/dev/null || true)"

# Backup diário do banco (spec 006): só a produção grava em /backups, e só se a pasta existir no VPS
# (criada uma vez, como root: mkdir -p /opt/financeiro-inteligente/backups && chown 1000:1000 ...).
# Sem a pasta o contêiner sobe do mesmo jeito; o painel e o alerta avisam que o backup não tem onde gravar.
MOUNTS=()
if [ "$ENV_NAME" = "main" ] && [ -d "$BASE/backups" ]; then
  MOUNTS=(-v "$BASE/backups:/backups")
fi

docker rm -f "$APP" >/dev/null 2>&1 || true
run_container() {
  docker run -d --name "$APP" --restart unless-stopped \
    --env-file "$RUNENV" -e PORT=3000 -e NODE_ENV=production \
    -p "127.0.0.1:$PORT:3000" \
    --memory 768m --cpus 1.5 \
    --log-opt max-size=10m --log-opt max-file=3 \
    ${MOUNTS[@]+"${MOUNTS[@]}"} \
    "$1" >/dev/null
}
run_container "$IMAGE"

echo "[deploy] aguardando saúde do container..."
for _ in $(seq 1 45); do
  STATUS="$(docker inspect --format '{{.State.Health.Status}}' "$APP" 2>/dev/null || echo none)"
  [ "$STATUS" = "healthy" ] && break
  sleep 2
done

if [ "${STATUS:-}" != "healthy" ]; then
  echo "[deploy] FALHA: container não ficou saudável. Últimos logs:" >&2
  docker logs --tail 40 "$APP" >&2 || true
  docker rm -f "$APP" >/dev/null 2>&1 || true
  if [ -n "$PREVIOUS" ]; then
    echo "[deploy] restaurando versão anterior ($PREVIOUS)" >&2
    run_container "$PREVIOUS" || true
  fi
  exit 1
fi

echo "[deploy] OK — $APP no ar em 127.0.0.1:$PORT ($IMAGE)"

# Mantém as 3 últimas releases e imagens; limpa o resto.
ls -1dt "$BASE/releases/$ENV_NAME"/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
docker images "$APP" --format '{{.Tag}}' | grep -v '^latest$' | sort -r | tail -n +4 \
  | xargs -r -I{} docker rmi "$APP:{}" >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
