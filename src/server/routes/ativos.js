const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const { tipo, ativo_only } = req.query;
  let sql = `SELECT a.*,
    (SELECT preco FROM cotacoes WHERE ativo_id = a.id ORDER BY data DESC LIMIT 1) AS preco_atual,
    (SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END) FROM lancamentos WHERE ativo_id = a.id) AS qtd_total,
    (SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade*preco + IFNULL(taxa,0) ELSE 0 END) /
            NULLIF(SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE 0 END), 0)
     FROM lancamentos WHERE ativo_id = a.id) AS preco_medio
    FROM ativos a WHERE 1=1`;
  const params = [];
  if (tipo) { sql += ' AND a.tipo = ?'; params.push(tipo); }
  if (ativo_only === '1') { sql += ' AND a.ativo = 1'; }
  sql += ' ORDER BY a.ticker';
  res.json(req.db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const row = req.db.prepare('SELECT * FROM ativos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'não encontrado' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { ticker, tipo='FII', segmento, razao_social, cnpj, nota=5, observacao,
          dy_minimo, preco_teto, preco_muito_bom, alvo_pct_carteira=1.76 } = req.body;
  if (!ticker) return res.status(400).json({ error: 'ticker obrigatório' });
  try {
    const info = req.db.prepare(`INSERT INTO ativos
      (ticker, tipo, segmento, razao_social, cnpj, nota, observacao, dy_minimo, preco_teto, preco_muito_bom, alvo_pct_carteira)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ticker.toUpperCase(), tipo, segmento||null, razao_social||null, cnpj||null, nota, observacao||null, dy_minimo||null, preco_teto||null, preco_muito_bom||null, alvo_pct_carteira);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:id', (req, res) => {
  const allowed = ['tipo','segmento','razao_social','cnpj','gestor','taxa_adm','nota','observacao',
    'dy_minimo','preco_teto','preco_muito_bom','p_vp','vp_cota','vacancia','num_imoveis',
    'dy_12m','dy_24m','ultimo_dividendo','ultimo_pagto','alvo_pct_carteira','ativo'];
  const fields = []; const values = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { fields.push(`${k} = ?`); values.push(req.body[k]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'nada a atualizar' });
  fields.push("updated_at = datetime('now')");
  values.push(req.params.id);
  const info = req.db.prepare(`UPDATE ativos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ changes: info.changes });
});

router.delete('/:id', (req, res) => {
  const info = req.db.prepare('DELETE FROM ativos WHERE id = ?').run(req.params.id);
  res.json({ changes: info.changes });
});

module.exports = router;
