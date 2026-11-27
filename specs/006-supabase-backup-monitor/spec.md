# Spec 006 — Supabase Free com backup e monitor de uso

- **Status:** em-andamento
- **Criada em:** 2026-11-26
- **Aprovada em:** 2026-11-27
- **Responsável pela aprovação:** usuário

## Problema
O sistema depende do Supabase (plano Free). O usuário teme custo e risco. Decisão tomada: **ficar no Free agora**,
sem self-hosting. O plano Free não tem backup diário gerenciado, limita o banco a 500 MB e o Storage a 1 GB,
e pausa projetos inativos por 7 dias.

## Histórias de usuário
- Como titular, quero uma cópia diária do banco guardada no meu VPS, para me recuperar de qualquer problema.
- Como titular, quero ver o quanto do limite Free estou usando e ser avisado antes de estourar.
- Como titular, quero saber o caminho para migrar para o Supabase self-hosted no futuro.

## Comportamento esperado
- Todo dia às **03:00** (America/Sao_Paulo), um job no VPS faz `pg_dump` do banco do Supabase, cifra com a chave de backup e guarda em
  `/opt/financeiro-inteligente/backups`, mantendo os últimos 14 dias.
- A mesma cópia cifrada também é enviada ao **Google Drive** do titular (pasta própria, retenção própria de 14 arquivos), em paralelo ao backup lógico do app.
- Há um comando/rotina de **teste de restauração** num Postgres temporário, comparando contagens das tabelas principais.
- Em Segurança & SQL, painel "Uso do plano": tamanho do banco (de 500 MB) e do Storage (de 1 GB), com aviso a partir de 70%.
- Alerta (e-mail/WhatsApp, já existentes) quando o backup diário falhar ou o uso passar de 70%.
- Documento `docs/supabase-self-host.md` descrevendo o caminho de migração (recursos, passos, riscos), sem executá-lo.
- O backup criptografado atual no Google Drive (o lógico do app) continua existindo, com o seu horário e retenção atuais.

## Critérios de aceite
- [ ] CA1: após 24 h existe um arquivo cifrado novo por dia, e arquivos com mais de 14 dias são removidos.
- [ ] CA2: o teste de restauração reproduz o banco num Postgres temporário e as contagens das tabelas principais batem.
- [ ] CA3: o arquivo de backup não é legível sem a chave (conteúdo cifrado).
- [ ] CA4: o painel mostra tamanho do banco e do Storage corretos (conferir com o painel do Supabase).
- [ ] CA5: com uso simulado acima de 70%, o aviso aparece na tela e o alerta é enviado.
- [ ] CA6: falha forçada do backup gera alerta.
- [ ] CA8: depois do backup diário, o arquivo cifrado do `pg_dump` aparece no Drive, na pasta própria, e arquivos além dos 14 mais recentes são removidos de lá.
- [ ] CA7: a senha do banco (connection string) não aparece em logs, repositório nem imagem Docker; fica só no env do VPS.

## Fora de escopo
- Instalar ou migrar para Supabase self-hosted (apenas documentar).
- Trocar o banco por PostgreSQL/MySQL puro.
- Replicação ou alta disponibilidade.

## Restrições e princípios aplicáveis
- Constituição nº 3 (segredos), nº 9 (reversível). O usuário fornece a connection string do banco no env do VPS.

## Perguntas abertas
- Nenhuma. (Resolvida: o `pg_dump` cifrado também vai ao Drive, mantendo os dois backups, cada um com a sua retenção.)

## Respostas do usuário
- **Horário do backup diário:** 03:00 (America/Sao_Paulo), conforme a proposta (2026-11-27: "às 3 serve sim").
- **Backup do VPS também no Drive:** sim, mantendo o backup lógico do app e o `pg_dump`, cada um com a sua retenção (2026-11-27: "sim, confirmo").

## Registro de verificação
—
