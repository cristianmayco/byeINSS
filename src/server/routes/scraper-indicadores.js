// src/server/routes/scraper-indicadores.js
//
// Endpoint REST para disparo manual do scraper de indicadores. PRD 02 sub-PR 3.
//
//   POST /api/fiis/scraper/indicadores/resync
//     Body: { tickers?: string[] }  (opcional; se ausente, roda em todos os FIIs)
//     Response 200: {
//       total, sucessos, falhas, janela_execucao_ms,
//       detalhes: [{ ticker, success, campos_atualizados, error, duracao_ms }]
//     }
//     Response 400: { error } — body inválido
//     Response 500: { error, detalhe } — scraper falhou inteiro
//     Response 503: { disponivel: false, erro } — scraper não carrega
//
// Regras:
//   - Bind em 127.0.0.1 (validado no app.listen de src/server/index.js).
//   - Tickers no body validados contra regex FII.
//   - Falha de um ticker NÃO derruba o batch (PRD 02 RF-007).
//   - Idempotente: rodar 2x não duplica dados (mergeIndicadores null-safe).

'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();

const FII_RE = /^[A-Z]{4}11$/;

function normalizarTickers(body) {
  if (!body) return { ok: true, tickers: null };
  if (!Array.isArray(body.tickers)) {
    return { ok: false, erro: 'tickers deve ser array de strings' };
  }
  if (body.tickers.length === 0) return { ok: true, tickers: [] };
  const out = [];
  for (const t of body.tickers) {
    if (typeof t !== 'string') {
      return { ok: false, erro: `ticker inválido (não-string): ${String(t)}` };
    }
    const u = t.toUpperCase();
    if (!FII_RE.test(u)) {
      return { ok: false, erro: `ticker inválido: ${t}` };
    }
    out.push(u);
  }
  return { ok: true, tickers: out };
}

function getScraper() {
  if (global.__mockScraperIndicadores) return global.__mockScraperIndicadores;
  return require(path.join(__dirname, '..', '..', 'main', 'scraper-indicadores.js'));
}

router.post('/resync', async (req, res) => {
  const t0 = Date.now();

  // Validação opcional do body
  if (req.body && Object.keys(req.body).length > 0) {
    const v = normalizarTickers(req.body);
    if (!v.ok) {
      return res.status(400).json({ error: v.erro });
    }
    if (v.tickers !== null) req.body = { tickers: v.tickers };
  }

  let scraper;
  try {
    scraper = getScraper();
  } catch (e) {
    return res.status(503).json({ disponivel: false, erro: 'scraper-indicadores indisponível: ' + e.message });
  }
  if (typeof scraper.resyncAll !== 'function') {
    return res.status(503).json({ disponivel: false, erro: 'resyncAll não exposto pelo scraper-indicadores' });
  }

  try {
    const resultado = await scraper.resyncAll(req.db, {
      tickers: req.body && req.body.tickers,
      onProgress: (ticker, detalhe) => {
        console.info(
          `[scraper-indicadores] ${ticker} ${detalhe.success ? 'OK' : 'FALHA'} ` +
          `${detalhe.campos_atualizados ? '(' + detalhe.campos_atualizados.length + ' campos)' : ''} ` +
          `${detalhe.error || ''}`
        );
      }
    });
    resultado.janela_execucao_ms = Date.now() - t0;
    return res.json(resultado);
  } catch (e) {
    console.error('[scraper-indicadores] resync falhou:', e.message);
    return res.status(500).json({ error: 'falha no resync', detalhe: e.message });
  }
});

// Health-check do scraper (não tenta scrape, só verifica se o módulo carrega).
router.get('/status', (_req, res) => {
  try {
    const scraper = getScraper();
    res.json({
      disponivel: typeof scraper.resyncAll === 'function',
      versao: 'PRD02-subPR3'
    });
  } catch (e) {
    res.status(503).json({ disponivel: false, erro: e.message });
  }
});

module.exports = router;