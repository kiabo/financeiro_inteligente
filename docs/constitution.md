# Constituição do projeto

Princípios que nenhuma spec, plano ou tarefa pode violar. Se uma spec precisar quebrar um deles, a exceção
tem que estar escrita nela e aprovada pelo usuário.

1. **Privacidade por padrão.** Nenhum dado identificável (razão social, CNPJ, nomes) sai para IA externa.
   Só tokens analíticos (EMP_01, CTA_01…).
2. **Isolamento por tenant.** Toda tabela tem `tenant_id`, RLS e FORCE RLS. O servidor obtém o tenant do JWT,
   nunca do corpo da requisição.
3. **Segredos nunca no cliente nem no repositório.** `VITE_*` é público. Credenciais de terceiros ficam
   cifradas (AES-256-GCM) e nunca voltam em respostas da API.
4. **Idempotência em integrações.** Reenvio de webhook, reimportação e retentativa não duplicam lançamentos.
5. **Dinheiro é `NUMERIC`, nunca ponto flutuante.** Arredondamento e moeda explícitos.
6. **Regra de negócio tem teste.** Cálculo de saldo, deduplicação, taxas e conciliação têm testes em `npm test`.
7. **A aparência padrão não muda sem spec.** Refatorações visuais mantêm o resultado idêntico até que uma spec diga o contrário.
8. **Interface sem jargão interno.** O usuário não vê "Módulo N", nomes de migration nem termos de desenvolvimento.
9. **Mudanças reversíveis.** Toda migration e todo deploy têm caminho de volta descrito no plano.
10. **Dados reais com cautela.** Ambientes dev e prod compartilham o mesmo banco; operações destrutivas exigem confirmação.
