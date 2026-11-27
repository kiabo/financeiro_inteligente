# Plan 001 — Remover referências a "Módulo N" da interface

- **Status:** em-andamento
- **Spec:** `specs/001-remover-referencias-modulos/spec.md` (aprovada em 2026-11-27)
- **Criado em:** 2026-11-27
- **Aprovado em:** 2026-11-27

## Abordagem
Três frentes, sem mexer em rotas, banco nem nomes de arquivos:

1. **Etiquetas de seção** (`eyebrow`/subtítulos): trocar "Módulo N · …" pelo **nome do item de menu** da área
   (decisão do usuário: "seguir a proposta").
2. **Mensagens de erro/aviso** com "Módulo 6": reescrever sem o termo.
3. **Tela Segurança & SQL**: títulos descritivos e **esconder os blocos de migration para quem não for owner/admin**
   (decisão do usuário). Isso exige conhecer o papel real do usuário, ver "Descoberta" abaixo.

Alternativas descartadas: renomear arquivos/migrations (fora de escopo, risco sem ganho); remover a tela
de SQL por completo (o usuário quer manter para administradores).

## Descoberta que afeta o plano
`session.role` está **fixo em `'owner'`** em quatro pontos ([App.tsx:134](src/App.tsx#L134),
[LoginScreen.tsx:86, 207, 265](src/modules/auth/LoginScreen.tsx#L86)); o perfil real (`user_profiles.role`, enum
`owner|admin|analyst`) nunca é lido. Sem isso, "esconder para quem não for admin" seria inócuo.
A política `user_profiles_self_select` ([0001…sql:660](supabase/migrations/0001_module1_foundation.sql#L660)) já permite
ler a **própria** linha, então **não precisa de migration**.

## Arquivos afetados

### Etiquetas (troca de texto)
| Arquivo | Linhas | De → Para |
|---|---|---|
| `src/modules/projects/ProjectsView.tsx` | 540, 575 | "Módulo 3 · Projetos…/Viabilidade…" → "Projetos & Viabilidade" |
| `src/modules/ai-cfo/AiCfoView.tsx` | 288, 322 | "Módulo 5 · Inteligência Financeira…" → "CFO Virtual (IA)" |
| `src/modules/products/CatalogView.tsx` | 255 | "Módulo 2 · Precificação…" → "Produtos & Serviços" |
| `src/modules/ai-cfo/McpSettingsView.tsx` | 300 | "Módulo 5 · Conectividade Privada" → "Servidor MCP & Chaves" |
| `src/modules/core/views/OverviewView.tsx` | 125 | subtítulo "Módulo 1 · Fundação Segura, …" → "Fundação segura, hierarquia flexível e cofre de anonimização" |
| `src/modules/core/views/CashFlowView.tsx` | 283 | "Módulo 2 · Core Financeiro" → "Fluxo & Lançamentos" |
| `src/modules/integrations/AutomationCenterView.tsx` | 113 | "Módulo 6 · Automação & Continuidade" → "Alertas, Agenda & Backup" |
| `src/modules/integrations/ReconciliationView.tsx` | 227 | "Módulo 6 · Conciliação" → "Conciliação Bancária" |
| `src/modules/integrations/IntegrationsHubView.tsx` | 236 | "Módulo 6 · Integrações" → "Integrações & Webhooks" |
| `src/modules/health/DebtsTaxesView.tsx` | 442, 472 | "Módulo 4 · Passivos…" → "Dívidas & Impostos" |
| `src/modules/health/HealthCommandCenterView.tsx` | 386, 421 | "Módulo 4 · Diagnóstico/Command Center" → "Saúde Financeira" |
| `src/modules/health/DreView.tsx` | 254, 285 | "Módulo 4 · Demonstração…/Análise…" → "DRE Gerencial" |
| `src/modules/auth/LoginScreen.tsx` | 438 | "Módulo 1 · Acesso Restrito" → "Acesso Restrito" |

Onde o texto já é um rótulo de seção, mantém-se o estilo (caixa-alta/tracking) da etiqueta existente.

### Mensagens
- [integrationsApi.ts:24](src/modules/integrations/integrationsApi.ts#L24): "Este recurso do Módulo 6 exige…" → "Este recurso exige o Supabase configurado (o modo sandbox não o suporta)."
- [moduleUi.tsx:140](src/modules/integrations/components/moduleUi.tsx#L140): idem, sem "do Módulo 6".

### Segurança & SQL ([SecurityAuditView.tsx](src/modules/settings/SecurityAuditView.tsx))
- Títulos dos 5 blocos (linhas 330, 354, 379, 404, 431):
  "Estrutura base", "Núcleo financeiro", "Projetos", "Saúde, dívidas e impostos", "CFO virtual e MCP",
  prefixados por "Migração SQL ·". Os nomes de arquivo saem do título; ficam só como comentário no código.
- Botões "Copiar SQL M1…M5" → "Copiar SQL".
- Os cinco blocos de migration só renderizam quando `session.role` é `owner` ou `admin`
  (condição única `canSeeSql`). Convites e auditoria continuam como estão.
- Não incluir o bloco da migration 0006 (integrações/backup), que hoje nem é exibido: sem mudança.

### Papel real do usuário
- `src/modules/core/repository.ts`: nova `fetchOwnRole(userId): Promise<AppRole>` lendo
  `user_profiles.select('role').eq('id', userId).maybeSingle()`; em erro ou ausência devolve `'analyst'`
  (privilégio mínimo). Modo sandbox continua `'owner'`.
- `src/App.tsx` (`bootstrapSession`, linha ~129) e `src/modules/auth/LoginScreen.tsx` (caminhos Supabase, linhas ~86 e ~207):
  usar `await fetchOwnRole(user.id)` no lugar do `'owner'` fixo. O caminho sandbox (linha ~265) fica `'owner'`.
  (Correção de 2026-11-27: a versão inicial do plano tinha invertido as linhas; confirmado pelo código.)
- O rótulo "AAL2 · OWNER" no [AppShell.tsx:319](src/modules/core/components/AppShell.tsx#L319) passa a refletir o papel real.

### Fora do que muda (propositalmente)
- Comentários de código, nomes de funções/variáveis (`module2Pulse`), nomes de suítes de teste e nomes de arquivos.
- `SANDBOX_STORAGE_KEY = 'vertice_module1_sandbox_v1'` (renomear apagaria o sandbox local de quem já usa).
- Imports `?raw` das migrations (conteúdo do SQL permanece, inclusive nomes internos).

## Banco de dados
Nenhuma migration. Nenhuma ação manual do usuário.

## Contratos (API / tipos)
- `fetchOwnRole(userId: string): Promise<AppRole>` (novo, só cliente).
- Nenhuma rota ou tipo de resposta muda.

## Riscos e mitigação
- **Papel lido como `analyst` por erro de leitura** esconderia o bloco SQL de um admin. Mitigação: em erro, log no console e
  o bloco só some (nenhuma outra função depende do papel hoje). O usuário atual é `owner` (verificar no h-cfo).
- **Efeito colateral ao ler o papel real**: qualquer lógica que presuma `owner` fixo. Mitigação: busca por `session.role`/`.role ===` antes de implementar
  (hoje só AppShell o exibe e o SecurityAuditView passa a usar).
- **Textos longos nas etiquetas** quebrando layout: os nomes de menu são curtos; conferir em telas estreitas (mobile).

## Rollback
Reverter o commit (somente front-end e texto). Sem migration, sem estado persistido novo.

## Estratégia de teste
- **Teste automático novo** `src/modules/core/__tests__/noModuleLabels.test.ts`, registrado em `scripts/run-tests.ts`:
  varre `src/**/*.{ts,tsx}`, remove comentários (`//`, `/* */`, `{/* */}`) e falha se restar `/m[óo]dulo\s*\d/i`
  em qualquer literal/JSX (CA1/CA2/CA3). Ignora os arquivos `__tests__`.
- Teste unitário de `canSeeSql(role)` (owner/admin → true; analyst → false).
- `npx tsc --noEmit`, `npm test`, `npm run build`.
- **Manual no h-cfo** (CA1): percorrer as 15 seções em claro e escuro e em largura mobile; abrir Segurança & SQL como owner
  (vê os blocos) e confirmar a etiqueta de papel no menu lateral; `grep` final em `dist/` pelo padrão não retorna literais de interface.
