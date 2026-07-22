// Lógica pura de histórico de dividendos para o PRD 01.
// Cobrindo RF-012 (DY realizado 12M), RF-013/014 (DY sustentável + confiança),
// RF-016/017 (sinais de corte/aumento), RF-018 (cadência).
//
// Dual-mode CJS+ESM (vitest + require).
// Funções puras — recebem dados, devolvem objetos descritivos, sem I/O.

function parseYM(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return { ano: Number(m[1]), mes: Number(m[2]), chave: `${m[1]}-${m[2]}` };
}

function mesesEntreYM(a, b) {
  // a, b = { ano, mes }
  return (b.ano - a.ano) * 12 + (b.mes - a.mes);
}

function hojeYM(hoje) {
  const m = String(hoje || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date().toISOString().slice(0, 7);
  return `${m[1]}-${m[2]}`;
}

function diferencaMeses(ymRef, ymBase) {
  const a = parseYM(ymRef), b = parseYM(ymBase);
  if (!a || !b) return 0;
  return mesesEntreYM(a, b);
}

function distribuiveis(proventos) {
  // Soma valor_por_cota por competencia para tipos distribuídos (DIVIDENDO + RENDIMENTO)
  // Exclui AMORTIZACAO, BONIFICACAO e status='AGENDADO' (RF-006/007).
  const map = new Map();
  for (const p of proventos || []) {
    if (p.status === 'AGENDADO') continue;
    const t = String(p.tipo || '').toUpperCase();
    if (t !== 'DIVIDENDO' && t !== 'RENDIMENTO') continue;
    const k = String(p.competencia || (p.data_pagto || '').slice(0, 7));
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + Number(p.valor_por_cota || 0));
  }
  return map;
}

/**
 * DY realizado 12 meses (RF-012).
 * @param {{proventos: Array, cotacao: number, hoje: string, janelaMeses?: number}} opts
 * @returns {{
 *   dy_pct: number|null,
 *   valor_total_por_cota: number,
 *   cobertura_meses: number,
 *   ultima_competencia: string|null,
 *   indisponivel_motivo: string|null
 * }}
 */
function calcularDYRealizado12M(opts) {
  const { proventos, cotacao, hoje } = opts;
  const janela = opts.janelaMeses || 12;
  const refYM = hojeYM(hoje);
  const ref = parseYM(refYM);

  const map = distribuiveis(proventos);
  let totalPorCota = 0;
  let mesesCobertos = 0;
  let ultima = null;
  for (const [ym, val] of map) {
    const dt = parseYM(ym);
    if (!dt) continue;
    const mesesAtras = mesesEntreYM(dt, ref);
    if (mesesAtras >= 0 && mesesAtras < janela) {
      totalPorCota += val;
      mesesCobertos++;
      if (!ultima || dt.ano > parseYM(ultima).ano ||
          (dt.ano === parseYM(ultima).ano && dt.mes > parseYM(ultima).mes)) {
        ultima = ym;
      }
    }
  }

  if (mesesCobertos < janela) {
    return {
      dy_pct: null, valor_total_por_cota: totalPorCota,
      cobertura_meses: mesesCobertos, ultima_competencia: ultima,
      indisponivel_motivo: `Cobertura < ${janela} meses (${mesesCobertos}/${janela})`
    };
  }
  if (!Number.isFinite(cotacao) || cotacao <= 0) {
    return {
      dy_pct: null, valor_total_por_cota: totalPorCota,
      cobertura_meses: mesesCobertos, ultima_competencia: ultima,
      indisponivel_motivo: 'Cotação de referência ausente ou inválida'
    };
  }
  return {
    dy_pct: (totalPorCota / cotacao) * 100,
    valor_total_por_cota: totalPorCota,
    cobertura_meses: mesesCobertos,
    ultima_competencia: ultima,
    indisponivel_motivo: null
  };
}

/**
 * DY sustentável estimado (RF-013) + confiança (RF-014).
 * @param {{proventos: Array, cotacao: number, hoje: string, sincronizacaoDias?: number}} opts
 */
function calcularDYSustentavel(opts) {
  const { proventos, cotacao, hoje } = opts;
  const sincDias = opts.sincronizacaoDias != null ? opts.sincronizacaoDias : 0;
  const refYM = hojeYM(hoje);
  const ref = parseYM(refYM);
  if (!ref) {
    return {
      valor_mensal: null, dy_pct: null, cobertura_meses: 0,
      confianca: 'INDISPONIVEL', indisponivel_motivo: 'Data de referência inválida'
    };
  }

  const map = distribuiveis(proventos);

  // Janela móvel de 36 meses: cobrimos TODOS os meses mesmo sem pagamento,
  // atribuindo 0 para meses sem provento distribuível (RF-013).
  const mesesJanela = [];
  for (let i = 35; i >= 0; i--) {
    const d = new Date(Date.UTC(ref.ano, ref.mes - 1 - i, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    mesesJanela.push({ ym, valor: map.get(ym) || 0 });
  }

  const media36 = mesesJanela.reduce((s, m) => s + m.valor, 0) / 36;
  const media24 = mesesJanela.slice(12).reduce((s, m) => s + m.valor, 0) / 24;
  const cobertura = mesesJanela.filter(m => m.valor > 0).length;

  // Pré-requisitos (RF-013): >= 24 meses E cotação válida
  if (cobertura < 24 || !Number.isFinite(cotacao) || cotacao <= 0) {
    return {
      valor_mensal: null, dy_pct: null,
      cobertura_meses: cobertura,
      confianca: 'INDISPONIVEL',
      indisponivel_motivo: cobertura < 24
        ? `Cobertura < 24 meses (${cobertura}/24)`
        : 'Cotação de referência ausente ou inválida'
    };
  }

  let valorMensal;
  let confianca;
  if (cobertura >= 36 && sincDias <= 30) {
    // RF-013: min(média mensal 24M, média mensal 36M)
    valorMensal = Math.min(media24, media36);
    confianca = 'ALTA';
  } else if (cobertura >= 24) {
    // 24..35 meses ou dados mais antigos (>30 dias)
    valorMensal = media24;
    confianca = 'MEDIA';
  } else {
    valorMensal = null;
    confianca = 'INDISPONIVEL';
  }

  return {
    valor_mensal: valorMensal,
    dy_pct: (valorMensal * 12 / cotacao) * 100,
    cobertura_meses: cobertura,
    confianca,
    indisponivel_motivo: null
  };
}

/**
 * Detecta sinais de corte/aumento (RF-016 + RF-017).
 * Compara cada competência mensal com a média dos 12 totais mensais
 * ANTERIORES (RF-016). Variação ≤ -limite → QUEDA; ≥ +limite → ALTA.
 * - 1 mês na direção → EM_OBSERVACAO
 * - 2 meses consecutivos → CONFIRMADO (CORTE ou AUMENTO)
 * - 0 ou reset → ESTAVEL
 *
 * @param {{serieRecente: Array<{competencia:string, valor:number}>,
 *         baseAnterior?: number, limitePct?: number}} opts
 */
function classificarSinais(opts) {
  const serie = (opts.serieRecente || []).slice()
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
  const limite = opts.limitePct != null ? opts.limitePct : 15;

  // RF-016: base = média dos 12 totais ANTERIORES às competências em
  // análise. Sem info de baseAnterior, usamos a média dos primeiros 12
  // itens da série (mais antigos) como proxy.
  const baseItems = serie.slice(0, Math.min(12, serie.length));
  const base = (typeof opts.baseAnterior === 'number' && Number.isFinite(opts.baseAnterior))
    ? opts.baseAnterior
    : (baseItems.reduce((s, m) => s + m.valor, 0) / baseItems.length);

  const variacoes = serie.map(s => {
    const variacao = base > 0 ? ((s.valor - base) / base) * 100 : 0;
    let direcao = 'ESTAVEL';
    if (variacao <= -limite) direcao = 'QUEDA';
    else if (variacao >= limite) direcao = 'ALTA';
    return { competencia: s.competencia, variacao_pct: variacao, direcao };
  });

  // Avalia rampa dos 2 mais recentes
  const ult2 = variacoes.slice(-2);
  let estado = 'ESTAVEL';
  let direcao = null;
  if (ult2.length === 2 && ult2[0].direcao === 'QUEDA' && ult2[1].direcao === 'QUEDA') {
    estado = 'CORTE_CONFIRMADO'; direcao = 'QUEDA';
  } else if (ult2.length === 2 && ult2[0].direcao === 'ALTA' && ult2[1].direcao === 'ALTA') {
    estado = 'AUMENTO_CONFIRMADO'; direcao = 'ALTA';
  } else if (ult2.length >= 1 && (ult2[ult2.length - 1].direcao === 'QUEDA' || ult2[ult2.length - 1].direcao === 'ALTA')) {
    estado = 'EM_OBSERVACAO';
    direcao = ult2[ult2.length - 1].direcao;
  }

  return { estado, direcao, variacoes };
}

/**
 * Resumo de cadência dos últimos 12 meses (RF-018).
 * REGULAR >= 9 meses pagantes, IRREGULAR < 9.
 */
function resumirCadencia(opts) {
  const { proventos, hoje } = opts;
  const refYM = hojeYM(hoje);
  const ref = parseYM(refYM);
  const map = distribuiveis(proventos);
  let mesesPagantes = 0;
  for (const [ym, val] of map) {
    const dt = parseYM(ym);
    if (!dt) continue;
    const m = mesesEntreYM(dt, ref);
    if (m >= 0 && m < 12 && val > 0) mesesPagantes++;
  }
  return {
    meses_pagantes: mesesPagantes,
    janela_meses: 12,
    cadencia: mesesPagantes >= 9 ? 'REGULAR' : 'IRREGULAR'
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Exports CJS para consumo via require() nas rotas Express.
// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
  calcularDYRealizado12M,
  calcularDYSustentavel,
  classificarSinais,
  resumirCadencia,
  // Auxiliares expostos para testes/debug:
  distribuiveis, parseYM, mesesEntreYM, hojeYM
};