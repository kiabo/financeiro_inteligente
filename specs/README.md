# Índice de specs

Fluxo e regras: `AGENTS.md` e `docs/sdd/README.md`.
Status: `rascunho` → `aprovado` → `em-andamento` → `concluído`.

| Nº | Spec | Spec | Plan | Tasks |
|---|---|---|---|---|
| 001 | [Remover referências a "Módulo N"](001-remover-referencias-modulos/spec.md) | concluído | concluído | concluído |
| 002 | [URL por tela](002-url-por-tela/spec.md) | concluído | concluído | concluído |
| 003 | [Saldo inicial e edição de conta](003-saldo-inicial-conta/spec.md) | concluído | concluído | concluído |
| 004 | [Importação de histórico por API](004-importacao-historico-api/spec.md) | aprovado | aprovado | aprovado |
| 005 | [Marca e temas](005-marca-e-temas/spec.md) | rascunho | — | — |
| 006 | [Supabase Free: backup e monitor](006-supabase-backup-monitor/spec.md) | rascunho | — | — |

Ordem sugerida: 001 → 002 → 003 (rápidas), depois 004, 005 e 006.

## Estado atual (2026-11-27) e próximos passos
- **001, 002 e 003: concluídas e em produção** (`dev` e `main` iguais; migration `0007` já aplicada no Supabase).
- **004:** spec, plan e tasks aprovados em 2026-11-27; implementação começando na branch `feat/004-importacao-historico-api`.
- **005 e 006:** rascunhos; perguntas abertas ainda sem resposta.
- Pendências fora das specs: conectar o Google no **cfo** (backup no Drive e agenda); criar o webhook do Asaas apontando para o cfo quando houver pagamentos reais
  (sem mexer no webhook "Gestão Comoequetalá").
  (Resolvido em 2026-11-27: o `.env` local passou a `ENABLE_INTERNAL_SCHEDULER=false` e o servidor local foi reiniciado; só o cfo roda as rotinas diárias.)
- Fluxo de cada spec: `/sdd-plan`, `/sdd-tasks`, `/sdd-implement`, `/sdd-verify` (Claude) ou `/sdd:plan` etc. (Gemini); promoção `dev` → `main` só com o "sim" do usuário.
