# Spec 001 — Remover referências a "Módulo N" da interface

- **Status:** rascunho
- **Criada em:** 2026-11-26
- **Aprovada em:** —
- **Responsável pela aprovação:** usuário

## Problema
A interface mostra termos do processo de desenvolvimento ("Módulo 1 · Acesso restrito", "Módulo 3 · Projetos…",
"Módulo 5 · Inteligência…", "Módulo 6 · Integrações", nomes de migration como `0004_module4_health_debts_taxes.sql`).
O usuário final não deve ver nada disso. O levantamento encontrou 43 ocorrências em 19 arquivos de `src/`.

## Histórias de usuário
- Como titular, quero ver apenas o nome das áreas do sistema, sem numeração de módulos, para que o produto pareça um sistema único e finalizado.

## Comportamento esperado
- Cabeçalhos e etiquetas de seção mostram só o nome da área (ex.: "Integrações", "Projetos & Viabilidade").
- A tela de login mostra uma etiqueta neutra (ex.: "Acesso restrito") sem "Módulo 1".
- Na tela de Segurança & SQL, os títulos dos blocos de migration usam rótulos descritivos
  ("Estrutura base", "Núcleo financeiro", "Projetos", "Saúde, dívidas e impostos", "CFO virtual e MCP", "Integrações e backup").
  O conteúdo SQL exibido pode manter os nomes reais dos arquivos **somente dentro do código/SQL**, não nos títulos.
- Nada muda em comportamento, rotas, banco ou nomes de arquivos.

## Critérios de aceite
- [ ] CA1: nenhum texto visível ao usuário contém "Módulo" seguido de número, em nenhuma tela (conferido navegando todas as seções, claro e escuro).
- [ ] CA2: busca no código por `m[óo]dulo [0-9]` em `src/` retorna apenas comentários internos, nenhum literal de interface.
- [ ] CA3: o `<title>`, o manifesto PWA e mensagens de erro/alerta também não citam módulos.
- [ ] CA4: `npx tsc --noEmit`, `npm test` e `npm run build` continuam passando (testes que dependem dos textos antigos são atualizados).

## Fora de escopo
- Renomear arquivos, pastas e migrations (`module1_…`).
- Mudar a identidade/nome do sistema (spec 005).

## Restrições e princípios aplicáveis
- Constituição nº 7 e 8 (aparência padrão preservada; interface sem jargão interno).

## Perguntas abertas
- Como chamar cada etiqueta de seção? Proposta: usar o próprio nome do item de menu. Preferem outro padrão?
- Os títulos de migration na tela de Segurança devem permanecer visíveis, ou a tela pode esconder esse bloco para quem não for administrador?

## Registro de verificação
—
