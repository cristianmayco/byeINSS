// Importador do Investidor10.
// Aceita um payload no formato extraído da carteira:
//   { ativos: [{ticker, tipo, segmento, quantidade, preco_medio, preco_atual, dy, yoc, nota, pct_carteira, pct_ideal}], cotacoes: {TICKER: [{data,preco}]}, proventos: [...] }

function upsertAtivo(db, a) {
  const existente = db.prepare('SELECT id FROM ativos WHERE ticker = ?').get(a.ticker.toUpperCase());
  if (existente) {
    db.prepare(`UPDATE ativos SET tipo=COALESCE(?,tipo), segmento=COALESCE(?,segmento), nota=COALESCE(?,nota),
      alvo_pct_carteira=COALESCE(?,alvo_pct_carteira), ativo=1, updated_at=datetime('now') WHERE id=?`)
      .run(a.tipo||null, a.segmento||null, a.nota||null, a.pct_ideal||null, existente.id);
    return existente.id;
  }
  const info = db.prepare(`INSERT INTO ativos (ticker, tipo, segmento, nota, alvo_pct_carteira)
    VALUES (?, ?, ?, ?, ?)`).run(a.ticker.toUpperCase(), a.tipo||'FII', a.segmento||null, a.nota||null, a.pct_ideal||null);
  return info.lastInsertRowid;
}

async function importar(db, payload) {
  const { ativos=[], cotacoes={}, proventos=[] } = payload;
  const hoje = new Date().toISOString().slice(0,10);
  let ativosImportados = 0, cotacoesImportadas = 0, lancamentosImportados = 0, proventosImportados = 0;

  const insereCotacao = db.prepare('INSERT INTO cotacoes (ativo_id, data, preco, fonte) VALUES (?, ?, ?, ?)');
  const insereLancamento = db.prepare('INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco, taxa, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insereProv = db.prepare('INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo) VALUES (?, ?, ?, ?, ?)');

  const trx = db.transaction(() => {
    for (const a of ativos) {
      const id = upsertAtivo(db, a);
      ativosImportados++;
      // Cotação de hoje
      if (a.preco_atual) {
        insereCotacao.run(id, hoje, a.preco_atual, 'i10');
        cotacoesImportadas++;
      }
      // Lançamento de compra consolidada (se qtd > 0)
      if (a.quantidade && a.preco_medio) {
        // Verifica se já existe um lançamento de compra com esse ativo hoje (evita duplicar)
        const dup = db.prepare(`SELECT 1 FROM lancamentos WHERE ativo_id=? AND data=? AND tipo='COMPRA' AND quantidade=? AND preco=?`).get(id, hoje, a.quantidade, a.preco_medio);
        if (!dup) {
          insereLancamento.run(id, hoje, 'COMPRA', Math.round(a.quantidade), a.preco_medio, 0, 'Importado Investidor10');
          lancamentosImportados++;
        }
      }
      // Sobrescreve preço-teto / muito bom se vierem
      if (a.preco_teto || a.preco_muito_bom) {
        db.prepare(`UPDATE ativos SET preco_teto=COALESCE(?, preco_teto), preco_muito_bom=COALESCE(?, preco_muito_bom), dy_minimo=COALESCE(?, dy_minimo) WHERE id=?`)
          .run(a.preco_teto||null, a.preco_muito_bom||null, a.dy_minimo||null, id);
      }
    }
    // Cotações extras (histórico)
    for (const [ticker, arr] of Object.entries(cotacoes)) {
      const at = db.prepare('SELECT id FROM ativos WHERE ticker = ?').get(ticker.toUpperCase());
      if (!at) continue;
      for (const c of arr) {
        const exists = db.prepare('SELECT 1 FROM cotacoes WHERE ativo_id=? AND data=?').get(at.id, c.data);
        if (!exists) { insereCotacao.run(at.id, c.data, c.preco, 'i10'); cotacoesImportadas++; }
      }
    }
    // Proventos
    for (const p of proventos) {
      const at = db.prepare('SELECT id FROM ativos WHERE ticker = ?').get(p.ticker.toUpperCase());
      if (!at) continue;
      const dup = db.prepare('SELECT 1 FROM proventos WHERE ativo_id=? AND data_pagto=? AND valor_por_cota=?').get(at.id, p.data_pagto, p.valor_por_cota);
      if (!dup) { insereProv.run(at.id, p.data_com||null, p.data_pagto, p.valor_por_cota, p.tipo||'DIVIDENDO'); proventosImportados++; }
    }
  });
  trx();
  return { ativosImportados, cotacoesImportadas, lancamentosImportados, proventosImportados };
}

module.exports = importar;
