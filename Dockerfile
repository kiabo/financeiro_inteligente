# syntax=docker/dockerfile:1
# Financeiro Inteligente — imagem única (SPA Vite + servidor Express/tsx).
# As variáveis VITE_* são embutidas no bundle em tempo de build (são públicas por natureza).
# Todos os segredos (service role, chaves de criptografia, OAuth, Resend...) entram só em
# tempo de execução via --env-file e NUNCA fazem parte da imagem.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
# Cliente do PostgreSQL 17 (pg_dump, pg_restore, psql) para o backup diário do banco (spec 006).
# O Debian da imagem traz o cliente 15, que NÃO consegue copiar um servidor 17; por isso o repositório oficial (PGDG).
# curl e gnupg só existem durante a instalação.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; \
    CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-17; \
    apt-get purge -y curl gnupg; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*
# tsx é devDependency: o servidor importa módulos compartilhados com o cliente (sem extensão .ts),
# então `node server.ts` puro não resolve. Mantemos node_modules completo.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json server.ts tsconfig.json ./
COPY server ./server
COPY src ./src
COPY scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/automation/status').then(r=>process.exit(r.status===401||r.status===200?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server.ts"]
