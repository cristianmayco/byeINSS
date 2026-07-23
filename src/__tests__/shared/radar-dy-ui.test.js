// TDD Red/Green — PRD 07: helpers de UI para badge Radar DY + alerta consolidado.

import { describe, it, expect } from 'vitest';
import {
  formatarBadgeRadar,
  formatarAlertaConsolidado,
  formatarTendencia,
  formatarRatio
} from '../../shared/radar-dy-ui.js';

describe('formatarRatio', () => {
  it('formata com vírgula e sufixo ×', () => {
    expect(formatarRatio(1.26)).toBe('1,26×');
    expect(formatarRatio(1.5)).toBe('1,50×');
  });
  it('null/NaN/Infinity → "—"', () => {
    expect(formatarRatio(null)).toBe('—');
    expect(formatarRatio(NaN)).toBe('—');
  });
});

describe('formatarBadgeRadar', () => {
  it('VERMELHO com ratio → "Crítico · 1,63×" + classe vermelha + ícone ⚠', () => {
    const r = formatarBadgeRadar({ nivel: 'VERMELHO', ratio: 1.63, dy_12m: 16.3, dy_medio_5a: 10 });
    expect(r.texto).toBe('Crítico · 1,63×');
    expect(r.classe).toBe('badge-radar-vermelho');
    expect(r.icone).toBe('⚠');
    expect(r.ariaLabel).toMatch(/Crítico/);
    expect(r.ariaLabel).toMatch(/1,63/);
  });
  it('AMARELO com ratio → "Atenção · 1,31×"', () => {
    const r = formatarBadgeRadar({ nivel: 'AMARELO', ratio: 1.31, dy_12m: 13.1, dy_medio_5a: 10 });
    expect(r.texto).toBe('Atenção · 1,31×');
    expect(r.classe).toBe('badge-radar-amarelo');
  });
  it('NORMAL com ratio → "Normal · 1,12×"', () => {
    const r = formatarBadgeRadar({ nivel: 'NORMAL', ratio: 1.12, dy_12m: 11.2, dy_medio_5a: 10 });
    expect(r.texto).toBe('Normal · 1,12×');
    expect(r.classe).toBe('badge-radar-normal');
    expect(r.icone).toBe('✓');
  });
  it('SEM_DADOS sem ratio → "Sem dados" + classe cinza', () => {
    const r = formatarBadgeRadar({ nivel: 'SEM_DADOS', ratio: null });
    expect(r.texto).toBe('Sem dados');
    expect(r.classe).toBe('badge-radar-sem-dados');
    expect(r.icone).toBe('—');
  });
  it('null/undefined → badge SEM_DADOS', () => {
    expect(formatarBadgeRadar(null).texto).toBe('—');
    expect(formatarBadgeRadar(undefined).texto).toBe('—');
  });
});

describe('formatarAlertaConsolidado (RF-015)', () => {
  it('sem alertas → mensagem de sucesso', () => {
    const r = formatarAlertaConsolidado([
      { ticker: 'A', nivel: 'NORMAL', ratio: 1.10 },
      { ticker: 'B', nivel: 'SEM_DADOS' }
    ]);
    expect(r.mensagem).toMatch(/Nenhum DY suspeito/);
    expect(r.total).toBe(0);
    expect(r.itens).toEqual([]);
  });
  it('só amarelos → conta amarelos', () => {
    const items = [
      { ticker: 'A', nivel: 'AMARELO', ratio: 1.30 },
      { ticker: 'B', nivel: 'AMARELO', ratio: 1.40 }
    ];
    const r = formatarAlertaConsolidado(items);
    expect(r.total).toBe(2);
    expect(r.mensagem).toMatch(/2 FII\(s\)/);
    expect(r.mensagem).toMatch(/atenção/i);
    expect(r.itens.length).toBe(2);
  });
  it('vermelhos dominam mensagem + cita amarelos secundários', () => {
    const items = [
      { ticker: 'A', nivel: 'VERMELHO', ratio: 1.60 },
      { ticker: 'B', nivel: 'AMARELO', ratio: 1.30 },
      { ticker: 'C', nivel: 'AMARELO', ratio: 1.40 }
    ];
    const r = formatarAlertaConsolidado(items);
    expect(r.total).toBe(3);
    expect(r.mensagem).toMatch(/1 FII\(s\)/);
    expect(r.mensagem).toMatch(/1,50×/);
    expect(r.mensagem).toMatch(/mais 2 em atenção/);
  });
});

describe('formatarTendencia', () => {
  it('traduz para pt-BR', () => {
    expect(formatarTendencia('EM_QUEDA')).toBe('Em queda');
    expect(formatarTendencia('ESTAVEL')).toBe('Estável');
    expect(formatarTendencia('EM_ALTA')).toBe('Em alta');
  });
  it('INDETERMINADA ou null → "—"', () => {
    expect(formatarTendencia('INDETERMINADA')).toBe('—');
    expect(formatarTendencia(null)).toBe('—');
    expect(formatarTendencia(undefined)).toBe('—');
  });
});