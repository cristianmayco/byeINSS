// Importador da planilha PRECO TETO.
// Aceita o CSV parseado (linhas) onde cada linha tem colunas:
//   [ticker, valor_atual, dividendo, dy, preco_teto, comprar, barato, preco_muito_bom, quantidade, dividendo_mensal, total_investido, observacao]

function parseBRNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return Number(v);
  // "R$ 1.234,56" → 1234.56;  "12,5%" → 12.5
  const cleaned = v.replace(/[^\d,\-\.]/g, '');
  const isPercent = v.includes('%');
  const num = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  return isNaN(num) ? null : num;
}

async function importar(db, payload) {
  const { linhas=[] } = payload;
  let atualizados = 0, criados = 0;

  const upsert = db.prepare(`INSERT INTO ativos (ticker, tipo, segmento, preco_teto, preco_muito_bom, dy_minimo, alvo_pct_carteira, observacao)
    VALUES (?, 'FII', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET
      preco_teto=COALESCE(excluded.preco_teto, ativos.preco_teto),
      preco_muito_bom=COALESCE(excluded.preco_muito_bom, ativos.preco_muito_bom),
      dy_minimo=COALESCE(excluded.dy_minimo, ativos.dy_minimo),
      observacao=COALESCE(excluded.observacao, ativos.observacao),
      updated_at=datetime('now')`);

  const existsCheck = db.prepare('SELECT id FROM ativos WHERE ticker = ?');

  const trx = db.transaction(() => {
    for (const row of linhas) {
      const ticker = (row.ticker || '').toUpperCase().trim();
      if (!ticker || ticker === 'TICKER' || ticker === 'FUNDO') continue;
      const existe = existsCheck.get(ticker);
      const valorAtual = parseBRNumber(row.valor_atual);
      const dy = parseBRNumber(row.dy);
      const precoTeto = parseBRNumber(row.preco_teto);
      const precoMuitoBom = parseBRNumber(row.preco_muito_bom);
      upsert.run(ticker, row.segmento || null, precoTeto, precoMuitoBom, dy, row.alvo_pct_carteira || 1.76, row.observacao || null);
      if (existe) atualizados++; else criados++;
      // Cotação de hoje
      if (valorAtual && !existe) {
        const id = existsCheck.get(ticker).id;
        const hoje = new Date().toISOString().slice(0,10);
        db.prepare('INSERT INTO cotacoes (ativo_id, data, preco, fonte) VALUES (?, ?, ?, ?)').run(id, hoje, valorAtual, 'sheets');
      }
    }
  });
  trx();
  return { criados, atualizados };
}

module.exports = importar;
