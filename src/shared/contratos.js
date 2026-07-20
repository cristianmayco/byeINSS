// src/shared/contratos.js
// Lógica pura do PRD 12 (Vencimento de Contratos): cálculo de alerta, parsing
// e validação. SEM dependência de better-sqlite3, Electron ou Express, para
// permitir teste direto via vitest/node e reuso por qualquer camada.
//
// Funções:
//   - TIPOS_REAJUSTE: enum canônico.
//   - calcularAlertaVencimento({ dataVenc, meses, hoje }) → estado do alerta.
//   - parseTipoReajuste(texto) → { tipo, percentual?, texto_original?, erro? }.
//   - validarDadosContratos(body) → { ok, status?, erro? } para uso em rotas.

'use strict';

const TIPOS_REAJUSTE = Object.freeze(['IGPM', 'IPCA', 'FIXO', 'MISTO', 'OUTRO']);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERCENTUAL_MIN = 0;
const PERCENTUAL_MAX = 100;
const MESES_MIN = 0;

/**
 * Calcula o estado de alerta de vencimento.
 *
 * @param {object} args
 * @param {string|null} args.dataVenc  data ISO 'YYYY-MM-DD' ou null
 * @param {number|null} args.meses     meses como INTEGER ou null
 * @param {string} args.hoje           data de referência 'YYYY-MM-DD' (injetável)
 * @param {number} [args.janela=24]    meses para disparar alerta (fonte única:
 *                                      config.vencimento_janela_alerta_meses, default 24)
 * @returns {{
 *   alerta_24m: boolean,
 *   vencido: boolean,
 *   meses_ate_vencimento: number|null,
 *   data_vencimento: string|null,
 *   disponivel: boolean,
 *   motivo_indisponivel: string|null
 * }}
 */
function calcularAlertaVencimento({ dataVenc, meses, hoje, janela = 24 }) {
  const disponivel = Boolean(dataVenc) || Number.isFinite(meses);
  if (!disponivel) {
    return {
      alerta_24m: false,
      vencido: false,
      meses_ate_vencimento: null,
      data_vencimento: null,
      disponivel: false,
      motivo_indisponivel: 'DADOS_INDISPONIVEIS'
    };
  }

  // Regra PRD 12: dataVenc tem precedência sobre meses quando ambos vêm.
  let mesesFinal;
  let dataFinal;
  if (dataVenc) {
    dataFinal = dataVenc;
    mesesFinal = mesesEntre(hoje, dataVenc);
  } else {
    mesesFinal = meses;
    dataFinal = null;
    mesesFinal = arredondarMeses(mesesFinal);
  }

  const vencido = mesesFinal < 0;
  // Boundary: meses < janela aciona alerta. meses exato = janela é estável.
  const alerta_24m = mesesFinal < janela;

  return {
    alerta_24m,
    vencido,
    meses_ate_vencimento: mesesFinal,
    data_vencimento: dataFinal,
    disponivel: true,
    motivo_indisponivel: null
  };
}

/**
 * Normaliza texto livre de tipo de reajuste para enum canônico.
 *
 * Aceita variações: "IGP-M", "IGP M", "igp-m", "IPCA", "IPCA-15", "Fixo 3%",
 * "Fixo", "Misto", "INPC", "Outro: ..." e devolve um objeto:
 *   { tipo: 'IGPM' | 'IPCA' | 'FIXO' | 'MISTO' | 'OUTRO', percentual?, texto_original, erro? }
 *
 * @deprecated_in_v1_use_future_scraper Esta função é consumida pelo
 *   módulo scraper (a ser implementado no sub-PR 2 do PRD 12) que vai
 *   popular `ativos.tipo_reajuste` a partir de texto livre extraído da
 *   página do I10. Sem o scraper, a função só é exercitada por testes.
 *   Mantida aqui para evitar acoplamento tardio quando o scraper chegar.
 */
function parseTipoReajuste(texto) {
  if (texto == null) {
    return { tipo: null, erro: 'Tipo de reajuste vazio' };
  }
  const raw = String(texto).trim();
  if (!raw) {
    return { tipo: null, erro: 'Tipo de reajuste vazio' };
  }
  const upper = raw.toUpperCase().replace(/\s+/g, ' ');

  // FIXO X% (case-insensitive)
  const fixoMatch = upper.match(/^FIXO(?:\s+(\d+(?:[.,]\d+)?)\s*%?)?$/);
  if (fixoMatch) {
    if (!fixoMatch[1]) {
      return { tipo: null, erro: 'FIXO exige percentual (ex.: "Fixo 3%")' };
    }
    const percentual = parseFloat(fixoMatch[1].replace(',', '.'));
    if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
      return { tipo: null, erro: 'FIXO percentual inválido' };
    }
    return { tipo: 'FIXO', percentual, texto_original: raw };
  }

  // IGPM variações: "IGPM", "IGP-M", "IGP M"
  if (/^IGP[\s\-]?M$/.test(upper)) {
    return { tipo: 'IGPM', texto_original: raw };
  }
  // IPCA variações
  if (/^IPCA(?:\s*-?\s*\d{1,2})?$/.test(upper)) {
    return { tipo: 'IPCA', texto_original: raw };
  }
  if (upper === 'MISTO') return { tipo: 'MISTO', texto_original: raw };

  // Sem match canônico → OUTRO preservando texto original.
  return { tipo: 'OUTRO', texto_original: raw };
}

/**
 * Valida payload antes de persistir.
 *
 * Regras (PRD 12):
 *   - dataVenc + meses conflitantes → { ok: false, erro, status: 400 }
 *   - dataVenc inválida (não-ISO) → { ok: false, erro, status: 400 }
 *   - meses fora de [0,∞) ou não-numérico → { ok: false, erro, status: 400 }
 *   - FIXO sem percentual → { ok: false, erro, status: 422 }
 *   - FIXO com percentual fora de [0,100] → { ok: false, erro, status: 422 }
 *   - tipo_reajuste fora do enum → { ok: false, erro, status: 400 }
 *
 * @param {object} body
 * @returns {{ ok: boolean, status?: number, erro?: string }}
 */
function validarDadosContratos(body) {
  body = body || {};
  // null é tratado como "não presente" para permitir que PUTs com
  // `vencimento_medio_contratos_meses: null` limpem o valor armazenado
  // (workaround para "switching" entre data e meses sem conflito).
  const temData = body.vencimento_medio_contratos != null;
  const temMeses = body.vencimento_medio_contratos_meses != null;

  if (temData && temMeses) {
    return {
      ok: false,
      status: 400,
      erro: 'Informe apenas data OU meses, não ambos (conflito de fontes)'
    };
  }

  // Validação estrita de data: deve ser 'YYYY-MM-DD' exato.
  if (temData) {
    if (typeof body.vencimento_medio_contratos !== 'string' ||
        !ISO_DATE_RE.test(body.vencimento_medio_contratos)) {
      return {
        ok: false,
        status: 400,
        erro: 'vencimento_medio_contratos deve ser string ISO YYYY-MM-DD'
      };
    }
    // Validar que mês e dia formam uma data real (não 2026-13-40).
    const [y, m, d] = body.vencimento_medio_contratos.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) {
      return { ok: false, status: 400, erro: 'vencimento_medio_contratos: mês/dia inválido' };
    }
    // Validação adicional: garantir que data existe (não 2026-02-30)
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return { ok: false, status: 400, erro: 'vencimento_medio_contratos: data inexistente' };
    }
  }

  // Validação de meses: deve ser number (não string) e >= 0.
  if (temMeses) {
    if (typeof body.vencimento_medio_contratos_meses !== 'number' ||
        !Number.isInteger(body.vencimento_medio_contratos_meses) ||
        body.vencimento_medio_contratos_meses < MESES_MIN) {
      return {
        ok: false,
        status: 400,
        erro: 'vencimento_medio_contratos_meses deve ser inteiro >= 0'
      };
    }
  }

  if (body.tipo_reajuste !== undefined && body.tipo_reajuste !== null) {
    if (!TIPOS_REAJUSTE.includes(body.tipo_reajuste)) {
      return { ok: false, status: 400, erro: 'tipo_reajuste inválido' };
    }
    if (body.tipo_reajuste === 'FIXO') {
      if (!Number.isFinite(body.reajuste_percentual) ||
          typeof body.reajuste_percentual !== 'number' ||
          body.reajuste_percentual < PERCENTUAL_MIN ||
          body.reajuste_percentual > PERCENTUAL_MAX) {
        return {
          ok: false,
          status: 422,
          erro: `FIXO exige reajuste_percentual numérico em [${PERCENTUAL_MIN}, ${PERCENTUAL_MAX}]`
        };
      }
    }
  }

  return { ok: true };
}

// ===== helpers internos (não exportados) =====

function mesesEntre(dataInicial, dataFinal) {
  // Diferença em meses-calendário aproximado (30.4375 dias/mês).
  // Robusto contra horário local porque recebe apenas YYYY-MM-DD.
  const [ai, mi, di] = dataInicial.split('-').map(Number);
  const [af, mf, df] = dataFinal.split('-').map(Number);
  if (![ai, mi, di, af, mf, df].every(Number.isFinite)) return 0;
  let meses = (af - ai) * 12 + (mf - mi);
  if (df < di) meses -= 1;
  return arredondarMeses(meses);
}

function arredondarMeses(n) {
  // Truncar para inteiro (meses inteiros é a precisão que exibimos).
  return Math.trunc(n);
}

module.exports = {
  TIPOS_REAJUSTE,
  calcularAlertaVencimento,
  parseTipoReajuste,
  validarDadosContratos
};
