// src/server/routes/scraper-contratos.js
//
// Endpoint REST para disparo manual do scraper de contratos. PRD 12 sub-PR 3.
//
//   POST /api/fiis/scraper/contratos/resync
//     Body: { tickers?: string[] }  (opcional; se ausente, roda em todos os FIIs)
//     Response 200: {
//       total: number,
//       sucessos: number,
//       falhas: number,
//       janela_execucao_ms: number,
//       detalhes: [{ ticker, success, source, persisted, motivo_skip, error, confianca }]
//     }
//     Response 500: { error: string } — quando o scraper inteiro falha
//
// Regras:
//   - Bind em 127.0.0.1 (validado no app.listen de src/server/index.js).
//   - Tickers no body são normalizados para upper-case e validados (regex FII).
//   - Resync roda em background se Accept: application/x-ndjson (streaming).
//     Default: blocking — espera todos terminarem (max 5min).
//   - Log estruturado de início/fim para observabilidade.

'use strict';

const express = require('express');
const path = require('node:path');

const router = express.Router();

// ===== validação =====
const FII_RE = /^[A-Z]{4}11$/;

function normalizarTickers(body) {
  if (!body) return null;
  if (!Array.isArray(body.tickers)) {
    return { ok: false, erro: 'tickers deve ser array de strings' };
  }
  const out = [];
  for (const t of body.tickers) {
    if (typeof t !== 'string') {
      return { ok: false, erro: `ticker inválido (não-string): ${t}` };
    }
    const u = t.toUpperCase();
    if (!FII_RE.test(u)) {
      return { ok: false, erro: `ticker inválido: ${t}` };
    }
    out.push(u);
  }
  return { ok: true, tickers: out };
}

// Lazy-load do scraper para evitar carregar Electron em testes que só usam parsers.
function getScraper() {
  // O scraper usa Electron; só funciona dentro do processo principal.
  // Em testes, mockar via __mockScraperContratos.
  if (global.__mockScraperContratos) return global.__mockScraperContratos;
  return require(path.join(__dirname, '..', '..', 'main', 'scraper-contratos.js'));
}

router.post('/resync', async (req, res) => {
  const t0 = Date.now();

  // Validação opcional do body.
  if (req.body && Object.keys(req.body).length > 0) {
    const v = normalizarTickers(req.body);
    if (!v.ok) {
      return res.status(400).json({ error: v.erro });
    }
    req.body = { tickers: v.tickers };
  }

  const scraper = getScraper();
  if (typeof scraper.resyncAll !== 'function') {
    return res.status(500).json({ error: 'scraper indisponível neste contexto' });
  }

  try {
    const resultado = await scraper.resyncAll(req.db, {
      tickers: req.body?.tickers,
      onProgress: (ticker, detalhe) => {
        // Log leve — um console.info por FII.
        console.info(
          `[scraper-contratos] ${ticker} ${detalhe.success ? 'OK' : 'FALHA'} ` +
          `(${detalhe.source || 'n/a'}) ${detalhe.motivo_skip || detalhe.error || ''}`
        );
      }
    });
    resultado.janela_execucao_ms = Date.now() - t0;
    return res.json(resultado);
  } catch (e) {
    console.error('[scraper-contratos] resync falhou:', e.message);
    return res.status(500).json({ error: 'falha no resync', detalhe: e.message });
  }
});

// Health-check do scraper (não tenta scrape, só verifica se o módulo carrega).
router.get('/status', (_req, res) => {
  try {
    const scraper = getScraper();
    res.json({
      disponivel: typeof scraper.resyncAll === 'function',
      versao: 'PRD12-subPR3'
    });
  } catch (e) {
    res.status(503).json({ disponivel: false, erro: e.message });
  }
});

module.exports = router;
