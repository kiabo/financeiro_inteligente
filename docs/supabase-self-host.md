# Caminho para o Supabase self-hosted (referência, nada é executado)

Estado atual: o projeto usa o **Supabase Free na nuvem** (decisão da spec 006). Este documento só descreve o que seria preciso
para mudar para um Supabase próprio no VPS, se um dia compensar. Nenhum passo daqui foi feito.

## Quando faria sentido
- O banco chegando perto de 500 MB ou os arquivos de 1 GB (o monitor da aba "Banco e backups" avisa a partir de 70%).
- Pausa do projeto por inatividade, ou necessidade de backup gerenciado e de restauração a qualquer momento.
- Comparar sempre com o plano pago da nuvem (menos trabalho que operar tudo sozinho).

## O que é o Supabase self-hosted
Uma pilha de serviços em Docker Compose, mantida pelo próprio Supabase (`supabase/docker` no GitHub): Postgres, Auth (GoTrue), API REST (PostgREST),
Storage (e conversor de imagens), Realtime, Kong (porta de entrada), Studio (painel), Meta, funções Edge, coleta de logs e o pooler de conexões.
O app usa apenas **Auth (senha + Google + TOTP), Postgres com RLS e Storage**; Realtime e funções Edge não são usados e podem ser desligados para economizar memória.

## Recursos
| Item | Hoje no VPS | Necessário (estimativa) |
|---|---|---|
| Memória | 16 GB no total, cerca de 8,7 GB disponíveis com os outros serviços (Chatwoot, Evolution, MySQL, etc.) | 4 GB livres no mínimo; 8 GB com folga |
| CPU | 4 núcleos | 2 dedicados |
| Disco | 83 GB livres | banco + arquivos + backups + logs; hoje são ~15 MB de banco |
| Rede | nginx/CloudPanel já com HTTPS | um domínio novo (ex.: `db.seudominio`) para a API e outro para o Studio, só com acesso restrito |

## Passos (visão geral)
1. **Preparar o servidor:** domínio e HTTPS para a API; pasta própria `/opt/supabase`; firewall só com 80/443 abertos (Postgres e Studio nunca públicos).
2. **Subir a pilha:** copiar `docker/` do repositório oficial, gerar os segredos novos (senha do Postgres, segredo JWT, chaves `anon` e `service_role` assinadas com esse segredo, usuário do Studio) e subir só os serviços usados.
3. **E-mail e login:** configurar SMTP (convites e recuperação de senha), a URL do site e os redirecionamentos do app (cfo, h-cfo, localhost) e o login com Google (novo cliente OAuth com as novas URLs de retorno).
4. **Trazer os dados:** parar o app, fazer um backup novo do banco (aba "Banco e backups"), decifrar (`scripts/decrypt-db-backup.ts`) e restaurar com `pg_restore` no Postgres novo. O backup já inclui o schema `auth`, então usuários, fatores TOTP e convites vêm junto.
5. **Trazer os arquivos:** o Storage (hoje o bucket `receipts`, comprovantes) não está no `pg_dump`; copiar os arquivos por API (script próprio ou `rclone`) e conferir os caminhos.
6. **Apontar o app:** trocar `VITE_SUPABASE_URL` e a chave pública (entram no **build**, então precisa de novo deploy), `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_DB_URL` nos envs do VPS. Como a chave de cifragem dos segredos (`CREDENTIALS_ENCRYPTION_KEY`) não muda, as integrações continuam válidas.
7. **Conferir:** login com senha, Google e TOTP; um lançamento novo; comprovante; webhook de teste; backup e teste de restauração (`deploy/restore-test.sh`).
8. **Virar a chave:** liberar o app; manter o Supabase da nuvem intacto por alguns dias como plano de volta.

## Riscos
- **Operação é sua:** atualizações de segurança da pilha, monitoramento, espaço em disco, certificados. Se esquecer, ninguém avisa.
- **Backup deixa de ser "do provedor":** o `pg_dump` cifrado (já existente) vira a única proteção; testar a restauração regularmente.
- **Senhas dos usuários:** vêm no schema `auth` restaurado; conferir que o login funciona antes de desligar a nuvem.
- **Chaves antigas:** as chaves `anon`/`service_role` mudam. O que estiver instalado como PWA ou embutido num build antigo para de funcionar até atualizar.
- **Convivência com os outros serviços do VPS:** memória compartilhada; um pico de outro serviço pode derrubar o banco. Avaliar um servidor separado.
- **E-mail:** sem SMTP configurado, convites e recuperação de senha não saem.

## Como voltar atrás
Trocar de novo as variáveis do item 6 para as da nuvem e fazer deploy. Os dados criados no self-hosted nesse intervalo teriam de ser exportados (`pg_dump`) e reimportados; por isso o ideal é manter a nuvem só leitura por alguns dias e não apagar nada logo.
