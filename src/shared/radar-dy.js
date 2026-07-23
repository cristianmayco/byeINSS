// src/shared/radar-dy.js
//
// Lógica pura do PRD 07 (Radar de DY Suspeito — Alerta de Corte Iminente):
// detecta FIIs cujo DY 12M está substancialmente ACIMA da média histórica
// de 5 anos (yield trap / possível corte iminente).
//
// Sem dependência de better-sqlite3, Electron ou Express.
//
// Funções públicas:
//   - calcularRatio(dy_12m, dy_medio_5a)             → razão numérica
//   - classificarRadar(ratio, thresholds?)           → NORMAL/AMARELO/VERMELHO/SEM_DADOS
//   - avaliarRadarFII(ativo, opts?)                 → objeto completo p/ API/UI
//   - agregarResumo(items)                          → { vermelhos, amarelos, semDados, normais }
//   - validarThresholds(amarelo, vermelho)          → null ou { erro, code }

'use strict';

const DEFAULT_LIMIAR_AMARELO = 1.25;
const DEFAULT_LIMIAR_VERMELHO = 1.50;

// ----------------- cálculo -----------------

function numberOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Calcula ratio = dy_12m / dy_medio_5a. Retorna null se algum input for
 * inválido, ausente, não-financeiro, ou se dy_medio_5a for zero (RF-007).
 */
function calcularRatio(dy_12m, dy_medio_5a) {
  const v = numberOrNull(dy_12m);
  const m = numberOrNull(dy_medio_5a);
  if (v === null || m === null) return null;
  if (m <= 0) return null;          // baseline 0/negativo → inválido
  if (v < 0) return null;            // DY 12M negativo não faz sentido
  return v / m;
}

// ----------------- classificação -----------------

/**
 * Classifica o FII com base na razão DY 12M / DY 5a.
 * - ratio null    → SEM_DADOS (RF-007)
 * - ratio > vermelho → VERMELHO (RF-004, RF-005)
 * - ratio > amarelo  → AMARELO  (RF-004, RF-005 — vermelho avaliado antes)
 * - caso contrário    → NORMAL
 *
 * Fronteiras estritas: "maior que" (RF-006).
 */
function classificarRadar(ratio, thresholds = {}) {
  const amarelo = numberOrNull(thresholds.amarelo) ?? DEFAULT_LIMIAR_AMARELO;
  const vermelho = numberOrNull(thresholds.vermelho) ?? DEFAULT_LIMIAR_VERMELHO;

  if (ratio === null || !Number.isFinite(ratio)) {
    return { nivel: 'SEM_DADOS', motivo: 'DADOS_INSUFICIENTES' };
  }
  if (ratio > vermelho) {
    return { nivel: 'VERMELHO', motivo: 'DY 12M substancialmente acima da média histórica' };
  }
  if (ratio > amarelo) {
    return { nivel: 'AMARELO', motivo: 'DY 12M acima da média histórica' };
  }
  return { nivel: 'NORMAL', motivo: 'DY 12M dentro da faixa esperada' };
}

// ----------------- avaliação por FII -----------------

/**
 * Avalia um FII a partir de um objeto-ativo e metadados de configuração.
 * NÃO consulta banco. NÃO importa nada do Electron/Express.
 *
 * @param {object} ativo { ticker, tipo, ativo, dy_12m, dy_medio_5a, updated_at }
 * @param {object} [opts]
 * @param {number} [opts.amarelo=1.25]
 * @param {number} [opts.vermelho=1.50]
 * @returns {object} { ticker, ratio, nivel, motivo, ... }
 */
function avaliarRadarFII(ativo, opts = {}) {
  if (!ativo || typeof ativo !== 'object') return null;

  const dy12 = numberOrNull(ativo.dy_12m);
  const dy5 = numberOrNull(ativo.dy_medio_5a);
  const ratio = calcularRatio(dy12, dy5);
  const cls = classificarRadar(ratio, opts);

  return {
    ticker: (ativo.ticker || '').toUpperCase(),
    tipo: ativo.tipo || null,
    dy_12m: dy12,
    dy_medio_5a: dy5,
    ratio: Number.isFinite(ratio) ? Number(ratio.toFixed(4)) : null,
    nivel: cls.nivel,
    motivo: cls.motivo,
    thresholds_aplicados: {
      amarelo: numberOrNull(opts.amarelo) ?? DEFAULT_LIMIAR_AMARELO,
      vermelho: numberOrNull(opts.vermelho) ?? DEFAULT_LIMIAR_VERMELHO
    },
    dados_em: ativo.updated_at || null
  };
}

// ----------------- agregação -----------------

function agregarResumo(items) {
  const acc = { vermelhos: 0, amarelos: 0, normais: 0, semDados: 0 };
  for (const it of items || []) {
    const n = it && it.nivel;
    if (n === 'VERMELHO') acc.vermelhos++;
    else if (n === 'AMARELO') acc.amarelos++;
    else if (n === 'NORMAL') acc.normais++;
    else acc.semDados++;
  }
  return acc;
}

// ----------------- ordenação do alerta global -----------------

/**
 * Ordena alertas: VERMELHO antes de AMARELO, depois por ratio desc,
 * depois por ticker asc (RF-014).
 */
function ordenarAlertas(items) {
  const rank = { VERMELHO: 0, AMARELO: 1, NORMAL: 2, SEM_DADOS: 3 };
  return [...(items || [])].sort((a, b) => {
    const ra = rank[a.nivel] ?? 9;
    const rb = rank[b.nivel] ?? 9;
    if (ra !== rb) return ra - rb;
    const da = Number.isFinite(a.ratio) ? a.ratio : -Infinity;
    const db = Number.isFinite(b.ratio) ? b.ratio : -Infinity;
    if (da !== db) return db - da;
    return (a.ticker || '').localeCompare(b.ticker || '');
  });
}

// ----------------- validação de thresholds -----------------

/**
 * RF-023: 1.00 < amarelo < vermelho <= 10.00, diferença >= 0.01.
 * Salva atomicamente: se inválido, nenhum valor deve ser aceito.
 */
function validarThresholds(amarelo, vermelho) {
  const a = numberOrNull(amarelo);
  const v = numberOrNull(vermelho);

  if (a === null || v === null) {
    return { ok: false, code: 'INVALID_THRESHOLDS', erro: 'Valores devem ser números finitos' };
  }
  if (a <= 1.0) {
    return { ok: false, code: 'INVALID_THRESHOLDS', erro: 'Limite amarelo deve ser > 1.00' };
  }
  if (v <= a) {
    return { ok: false, code: 'INVALID_THRESHOLDS', erro: 'Limite vermelho deve ser > limite amarelo' };
  }
  if (v > 10.0) {
    return { ok: false, code: 'INVALID_THRESHOLDS', erro: 'Limite vermelho deve ser <= 10.00' };
  }
  if (v - a < 0.01) {
    return { ok: false, code: 'INVALID_THRESHOLDS', erro: 'Diferença mínima entre limites é 0.01' };
  }
  return { ok: true, amarelo: a, vermelho: v };
}

module.exports = {
  DEFAULT_LIMIAR_AMARELO,
  DEFAULT_LIMIAR_VERMELHO,
  calcularRatio,
  classificarRadar,
  avaliarRadarFII,
  agregarResumo,
  ordenarAlertas,
  validarThresholds
};