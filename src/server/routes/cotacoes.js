const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const { ativo_id } = req.query;
  let sql = 'SELECT * FROM cotacoes WHERE 1=1';
  const params = [];
  if (ativo_id) { sql += ' AND ativo_id = ?'; params.push(ativo_id); }
  sql += ' ORDER BY data DESC LIMIT 365';
  res.json(req.db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { ativo_id, data, preco, fonte='manual' } = req.body;
  if (!ativo_id || !data || !preco) return res.status(400).json({ error: 'campos obrigatórios' });
  const info = req.db.prepare('INSERT INTO cotacoes (ativo_id, data, preco, fonte) VALUES (?, ?, ?, ?)').run(ativo_id, data, preco, fonte);
  res.status(201).json({ id: info.lastInsertRowid });
});

module.exports = router;
