// TDD Red Phase — PRD 01 RF-012 a RF-018 — lógica pura de histórico
// de dividendos. Cobre DY realizado, DY sustentável, sinais, cadência.

import { describe, it, expect } from 'vitest';
import {
  calcularDYRealizado12M,
  calcularDYSustentavel,
  classificarSinais,
  resumirCadencia
} from '../shared/dividendos-hist.js';
// (path é src/shared/dividendos-hist.js — relativo a src/__tests__/)

// Helper: cria N proventos pagos em meses consecutivos
function prov(ticker, anoMes, valor, tipo = 'DIVIDENDO', fonte = 'INVESTIDOR10') {
  return { ticker, competencia: anoMes, data_pagto: `${anoMes}-15`,
           valor_por_cota: valor, tipo, status: 'PAGO', fonte };
}

describe('calcularDYRealizado12M — RF-012', () => {
  // Helper: gera 12 proventos consecutivos dos últimos 12 meses
  function prov12(mesValor, tipo = 'DIVIDENDO') {
    const out = [];
    const now = new Date('2026-07-21');
    for (let i = 0; i < 12; i++) {
      const d = new Date(now); d.setMonth(d.getMonth() - i);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      out.push(prov('HGLG11', ym, mesValor, tipo));
    }
    return out;
  }

  it('retorna (provento_12m_por_cota / cotacao) × 100 quando cobertura ≥ 12M', () => {
    const provs = prov12(0.80);
    const r = calcularDYRealizado12M({
      proventos: provs, cotacao: 10.0, hoje: '2026-07-21', janelaMeses: 12
    });
    // 12 × 0.80 = 9.60 / 10.0 × 100 = 96.0
    expect(r.dy_pct).toBeCloseTo(96.0, 2);
    expect(r.cobertura_meses).toBe(12);
    expect(r.ultima_competencia).toMatch(/^\d{4}-\d{2}$/);
  });

  it('inclui só DIVIDENDO + RENDIMENTO (exclui AMORTIZACAO e BONIFICACAO)', () => {
    const out = [];
    const now = new Date('2026-07-21');
    for (let i = 0; i < 12; i++) {
      const d = new Date(now); d.setMonth(d.getMonth() - i);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      out.push(prov('HGLG11', ym, 0.80, 'DIVIDENDO'));
      out.push(prov('HGLG11', ym, 0.50, 'BONIFICACAO'));   // não conta
      out.push(prov('HGLG11', ym, 1.00, 'AMORTIZACAO'));   // não conta
      out.push(prov('HGLG11', ym, 0.30, 'RENDIMENTO'));   // conta
    }
    const r = calcularDYRealizado12M({
      proventos: out, cotacao: 10, hoje: '2026-07-21', janelaMeses: 12
    });
    // (0.80 + 0.30) * 12 / 10 * 100 = 132.0
    expect(r.dy_pct).toBeCloseTo(132.0, 2);
  });

  it('exclui status=AGENDADO (RF-006)', () => {
    const provs = prov12(0.80, 'DIVIDENDO');
    // Um futuro agendado não conta
    provs.push({ ...prov('HGLG11', '2026-12', 0.99, 'DIVIDENDO'), status: 'AGENDADO' });
    const r = calcularDYRealizado12M({
      proventos: provs, cotacao: 10, hoje: '2026-07-21', janelaMeses: 12
    });
    // 12 × 0.80 = 9.6 / 10 × 100 = 96
    expect(r.dy_pct).toBeCloseTo(96.0, 2);
  });

  it('RF-012: retorna indisponível se cobertura < 12 meses OU cotação inválida', () => {
    const r1 = calcularDYRealizado12M({
      proventos: [prov('HGLG11', '2025-08', 0.80)],
      cotacao: 10, hoje: '2026-07-21', janelaMeses: 12
    });
    expect(r1.dy_pct).toBeNull();
    expect(r1.indisponivel_motivo).toMatch(/cobertura/i);

    const r2 = calcularDYRealizado12M({
      proventos: prov12(0.80), cotacao: 0, hoje: '2026-07-21', janelaMeses: 12
    });
    expect(r2.dy_pct).toBeNull();
    expect(r2.indisponivel_motivo).toMatch(/cota[cç]ão/i);
  });
});

describe('calcularDYSustentavel — RF-013 + RF-014', () => {
  // Helper: gera N pagamentos consecutivos a partir de "hoje - N meses"
  function pagamentosN(meses, valorFixo, offsetMeses = 0) {
    const out = [];
    const now = new Date('2026-07-21');
    for (let i = 0; i < meses; i++) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - offsetMeses - i);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      out.push(prov('HGLG11', ym, valorFixo(i)));
    }
    return out;
  }

  it('com 36 meses usa min(média24, média36) — últimos 24 são 0.50, primeiros 12 são 0.80', () => {
    // Pagamentos de 36 meses consecutivos: os 24 MAIS RECENTES pagam 0.50
    // (queda), os 12 MAIS ANTIGOS pagam 0.80. Cobertura = 36.
    const provs = pagamentosN(36, (i) => i < 24 ? 0.50 : 0.80);
    const r = calcularDYSustentavel({
      proventos: provs, cotacao: 10, hoje: '2026-07-21'
    });
    // media24 (últimos 24) = 24 × 0.50 / 24 = 0.50.
    // media36 (todos 36) = (24 × 0.50 + 12 × 0.80) / 36 = (12 + 9.6) / 36 = 0.60.
    // min(0.50, 0.60) = 0.50.
    expect(r.valor_mensal).toBeCloseTo(0.50, 2);
    expect(r.dy_pct).toBeCloseTo(60.0, 2);  // 0.50 * 12 / 10 * 100
    expect(r.confianca).toBe('ALTA');
  });

  it('com 24..35 meses usa média24M', () => {
    // 30 pagamentos consecutivos = 0.80 cobrindo 30 meses. Os 6 meses sem
    // pagamento no início caem fora da janela 36M, e os 36M cobrem os 30.
    const provs = pagamentosN(30, () => 0.80);
    const r = calcularDYSustentavel({
      proventos: provs, cotacao: 10, hoje: '2026-07-21'
    });
    expect(r.valor_mensal).toBeCloseTo(0.80, 2);
    expect(r.confianca).toBe('MEDIA');  // 30 meses = MEDIA
  });

  it('RF-013: indisponível com < 24 meses de cobertura', () => {
    const provs = pagamentosN(20, () => 0.80);
    const r = calcularDYSustentavel({
      proventos: provs, cotacao: 10, hoje: '2026-07-21'
    });
    expect(r.valor_mensal).toBeNull();
    expect(r.confianca).toBe('INDISPONIVEL');
    expect(r.indisponivel_motivo).toMatch(/cobertura/i);
  });

  it('RF-013: meses sem pagamento contam como zero (fundo que pagou 12 dos 24 últimos)', () => {
    // 12 pagamentos consecutivos = 0.80 nos 12 primeiros dos 36 (não nos
    // 24 mais recentes). Cobertura = 12. Indisponível (< 24 meses).
    const provs = pagamentosN(12, () => 0.80, 24);
    const r = calcularDYSustentavel({
      proventos: provs, cotacao: 10, hoje: '2026-07-21'
    });
    expect(r.cobertura_meses).toBe(12);
    expect(r.confianca).toBe('INDISPONIVEL');
  });
});

describe('classificarSinais — RF-016 + RF-017 (corte/aumento)', () => {
  function serie(base, variacoes) {
    const out = [];
    const now = new Date('2026-07-21');
    for (const [mesesAtras, pct] of variacoes) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - mesesAtras);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      out.push({ competencia: ym, valor: base * (1 + pct / 100) });
    }
    return out.sort((a, b) => a.competencia.localeCompare(b.compatencia));
  }

  it('ESTAVEL: todas as variações dentro da banda ±15%', () => {
    const r = classificarSinais({
      serieRecente: serie(0.80, [
        [12, 0], [11, +5], [10, -3], [9, +2], [8, -1],
        [7, +8], [6, -5], [5, +1], [4, -2], [3, +10],
        [2, -8], [1, 0]
      ]),
      baseAnterior: 0.80,
      limitePct: 15
    });
    expect(r.estado).toBe('ESTAVEL');
  });

  it('EM_OBSERVACAO: uma competência abaixo de -15%', () => {
    const r = classificarSinais({
      serieRecente: serie(0.80, [
        [12, 0], [11, 0], [10, 0], [9, 0],
        [8, 0], [7, 0], [6, 0], [5, 0], [4, 0],
        [3, 0], [2, 0], [1, -20]
      ]),
      baseAnterior: 0.80,
      limitePct: 15
    });
    expect(r.estado).toBe('EM_OBSERVACAO');
    expect(r.direcao).toBe('QUEDA');
  });

  it('CORTE_CONFIRMADO: duas competências consecutivas abaixo de -15%', () => {
    const r = classificarSinais({
      serieRecente: serie(0.80, [
        [12, 0], [11, 0], [10, 0], [9, 0],
        [8, 0], [7, 0], [6, 0], [5, 0], [4, 0],
        [3, -20], [2, -25]  // dois meses consecutivos em queda
      ]),
      baseAnterior: 0.80,
      limitePct: 15
    });
    expect(r.estado).toBe('CORTE_CONFIRMADO');
    expect(r.direcao).toBe('QUEDA');
  });

  it('AUMENTO_CONFIRMADO: dois meses consecutivos acima de +15%', () => {
    const r = classificarSinais({
      serieRecente: serie(0.80, [
        [12, 0], [11, 0], [10, 0], [9, 0], [8, 0],
        [7, 0], [6, 0], [5, 0], [4, 0], [3, +20], [2, +25]
      ]),
      baseAnterior: 0.80,
      limitePct: 15
    });
    expect(r.estado).toBe('AUMENTO_CONFIRMADO');
    expect(r.direcao).toBe('ALTA');
  });
});

describe('resumirCadencia — RF-018', () => {
  function pagouEmMeses(mesesAtrasList) {
    const out = [];
    const hoje = new Date('2026-07-21');
    for (const m of mesesAtrasList) {
      const d = new Date(hoje); d.setMonth(d.getMonth() - m);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      out.push(prov('HGLG11', ym, 0.80));
    }
    return out;
  }

  it('CADENCIA_IRREGULAR se < 9 meses pagantes em 12', () => {
    const provs = pagouEmMeses([1, 2, 3, 4, 5, 6, 7, 8]);  // 8 pagamentos
    const r = resumirCadencia({ proventos: provs, hoje: '2026-07-21' });
    expect(r.meses_pagantes).toBe(8);
    expect(r.cadencia).toBe('IRREGULAR');
  });

  it('CADENCIA_REGULAR se >= 9 meses pagantes em 12', () => {
    const provs = pagouEmMeses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);  // 10 pagamentos
    const r = resumirCadencia({ proventos: provs, hoje: '2026-07-21' });
    expect(r.meses_pagantes).toBe(10);
    expect(r.cadencia).toBe('REGULAR');
  });
});