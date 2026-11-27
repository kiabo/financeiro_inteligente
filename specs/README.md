# Índice de specs

Fluxo e regras: `AGENTS.md` e `docs/sdd/README.md`.
Status: `rascunho` → `aprovado` → `em-andamento` → `concluído`.

| Nº | Spec | Spec | Plan | Tasks |
|---|---|---|---|---|
| 001 | [Remover referências a "Módulo N"](001-remover-referencias-modulos/spec.md) | concluído | concluído | concluído |
| 002 | [URL por tela](002-url-por-tela/spec.md) | concluído | concluído | concluído |
| 003 | [Saldo inicial e edição de conta](003-saldo-inicial-conta/spec.md) | concluído | concluído | concluído |
| 004 | [Importação de histórico por API](004-importacao-historico-api/spec.md) | concluído | concluído | concluído |
| 005 | [Nome e marca do sistema](005-marca-e-temas/spec.md) | aprovado | aprovado | rascunho |
| 006 | [Supabase Free: backup e monitor](006-supabase-backup-monitor/spec.md) | aprovado | aprovado | rascunho |
| 007 | [Trocar o segredo do webhook](007-trocar-segredo-webhook/spec.md) | concluído | concluído | concluído |
| 008 | [Importação completa das operações financeiras](008-importacao-completa-operacoes/spec.md) | rascunho | — | — |

Ordem sugerida: 001 → 004 concluídas; depois 007 (pequena), 006, 005 e 008 (grande; vira várias specs: 009 Asaas, 010 Mercado Pago, 011 outros bancos).

## Estado atual (2026-11-27) e próximos passos
- **001, 002 e 003: concluídas e em produção** (`dev` e `main` iguais; migration `0007` já aplicada no Supabase).
- **004: concluída e em produção** (`dev` e `main`; PRs #4–#7). Verificação no cfo: CA1, CA3, CA8, CA10 e CA2 (conferido pelo usuário) ok; CA4, CA5, CA7, CA12 e CA13 só por testes automáticos; CA6 parcial (sem recebimento real no Mercado Pago). Defeito do Mercado Pago (compras da própria conta virando receita) encontrado e corrigido. O usuário vai apagar os dados de teste e recomeçar limpo.
- **005 (nome e marca):** spec aprovada; marca única da instância, só administradores alteram, vale também em e-mails e WhatsApp. Plano aprovado (inclui a exceção à constituição nº 2: tabela sem `tenant_id`; migration `0010`). Tasks em rascunho (13).
- **006 (backup e monitor):** spec aprovada (03:00; `pg_dump` também no Drive). Plano aprovado (migration `0009`; variáveis `SUPABASE_DB_URL` e `OWNER_TENANT_ID` no env do `main`). Tasks em rascunho (15).
- **007 (trocar segredo do webhook):** concluída e em produção (PRs #10 e #11); verificada no cfo em 2026-11-27.
- **008 (importação completa de operações):** rascunho novo, só a visão geral e as regras; 6 perguntas abertas. Depois de aprovada, viram 009 (Asaas), 010 (Mercado Pago) e 011 (outros bancos).
- **Correção fora de spec:** PR #8 (mensagem clara ao excluir conta com lançamentos) mergeado e promovido para a `main` (PR #9) em 2026-11-27.
- Pendências fora das specs: Google já conectado no cfo (backup no Drive funcionando em 2026-11-27); webhooks do Asaas e do Mercado Pago do cfo já cadastrados pelo usuário
  (sem mexer no webhook "Gestão Comoequetalá").
  (Resolvido em 2026-11-27: o `.env` local passou a `ENABLE_INTERNAL_SCHEDULER=false` e o servidor local foi reiniciado; só o cfo roda as rotinas diárias.)
- Fluxo de cada spec: `/sdd-plan`, `/sdd-tasks`, `/sdd-implement`, `/sdd-verify` (Claude) ou `/sdd:plan` etc. (Gemini); promoção `dev` → `main` feita pelo agente (autorizada em 2026-11-27) quando tsc, testes e build passam e não há migration pendente; verificação no cfo.
