// src/shared/indicadores.js
// Lógica pura do PRD 02 (Indicadores Históricos de DY e Rentabilidade Real):
// classificação, persistência segura e normalização de rótulos. SEM dependência
// de better-sqlite3, Electron ou Express, para permitir teste direto via
// vitest/node e reuso por qualquer camada.
//
// Funções:
//   - calcularDyVs5a({ dy_12m, dy_medio_5a }) → razão e percentual.
//   - classificarDyVs5a({ pct, limiar_abaixo_pct, limiar_acima_pct })
//       → { classificacao: 'EM_LINHA'|'ABAIXO'|'ACIMA'|'INSUFICIENTE',
//           severidade: 'CONSISTENTE'|'ATENCAO'|'CRITICO'|'INDEFINIDO' }.
//   - mergeIndicadores(prev, novo) → objeto com campos atualizados somente onde
//       novo[campo] != null (nunca apaga valor válido anterior).
//   - normalizarRotuloRentabilidade(rotulo) → chave canônica ('1a'|'2a'|'5a').
//   - parsePercentBr(text) → float em pontos percentuais (12,34% → 12.34).

'use strict';

/**
 * Limites padrão (PRD 02 RF-014 / agente decisão §3).
 * Fonte única de thresholds — mesma configuração pode ser sobrescrita pelo
 * caller (config.indicador_dy_vs_5a_abaixo_pct / _acima_pct).
 */
const DEFAULT_LIMIAR_ABAIXO_PCT = 95;
const DEFAULT_LIMIAR_ACIMA_PCT = 105;

/**
 * Calcula a razão DY 12M / DY médio 5 anos e o percentual resultante.
 *
 * @param {object} args
 * @param {number|null} args.dy_12m         DY dos últimos 12 meses (pontos %)
 * @param {number|null} args.dy_medio_5a    DY médio de 5 anos (pontos %)
 * @returns {{
 *   razao: number|null,
 *   pct: number|null,
 *   calculavel: boolean,
 *   motivo_indisponivel: string|null
 * }}
 */
function calcularDyVs5a({ dy_12m, dy_medio_5a }) {
  const dy12Num = numberOrNull(dy_12m);
  const dy5Num = numberOrNull(dy_medio_5a);

  // Edge: dy_medio_5a é 0 — divisão por zero. Consideramos "indisponível"
  // porque não há histórico útil para comparar. dy_medio_5a negativo é
  // semanticamente inválido mas tratamos como dado utilizável (defensivo).
  if (dy12Num === null || dy5Num === null || dy5Num === 0) {
    return {
      razao: null,
      pct: null,
      calculavel: false,
      motivo_indisponivel: dy5Num === 0 ? 'HISTORICO_ZERADO' : 'DADOS_INSUFICIENTES'
    };
  }

  const razao = dy12Num / dy5Num;
  const pct = razao * 100;
  return {
    razao,
    pct,
    calculavel: true,
    motivo_indisponivel: null
  };
}

/**
 * Classifica a posição do DY 12M em relação ao DY 5 anos.
 *
 * @param {object} args
 * @param {number|null} args.pct                  percentual (dy_12m/dy_medio_5a)*100
 * @param {number} [args.limiar_abaixo_pct=95]    abaixo disso → ABAIXO
 * @param {number} [args.limiar_acima_pct=105]    acima disso → ACIMA
 * @returns {{
 *   classificacao: 'EM_LINHA'|'ABAIXO'|'ACIMA'|'INSUFICIENTE',
 *   severidade: 'CONSISTENTE'|'ATENCAO'|'CRITICO'|'INDEFINIDO',
 *   motivo: string|null
 * }}
 *
 * Regras (PRD 02 RF-014, KPI: classificação correta em 80% e 95%):
 *   - calculavel=false → INSUFICIENTE / INDEFINIDO
 *   - ABAIXO com pct ≤ 80  → CRITICO   (provável corte)
 *   - ABAIXO com 80 < pct  → ATENCAO   (desvio leve, ainda consistente)
 *   - ACIMA  com pct > 125 → CRITICO   (yield inflado por queda de preço)
 *   - ACIMA  com 105 < pct → ATENCAO
 *   - EM_LINHA 95 ≤ pct ≤ 105 → CONSISTENTE
 */
function classificarDyVs5a({
  pct,
  limiar_abaixo_pct = DEFAULT_LIMIAR_ABAIXO_PCT,
  limiar_acima_pct = DEFAULT_LIMIAR_ACIMA_PCT
}) {
  if (pct === null || !Number.isFinite(pct)) {
    return { classificacao: 'INSUFICIENTE', severidade: 'INDEFINIDO', motivo: 'DADOS_INSUFICIENTES' };
  }

  if (pct < limiar_abaixo_pct) {
    if (pct <= 80) {
      return { classificacao: 'ABAIXO', severidade: 'CRITICO', motivo: 'DY 12M ≤ 80% do DY 5A — provável corte' };
    }
    return { classificacao: 'ABAIXO', severidade: 'ATENCAO', motivo: `DY 12M abaixo de ${limiar_abaixo_pct}% do DY 5A` };
  }

  if (pct > limiar_acima_pct) {
    if (pct > 125) {
      return { classificacao: 'ACIMA', severidade: 'CRITICO', motivo: 'DY 12M > 125% do DY 5A — possível armadilha de yield' };
    }
    return { classificacao: 'ACIMA', severidade: 'ATENCAO', motivo: `DY 12M acima de ${limiar_acima_pct}% do DY 5A` };
  }

  return { classificacao: 'EM_LINHA', severidade: 'CONSISTENTE', motivo: 'DY 12M em linha com a média histórica' };
}

/**
 * Faz merge seguro entre o objeto anterior (persistido) e o novo (capturado).
 * REGRAS:
 *   - campo novo null/undefined/NaN → mantém valor anterior.
 *   - campo novo presente → sobrescreve.
 *   - campos exclusivos do anterior (não tocados no novo) → preservados.
 *   - dy_medio_5a_atualizado_em é setado somente se dy_medio_5a foi atualizado.
 *   - dy_medio_5a_fonte é setado para o source injetado quando há atualização.
 *
 * @param {object} prev  objeto persistido (linha do banco ou {})
 * @param {object} novo  objeto extraído do scraper (campos opcionais)
 * @param {object} [opts]
 * @param {string} [opts.fonte='investidor10']  fonte da nova captura
 * @param {string} [opts.atualizadoEm]         ISO datetime (default: agora)
 * @returns {object} objeto mergeado pronto para UPDATE
 */
function mergeIndicadores(prev, novo, opts = {}) {
  const fonte = (opts && opts.fonte) || 'investidor10';
  const atualizadoEm = (opts && opts.atualizadoEm) || new Date().toISOString();

  const tracked = [
    'dy_medio_5a',
    'rentab_nominal_1a', 'rentab_nominal_2a', 'rentab_nominal_5a',
    'rentab_real_1a', 'rentab_real_2a', 'rentab_real_5a'
  ];

  const out = { ...(prev || {}) };
  let atualizouDyMedio = false;

  for (const k of tracked) {
    const novoVal = novo ? novo[k] : undefined;
    if (isUsableNumber(novoVal)) {
      // Converte string-numérica para número (RF-006: tipo REAL).
      out[k] = typeof novoVal === 'number' ? novoVal : Number(novoVal);
      if (k === 'dy_medio_5a') atualizouDyMedio = true;
    }
    // else: mantém valor anterior (regra RF-008 do PRD 02)
  }

  if (atualizouDyMedio) {
    out.dy_medio_5a_fonte = fonte;
    out.dy_medio_5a_atualizado_em = atualizadoEm;
  }

  return out;
}

/**
 * Normaliza rótulo de janela de rentabilidade.
 *
 * Aceita variações comuns do I10: '1a', '1 ano', '12 meses',
 * '2a', '24 meses', '5a', '60 meses'. Retorna chave canônica.
 *
 * @param {string} rotulo
 * @returns {'1a'|'2a'|'5a'|null}  null se não reconhecido
 */
function normalizarRotuloRentabilidade(rotulo) {
  if (rotulo === null || rotulo === undefined) return null;
  const s = String(rotulo).toLowerCase().trim();

  // 1 ano
  if (/^1\s*a/.test(s) || /^1\s*ano/.test(s) || /^12\s*meses/.test(s)) return '1a';
  // 2 anos
  if (/^2\s*a/.test(s) || /^2\s*anos/.test(s) || /^24\s*meses/.test(s)) return '2a';
  // 5 anos
  if (/^5\s*a/.test(s) || /^5\s*anos/.test(s) || /^60\s*meses/.test(s)) return '5a';

  return null;
}

/**
 * Converte string de percentual em formato brasileiro para float.
 * '12,34%' → 12.34, '-5,6%' → -5.6, '0%' → 0. Mantém sinal e zero.
 *
 * @param {string|number|null} text
 * @returns {number|null} null se inválido/ausente
 */
function parsePercentBr(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const s = String(text).trim();
  if (!s) return null;

  // Detecta formato: '12,34%' (BR) ou '12.34%' / '12.34' (EN)
  // Estratégia: se tem vírgula como separador decimal e ponto como milhar,
  // remove ponto e troca vírgula por ponto. Caso contrário, mantém ponto.
  let cleaned = s.replace(/\s+/g, '').replace(/%$/, '');
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/,-?\d+$/.test(cleaned) === false && cleaned.includes(',') && !cleaned.includes('.')) {
    // vírgula como decimal simples (ex: '12,5')
    cleaned = cleaned.replace(',', '.');
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// --------- helpers internos ---------

function isUsableNumber(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n);
}

function numberOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  DEFAULT_LIMIAR_ABAIXO_PCT,
  DEFAULT_LIMIAR_ACIMA_PCT,
  calcularDyVs5a,
  classificarDyVs5a,
  mergeIndicadores,
  normalizarRotuloRentabilidade,
  parsePercentBr
};