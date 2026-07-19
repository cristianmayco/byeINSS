const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const { ativo_id, ano } = req.query;
  let sql = `SELECT p.*, a.ticker FROM proventos p
    JOIN ativos a ON a.id = p.ativo_id WHERE 1=1`;
  const params = [];
  if (ativo_id) { sql += ' AND p.ativo_id = ?'; params.push(ativo_id); }
  if (ano) { sql += ' AND strftime("%Y", p.data_pagto) = ?'; params.push(ano); }
  sql += ' ORDER BY p.data_pagto DESC';
  res.json(req.db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { ativo_id, data_com, data_pagto, valor_por_cota, tipo='DIVIDENDO' } = req.body;
  if (!ativo_id || !data_pagto || !valor_por_cota) {
    return res.status(400).json({ error: 'ativo_id, data_pagto, valor_por_cota obrigatórios' });
  }
  const info = req.db.prepare(`INSERT INTO proventos
    (ativo_id, data_com, data_pagto, valor_por_cota, tipo)
    VALUES (?, ?, ?, ?, ?)`).run(ativo_id, data_com||null, data_pagto, valor_por_cota, tipo);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  const info = req.db.prepare('DELETE FROM proventos WHERE id = ?').run(req.params.id);
  res.json({ changes: info.changes });
});

// Batch: atualiza/insere proventos de múltiplos ativos de uma vez
// Body: { data_pagto, data_com?, dividendos: [{ ticker, valor_por_cota }, ...] }
router.post('/batch', (req, res) => {
  const { data_pagto, data_com, dividendos = [] } = req.body;
  if (!data_pagto) return res.status(400).json({ error: 'data_pagto obrigatório' });
  if (!Array.isArray(dividendos) || !dividendos.length) return res.status(400).json({ error: 'dividendos[] obrigatório' });

  const findAtivo = req.db.prepare('SELECT id FROM ativos WHERE ticker = ?');
  const findProv = req.db.prepare('SELECT id FROM proventos WHERE ativo_id=? AND data_pagto=? AND valor_por_cota=?');
  const ins = req.db.prepare('INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo) VALUES (?,?,?,?,?)');

  let inseridos = 0, duplicados = 0, ignorados = 0;
  const trx = req.db.transaction(() => {
    for (const d of dividendos) {
      const tk = (d.ticker || '').toUpperCase().trim();
      const v = Number(d.valor_por_cota);
      if (!tk || !v || v <= 0) { ignorados++; continue; }
      const a = findAtivo.get(tk);
      if (!a) { ignorados++; continue; }
      const dup = findProv.get(a.id, data_pagto, v);
      if (dup) { duplicados++; continue; }
      ins.run(a.id, data_com || null, data_pagto, v, 'DIVIDENDO');
      inseridos++;
    }
  });
  trx();
  res.json({ inseridos, duplicados, ignorados });
});

module.exports = router;
