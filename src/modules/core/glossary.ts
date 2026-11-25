export interface GlossaryEntry {
  key: string;
  term: string;
  category: string;
  summary: string;
  example?: string;
}

export const FINANCIAL_GLOSSARY: Record<string, GlossaryEntry> = {
  regime_de_caixa: {
    key: 'regime_de_caixa',
    term: 'Regime de Caixa',
    category: 'Contabilidade Gerencial',
    summary:
      'Reconhece receitas e despesas apenas no momento exato em que o dinheiro entra ou sai da conta bancária ou caixa físico. É essencial para medir liquidez real e evitar descobertos de tesouraria.',
    example:
      'Uma venda parcelada em 3x de R$ 1.000 aparece como R$ 1.000 em cada mês efetivamente recebido.',
  },
  regime_de_competencia: {
    key: 'regime_de_competencia',
    term: 'Regime de Competência',
    category: 'Contabilidade & DRE',
    summary:
      'Registra receitas e custos na data em que o fato gerador ocorre (emissão da nota fiscal ou prestação do serviço), independentemente da data de pagamento ou recebimento.',
    example:
      'Uma venda de R$ 3.000 faturada em março entra integralmente na DRE de março, mesmo se for paga em abril.',
  },
  payback: {
    key: 'payback',
    term: 'Payback',
    category: 'Viabilidade de Projetos',
    summary:
      'Indica o tempo necessário para que os retornos líquidos acumulados de um projeto ou investimento recuperem 100% do capital inicial investido.',
    example:
      'Um aporte de R$ 120.000 que gera R$ 15.000/mês de caixa livre possui Payback simples de 8 meses.',
  },
  break_even: {
    key: 'break_even',
    term: 'Break-even (Ponto de Equilíbrio)',
    category: 'Margem & Operação',
    summary:
      'Volume mínimo de receita ou unidades vendidas em que a margem de contribuição cobre exatamente todos os custos e despesas fixas, resultando em lucro operacional igual a zero.',
    example:
      'Com custos fixos de R$ 40.000 e margem de contribuição de 40%, o Break-even ocorre em R$ 100.000 de faturamento.',
  },
  token_analitico: {
    key: 'token_analitico',
    term: 'Token Analítico Imutável',
    category: 'Privacy-by-Design',
    summary:
      'Identificador anônimo atribuído automaticamente (ex.: GRP_01, EMP_01, CTA_01) que substitui razões sociais, CNPJs e contas reais antes de qualquer análise externa ou chamada futura de IA.',
  },
  consolidacao_grupo: {
    key: 'consolidacao_grupo',
    term: 'Visão Consolidada de Grupo',
    category: 'Hierarquia Organizacional',
    summary:
      'Agrupamento opcional de múltiplas empresas sob uma mesma holding ou controle estratégico. Empresas sem grupo operam de forma totalmente independente sem necessidade de vínculo.',
  },
  rls_isolamento: {
    key: 'rls_isolamento',
    term: 'Row Level Security (RLS)',
    category: 'Segurança de Dados',
    summary:
      'Política executada diretamente no motor PostgreSQL que garante que cada registro só possa ser lido ou alterado pelo titular autenticado com sessão e MFA válidos.',
  },
};

export type GlossaryKey = keyof typeof FINANCIAL_GLOSSARY;
