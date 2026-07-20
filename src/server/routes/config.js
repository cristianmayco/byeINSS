const express = require('express');
const router = express.Router();

const ALLOWED = [
  'taxa_anual_padrao', 'alerta_dy_limite', 'alerta_concentracao_pct',
  'dy_minimo_global', 'moeda', 'versao_schema',
  'pct_muito_barato', 'pct_barato', 'pct_caro',
  'reajuste_aporte_anual', 'reajuste_mes_inicio', 'aliquota_ir_dividendos',
  // PRD 12: janela de alerta de vencimento de contratos
  'vencimento_janela_alerta_meses'
];

router.get('/', (req, res) => {
  const rows = req.db.prepare('SELECT chave, valor FROM config').all();
  const out = {};
  for (const r of rows) out[r.chave] = r.valor;
  res.json(out);
});

router.put('/', (req, res) => {
  const stmt = req.db.prepare(`INSERT INTO config (chave, valor) VALUES (?, ?)
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`);
  const trx = req.db.transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      if (ALLOWED.includes(k)) stmt.run(k, String(v));
    }
  });
  trx();
  res.json({ ok: true });
});

module.exports = router;
