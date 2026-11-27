# Plan NNN — Título

- **Status:** rascunho
- **Spec:** `specs/NNN-slug/spec.md` (deve estar `aprovado`)
- **Criado em:** AAAA-MM-DD
- **Aprovado em:** —

## Abordagem
Resumo da solução escolhida e por quê (descartar alternativas em uma linha cada).

## Arquivos afetados
- `caminho` — o que muda
- Reaproveitar: funções/utilitários existentes (com caminho)

## Banco de dados
Migrations (`supabase/migrations/NNNN_*.sql`), RLS, GRANTs por coluna. **Aplicadas manualmente pelo usuário**: indicar quando.

## Contratos (API / tipos)
Rotas, payloads, tipos TypeScript novos.

## Riscos e mitigação
- …

## Rollback
Como desfazer (código e, se houver, migration).

## Estratégia de teste
Testes automatizados a criar (`npm test`) e verificação manual no h-cfo, ligada aos critérios de aceite da spec.
