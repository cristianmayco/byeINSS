const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json(req.db.prepare('SELECT * FROM metas ORDER BY id').all());
});

router.post('/', (req, res) => {
  const { tipo, descricao, valor_alvo, prazo_meses, aporte_mensal, taxa_anual=12, patrimonio_atual=0 } = req.body;
  if (!tipo || !valor_alvo) return res.status(400).json({ error: 'tipo e valor_alvo obrigatórios' });
  const info = req.db.prepare(`INSERT INTO metas
    (tipo, descricao, valor_alvo, prazo_meses, aporte_mensal, taxa_anual, patrimonio_atual)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(tipo, descricao||null, valor_alvo, prazo_meses||null, aporte_mensal||null, taxa_anual, patrimonio_atual);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const allowed = ['descricao','valor_alvo','prazo_meses','aporte_mensal','taxa_anual','patrimonio_atual'];
  const fields = []; const values = [];
  for (const k of allowed) if (req.body[k] !== undefined) { fields.push(`${k} = ?`); values.push(req.body[k]); }
  if (!fields.length) return res.status(400).json({ error: 'nada a atualizar' });
  values.push(req.params.id);
  const info = req.db.prepare(`UPDATE metas SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ changes: info.changes });
});

router.delete('/:id', (req, res) => {
  const info = req.db.prepare('DELETE FROM metas WHERE id = ?').run(req.params.id);
  res.json({ changes: info.changes });
});

module.exports = router;
