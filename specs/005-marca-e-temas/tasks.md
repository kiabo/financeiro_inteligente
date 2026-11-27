# Tasks 005 — Nome e marca do sistema

- **Status:** rascunho
- **Plan:** `specs/005-marca-e-temas/plan.md` (aprovado em 2026-11-27, incluindo a exceção à constituição nº 2)
- **Branch:** `feat/005-marca-e-temas` (saindo da `dev`)
- **Aprovado em:** —

Uma tarefa por vez, em ordem. Marque `[x]` ao concluir. Commit: `feat(005): descrição (T01)`.
Antes de cada commit: `npx tsc --noEmit && npm test` (e `npm run build` nas tarefas de tela).
Tarefas marcadas **(usuário)** dependem de uma ação sua; eu não as simulo.
Pré-requisito: a spec 006 vem antes e cria `server/integrations/authz.ts`; se a 005 vier primeiro, a T05 o cria. Se a 006 não tiver usado a `0009`, a migration desta spec passa a ser `0009`.
Nomes técnicos que **não** mudam: formato `vertice-backup`, extensão `.vtxbak`, prefixo `vertice-backup-`, `vertice-privacy-mcp`, `vertice_product`, chaves `vertice_*` do navegador, `vertice-credentials-v1`.

## Banco

- [ ] T01 — Escrever `supabase/migrations/0010_marca_do_sistema.sql`: valor de auditoria `branding.updated`, tabela `app_branding` de uma linha (`id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id)`, nomes com limites de tamanho, caminhos, `assets_version`, `updated_by`, `updated_at`) com RLS + FORCE RLS **sem política** e `REVOKE ALL` de `anon`/`authenticated`,
  bucket privado `branding` (512 KB; PNG, JPEG, WebP, ICO) sem política em `storage.objects`, e rollback comentado.
  **Pronto quando:** o arquivo é idempotente, não usa o valor novo do enum na mesma transação e passa em leitura linha a linha contra a `0006` e a `0008`. (CA4)

- [ ] T02 — **(usuário)** Aplicar a migration no SQL Editor do Supabase (pode ser já; é só aditiva e o código antigo ignora a tabela).
  **Pronto quando:** você confirma; eu consigo ler `select count(*) from app_branding` pelo app (retorna 0). (CA4)

## Servidor

- [ ] T03 — `server/brand/imageValidation.ts` (`detectImageType` pelos bytes iniciais; limites logo 512 KB e favicon 256 KB); testes **antes** em `server/__tests__/brand.test.ts` (registrar em `scripts/run-tests.ts`).
  **Pronto quando:** PNG, JPEG, WebP e ICO são aceitos; SVG, HTML renomeado, arquivo vazio e arquivo acima do limite são recusados. (CA3)

- [ ] T04 — `server/brand/brandStore.ts`: padrões (`Vértice`/`Vértice`, sem imagens), `getBrand()` com cache de 60 s, `saveBrand()` com validação do nome (2–40 caracteres, sem `<`, `>` nem caracteres de controle; nome curto 1–12), `resetBrand()`, `getBrandName()`; testes **antes**.
  **Pronto quando:** sem linha na tabela o resultado é exatamente o padrão atual; nomes com HTML são recusados; salvar invalida o cache. (CA1, CA2)

- [ ] T05 — `server/integrations/authz.ts` (`requireAdminRole`, se ainda não existir) e `server/brand/brandRoutes.ts`: `GET /api/brand` público (só os 5 campos), `GET /api/brand/logo` e `/favicon` públicos (`Content-Type` fixo, `nosniff`, cache longo por versão), `PUT /api/brand`, `POST /api/brand/logo`, `POST /api/brand/favicon`, `DELETE /api/brand` só para `owner`/`admin`, com auditoria `branding.updated`; montadas em `server.ts` antes do `express.static`.
  **Pronto quando:** testes cobrem 401 sem login, 403 para `analyst`, 415 para tipo recusado, GET público com exatamente as chaves esperadas, e que o upload substitui o arquivo antigo e sobe a versão. (CA3, CA4)

- [ ] T06 — Manifesto e título servidos: `GET /manifest.webmanifest` dinâmico (lê o do `dist` e troca `name`/`short_name`), troca de `<title>`, `og:title` e `apple-mobile-web-app-title` no `index.html` servido em produção (valores escapados) e `globIgnores: ['manifest.webmanifest']` no Workbox em `vite.config.ts`.
  **Pronto quando:** testes confirmam o nome (escapado) no manifesto e no HTML servido, `npm run build` passa e `dist/sw.js` não pré-armazena o manifesto. (CA2, CA5)

- [ ] T07 — Nome nos textos do servidor: `compose*` com `brandName` (padrão `'Vértice'`), `dailyJobs`/`automationRoutes` passam `await getBrandName()`, `calendarSync`, `aiProvider` (instruções viram funções), `mcpHandler` (`privacyNotice`), `webhookRoutes` ("Evento de teste"), nome exibido da pasta do Drive. Nomes técnicos intocados.
  **Pronto quando:** com `brandName: 'Nome Teste'` assunto, rodapé, WhatsApp de teste, instruções do CFO e mensagem do calendário usam o nome; sem ele os textos são idênticos aos de hoje (testes antigos verdes); um teste confere que prefixo, formato e extensão do backup e `vertice-privacy-mcp` não mudaram. (CA1, CA7)

## Cliente

- [ ] T08 — `src/modules/core/brandApi.ts` e `src/modules/core/brand.tsx` (`BrandProvider`, `useBrand()`, padrões, cache local só de nome e versão, atualização de `document.title` e do ícone da aba) em lugar de `brand.ts`; testes **antes** em `src/modules/core/__tests__/brand.test.ts`.
  **Pronto quando:** sem resposta do servidor o cliente usa exatamente os padrões atuais; uma resposta válida troca nome e ícone; resposta inválida é ignorada. (CA1, CA5)

- [ ] T09 — Aplicar a marca: `main.tsx` (provedor), `App.tsx` (título), `AppShell.tsx` (logo e nome nas duas ocorrências), `LoginScreen.tsx` (logo, nome, `friendlyName` e `issuer` do TOTP só em inscrições **novas**), `PWAInstallButton.tsx`.
  **Pronto quando:** `npm run build` passa e, no navegador local, trocar a resposta de `/api/brand` muda menu, login, título da aba e botão de instalar; sem personalização as telas são idênticas às de hoje, em claro e escuro. (CA1, CA2, CA3, CA5)

- [ ] T10 — `BrandSettingsView.tsx` + seção `brand`: `AppSection` em `types.ts`, título e URL em `routes.ts` (regra da spec 002), item "Marca" no menu **só para `owner`/`admin`**, rota em `App.tsx`. A tela traz nome, nome curto, envio de logo e favicon, **pré-visualização** em claro e escuro antes de salvar, aviso de fundo opaco por função pura sobre os pixels (CA6), "Restaurar padrão" com confirmação e a nota de que o ícone do app instalado não muda.
  **Pronto quando:** `npm run build` passa; a tela não aparece para `analyst`; o aviso de fundo opaco funciona em PNG com e sem transparência (teste da função pura); salvar sem arquivos não apaga imagens existentes. (CA3, CA4, CA6)

## Documentos e publicação

- [ ] T11 — `docs/architecture.md` (seção "Marca da instância", lista dos nomes técnicos que não mudam, `brand.ts` → `brand.tsx`) e `specs/README.md` (005 `em-andamento`).
  **Pronto quando:** as duas atualizações existem. (—)

- [ ] T12 — Publicar: `npx tsc --noEmit && npm test && npm run build` verdes, PR para `dev`, merge, promoção `dev` → `main` e deploy acompanhado, com a migration (T02) já aplicada.
  **Pronto quando:** o deploy da `main` termina com sucesso, `GET /api/brand` responde o padrão e o cfo continua idêntico ao de antes. (CA1)

- [ ] T13 — Verificação final no **cfo** contra todos os critérios (`/sdd-verify 005`): CA1 com as telas principais em claro e escuro antes de trocar; trocar nome e enviar logo/favicon e ver menu, login (janela anônima), aba, `/manifest.webmanifest`; "Testar alerta" com assunto novo; logo em claro e escuro; recusa de arquivo inválido.
  CA4 para `analyst` só por teste automático (não há usuário `analyst`), dito no registro. **Você escolhe o nome e o logo definitivos** (o nome de teste é revertido ao fim se você preferir, com "Restaurar padrão").
  **Pronto quando:** o "Registro de verificação" tem cada CA com resultado, evidência e data; spec, plan e tasks `concluído`. (CA1–CA7)

## Notas de execução
(decisões e descobertas durante a implementação; mudança de escopo → parar e atualizar a spec)
