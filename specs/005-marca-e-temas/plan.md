# Plan 005 — Nome e marca do sistema

- **Status:** aprovado
- **Spec:** `specs/005-marca-e-temas/spec.md` (aprovado em 2026-11-27)
- **Criado em:** 2026-11-27
- **Aprovado em:** 2026-11-27

## Abordagem
Uma **marca única da instância** (nome, nome curto, logo, favicon), guardada numa tabela de uma só linha, **lida e gravada somente pelo servidor** (service role).
O navegador a obtém por uma rota pública `GET /api/brand` (antes do login) e a aplica no menu, no login, no título da aba e no favicon. O servidor também usa o nome nos e-mails, nos alertas de WhatsApp e nas instruções do CFO virtual.

Decisões e alternativas descartadas:
- **Tabela sem `tenant_id` (exceção à constituição nº 2, a aprovar com este plano).** A marca é da instância, não de um titular. A proteção que o `tenant_id` daria é substituída por: RLS + FORCE RLS **sem nenhuma política** para `anon`/`authenticated` e `REVOKE ALL`; ninguém além do servidor toca na tabela. Descartado: uma linha por tenant com `BRANDING_TENANT_ID` (a decisão do usuário é a mesma marca para todos).
- **Imagens servidas pelo próprio servidor** (`GET /api/brand/logo`, `/api/brand/favicon`), de um bucket **privado** `branding`. Descartado: bucket público (expõe um domínio e uma política de Storage a mais) e SVG (pode carregar script; aceitamos só PNG, JPEG, WebP e ICO, conferidos pelos primeiros bytes do arquivo, não pelo que o navegador declara).
- **Só administradores alteram**: `owner` e `admin` de `user_profiles.role`, checado **no servidor** em toda escrita (`requireAdminRole`, o mesmo helper criado no plano 006; se a 005 vier antes, ela o cria). A tela só aparece para eles, mas a trava real é a API.
- **Nome padrão continua "Vértice"** enquanto ninguém trocar (CA1: sem personalização, tudo idêntico). O usuário troca logo depois do deploy.
- **Nomes técnicos não mudam** (decisão da spec): formato `vertice-backup` e extensão `.vtxbak`, `vertice-privacy-mcp`, metadado `vertice_product` do Stripe, chaves do `localStorage` (`vertice_*`), `vertice-credentials-v1` (derivação de chave). Mudá-los quebraria restauração, sessões e integrações.
- **Ícone instalado do PWA continua o padrão** (192/512 px): redimensionar imagem exigiria uma biblioteca nova. O **nome** do PWA muda; o ícone fica como evolução futura (a tela diz isso). A spec fala de nome no PWA, não de ícone.
- **Manifesto do PWA dinâmico**: o servidor responde `/manifest.webmanifest` lendo o arquivo gerado no build e trocando `name` e `short_name`. O mesmo vale para o `<title>` e as metatags no `index.html` servido.

## Arquivos afetados
Servidor
- `supabase/migrations/0010_marca_do_sistema.sql` — **novo** (ver Banco). Número `0010` porque a `0009` é da spec 006; se a ordem de implementação mudar, os números se trocam.
- `server/brand/brandStore.ts` — **novo**: `getBrand()` (cache em memória de 60 s, invalida ao salvar), `saveBrand()`, `getBrandName()`, valores padrão (`Vértice`, `Vértice`, sem imagens).
- `server/brand/imageValidation.ts` — **novo**: `detectImageType(bytes)` (PNG, JPEG, WebP, ICO pelos bytes iniciais), limites (logo ≤ 512 KB, favicon ≤ 256 KB).
- `server/brand/brandRoutes.ts` — **novo**: rotas abaixo; montado em `server.ts` **antes** do `express.static` e sem exigir sessão só em `GET`.
- `server/integrations/authz.ts` — `requireAdminRole(userId)` (plano 006; reaproveitar).
- `server.ts` — monta `brandRoutes`; `GET /manifest.webmanifest` dinâmico; o `app.get('*')` troca `<title>`, `og:title` e `apple-mobile-web-app-title` do `index.html` (valores escapados) em produção.
- `vite.config.ts` — `globIgnores: ['manifest.webmanifest']` no Workbox, para o manifesto não ficar congelado no cache do service worker.
- `server/integrations/alerts/notificationService.ts` — `compose*` ganham o parâmetro `brandName` (padrão `'Vértice'`, então os testes atuais continuam valendo); rodapés e assuntos usam o nome.
- `server/integrations/dailyJobs.ts`, `server/integrations/automationRoutes.ts` — passam `await getBrandName()` ao compor alertas, e-mail e WhatsApp de teste.
- `server/integrations/alerts/calendarSync.ts` — "Origem: {nome}" e "Abra o {nome}…".
- `server/aiProvider.ts` — `CFO_ANALYSIS_SYSTEM_INSTRUCTION` e `CFO_CHAT_SYSTEM_INSTRUCTION` viram funções do nome; chamadas em `server.ts` passam o nome.
- `server/mcpHandler.ts` — `privacyNotice` ("Cofre Vértice") usa o nome; **`vertice-privacy-mcp` não muda**.
- `server/integrations/webhookRoutes.ts` — "Evento de teste {nome}".
- `server/integrations/backupService.ts` e `google/googleClient.ts` — nome **exibido** da pasta do Drive e da descrição usam o nome; **prefixo de arquivo, formato e extensão não mudam**. A pasta já criada com o nome antigo continua sendo usada pelo `drive_folder_id`.

Cliente
- `src/modules/core/brand.ts` → vira `src/modules/core/brand.tsx`: `BrandProvider`, `useBrand()`, valores padrão, cache em `localStorage` (só nome e versão; sem dado sensível) para a aba não piscar o nome antigo, e atualização de `document.title` e do ícone da aba.
- `src/main.tsx` (ou o ponto de entrada) — envolve o app com `BrandProvider`.
- `src/App.tsx` — título da aba usa `useBrand()` (substitui `APP_NAME`); seção nova `brand`.
- `src/modules/core/components/AppShell.tsx` — logo e nome do menu (duas ocorrências do `<img>` e do nome); item "Marca" no grupo de governança, **só para `owner`/`admin`**.
- `src/modules/auth/LoginScreen.tsx` — logo e nome na coluna da esquerda; `friendlyName` e o `issuer` do TOTP usam o nome nas **novas** inscrições (as já feitas não mudam).
- `src/modules/core/pwa/PWAInstallButton.tsx` — "Instalar {nome}".
- `src/modules/core/types.ts` (`AppSection`) e `src/modules/core/routes.ts` — seção `brand` (título "Marca", URL própria, regra da spec 002).
- `src/modules/settings/BrandSettingsView.tsx` — **novo**: nome, nome curto, envio de logo e favicon, **pré-visualização** (claro e escuro) antes de salvar, aviso de fundo opaco (CA6), botão "Restaurar padrão".
- `src/modules/core/brandApi.ts` — **novo**: `fetchBrand()` (sem sessão), `saveBrand()`, `uploadBrandImage()`, `resetBrand()`.
- `src/modules/core/repository.ts` — o dado de demonstração do sandbox ("Vértice Consultoria") **não muda** (é dado de exemplo, não marca).
- `docs/architecture.md` — seção "Marca da instância".

Testes: `server/__tests__/brand.test.ts` — **novo**; `src/modules/core/__tests__/brand.test.ts` — **novo**; registrar em `scripts/run-tests.ts`.

## Banco de dados
**Migration `0010_marca_do_sistema.sql`** — aplicada **manualmente pelo usuário**, antes do deploy do código (o código novo lê a tabela; sem ela, `GET /api/brand` devolve o padrão e a tela de edição mostra "indisponível", ou seja, falha de forma segura). Idempotente:
- `ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'branding.updated';`
- `CREATE TABLE IF NOT EXISTS public.app_branding` (uma linha: `id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id)`, `app_name` 2–40 caracteres, `short_name` 1–12, `logo_path`, `favicon_path`, `assets_version`, `updated_by` → `auth.users` ON DELETE SET NULL, `updated_at`), `ENABLE` + `FORCE ROW LEVEL SECURITY`, **sem política**, `REVOKE ALL … FROM anon, authenticated`.
- Bucket `branding` **privado**, `file_size_limit` 524288, tipos `image/png`, `image/jpeg`, `image/webp`, `image/x-icon`, `image/vnd.microsoft.icon`; **nenhuma** política em `storage.objects` (só a service role acessa).
- Rollback comentado no fim do arquivo: `DROP TABLE public.app_branding;` e remoção do bucket (o valor do enum não é removível; é inofensivo).

## Contratos (API / tipos)
- `GET /api/brand` — **público**, sem sessão, cache `no-cache` com `ETag`; devolve `{ appName, shortName, logoUrl: string | null, faviconUrl: string | null, version: number }` (URLs relativas com `?v=version`). Nada além disso.
- `GET /api/brand/logo` e `GET /api/brand/favicon` — **públicos**; devolvem os bytes com o `Content-Type` detectado, `Cache-Control: public, max-age=31536000, immutable` (a URL muda com `?v=`), `X-Content-Type-Options: nosniff`; `404` se não houver imagem.
- `PUT /api/brand` — JWT aal2 + `owner`/`admin`. Body `{ appName, shortName }`. Valida tamanho e remove espaços; `403` para `analyst`. Grava `updated_by` e auditoria `branding.updated` (sem o conteúdo das imagens).
- `POST /api/brand/logo` e `POST /api/brand/favicon` — mesmo acesso; corpo binário (`express.raw`, limite 512 KB/256 KB); confere o tipo pelos bytes; `415` se não for imagem aceita; substitui o arquivo antigo e sobe `assets_version`.
- `DELETE /api/brand` — mesmo acesso; volta ao padrão (apaga a linha e as imagens).
- Tipo: `Brand = { appName: string; shortName: string; logoUrl: string | null; faviconUrl: string | null; version: number }`.
- A tela de login só usa `GET /api/brand`; não há dado sensível em nenhuma dessas respostas (CA4).

## Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Nome da marca com HTML/script entrando no `<title>`, no manifesto ou em e-mail | Validação no servidor (sem `<`, `>` e caracteres de controle; 2–40 caracteres), escape ao injetar no `index.html`, JSON no manifesto, `escapeHtml` já usado nos e-mails |
| Upload malicioso disfarçado de imagem | Tipo detectado pelos bytes, SVG recusado, limites de tamanho, `nosniff`, servido por rota nossa com `Content-Type` fixo |
| Aparência mudar sem personalização (CA1) | Sem linha na tabela o servidor devolve os padrões e o cliente usa `/icon.svg` e "Vértice"; teste de captura de tela antes e depois no cfo |
| Piscar do nome antigo ao abrir (cache do service worker) | Cache local da marca + `index.html` já servido com o nome atual; `manifest.webmanifest` fora do precache |
| PWA já instalado manter o nome antigo | O navegador relê o manifesto de tempos em tempos; pode ser preciso reinstalar. Dito na tela e no registro de verificação |
| Administrador apagar a marca sem querer | Botão "Restaurar padrão" pede confirmação; o histórico fica na auditoria |
| Código novo no ar sem a migration aplicada | Falha segura: padrão visível, edição indisponível com mensagem clara; a ordem combinada é migration **antes** do merge |
| Substituir nomes em e-mails quebrar testes existentes | `brandName` com padrão `'Vértice'`; `module6Server.test.ts` continua passando sem alteração |
| Trocar um nome técnico por engano | Lista fechada de nomes que **não** mudam (acima) e teste que confere que `BACKUP_FILE_PREFIX`, o formato e a extensão continuam iguais |

## Rollback
- Código: reverter o PR; a marca volta a ser a fixa do código.
- Banco: o script de rollback no fim da migration (tabela e bucket). Se só reverter o código, a tabela fica sem uso e sem risco.
- Se o novo nome causar problema: `DELETE /api/brand` (botão "Restaurar padrão") volta ao "Vértice".

## Estratégia de teste
Automatizados (`npm test`):
- **CA1:** `getBrand()` sem linha devolve exatamente os padrões; `useBrand` sem resposta do servidor usa os mesmos; `compose*` sem `brandName` gera o mesmo texto de hoje (testes existentes).
- **CA2/CA7:** com `brandName: 'Nome Teste'`, assunto e rodapé dos alertas, texto do WhatsApp de teste, instruções do CFO virtual, `privacyNotice`, "Evento de teste" e a mensagem do calendário usam o nome; o manifesto e o `index.html` servidos trazem o nome (escapado).
- **CA3:** `detectImageType` aceita PNG/JPEG/WebP/ICO e recusa SVG, HTML renomeado para `.png`, arquivo vazio e arquivo acima do limite.
- **CA4:** `PUT/POST/DELETE` recusam `analyst` (403) e quem não está logado (401); `GET` público devolve só os cinco campos esperados (teste compara as chaves).
- **CA6:** a detecção de fundo opaco, por função pura sobre os pixels (PNG com e sem transparência).
- Nomes técnicos: o prefixo, o formato e a extensão do backup e `vertice-privacy-mcp` não mudaram.

Verificação manual no cfo (`/sdd-verify 005`), depois da migration e do deploy:
- CA1: telas principais em claro e escuro, antes de trocar o nome.
- CA2/CA3/CA5/CA6: trocar nome e enviar logo/favicon; ver menu, login (em janela anônima, sem sessão), aba, claro e escuro.
- CA4: com outro papel (se houver um usuário `analyst` convidado) a tela não aparece; sem isso, só por teste automático e leitura do código, e o registro diz isso.
- CA7: "Testar alerta" (e-mail/WhatsApp) e conferir o assunto com o nome novo.
- PWA: abrir `/manifest.webmanifest` e conferir `name`.
