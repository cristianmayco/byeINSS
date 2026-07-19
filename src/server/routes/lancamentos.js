const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const { ativo_id } = req.query;
  let sql = `SELECT l.*, a.ticker FROM lancamentos l
    JOIN ativos a ON a.id = l.ativo_id`;
  const params = [];
  if (ativo_id) { sql += ' WHERE l.ativo_id = ?'; params.push(ativo_id); }
  sql += ' ORDER BY l.data DESC, l.id DESC';
  res.json(req.db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { ativo_id, data, tipo, quantidade, preco, corretora, taxa=0, observacao } = req.body;
  if (!ativo_id || !data || !tipo || !quantidade || !preco) {
    return res.status(400).json({ error: 'ativo_id, data, tipo, quantidade, preco obrigatórios' });
  }
  if (!['COMPRA','VENDA'].includes(tipo)) return res.status(400).json({ error: 'tipo inválido' });
  const info = req.db.prepare(`INSERT INTO lancamentos
    (ativo_id, data, tipo, quantidade, preco, corretora, taxa, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ativo_id, data, tipo, quantidade, preco, corretora||null, taxa, observacao||null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  const info = req.db.prepare('DELETE FROM lancamentos WHERE id = ?').run(req.params.id);
  res.json({ changes: info.changes });
});

module.exports = router;
