// TDD Red/Green — PRD 07: Radar de DY Suspeito (yield trap / corte iminente).

import { describe, it, expect } from 'vitest';
import {
  calcularRatio,
  classificarRadar,
  avaliarRadarFII,
  agregarResumo,
  ordenarAlertas,
  validarThresholds,
  DEFAULT_LIMIAR_AMARELO,
  DEFAULT_LIMIAR_VERMELHO
} from '../../shared/radar-dy.js';

describe('calcularRatio (RF-002/003/007)', () => {
  it('12.6 / 10.0 = 1.26', () => {
    expect(calcularRatio(12.6, 10.0)).toBeCloseTo(1.26, 4);
  });
  it('15.1 / 10.0 = 1.51 (vermelho)', () => {
    expect(calcularRatio(15.1, 10.0)).toBeCloseTo(1.51, 4);
  });
  it('dy_medio_5a = 0 → null (RF-007)', () => {
    expect(calcularRatio(12, 0)).toBeNull();
  });
  it('dy_medio_5a negativo → null', () => {
    expect(calcularRatio(12, -1)).toBeNull();
  });
  it('dy_12m null/undefined/NaN → null', () => {
    expect(calcularRatio(null, 10)).toBeNull();
    expect(calcularRatio(undefined, 10)).toBeNull();
    expect(calcularRatio(NaN, 10)).toBeNull();
  });
  it('dy_12m negativo → null', () => {
    expect(calcularRatio(-1, 10)).toBeNull();
  });
  it('preserva precisão completa sem arredondamento', () => {
    const r = calcularRatio(12.34, 9.87);
    expect(r).toBeCloseTo(1.25025, 4);
    expect(r.toFixed(6)).toBe('1.250253');
  });
});

describe('classificarRadar (RF-004/005/006)', () => {
  it('ratio 1.10 < 1.25 → NORMAL', () => {
    expect(classificarRadar(1.10).nivel).toBe('NORMAL');
  });
  it('ratio 1.26 > 1.25 → AMARELO', () => {
    expect(classificarRadar(1.26).nivel).toBe('AMARELO');
  });
  it('ratio 1.50 > 1.50? NÃO. → AMARELO (fronteira estrita, RF-006)', () => {
    expect(classificarRadar(1.50).nivel).toBe('AMARELO');
  });
  it('ratio 1.51 > 1.50 → VERMELHO', () => {
    expect(classificarRadar(1.51).nivel).toBe('VERMELHO');
  });
  it('ratio exatamente 1.25 → NORMAL (fronteira estrita, RF-006)', () => {
    expect(classificarRadar(1.25).nivel).toBe('NORMAL');
  });
  it('precedência: ratio 2.0 → VERMELHO (não AMARELO)', () => {
    expect(classificarRadar(2.0).nivel).toBe('VERMELHO');
  });
  it('null → SEM_DADOS', () => {
    expect(classificarRadar(null).nivel).toBe('SEM_DADOS');
  });
  it('thresholds customizados: amarelo 1.10, vermelho 1.30', () => {
    expect(classificarRadar(1.15, { amarelo: 1.10, vermelho: 1.30 }).nivel).toBe('AMARELO');
    expect(classificarRadar(1.35, { amarelo: 1.10, vermelho: 1.30 }).nivel).toBe('VERMELHO');
  });
});

describe('avaliarRadarFII', () => {
  it('FII com dados válidos retorna ratio + nível + thresholds', () => {
    const r = avaliarRadarFII({
      ticker: 'hglg11', tipo: 'FII', ativo: 1,
      dy_12m: 12.6, dy_medio_5a: 10.0, updated_at: '2026-07-22T12:00:00Z'
    });
    expect(r.ticker).toBe('HGLG11');
    expect(r.ratio).toBeCloseTo(1.26, 2);
    expect(r.nivel).toBe('AMARELO');
    expect(r.thresholds_aplicados.amarelo).toBe(1.25);
    expect(r.thresholds_aplicados.vermelho).toBe(1.50);
    expect(r.dados_em).toBe('2026-07-22T12:00:00Z');
  });
  it('FII sem dy_medio_5a → SEM_DADOS com ratio null', () => {
    const r = avaliarRadarFII({ ticker: 'XPTO11', tipo: 'FII', dy_12m: 9 });
    expect(r.nivel).toBe('SEM_DADOS');
    expect(r.ratio).toBeNull();
  });
  it('input inválido (null) → null', () => {
    expect(avaliarRadarFII(null)).toBeNull();
  });
});

describe('agregarResumo', () => {
  it('conta por nível', () => {
    const items = [
      { nivel: 'VERMELHO' }, { nivel: 'VERMELHO' },
      { nivel: 'AMARELO' },
      { nivel: 'NORMAL' }, { nivel: 'NORMAL' }, { nivel: 'NORMAL' },
      { nivel: 'SEM_DADOS' }
    ];
    expect(agregarResumo(items)).toEqual({
      vermelhos: 2, amarelos: 1, normais: 3, semDados: 1
    });
  });
  it('items vazios / null → todos zeros', () => {
    expect(agregarResumo([])).toEqual({ vermelhos: 0, amarelos: 0, normais: 0, semDados: 0 });
    expect(agregarResumo(null)).toEqual({ vermelhos: 0, amarelos: 0, normais: 0, semDados: 0 });
  });
});

describe('ordenarAlertas (RF-014)', () => {
  it('VERMELHO antes de AMARELO; ratio desc; ticker asc', () => {
    const items = [
      { ticker: 'CCC', nivel: 'AMARELO', ratio: 1.30 },
      { ticker: 'AAA', nivel: 'VERMELHO', ratio: 1.55 },
      { ticker: 'BBB', nivel: 'VERMELHO', ratio: 1.70 },
      { ticker: 'DDD', nivel: 'NORMAL', ratio: 1.10 }
    ];
    const r = ordenarAlertas(items).map(i => i.ticker);
    expect(r).toEqual(['BBB', 'AAA', 'CCC', 'DDD']);
  });
  it('empate de ratio: ticker asc', () => {
    const items = [
      { ticker: 'ZZZ', nivel: 'AMARELO', ratio: 1.30 },
      { ticker: 'AAA', nivel: 'AMARELO', ratio: 1.30 }
    ];
    expect(ordenarAlertas(items).map(i => i.ticker)).toEqual(['AAA', 'ZZZ']);
  });
});

describe('validarThresholds (RF-023)', () => {
  it('padrão 1.25/1.50 → ok', () => {
    expect(validarThresholds(1.25, 1.50)).toEqual({ ok: true, amarelo: 1.25, vermelho: 1.50 });
  });
  it('amarelo <= 1.0 → erro', () => {
    const r = validarThresholds(1.0, 1.50);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INVALID_THRESHOLDS');
  });
  it('vermelho <= amarelo → erro', () => {
    expect(validarThresholds(1.30, 1.30).ok).toBe(false);
    expect(validarThresholds(1.40, 1.30).ok).toBe(false);
  });
  it('vermelho > 10 → erro', () => {
    expect(validarThresholds(1.25, 11).ok).toBe(false);
  });
  it('diferença < 0.01 → erro', () => {
    expect(validarThresholds(1.25, 1.255).ok).toBe(false);
  });
  it('strings numéricas são aceitas', () => {
    expect(validarThresholds('1.25', '1.50').ok).toBe(true);
  });
  it('NaN/null → erro', () => {
    expect(validarThresholds(null, 1.50).ok).toBe(false);
    expect(validarThresholds(NaN, 1.50).ok).toBe(false);
  });
});

describe('defaults', () => {
  it('DEFAULT_LIMIAR_AMARELO = 1.25', () => {
    expect(DEFAULT_LIMIAR_AMARELO).toBe(1.25);
  });
  it('DEFAULT_LIMIAR_VERMELHO = 1.50', () => {
    expect(DEFAULT_LIMIAR_VERMELHO).toBe(1.50);
  });
});