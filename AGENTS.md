# AGENTS.md — diretrizes para qualquer agente de IA (Claude, Gemini, etc.)

Fonte única de verdade. `CLAUDE.md` e `GEMINI.md` apenas importam este arquivo.
Leia também `docs/constitution.md` (princípios inegociáveis) e `docs/architecture.md` (mapa do sistema).

## O produto
Financeiro Inteligente: cofre financeiro privado para titulares convidados (empresas, contas, grupos),
com anonimização antes de qualquer análise de IA. Interface em **português (pt-BR)**.

## Stack
- Front: Vite + React 19 + TypeScript + Tailwind, PWA.
- Back: Express rodando via `tsx` (`server.ts`, `server/`).
- Dados: Supabase (Auth com MFA/TOTP exigindo aal2, Postgres com RLS + FORCE RLS, Storage).
- O navegador fala com o Supabase direto (PostgREST); o módulo de integrações usa o servidor com service role e `tenant_id` extraído do JWT.

## Comandos
| Ação | Comando |
|---|---|
| Desenvolver | `npm run dev` (porta 3000) |
| Checar tipos | `npx tsc --noEmit` |
| Testes | `npm test` |
| Build | `npm run build` |

Antes de qualquer commit: `npx tsc --noEmit && npm test && npm run build` precisam passar (é o que o CI roda).

## Ambientes e deploy
| Branch | URL | Observação |
|---|---|---|
| `dev` | https://h-cfo.cqtl.pro | homologação; **sem** agendador diário |
| `main` | https://cfo.cqtl.pro | produção; `ENABLE_INTERNAL_SCHEDULER=true` |

- Push em `dev`/`main` dispara o GitHub Actions (`.github/workflows/deploy.yml`): verifica e envia o código por SSH ao VPS, que roda `deploy/receive.sh` (Docker, healthcheck, rollback automático).
- Os dois ambientes usam **o mesmo projeto Supabase**. Cuidado com migrations e dados.
- Segredos de runtime ficam em `/opt/financeiro-inteligente/env/{dev,main}.env` no VPS. Nunca no repositório.
- Produção executa `npx tsx server.ts`. `node server.ts` puro **não funciona** (imports sem extensão compartilhados com o cliente).

## Convenções de código
- Textos da interface em pt-BR. **Nunca** exibir "Módulo N" ou nomes internos de fase ao usuário.
- Escritas no banco com **lista explícita de colunas**. As tabelas têm GRANT por coluna; enviar coluna extra gera "permission denied" (padrão: `savePreferences` em `src/modules/integrations/integrationsApi.ts`).
- Toda tabela nova: `tenant_id`, RLS **e** FORCE RLS, política por tenant, GRANTs mínimos.
- Migrations: `supabase/migrations/NNNN_descricao.sql`, numeração sequencial, idempotentes (`IF NOT EXISTS`). São aplicadas **manualmente** no Supabase pelo usuário, e a spec deve dizer isso.
- Variáveis `VITE_*` são públicas e embutidas no build. Segredos só em runtime.
- Integrações externas: sempre idempotentes (chave de deduplicação por evento/pagamento).

## Segurança (regras duras)
- Nunca ler, imprimir ou commitar `.env`, chaves, tokens ou segredos de webhook. Cite apenas nomes e formato.
- Nunca enviar dado identificável a IA externa: usar os tokens analíticos (EMP_01, CTA_01…).
- Ações em sistemas externos (DNS, GitHub Secrets, Supabase, Google, Asaas) só com confirmação do usuário; credenciais quem cola é o usuário.
- A conta Asaas do usuário é **real** (com saldo). Somente leitura, salvo pedido explícito. Não alterar o webhook "Gestão Comoequetalá".

## Fluxo SDD (Spec-Driven Development) — obrigatório
Cada funcionalidade vive em `specs/NNN-slug/` com três arquivos, criados dos modelos em `docs/sdd/templates/`:

1. `spec.md` — **o quê e por quê** (critérios de aceite verificáveis).
2. `plan.md` — **como** (arquivos, migrations, contratos, riscos, rollback, testes).
3. `tasks.md` — **em que ordem** (`- [ ] T01 …`, cada uma com critério de pronto).

Cada arquivo começa com o cabeçalho de status: `rascunho → aprovado → em-andamento → concluído`.

Portões (o usuário aprova cada um):
1. Sem `spec.md` **aprovada**, não se escreve `plan.md`.
2. Sem `plan.md` **aprovado**, não se escreve `tasks.md`.
3. Sem `tasks.md` **aprovado**, não se escreve código.
4. Ao terminar, verificar cada critério de aceite da spec no h-cfo antes de promover para a `main`.

Regras durante a execução:
- Marque `[x]` em cada tarefa ao concluí-la; mantenha o status do arquivo atualizado.
- Se descobrir algo que muda o escopo, **pare** e atualize a spec/plan antes de continuar.
- Branch `feat/NNN-slug` saindo da `dev`; commits `feat(NNN): …` / `fix(NNN): …` citando a tarefa (ex.: `T03`).
- Índice e status de todas as specs: `specs/README.md`.

Comandos prontos (mesmo prompt nos dois agentes, em `docs/sdd/prompts/`):
- Claude: `/sdd-spec`, `/sdd-plan`, `/sdd-tasks`, `/sdd-implement`, `/sdd-verify`
- Gemini: `/sdd:spec`, `/sdd:plan`, `/sdd:tasks`, `/sdd:implement`, `/sdd:verify`

Processo completo em uma página: `docs/sdd/README.md`.
