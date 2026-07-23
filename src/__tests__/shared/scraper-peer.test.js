// TDD Red/Green — PRD 04: parser do box "Média Tipo/Segmento" do I10.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseBenchmarkSegmento,
  brNumberToFloat,
  normalizeText
} from '../../shared/scraper-peer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures', 'i10');

function loadFixture(name) {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('brNumberToFloat (RF-004)', () => {
  it('BR simples com vírgula: "9,10%" → 9.10', () => {
    expect(brNumberToFloat('9,10%')).toBe(9.10);
  });
  it('BR com milhar: "1.234,56" → 1234.56', () => {
    expect(brNumberToFloat('1.234,56')).toBe(1234.56);
  });
  it('BR com milhar + R$: "R$ 1.234,56" → 1234.56', () => {
    expect(brNumberToFloat('R$ 1.234,56')).toBe(1234.56);
  });
  it('Sufixo bi: "R$ 1,5 bi" → 1.5e9', () => {
    expect(brNumberToFloat('R$ 1,5 bi')).toBeCloseTo(1.5e9, 5);
  });
  it('Sufixo bilhões: "R$ 3,8 bilhões" → 3.8e9', () => {
    expect(brNumberToFloat('R$ 3,8 bilhões')).toBeCloseTo(3.8e9, 5);
  });
  it('Sufixo milhões: "R$ 250 milhões" → 2.5e8', () => {
    expect(brNumberToFloat('R$ 250 milhões')).toBeCloseTo(2.5e8, 5);
  });
  it('Sufixo mil: "R$ 1,2 mil" → 1200', () => {
    expect(brNumberToFloat('R$ 1,2 mil')).toBe(1200);
  });
  it('Negativo preserva sinal: "-3,20%" → -3.20', () => {
    expect(brNumberToFloat('-3,20%')).toBe(-3.20);
  });
  it('Zero é válido: "0,00" → 0', () => {
    expect(brNumberToFloat('0,00')).toBe(0);
  });
  it('Vazio / null / NaN → null', () => {
    expect(brNumberToFloat(null)).toBeNull();
    expect(brNumberToFloat(undefined)).toBeNull();
    expect(brNumberToFloat('')).toBeNull();
    expect(brNumberToFloat('abc')).toBeNull();
  });
});

describe('normalizeText', () => {
  it('lowercase + remove acento + trim + colapsa espaços', () => {
    expect(normalizeText('  Média   Tipo/Segmento  ')).toBe('media tipo/segmento');
  });
});

describe('parseBenchmarkSegmento — fixture hglg11-peer.html (layout padrão)', () => {
  const html = loadFixture('hglg11-peer.html');
  const r = parseBenchmarkSegmento(html);

  it('snapshot_valido = true (todos os 4 numéricos extraídos)', () => {
    expect(r.snapshot_valido).toBe(true);
    expect(r.avisos).toEqual([]);
  });
  it('pvp_medio_segmento = 0.95', () => {
    expect(r.pvp_medio_segmento).toBeCloseTo(0.95, 5);
  });
  it('dy_medio_segmento = 9.10 (em pontos percentuais)', () => {
    expect(r.dy_medio_segmento).toBeCloseTo(9.10, 5);
  });
  it('pl_medio_segmento = 1.5e9 ("R$ 1,5 bi")', () => {
    expect(r.pl_medio_segmento).toBeCloseTo(1.5e9, 5);
  });
  it('vpa_medio_segmento = 96.70', () => {
    expect(r.vpa_medio_segmento).toBeCloseTo(96.70, 5);
  });
  it('peer_grupo_tipo = NAO_INFORMADO (título "Média Tipo/Segmento" genérico)', () => {
    expect(r.peer_grupo_tipo).toBe('NAO_INFORMADO');
  });
});

describe('parseBenchmarkSegmento — fixture mxrf11-peer.html (Média do Tipo + bilhões)', () => {
  const html = loadFixture('mxrf11-peer.html');
  const r = parseBenchmarkSegmento(html);

  it('snapshot_valido = true', () => {
    expect(r.snapshot_valido).toBe(true);
  });
  it('extrai P/VP, DY, PL, VPA', () => {
    expect(r.pvp_medio_segmento).toBeCloseTo(1.02, 5);
    expect(r.dy_medio_segmento).toBeCloseTo(10.85, 5);
    expect(r.pl_medio_segmento).toBeCloseTo(3.8e9, 5);
    expect(r.vpa_medio_segmento).toBeCloseTo(10.15, 5);
  });
  it('peer_grupo_tipo = TIPO (título "Média do Tipo")', () => {
    expect(r.peer_grupo_tipo).toBe('TIPO');
  });
});

describe('parseBenchmarkSegmento — fixture novo11-peer-parcial.html (snapshot incompleto)', () => {
  const html = loadFixture('novo11-peer-parcial.html');
  const r = parseBenchmarkSegmento(html);

  it('snapshot_valido = false (VPA ausente)', () => {
    expect(r.snapshot_valido).toBe(false);
    expect(r.avisos).toContain('VPA_AUSENTE');
  });
  it('campos extraídos: P/VP e PL presentes', () => {
    expect(r.pvp_medio_segmento).toBeCloseTo(0.98, 5);
    expect(r.pl_medio_segmento).toBeCloseTo(2.5e8, 5);
  });
  it('DY "-" → null', () => {
    expect(r.dy_medio_segmento).toBeNull();
    expect(r.avisos).toContain('DY_AUSENTE');
  });
  it('VPA null', () => {
    expect(r.vpa_medio_segmento).toBeNull();
  });
});

describe('parseBenchmarkSegmento — casos de borda', () => {
  it('HTML vazio → snapshot_valido=false + BOX_NAO_ENCONTRADO', () => {
    const r = parseBenchmarkSegmento('');
    expect(r.snapshot_valido).toBe(false);
    expect(r.avisos).toContain('BOX_NAO_ENCONTRADO');
  });
  it('HTML sem o box → BOX_NAO_ENCONTRADO', () => {
    const r = parseBenchmarkSegmento('<html><body><h1>Sem box</h1></body></html>');
    expect(r.snapshot_valido).toBe(false);
    expect(r.avisos).toContain('BOX_NAO_ENCONTRADO');
  });
  it('Box presente mas valores zerados → snapshot_valido=false (P/VP=0 é inválido)', () => {
    const html = `
      <section><h2>Média Tipo/Segmento</h2>
        P/VP: 0
        Dividend Yield 12m: 0,00%
        Valor Patrimonial: R$ 0
        VPA: 0
      </section>`;
    const r = parseBenchmarkSegmento(html);
    // P/VP=0 inválido (não pode ser <= 0)
    expect(r.pvp_medio_segmento).toBe(0);
    expect(r.snapshot_valido).toBe(false);
  });
  it('P/VP negativo → snapshot_valido=false', () => {
    const html = `
      <section><h2>Média Tipo/Segmento</h2>
        P/VP: -0,5
        Dividend Yield 12m: 8,5%
        Valor Patrimonial: R$ 500 milhões
        VPA: 100,00
      </section>`;
    const r = parseBenchmarkSegmento(html);
    expect(r.pvp_medio_segmento).toBe(-0.5);
    expect(r.snapshot_valido).toBe(false);
  });
  it('Acento no título: "Média Tipo/Segmento" vs "Media Tipo Segmento"', () => {
    const a = `<section><h2>Média Tipo/Segmento</h2>
      P/VP: 0,95
      Dividend Yield 12m: 9,10%
      Valor Patrimonial: R$ 1,5 bi
      VPA: R$ 96,70
    </section>`;
    const b = `<section><h2>Media Tipo Segmento</h2>
      P/VP: 0,95
      Dividend Yield 12m: 9,10%
      Valor Patrimonial: R$ 1,5 bi
      VPA: R$ 96,70
    </section>`;
    expect(parseBenchmarkSegmento(a).snapshot_valido).toBe(true);
    // Variante sem "Tipo/" não casa (heurística exata); mas não quebra
    const rb = parseBenchmarkSegmento(b);
    expect(rb).toBeDefined();
    // Pode ser null ou false — comportamento defensivo, sem crash
    expect(typeof rb.snapshot_valido).toBe('boolean');
  });
});