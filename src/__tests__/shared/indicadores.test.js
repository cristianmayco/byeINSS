// src/__tests__/shared/indicadores.test.js
// Cobertura isolada da lógica pura de indicadores (PRD 02 sub-PR 1).
// TDD Green: testes para funções puras sem dependência de DB/Electron.

import { describe, it, expect } from 'vitest';
import {
  calcularDyVs5a,
  classificarDyVs5a,
  mergeIndicadores,
  normalizarRotuloRentabilidade,
  parsePercentBr
} from '../../shared/indicadores.js';

describe('calcularDyVs5a', () => {
  it('calcula razao e pct quando ambos válidos', () => {
    const r = calcularDyVs5a({ dy_12m: 9.0, dy_medio_5a: 10.0 });
    expect(r.calculavel).toBe(true);
    expect(r.razao).toBeCloseTo(0.9, 6);
    expect(r.pct).toBeCloseTo(90, 6);
    expect(r.motivo_indisponivel).toBeNull();
  });

  it('retorna INSUFICIENTE quando dy_12m é null', () => {
    const r = calcularDyVs5a({ dy_12m: null, dy_medio_5a: 10.0 });
    expect(r.calculavel).toBe(false);
    expect(r.razao).toBeNull();
    expect(r.motivo_indisponivel).toBe('DADOS_INSUFICIENTES');
  });

  it('retorna INSUFICIENTE quando dy_medio_5a é null', () => {
    const r = calcularDyVs5a({ dy_12m: 9.0, dy_medio_5a: null });
    expect(r.calculavel).toBe(false);
  });

  it('retorna HISTORICO_ZERADO quando dy_medio_5a = 0 (divisão por zero)', () => {
    const r = calcularDyVs5a({ dy_12m: 9.0, dy_medio_5a: 0 });
    expect(r.calculavel).toBe(false);
    expect(r.motivo_indisponivel).toBe('HISTORICO_ZERADO');
  });

  it('aceita valores numéricos como string', () => {
    const r = calcularDyVs5a({ dy_12m: '9.0', dy_medio_5a: '10.0' });
    expect(r.calculavel).toBe(true);
    expect(r.pct).toBeCloseTo(90, 6);
  });

  it('rejeita string não-numérica', () => {
    const r = calcularDyVs5a({ dy_12m: 'abc', dy_medio_5a: 10.0 });
    expect(r.calculavel).toBe(false);
  });

  it('permite dy_medio_5a negativo sem quebrar (devolve razão negativa)', () => {
    const r = calcularDyVs5a({ dy_12m: 9.0, dy_medio_5a: -10.0 });
    expect(r.calculavel).toBe(true);
    expect(r.razao).toBeCloseTo(-0.9, 6);
  });

  it('preserva precisão: 95.5 / 100 → 95.5', () => {
    const r = calcularDyVs5a({ dy_12m: 95.5, dy_medio_5a: 100 });
    expect(r.pct).toBeCloseTo(95.5, 6);
  });
});

describe('classificarDyVs5a', () => {
  it('EM_LINHA / CONSISTENTE quando pct = 100', () => {
    const c = classificarDyVs5a({ pct: 100 });
    expect(c.classificacao).toBe('EM_LINHA');
    expect(c.severidade).toBe('CONSISTENTE');
  });

  it('EM_LINHA / CONSISTENTE quando pct = 95 (limite inferior padrão)', () => {
    const c = classificarDyVs5a({ pct: 95 });
    expect(c.classificacao).toBe('EM_LINHA');
    expect(c.severidade).toBe('CONSISTENTE');
  });

  it('EM_LINHA / CONSISTENTE quando pct = 105 (limite superior padrão)', () => {
    const c = classificarDyVs5a({ pct: 105 });
    expect(c.classificacao).toBe('EM_LINHA');
    expect(c.severidade).toBe('CONSISTENTE');
  });

  it('ABAIXO / ATENCAO quando pct = 90 (entre 80 e 95)', () => {
    const c = classificarDyVs5a({ pct: 90 });
    expect(c.classificacao).toBe('ABAIXO');
    expect(c.severidade).toBe('ATENCAO');
  });

  it('ABAIXO / CRITICO quando pct < 80', () => {
    const c = classificarDyVs5a({ pct: 70 });
    expect(c.classificacao).toBe('ABAIXO');
    expect(c.severidade).toBe('CRITICO');
  });

  it('ABAIXO / CRITICO exatamente em pct = 80 (boundary)', () => {
    const c = classificarDyVs5a({ pct: 80 });
    expect(c.classificacao).toBe('ABAIXO');
    expect(c.severidade).toBe('CRITICO');
  });

  it('ABAIXO / CRITICO exatamente em pct = 79.99', () => {
    const c = classificarDyVs5a({ pct: 79.99 });
    expect(c.severidade).toBe('CRITICO');
  });

  it('ACIMA / ATENCAO quando pct = 110', () => {
    const c = classificarDyVs5a({ pct: 110 });
    expect(c.classificacao).toBe('ACIMA');
    expect(c.severidade).toBe('ATENCAO');
  });

  it('ACIMA / CRITICO quando pct > 125', () => {
    const c = classificarDyVs5a({ pct: 130 });
    expect(c.classificacao).toBe('ACIMA');
    expect(c.severidade).toBe('CRITICO');
  });

  it('INSUFICIENTE / INDEFINIDO quando pct = null', () => {
    const c = classificarDyVs5a({ pct: null });
    expect(c.classificacao).toBe('INSUFICIENTE');
    expect(c.severidade).toBe('INDEFINIDO');
  });

  it('respeita limiar_abaixo_pct customizado', () => {
    const c = classificarDyVs5a({ pct: 92, limiar_abaixo_pct: 90 });
    expect(c.classificacao).toBe('EM_LINHA'); // 92 >= 90
  });

  it('respeita limiar_acima_pct customizado', () => {
    const c = classificarDyVs5a({ pct: 115, limiar_acima_pct: 110 });
    expect(c.classificacao).toBe('ACIMA');
    expect(c.severidade).toBe('ATENCAO');
  });

  it('motivo descreve a regra aplicada', () => {
    expect(classificarDyVs5a({ pct: 70 }).motivo).toContain('corte');
    expect(classificarDyVs5a({ pct: 130 }).motivo).toContain('armadilha');
    expect(classificarDyVs5a({ pct: 100 }).motivo).toContain('em linha');
  });
});

describe('mergeIndicadores (persistência segura — RF-008)', () => {
  it('preserva valor anterior quando novo campo é null', () => {
    const prev = { dy_medio_5a: 9.5, rentab_nominal_1a: 12.0 };
    const novo = { dy_medio_5a: null, rentab_nominal_1a: 15.0 };
    const merged = mergeIndicadores(prev, novo);
    expect(merged.dy_medio_5a).toBe(9.5);   // preservado
    expect(merged.rentab_nominal_1a).toBe(15.0); // atualizado
  });

  it('atualiza campo quando novo valor é número válido', () => {
    const prev = { dy_medio_5a: 9.0 };
    const novo = { dy_medio_5a: 9.5 };
    const merged = mergeIndicadores(prev, novo);
    expect(merged.dy_medio_5a).toBe(9.5);
  });

  it('atualiza dy_medio_5a_fonte apenas quando dy_medio_5a foi atualizado', () => {
    const prev = { dy_medio_5a: 9.0, dy_medio_5a_fonte: 'investidor10' };
    const novo = { rentab_nominal_1a: 12.0 }; // dy_medio_5a não veio
    const merged = mergeIndicadores(prev, novo);
    expect(merged.dy_medio_5a_fonte).toBe('investidor10'); // preservado
  });

  it('sobrescreve dy_medio_5a_fonte quando dy_medio_5a atualiza', () => {
    const prev = { dy_medio_5a: 9.0, dy_medio_5a_fonte: 'manual' };
    const novo = { dy_medio_5a: 9.5 };
    const merged = mergeIndicadores(prev, novo, { fonte: 'investidor10' });
    expect(merged.dy_medio_5a).toBe(9.5);
    expect(merged.dy_medio_5a_fonte).toBe('investidor10');
  });

  it('atualiza dy_medio_5a_atualizado_em apenas quando dy_medio_5a muda', () => {
    const prev = { dy_medio_5a: 9.0, dy_medio_5a_atualizado_em: '2025-01-01T00:00:00Z' };
    const novo = { rentab_nominal_1a: 12.0 };
    const merged = mergeIndicadores(prev, novo);
    expect(merged.dy_medio_5a_atualizado_em).toBe('2025-01-01T00:00:00Z');
  });

  it('substitui atualizado_em quando novo valor é fornecido em opts.atualizadoEm', () => {
    const prev = { dy_medio_5a: 9.0 };
    const novo = { dy_medio_5a: 9.5 };
    const merged = mergeIndicadores(prev, novo, { atualizadoEm: '2026-07-21T12:00:00Z' });
    expect(merged.dy_medio_5a_atualizado_em).toBe('2026-07-21T12:00:00Z');
  });

  it('não toca em campos fora da lista tracked', () => {
    const prev = { dy_medio_5a: 9.0, dy_12m: 8.5, ticker: 'HGLG11' };
    const novo = { dy_medio_5a: 9.5 };
    const merged = mergeIndicadores(prev, novo);
    expect(merged.dy_12m).toBe(8.5);
    expect(merged.ticker).toBe('HGLG11');
  });

  it('lida com prev = {} (novo FII)', () => {
    const novo = { dy_medio_5a: 9.5, rentab_nominal_1a: 12.0 };
    const merged = mergeIndicadores({}, novo, { fonte: 'investidor10' });
    expect(merged.dy_medio_5a).toBe(9.5);
    expect(merged.rentab_nominal_1a).toBe(12.0);
    expect(merged.dy_medio_5a_fonte).toBe('investidor10');
  });

  it('lida com novo = {} (scraper falhou em todos os campos)', () => {
    const prev = { dy_medio_5a: 9.0, rentab_nominal_1a: 12.0 };
    const merged = mergeIndicadores(prev, {});
    expect(merged).toEqual(prev);
  });

  it('lida com prev = null', () => {
    const merged = mergeIndicadores(null, { dy_medio_5a: 9.5 });
    expect(merged.dy_medio_5a).toBe(9.5);
  });

  it('ignora string vazia como atualização', () => {
    const prev = { dy_medio_5a: 9.0 };
    const novo = { dy_medio_5a: '' };
    const merged = mergeIndicadores(prev, novo);
    expect(merged.dy_medio_5a).toBe(9.0);
  });

  it('ignora NaN como atualização', () => {
    const prev = { dy_medio_5a: 9.0 };
    const novo = { dy_medio_5a: NaN };
    const merged = mergeIndicadores(prev, novo);
    expect(merged.dy_medio_5a).toBe(9.0);
  });

  it('aceita string numérica como atualização', () => {
    const prev = { dy_medio_5a: 9.0 };
    const novo = { dy_medio_5a: '9.5' };
    const merged = mergeIndicadores(prev, novo);
    expect(merged.dy_medio_5a).toBe(9.5);
  });
});

describe('normalizarRotuloRentabilidade', () => {
  it('reconhece variações de 1 ano', () => {
    expect(normalizarRotuloRentabilidade('1a')).toBe('1a');
    expect(normalizarRotuloRentabilidade('1 ano')).toBe('1a');
    expect(normalizarRotuloRentabilidade('12 meses')).toBe('1a');
    expect(normalizarRotuloRentabilidade('1A')).toBe('1a');
  });
  it('reconhece variações de 2 anos', () => {
    expect(normalizarRotuloRentabilidade('2a')).toBe('2a');
    expect(normalizarRotuloRentabilidade('2 anos')).toBe('2a');
    expect(normalizarRotuloRentabilidade('24 meses')).toBe('2a');
  });
  it('reconhece variações de 5 anos', () => {
    expect(normalizarRotuloRentabilidade('5a')).toBe('5a');
    expect(normalizarRotuloRentabilidade('5 anos')).toBe('5a');
    expect(normalizarRotuloRentabilidade('60 meses')).toBe('5a');
  });
  it('retorna null para rótulos não reconhecidos', () => {
    expect(normalizarRotuloRentabilidade('3a')).toBeNull();
    expect(normalizarRotuloRentabilidade('1 mês')).toBeNull();
    expect(normalizarRotuloRentabilidade('')).toBeNull();
    expect(normalizarRotuloRentabilidade(null)).toBeNull();
    expect(normalizarRotuloRentabilidade(undefined)).toBeNull();
  });
});

describe('parsePercentBr', () => {
  it('converte formato BR com vírgula', () => {
    expect(parsePercentBr('12,34%')).toBe(12.34);
    expect(parsePercentBr('-5,6%')).toBe(-5.6);
    expect(parsePercentBr('0%')).toBe(0);
  });
  it('converte formato EN com ponto', () => {
    expect(parsePercentBr('12.34%')).toBe(12.34);
    expect(parsePercentBr('-5.6%')).toBe(-5.6);
  });
  it('converte sem sinal de %', () => {
    expect(parsePercentBr('12,5')).toBe(12.5);
    expect(parsePercentBr('7.8')).toBe(7.8);
  });
  it('preserva números como input', () => {
    expect(parsePercentBr(9.0)).toBe(9.0);
    expect(parsePercentBr(0)).toBe(0);
    expect(parsePercentBr(-3.5)).toBe(-3.5);
  });
  it('retorna null para inválidos', () => {
    expect(parsePercentBr(null)).toBeNull();
    expect(parsePercentBr(undefined)).toBeNull();
    expect(parsePercentBr('')).toBeNull();
    expect(parsePercentBr('abc')).toBeNull();
    expect(parsePercentBr(NaN)).toBeNull();
  });
  it('lida com whitespace', () => {
    expect(parsePercentBr('  12,34%  ')).toBe(12.34);
  });
  it('detecta formato BR com ponto como milhar', () => {
    expect(parsePercentBr('1.234,56%')).toBe(1234.56);
  });
});