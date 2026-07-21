// TDD Red Phase — PRD 03 RF-004 a RF-008, RF-022 — Parser da agenda I10.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';
import {
  extractAgendaDividendos,
  normalizarTipo,
  normalizarDataBR,
  normalizarNumeroBR
} from '../shared/agenda-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'i10', name), 'utf8');
}

function dom(html) {
  return new JSDOM(html).window.document;
}

describe('normalizarTipo — PRD 03 RF-005 normalização Tipo I10 → enum', () => {
  it('mapeia Dividendo/Dividendos → DIVIDENDO', () => {
    expect(normalizarTipo('Dividendo')).toBe('DIVIDENDO');
    expect(normalizarTipo('Dividendos')).toBe('DIVIDENDO');
    expect(normalizarTipo('dividendo')).toBe('DIVIDENDO');
    expect(normalizarTipo('DIVIDENDO')).toBe('DIVIDENDO');
    expect(normalizarTipo('  dividendos ')).toBe('DIVIDENDO');
  });
  it('mapeia Rendimento/Rendimentos → RENDIMENTO', () => {
    expect(normalizarTipo('Rendimento')).toBe('RENDIMENTO');
    expect(normalizarTipo('Rendimentos')).toBe('RENDIMENTO');
    expect(normalizarTipo('rendimento')).toBe('RENDIMENTO');
  });
  it('mapeia Amortização/Amortizacao → AMORTIZACAO (RF-001)', () => {
    expect(normalizarTipo('Amortização')).toBe('AMORTIZACAO');
    expect(normalizarTipo('Amortizacao')).toBe('AMORTIZACAO');
    expect(normalizarTipo('Amortizações')).toBe('AMORTIZACAO');
    expect(normalizarTipo('amortizacao')).toBe('AMORTIZACAO');
    expect(normalizarTipo('  amortizacao  ')).toBe('AMORTIZACAO');
  });
  it('mapeia Bonificação → BONIFICACAO', () => {
    expect(normalizarTipo('Bonificação')).toBe('BONIFICACAO');
    expect(normalizarTipo('Bonificacao')).toBe('BONIFICACAO');
    expect(normalizarTipo('BONIFICACAO')).toBe('BONIFICACAO');
  });
  it('RF-006: tipo desconhecido → null (NÃO converte silenciosamente para DIVIDENDO)', () => {
    expect(normalizarTipo('Outros')).toBeNull();
    expect(normalizarTipo('Subscrição')).toBeNull();
    expect(normalizarTipo('JCP')).toBeNull();
    expect(normalizarTipo('')).toBeNull();
    expect(normalizarTipo(null)).toBeNull();
    expect(normalizarTipo(undefined)).toBeNull();
    expect(normalizarTipo('xyz123')).toBeNull();
  });
});

describe('normalizarDataBR + normalizarNumeroBR', () => {
  it('DD/MM/YYYY → YYYY-MM-DD', () => {
    expect(normalizarDataBR('15/07/2026')).toBe('2026-07-15');
    expect(normalizarDataBR('01/01/2025')).toBe('2025-01-01');
  });
  it('retorna null para entrada inválida', () => {
    expect(normalizarDataBR('')).toBeNull();
    expect(normalizarDataBR(null)).toBeNull();
    expect(normalizarDataBR('abc')).toBeNull();
  });
  it('BR number → float', () => {
    expect(normalizarNumeroBR('R$ 0,80')).toBeCloseTo(0.80, 5);
    expect(normalizarNumeroBR('R$ 1.234,56')).toBeCloseTo(1234.56, 5);
    expect(normalizarNumeroBR('0,15')).toBeCloseTo(0.15, 5);
  });
});

describe('extractAgendaDividendos — RF-004 captura coluna Tipo', () => {
  it('extrai 5 linhas válidas + 1 tipo desconhecido de fixture canônica', () => {
    const html = loadFixture('agenda-com-tipo.html');
    const r = extractAgendaDividendos(dom(html));
    expect(r.table_found).toBe(true);
    expect(r.rows).toHaveLength(6);
    // HGLG11 → DIVIDENDO
    const hglg = r.rows.find(x => x.ticker === 'HGLG11');
    expect(hglg.tipo).toBe('DIVIDENDO');
    expect(hglg.data_pagto).toBe('2026-07-20');
    expect(hglg.data_com).toBe('2026-07-15');
    expect(hglg.valor_por_cota).toBeCloseTo(0.80, 5);
    // XPML11 → AMORTIZACAO
    const xpml = r.rows.find(x => x.ticker === 'XPML11');
    expect(xpml.tipo).toBe('AMORTIZACAO');
    expect(xpml.valor_por_cota).toBeCloseTo(0.20, 5);
    // KNIP11 → RENDIMENTO
    const knip = r.rows.find(x => x.ticker === 'KNIP11');
    expect(knip.tipo).toBe('RENDIMENTO');
    // BCFF11 → BONIFICACAO
    const bcff = r.rows.find(x => x.ticker === 'BCFF11');
    expect(bcff.tipo).toBe('BONIFICACAO');
    // MXRF11 → AMORTIZACAO (lowercase + whitespace)
    const mxrf = r.rows.find(x => x.ticker === 'MXRF11');
    expect(mxrf.tipo).toBe('AMORTIZACAO');
    // VINO11 → tipo desconhecido → null (RF-006)
    const vino = r.rows.find(x => x.ticker === 'VINO11');
    expect(vino.tipo).toBeNull();
    expect(vino.raw_tipo).toBe('Outros');
  });

  it('RF-004 + PRD 03 caso 5: não depende de posição das colunas (ordem invertida)', () => {
    const html = loadFixture('agenda-colunas-invertidas.html');
    const r = extractAgendaDividendos(dom(html));
    expect(r.table_found).toBe(true);
    expect(r.rows).toHaveLength(2);
    const hglg = r.rows.find(x => x.ticker === 'HGLG11');
    expect(hglg.tipo).toBe('DIVIDENDO');
    expect(hglg.data_pagto).toBe('2026-07-20');
    expect(hglg.valor_por_cota).toBeCloseTo(0.80, 5);
    const xpml = r.rows.find(x => x.ticker === 'XPML11');
    expect(xpml.tipo).toBe('AMORTIZACAO');
    expect(xpml.valor_por_cota).toBeCloseTo(0.20, 5);
  });

  it('reporta colunas ausentes quando header omite "Tipo" (PRD 03 caso 5)', () => {
    const html = `
      <table>
        <thead><tr><th>FII</th><th>Data Pagto</th><th>Valor</th></tr></thead>
        <tbody>
          <tr><td>HGLG11</td><td>20/07/2026</td><td>0,80</td></tr>
        </tbody>
      </table>`;
    const r = extractAgendaDividendos(dom(html));
    expect(r.missing_columns.tipo).toBe(true);
    // Não classifica silenciosamente (RF-006)
    expect(r.rows[0].tipo).toBeNull();
  });

  it('ignora tabela inexistente', () => {
    const html = '<html><body><p>sem agenda</p></body></html>';
    const r = extractAgendaDividendos(dom(html));
    expect(r.table_found).toBe(false);
    expect(r.rows).toEqual([]);
  });

  it('preserva raw_tipo para log/auditoria (RF-022)', () => {
    const html = loadFixture('agenda-com-tipo.html');
    const r = extractAgendaDividendos(dom(html));
    const vino = r.rows.find(x => x.ticker === 'VINO11');
    expect(vino.raw_tipo).toBe('Outros');  // para relatório de desconhecidos
  });
});
