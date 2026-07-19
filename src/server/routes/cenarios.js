const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json(req.db.prepare('SELECT * FROM cenarios ORDER BY ativo DESC, id').all());
});

router.get('/:id', (req, res) => {
  const row = req.db.prepare('SELECT * FROM cenarios WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'não encontrado' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { nome, descricao, tipo='PATRIMONIO', valor_alvo, prazo_meses, aporte_inicial=0,
          aporte_mensal, taxa_anual=12, reajuste_aporte_anual=0, cor='#4ade80', ativo=1 } = req.body;
  const erros = [];
  if (!nome || String(nome).trim() === '') erros.push('nome obrigatório');
  if (!valor_alvo || valor_alvo <= 0) erros.push('valor_alvo deve ser > 0');
  if (!prazo_meses || prazo_meses <= 0) erros.push('prazo_meses deve ser > 0');
  if (aporte_mensal === undefined || aporte_mensal === null || aporte_mensal <= 0) erros.push('aporte_mensal deve ser > 0');
  if (erros.length) return res.status(400).json({ error: 'Campos inválidos: ' + erros.join(', ') });
  const info = req.db.prepare(`INSERT INTO cenarios
    (nome, descricao, tipo, valor_alvo, prazo_meses, aporte_inicial, aporte_mensal, taxa_anual, reajuste_aporte_anual, cor, ativo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(nome.trim(), descricao||null, tipo, valor_alvo, prazo_meses, aporte_inicial, aporte_mensal, taxa_anual, reajuste_aporte_anual, cor, ativo);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const allowed = ['nome','descricao','tipo','valor_alvo','prazo_meses','aporte_inicial',
                   'aporte_mensal','taxa_anual','reajuste_aporte_anual','cor','ativo'];
  const fields = []; const values = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { fields.push(`${k} = ?`); values.push(req.body[k]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'nada a atualizar' });
  fields.push("updated_at = datetime('now')");
  values.push(req.params.id);
  const info = req.db.prepare(`UPDATE cenarios SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ changes: info.changes });
});

router.delete('/:id', (req, res) => {
  const info = req.db.prepare('DELETE FROM cenarios WHERE id = ?').run(req.params.id);
  res.json({ changes: info.changes });
});

// Simular um cenário (com ou sem reajuste)
router.post('/:id/simular', (req, res) => {
  const c = req.db.prepare('SELECT * FROM cenarios WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'não encontrado' });
  const cfg = req.db.prepare('SELECT * FROM config').all().reduce((a, r) => (a[r.chave] = r.valor, a), {});
  const ajusteMesInicio = Number(cfg.reajuste_mes_inicio || 1);
  const i = (c.taxa_anual / 100) / 12;
  let saldo = c.aporte_inicial;
  let aporte = c.aporte_mensal;
  let aportado = c.aporte_inicial;
  let primeiroReajuste = false;
  const serie = [{ mes: 0, patrimonio: saldo, aporte, aportado }];
  let atingiuEm = null;
  for (let m = 1; m <= c.prazo_meses; m++) {
    // Reajuste anual no mês de início configurado
    if (c.reajuste_aporte_anual > 0 && m > 1 && ((m - 1) % 12 === 0)) {
      if (!primeiroReajuste && m < ajusteMesInicio) continue;
      aporte = aporte * (1 + c.reajuste_aporte_anual / 100);
    }
    saldo = saldo * (1 + i) + aporte;
    aportado += aporte;
    if (atingiuEm === null && saldo >= c.valor_alvo) atingiuEm = m;
    if (m % Math.max(1, Math.floor(c.prazo_meses/24)) === 0 || m === c.prazo_meses || atingiuEm === m) {
      serie.push({ mes: m, patrimonio: saldo, aporte, aportado });
    }
  }
  res.json({
    cenario: c,
    serie,
    patrimonio_final: saldo,
    total_aportado: aportado,
    rendimento: saldo - aportado,
    atingiu_meta: saldo >= c.valor_alvo,
    meses_para_meta: atingiuEm
  });
});

module.exports = router;
