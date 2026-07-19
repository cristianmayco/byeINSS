// Scraper do Investidor10 usando Playwright + gera JSON pronto para o importador.
// Como o scraper depende de login, este script gera o payload no formato esperado
// a partir de dados colados manualmente OU exporta um CSV via /wallet/my-wallet/pro/positions.
//
// Uso:
//   node scripts/build-i10-payload.js            # mostra exemplo/template
//   node scripts/build-i10-payload.js < arquivo.json  # valida e mostra
//
// Formato esperado pela API /api/import/investidor10:
//   {
//     "ativos": [
//       { "ticker":"EXEMPLO11", "tipo":"FII", "segmento":"...", "quantidade":50, "preco_medio":100.00,
//         "preco_atual":105.00, "preco_teto":120.00, "preco_muito_bom":95.00,
//         "dy":10.00, "yoc":10.50, "nota":7, "pct_carteira":25.00, "pct_ideal":5.00 }
//     ],
//     "cotacoes": { "EXEMPLO11": [{ "data":"2024-01-15", "preco":105.00 }] },
//     "proventos": [ { "ticker":"EXEMPLO11", "data_pagto":"2024-01-10", "valor_por_cota":1.00 } ]
//   }

const template = {
  ativos: [
    {
      ticker: 'EXEMPLO11',
      tipo: 'FII',
      segmento: 'Logística',
      quantidade: 50,
      preco_medio: 100.00,
      preco_atual: 105.00,
      preco_teto: 120.00,
      preco_muito_bom: 95.00,
      dy: 10.00,
      nota: 7,
      pct_carteira: 25.00,
      pct_ideal: 5.00
    }
  ],
  cotacoes: {
    EXEMPLO11: [{ data: '2024-01-15', preco: 105.00 }]
  },
  proventos: [
    { ticker: 'EXEMPLO11', data_pagto: '2024-01-10', valor_por_cota: 1.00, tipo: 'DIVIDENDO' }
  ]
};

if (process.argv[2]) {
  try {
    const data = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
    console.log(`✓ JSON válido. ${data.ativos?.length || 0} ativos, ${Object.keys(data.cotacoes||{}).length} tickers com cotação, ${data.proventos?.length||0} proventos.`);
  } catch (e) {
    console.error('Erro:', e.message);
    process.exit(1);
  }
} else {
  console.log('=== TEMPLATE para colar em "Importar > Investidor10" ===');
  console.log(JSON.stringify(template, null, 2));
}
