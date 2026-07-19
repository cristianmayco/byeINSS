// Conversor CSV (saída de uma exportação da planilha PRECO TETO) → JSON para o importador.
// Lê o CSV de stdin e imprime o JSON pronto para colar na tela "Importar > Planilha".
//
// Uso:
//   cat preco_teto.csv | node scripts/build-sheets-payload.js > sheets-payload.json
//   cat preco_teto.csv | node scripts/build-sheets-payload.js | tee /tmp/payload.json
//
// Formato CSV esperado (cabeçalho na linha 1, separador vírgula):
//   ticker,valor_atual,dividendo,dy,preco_teto,comprar,barato,preco_muito_bom,quantidade,dividendo_mensal,total_investido,observacao

const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const csv = Buffer.concat(chunks).toString('utf8');
  const linhas = csv.split(/\r?\n/).filter(Boolean).map(line => {
    // parser CSV simples (sem aspas escapadas)
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; continue; }
      if (c === ',' && !inQuotes) { cols.push(cur); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur);
    return cols;
  });
  const header = linhas[0].map(h => h.toLowerCase().trim());
  const records = linhas.slice(1).map(cols => {
    const r = {};
    header.forEach((h, i) => { r[h] = (cols[i] || '').trim(); });
    return r;
  }).filter(r => r.ticker && r.ticker !== 'TICKER' && r.ticker !== 'FUNDO' && r.ticker !== '');

  const out = { linhas: records };
  console.log(JSON.stringify(out, null, 2));
  console.error(`\n✓ ${records.length} linhas convertidas para JSON.`);
});
