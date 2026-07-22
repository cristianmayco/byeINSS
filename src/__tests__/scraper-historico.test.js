// TDD Red Phase — PRD 01 RF-003/004/005 — parser do histórico de dividendos.
// Cobre localização por HEADER semântico, normalização de tipo,
// competência MM/YYYY → YYYY-MM, valor BR → float.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import {
  extractHistoricoFromDocument,
  buildOrigemChave,
  parseCompetenciaBR
} from '../main/scraper-historico.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'i10', name), 'utf8');
}

function dom(html) {
  return new JSDOM(html).window.document;
}

describe('parseCompetenciaBR — RF-005', () => {
  it('converte MM/YYYY → YYYY-MM', () => {
    expect(parseCompetenciaBR('07/2025')).toBe('2025-07');
    expect(parseCompetenciaBR('01/2024')).toBe('2024-01');
    expect(parseCompetenciaBR('12/2019')).toBe('2019-12');
  });
  it('aceita MM/AAAA (sem normalizar)', () => {
    expect(parseCompetenciaBR('07/2025')).toBe('2025-07');
  });
  it('retorna null para entrada inválida', () => {
    expect(parseCompetenciaBR('')).toBeNull();
    expect(parseCompetenciaBR('abc')).toBeNull();
    expect(parseCompetenciaBR(null)).toBeNull();
  });
});

describe('buildOrigemChave — chave determinística para dedup (RF-008)', () => {
  it('gera chave estável a partir de ticker+competência+tipo+valor', () => {
    const k = buildOrigemChave({
      ticker: 'HGLG11', competencia: '2025-07',
      tipo: 'DIVIDENDO', valor_por_cota: 0.80
    });
    expect(k).toBe('HGLG11:2025-07:DIVIDENDO:0.8');
  });
  it('chaves distintas para tipo ou valor diferentes', () => {
    const a = buildOrigemChave({ ticker: 'HGLG11', competencia: '2025-07', tipo: 'DIVIDENDO', valor_por_cota: 0.80 });
    const b = buildOrigemChave({ ticker: 'HGLG11', competencia: '2025-07', tipo: 'AMORTIZACAO', valor_por_cota: 0.80 });
    const c = buildOrigemChave({ ticker: 'HGLG11', competencia: '2025-07', tipo: 'DIVIDENDO', valor_por_cota: 0.85 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('extractHistoricoFromDocument — RF-003/004/005', () => {
  it('extrai 4 linhas da fixture canônica (HGLG11 com 3 div + 1 amort)', () => {
    const html = loadFixture('hglg11-historico-canônico.html');
    const items = extractHistoricoFromDocument(dom(html), 'HGLG11');
    expect(items).toHaveLength(4);
    const jul = items.find(i => i.competencia === '2025-07');
    expect(jul).toMatchObject({
      ticker: 'HGLG11',
      tipo: 'DIVIDENDO',
      data_pagto: '2025-07-15',
      valor_por_cota: 0.80,
      origem_chave: 'HGLG11:2025-07:DIVIDENDO:0.8'
    });
    const amort = items.find(i => i.tipo === 'AMORTIZACAO');
    expect(amort.competencia).toBe('2025-05');
    expect(amort.valor_por_cota).toBe(0.20);
  });

  it('tolera layout de paginação com cabeçalhos "Tipo de Provento"/"R$/Cota"', () => {
    const html = loadFixture('hglg11-historico-paginacao.html');
    const items = extractHistoricoFromDocument(dom(html), 'HGLG11');
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].tipo).toBe('DIVIDENDO');
    expect(items[0].valor_por_cota).toBeCloseTo(0.80, 5);
  });

  it('tipo desconhecido vira null (RF-006), linha ignorada no aggregate', () => {
    const html = `
      <table><thead><tr><th>Competência</th><th>Tipo</th><th>Pagamento</th><th>R$/Cota</th></tr></thead>
      <tbody>
        <tr><td>07/2025</td><td>Outros</td><td>15/07/2025</td><td>0,50</td></tr>
        <tr><td>06/2025</td><td>Dividendo</td><td>15/06/2025</td><td>0,80</td></tr>
      </tbody></table>`;
    const items = extractHistoricoFromDocument(dom(html), 'HGLG11');
    // Tipo desconhecido pode aparecer com tipo=null ou ser filtrado;
    // o aggregate em dividendos-import pega ele como ignorado.
    expect(items).toHaveLength(2);
    const outros = items.find(i => /outros/i.test(i.raw_tipo || ''));
    expect(outros.tipo).toBeNull();
    const div = items.find(i => i.tipo === 'DIVIDENDO');
    expect(div.valor_por_cota).toBeCloseTo(0.80, 5);
  });

  it('retorna [] se não encontrar tabela', () => {
    const html = '<html><body><p>sem tabela</p></body></html>';
    expect(extractHistoricoFromDocument(dom(html), 'HGLG11')).toEqual([]);
  });
});