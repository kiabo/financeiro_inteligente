import {
  assert,
  assertClose,
  assertEqual,
  runCases,
  type TestCase,
  type TestCaseResult,
} from '../../../../scripts/testHarness.ts';
import type { Transaction, VaultEntry } from '../../core/types.ts';
import { prepareReceiptForAI } from '../ocrReceiptParser.ts';
import {
  extractReceiptFields,
  redactReceiptPII,
} from '../receiptHeuristics.ts';
import {
  matchStatementLines,
  parseCSV,
  parseOFX,
  parsePdfStatementText,
  parseStatementAmount,
  summarizeMatches,
} from '../reconciliationEngine.ts';

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261103120000[-3:BRT]<TRNAMT>1500.00<FITID>A1<MEMO>PIX RECEBIDO CLIENTE ALFA
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105<TRNAMT>-350.00<FITID>A2<MEMO>PAGTO ALUGUEL NOVEMBRO
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261110<TRNAMT>970.00<FITID>A3<MEMO>REPASSE GATEWAY
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261112<TRNAMT>-42.90<FITID>A4<MEMO>TARIFA PACOTE SERVICOS
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const tx = (p: Partial<Transaction> & Pick<Transaction, 'id' | 'transaction_type' | 'amount' | 'due_date'>): Transaction =>
  ({
    tenant_id: 't', company_id: 'c', account_id: 'acc', destination_account_id: null, category_id: null,
    product_service_id: null, project_id: null, status: 'pending', description: 'Lançamento', counterparty_name: null,
    competence_date: p.due_date, payment_date: null, installment_group_id: null, installment_number: null,
    installment_total: null, is_recurring: false, recurrence_frequency: null, notes: null, created_at: '', updated_at: '',
    ...p,
  }) as Transaction;

const VAULT: VaultEntry[] = [
  { id: 'v1', tenant_id: 't', entity_type: 'company', entity_id: 'c', analytical_token: 'EMP_01', real_label: 'Vértice Tecnologia', sensitive_identifier: '11222333000181', secondary_aliases: ['Vértice Tecnologia Ltda'], is_archived: false, created_at: '', updated_at: '' },
  { id: 'v2', tenant_id: 't', entity_type: 'product', entity_id: 'p', analytical_token: 'PRD_02', real_label: 'Hospedagem Premium', sensitive_identifier: null, secondary_aliases: [], is_archived: false, created_at: '', updated_at: '' },
];

const RECEIPT = `POSTO ESTRELA COMBUSTIVEIS LTDA
CNPJ: 45.987.654/0001-10
Rua das Flores, 123 - Centro
CONSUMIDOR CPF: 123.456.789-09
GASOLINA COMUM  32,150 L x 6,19   199,01
Hospedagem Premium mensal         49,90
VALOR TOTAL R$                   248,91
FORMA PAGAMENTO: CARTAO DE CREDITO **** 4321
Emitente Vértice Tecnologia contato@vertice.com.br (11) 98888-7777
Chave de acesso: 3526 1145 9876 5400 0110 6500 1000 0123 4510 0012 3456
Data emissão: 24/11/2026 14:32`;

const cases: TestCase[] = [
  ['OFX SGML (windows-1252): 4 linhas, sinais e FITID', () => {
    const st = parseOFX(OFX_SGML);
    assertEqual(st.lines.length, 4, 'linhas');
    assertEqual(st.lines[0]?.date, '2026-11-03', 'data com fuso');
    assertClose(st.lines[1]?.amount ?? 0, -350, 'débito negativo');
    assertEqual(st.lines[2]?.fitId, 'A3', 'FITID');
    assertEqual(st.periodEnd, '2026-11-12', 'período');
  }],
  ['CSV bancário BR (;) com colunas Débito/Crédito e linha de saldo', () => {
    const csv = `Extrato Conta Corrente\nData;Histórico;Documento;Débito;Crédito;Saldo\n03/11/2026;PIX RECEBIDO;111;;1.500,00;1.500,00\n05/11/2026;PAGTO ALUGUEL;222;350,00;;1.150,00\n06/11/2026;SALDO DO DIA;;;;1.150,00`;
    const st = parseCSV(csv);
    assertEqual(st.lines.length, 2, 'ignora saldo');
    assertClose(st.lines[0]?.amount ?? 0, 1500, 'crédito positivo');
    assertClose(st.lines[1]?.amount ?? 0, -350, 'débito negativo');
  }],
  ['PDF (texto extraído): datas dd/mm com ano inferido e sufixo D/C', () => {
    const text = `EXTRATO NOVEMBRO 2026\n03/11 PIX RECEBIDO ALFA 1.500,00 C\n05/11 PAGAMENTO ALUGUEL 350,00 D 1.150,00\n05/11 SALDO 1.150,00`;
    const st = parsePdfStatementText(text);
    assertEqual(st.lines.length, 2, 'duas movimentações');
    assertClose(st.lines[1]?.amount ?? 0, -350, 'D = débito');
    assertEqual(st.lines[0]?.date, '2026-11-03', 'ano inferido');
  }],
  ['Valores: formatos BR/US, parênteses e sufixos', () => {
    assertClose(parseStatementAmount('1.234,56') ?? 0, 1234.56, 'BR');
    assertClose(parseStatementAmount('-1,234.56') ?? 0, -1234.56, 'US negativo');
    assertClose(parseStatementAmount('(99,90)') ?? 0, -99.9, 'parênteses');
    assertClose(parseStatementAmount('R$ 10,00 D') ?? 0, -10, 'sufixo D');
  }],
  ['Matching: exato (±3 dias), parcial por taxa e sem correspondência', () => {
    const st = parseOFX(OFX_SGML);
    const txs = [
      tx({ id: 't-alfa', transaction_type: 'income', amount: 1500, due_date: '2026-11-01', description: 'Recebimento cliente Alfa' }),
      tx({ id: 't-aluguel', transaction_type: 'expense', amount: 350, due_date: '2026-11-05', description: 'Aluguel novembro' }),
      tx({ id: 't-venda', transaction_type: 'income', amount: 1000, due_date: '2026-11-09', description: 'Repasse gateway vendas' }),
    ];
    const res = matchStatementLines(st.lines, txs, 'acc');
    assertEqual(res[0]?.status, 'exact_match', 'Alfa: valor igual, 2 dias');
    assertEqual(res[0]?.transactionId, 't-alfa', 'Alfa casado');
    assertEqual(res[1]?.status, 'exact_match', 'aluguel exato');
    assertEqual(res[2]?.status, 'partial_match', 'repasse 970 vs 1000 = taxa');
    assertClose(res[2]?.amountDiff ?? 0, -30, 'diferença −30');
    assertEqual(res[3]?.status, 'unmatched', 'tarifa nova');
    assertEqual(summarizeMatches(res).unmatched, 1, 'resumo');
  }],
  ['Matching: 1:1 — dois débitos iguais não casam no mesmo lançamento; conciliados são excluídos', () => {
    const lines = [
      { index: 0, date: '2026-11-05', amount: -100, description: 'A', fitId: null },
      { index: 1, date: '2026-11-06', amount: -100, description: 'B', fitId: null },
    ];
    const res = matchStatementLines(lines, [tx({ id: 'only', transaction_type: 'expense', amount: 100, due_date: '2026-11-05' })], 'acc');
    assertEqual(res.filter((r) => r.transactionId === 'only').length, 1, 'um único casamento');
    const res2 = matchStatementLines(lines, [tx({ id: 'only', transaction_type: 'expense', amount: 100, due_date: '2026-11-05' })], 'acc', { alreadyReconciledIds: new Set(['only']) });
    assert(res2.every((r) => r.status === 'unmatched'), 'já conciliado não reaparece');
  }],
  ['Matching: transferência interna casa nas duas contas com o sinal correto', () => {
    const t = tx({ id: 'trf', transaction_type: 'transfer', amount: 500, due_date: '2026-11-08', account_id: 'origem', destination_account_id: 'destino' });
    const out = matchStatementLines([{ index: 0, date: '2026-11-08', amount: -500, description: 'TED', fitId: null }], [t], 'origem');
    const inn = matchStatementLines([{ index: 0, date: '2026-11-08', amount: 500, description: 'TED', fitId: null }], [t], 'destino');
    assertEqual(out[0]?.status, 'exact_match', 'saída na origem');
    assertEqual(inn[0]?.status, 'exact_match', 'entrada no destino');
  }],
  ['OCR: extrai total, data de emissão e CNPJ do emissor', () => {
    const f = extractReceiptFields(RECEIPT, '2026-11-26');
    assertClose(f.amount ?? 0, 248.91, 'VALOR TOTAL');
    assertEqual(f.date, '2026-11-24', 'data');
    assertEqual(f.issuerCnpj, '45987654000110', 'CNPJ emissor');
    assertEqual(f.paymentMethod, 'credit_card', 'crédito');
  }],
  ['OCR: redação remove CPF, CNPJ, endereço, razão social, telefone, e-mail, cartão e chave', () => {
    const { text } = redactReceiptPII(RECEIPT);
    for (const leaked of ['123.456.789-09', '45.987.654/0001-10', 'Rua das Flores', 'ESTRELA COMBUSTIVEIS LTDA', '98888-7777', 'contato@vertice.com.br', '4321', '3526 1145']) {
      assert(!text.includes(leaked), `vazou: ${leaked}`);
    }
    assert(/GASOLINA/i.test(text), 'mantém termos úteis para classificar');
  }],
  ['OCR → IA: Zero-Leak contra o Cofre (empresa vira EMP_01, produto vira PRD_02)', () => {
    const out = prepareReceiptForAI(RECEIPT, VAULT, [], '2026-11-26');
    assert(out.zeroLeakVerified, `vazamento: ${out.leakedTerms.join(', ')}`);
    assert(!out.sanitizedText.includes('Vértice Tecnologia'), 'nome da empresa removido');
    assert(!out.sanitizedText.includes('Hospedagem Premium'), 'nome do produto removido');
    assert(out.sanitizedText.includes('PRD_02'), 'produto tokenizado para a IA sugerir');
    assertClose(out.extracted.amount ?? 0, 248.91, 'valor extraído do texto bruto local');
  }],
];

export async function runModule6ClientTests(): Promise<TestCaseResult[]> {
  return runCases(cases);
}
