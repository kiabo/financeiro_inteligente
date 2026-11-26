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
  margem_contribuicao_unitaria: {
    key: 'margem_contribuicao_unitaria',
    term: 'Margem de Contribuição Unitária',
    category: 'Catálogo & Precificação',
    summary:
      'Valor que sobra de cada unidade vendida após deduzir o custo direto estimado, a taxa do meio de pagamento e os impostos sobre a venda. É esse montante que paga os custos fixos e gera lucro.',
    example:
      'Preço R$ 1.000,00 - Custo Direto R$ 300,00 - Taxa Cartão (3% = R$ 30,00) - Imposto (10% = R$ 100,00) = Margem Unitária de R$ 570,00 (57,0%).',
  },
  transferencia_interna: {
    key: 'transferencia_interna',
    term: 'Transferência Interna entre Contas',
    category: 'Movimentação Financeira',
    summary:
      'Movimentação de recursos entre contas da mesma empresa ou entre empresas do mesmo titular. Altera os saldos bancários envolvidos, mas nunca entra como receita ou despesa nos indicadores de resultado.',
    example:
      'Transferir R$ 50.000 da Conta Itaú para a Conta Inter reduz o saldo do Itaú e aumenta o do Inter, com impacto zero no faturamento ou lucro.',
  },
  saldo_projetado: {
    key: 'saldo_projetado',
    term: 'Saldo Projetado do Período',
    category: 'Fluxo de Caixa',
    summary:
      'Estimativa de saldo ao final do período somando ao Saldo Anterior todas as entradas realizadas e previstas (a receber) e subtraindo todas as saídas realizadas e previstas (a pagar), além das transferências da conta.',
    example:
      'Se o saldo anterior é R$ 80.000 e há +R$ 40.000 a receber e -R$ 25.000 a pagar no mês, o saldo projetado é R$ 95.000.',
  },
  roi_projeto: {
    key: 'roi_projeto',
    term: 'ROI Projetado (Retorno sobre Investimento)',
    category: 'Viabilidade de Projetos',
    summary:
      'Percentual que mede quanto o retorno líquido operacional do projeto supera o capital investido (CAPEX inicial + investimentos previstos). Valores positivos indicam geração de valor acima do capital alocado.',
    example:
      'Um projeto com R$ 100.000 de investimento que gera R$ 145.000 de resultado operacional acumulado possui ROI de +45,0%.',
  },
  impacto_caixa_empresa: {
    key: 'impacto_caixa_empresa',
    term: 'Impacto Líquido no Caixa da Empresa',
    category: 'Tesouraria & Risco',
    summary:
      'Cruza a curva de caixa acumulada do projeto com o saldo disponível e previsto da empresa. Quando o vale negativo máximo do projeto supera o caixa livre atual/projetado, o sistema emite um Alerta de Exposição de Caixa.',
    example:
      'Se a empresa dispõe de R$ 60.000 livres e o projeto exige vale de -R$ 85.000 antes do Payback, há exposição de R$ 25.000.',
  },
  score_saude_financeira: {
    key: 'score_saude_financeira',
    term: 'Score de Saúde Financeira (0 a 100)',
    category: 'Diagnóstico Executivo',
    summary:
      'Índice composto ponderado em 4 pilares (25 pontos cada): (1) Liquidez Imediata — cobertura do caixa livre frente às obrigações e tributos dos próximos 30 dias; (2) Geração de Caixa & Runway — fluxo operacional e fôlego em meses; (3) Margem Líquida — lucratividade sobre a receita bruta; (4) Grau de Endividamento — relação entre saldo devedor total e liquidez/faturamento.',
    example:
      'Score >= 80 indica saúde financeira excelente; 60–79 saudável; 40–59 atenção; abaixo de 40 exige revisão urgente de margens e caixa.',
  },
  runway: {
    key: 'runway',
    term: 'Runway (Fôlego de Caixa em Meses)',
    category: 'Tesouraria & Liquidez',
    summary:
      'Indica por quantos meses a operação consegue se sustentar com o Caixa Livre Atual caso novas receitas parem ou mantendo o ritmo médio mensal de queima de caixa / despesas fixas e serviço da dívida.',
    example:
      'Caixa Livre de R$ 120.000 dividido por despesas fixas mensais de R$ 20.000 equivale a um Runway de 6,0 meses.',
  },
  dre_gerencial: {
    key: 'dre_gerencial',
    term: 'DRE Gerencial Estruturada',
    category: 'Demonstrativo de Resultado',
    summary:
      'Demonstração do Resultado do Exercício organizada em cascata gerencial: parte da Receita Bruta Operacional, subtrai Deduções/Impostos e Custos Diretos para apurar a Margem de Contribuição, abate Despesas Operacionais (EBITDA) e soma/subtrai o Resultado Financeiro até o Lucro ou Prejuízo Líquido. Transferências internas são 100% excluídas.',
  },
  analise_vertical_horizontal: {
    key: 'analise_vertical_horizontal',
    term: 'Análise Vertical (AV%) e Horizontal (AH%)',
    category: 'Leitura de DRE',
    summary:
      'A Análise Vertical (AV%) mostra o peso percentual de cada linha em relação à Receita Bruta Operacional (= 100%). A Análise Horizontal (AH%) compara o valor do período atual contra o período anterior ou ano anterior, revelando variações em R$ e %.',
    example:
      'Custos Diretos de R$ 30.000 sobre Receita Bruta de R$ 100.000 têm AV de 30,0%. Se no mês anterior eram R$ 25.000, a AH é de +20,0%.',
  },
  ebitda: {
    key: 'ebitda',
    term: 'EBITDA / Resultado Operacional',
    category: 'Performance Operacional',
    summary:
      'Lucro gerado exclusivamente pela operação principal do negócio antes de juros/rendimentos financeiros (Resultado Financeiro) e investimentos em ativos (CAPEX). Mede a eficiência operacional pura da empresa.',
  },
  margem_liquida: {
    key: 'margem_liquida',
    term: 'Margem Líquida (%)',
    category: 'Rentabilidade',
    summary:
      'Percentual da Receita Bruta Operacional que efetivamente se transforma em Resultado Líquido final após deduções, custos diretos, despesas operacionais e resultado financeiro.',
    example:
      'Lucro Líquido de R$ 18.000 sobre Receita Bruta de R$ 100.000 representa Margem Líquida de 18,0%.',
  },
  margem_contribuicao_global: {
    key: 'margem_contribuicao_global',
    term: 'Margem de Contribuição Global',
    category: 'Rentabilidade',
    summary:
      'Diferença entre a Receita Líquida e os Custos Diretos totais de produtos, serviços e projetos. Mostra quanto sobra em reais e percentual para cobrir a estrutura fixa da empresa e gerar lucro.',
  },
  amortizacao_sac_price: {
    key: 'amortizacao_sac_price',
    term: 'Sistemas de Amortização (SAC vs. Price)',
    category: 'Gestão de Dívidas',
    summary:
      'No sistema SAC, a amortização do principal é constante e as parcelas diminuem ao longo do tempo conforme o saldo devedor cai. Na Tabela Price, as parcelas são fixas: no início paga-se proporcionalmente mais juros e menos principal.',
    example:
      'Em R$ 60.000 em 12x a 1,5% a.m.: no SAC a 1ª parcela é R$ 5.900 e cai até R$ 5.075; na Price todas as 12 parcelas são fixas em R$ 5.500,80.',
  },
  obrigacoes_fiscais: {
    key: 'obrigacoes_fiscais',
    term: 'Obrigações Fiscais & Guias Recorrentes',
    category: 'Gestão Tributária',
    summary:
      'Controle centralizado de tributos por empresa (DAS do Simples Nacional, ISS, IRPJ/CSLL, PIS/COFINS, INSS) com base de cálculo estimada sobre o faturamento mensal, alertas de vencimento próximo e baixa integrada ao fluxo de caixa.',
  },
  cfo_virtual: {
    key: 'cfo_virtual',
    term: 'CFO Virtual (IA Zero-Leak)',
    category: 'Inteligência Financeira',
    summary:
      'Motor de análise estratégica que lê exclusivamente métricas agregadas e tokens analíticos (EMP_01, PRD_01, PRJ_01) para detectar queda de margem, risco de caixa em 45 dias, desvios de orçamento e oportunidades de realocação de capital.',
  },
  zero_leak_barreira: {
    key: 'zero_leak_barreira',
    term: 'Barreira Zero-Leak & Re-hidratação',
    category: 'Privacy-by-Design',
    summary:
      'Camada de sanitização estrita que bloqueia o envio de nomes reais, CNPJs, contas bancárias, clientes ou descrições livres para APIs externas de IA ou servidores MCP. A tradução dos tokens para nomes reais ocorre somente na tela autenticada do usuário.',
  },
  mcp_protocol: {
    key: 'mcp_protocol',
    term: 'Servidor MCP (Model Context Protocol)',
    category: 'Automação & Conectividade',
    summary:
      'Endpoint JSON-RPC protegido por token Bearer com hash SHA-256 e escopo granular (Somente Leitura ou Simulação de Rascunhos), permitindo que assistentes externos consultem saúde financeira e simulem novos projetos sem acessar identidades reais.',
  },
};

export type GlossaryKey = keyof typeof FINANCIAL_GLOSSARY;
