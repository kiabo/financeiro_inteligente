import { ACCOUNT_HAS_TRANSACTIONS_MESSAGE, friendlyDeleteAccountError } from '../repository';

export interface AccountDeletionTestResult {
  name: string;
  passed: boolean;
  details: string;
}

/** Exclusão de conta com lançamentos: a mensagem precisa dizer o que fazer (antes o clique falhava em silêncio). */
export function runAccountDeletionTests(): AccountDeletionTestResult[] {
  const results: AccountDeletionTestResult[] = [];
  const record = (name: string, fn: () => void) => {
    try {
      fn();
      results.push({ name, passed: true, details: 'ok' });
    } catch (err) {
      results.push({ name, passed: false, details: err instanceof Error ? err.message : String(err) });
    }
  };
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
  };

  record('excluir conta com lançamentos: o erro de chave estrangeira vira a mensagem orientadora', () => {
    const byCode = friendlyDeleteAccountError({
      code: '23503',
      message: 'update or delete on table "financial_accounts" violates foreign key constraint "transactions_account_id_fkey" on table "transactions"',
    });
    assert(byCode.message === 'Esta conta tem lançamentos; apague ou mova os lançamentos antes.', `código 23503: ${byCode.message}`);
    const byName = friendlyDeleteAccountError({
      message: 'violates foreign key constraint "transactions_destination_account_id_fkey" on table "transactions"',
    });
    assert(byName.message === ACCOUNT_HAS_TRANSACTIONS_MESSAGE, `pelo nome da restrição: ${byName.message}`);
    assert(!/constraint|financial_accounts/.test(byCode.message), 'sem jargão do banco');
  });

  record('excluir conta: outros erros do banco continuam com o texto original', () => {
    const other = friendlyDeleteAccountError({ code: '42501', message: 'permission denied for table financial_accounts' });
    assert(other.message === 'permission denied for table financial_accounts', `mensagem: ${other.message}`);
  });

  return results;
}
