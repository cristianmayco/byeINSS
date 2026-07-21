// src/__tests__/shared/scraper-contratos.test.js
// Testes dos parsers puros do PRD 12 sub-PR 3.
//
// Cobre:
//   - parseContratoFromMainHTML em diferentes layouts do I10 (fixtures)
//   - parseContratoFromComunicadoHTML (fallback)
//   - parseContratoFromFallbackHTML (última linha)
//   - parseTipoReajusteI10 (todas as variantes)
//   - parseDateBR / parseMesNumber (edge cases)
//   - Robustez contra HTML malformado / vazio

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseContratoFromMainHTML,
  parseContratoFromComunicadoHTML,
  parseContratoFromFallbackHTML,
  parseTipoReajusteI10,
  parseDateBR,
  parseMesNumber,
  brNumberToFloat
} from '../../shared/scraper-contratos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures', 'i10');

function loadFixture(name) {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('parseDateBR', () => {
  it('converte dd/mm/yyyy em ISO', () => {
    expect(parseDateBR('15/08/2028')).toBe('2028-08-15');
    expect(parseDateBR('01/01/2026')).toBe('2026-01-01');
    expect(parseDateBR('31/12/2025')).toBe('2025-12-31');
  });
  it('extrai data de texto misturado', () => {
    expect(parseDateBR('Vencimento em 15/08/2028 conforme contrato')).toBe('2028-08-15');
  });
  it('rejeita datas inválidas (mês/dia fora do range)', () => {
    expect(parseDateBR('30/02/2026')).toBeNull();
    expect(parseDateBR('00/01/2026')).toBeNull();
    expect(parseDateBR('15/13/2026')).toBeNull();
    expect(parseDateBR('32/01/2026')).toBeNull();
  });
  it('retorna null para entrada vazia ou inválida', () => {
    expect(parseDateBR('')).toBeNull();
    expect(parseDateBR(null)).toBeNull();
    expect(parseDateBR(undefined)).toBeNull();
    expect(parseDateBR('sem data')).toBeNull();
    expect(parseDateBR('2026-08-15')).toBeNull(); // ISO não é esperado aqui
  });
});

describe('parseMesNumber', () => {
  it('extrai meses inteiros', () => {
    expect(parseMesNumber('36 meses')).toBe(36);
    expect(parseMesNumber('18 meses')).toBe(18);
    expect(parseMesNumber('≈ 24 meses')).toBe(24);
    expect(parseMesNumber('12 m')).toBe(12);
    expect(parseMesNumber('60 mês')).toBe(60);
  });
  it('converte anos em meses', () => {
    expect(parseMesNumber('3 anos')).toBe(36);
    expect(parseMesNumber('5 anos')).toBe(60);
    expect(parseMesNumber('2,5 anos')).toBe(30);
  });
  it('em faixa, pega o valor maior (conservador)', () => {
    expect(parseMesNumber('12 a 24 meses')).toBe(24);
    expect(parseMesNumber('24 a 36 meses')).toBe(36);
    expect(parseMesNumber('12-18 meses')).toBe(18);
  });
  it('retorna null quando nada bate', () => {
    expect(parseMesNumber('sem numero')).toBeNull();
    expect(parseMesNumber('')).toBeNull();
    expect(parseMesNumber('10 dias')).toBeNull(); // dias não é escopo
  });
});

describe('brNumberToFloat', () => {
  it('parseia formato BR', () => {
    expect(brNumberToFloat('1.234,56')).toBe(1234.56);
    expect(brNumberToFloat('0,85')).toBe(0.85);
    expect(brNumberToFloat('10,12%')).toBe(10.12);
  });
  it('parseia número simples', () => {
    expect(brNumberToFloat('42')).toBe(42);
    expect(brNumberToFloat('3.5')).toBe(3.5);
  });
  it('retorna null para entrada vazia ou inválida', () => {
    expect(brNumberToFloat('')).toBeNull();
    expect(brNumberToFloat(null)).toBeNull();
    expect(brNumberToFloat('abc')).toBeNull();
  });
});

describe('parseTipoReajusteI10', () => {
  it('detecta IGP-M em variações comuns do I10', () => {
    expect(parseTipoReajusteI10('IGP-M').tipo).toBe('IGPM');
    expect(parseTipoReajusteI10('IGP M').tipo).toBe('IGPM');
    expect(parseTipoReajusteI10('igpm').tipo).toBe('IGPM');
    expect(parseTipoReajusteI10('Índice: IGP-M anual').tipo).toBe('IGPM');
  });
  it('detecta IPCA', () => {
    expect(parseTipoReajusteI10('IPCA').tipo).toBe('IPCA');
    expect(parseTipoReajusteI10('ipca + 0,5%').tipo).toBe('IPCA');
  });
  it('detecta MISTO', () => {
    expect(parseTipoReajusteI10('Misto').tipo).toBe('MISTO');
    expect(parseTipoReajusteI10('MISTURADO').tipo).toBe('MISTO');
    expect(parseTipoReajusteI10('parte IGP-M, parte IPCA').tipo).toBe('MISTO');
  });
  it('detecta FIXO com percentual', () => {
    const a = parseTipoReajusteI10('Fixo 3% a.a.');
    expect(a.tipo).toBe('FIXO');
    expect(a.percentual).toBe(3);
    const b = parseTipoReajusteI10('Fixo 3,5% a.a.');
    expect(b.tipo).toBe('FIXO');
    expect(b.percentual).toBe(3.5);
    const c = parseTipoReajusteI10('Fixo 0,85% anual');
    expect(c.tipo).toBe('FIXO');
    expect(c.percentual).toBe(0.85);
  });
  it('detecta FIXO sem percentual (origem manual, % depois)', () => {
    const a = parseTipoReajusteI10('Fixo');
    expect(a.tipo).toBe('FIXO');
    expect(a.percentual).toBeNull();
  });
  it('mapeia índices não-canônicos para OUTRO', () => {
    expect(parseTipoReajusteI10('INPC').tipo).toBe('OUTRO');
    expect(parseTipoReajusteI10('IPC-FIPE').tipo).toBe('OUTRO');
  });
  it('retorna null para texto vazio ou ausente', () => {
    expect(parseTipoReajusteI10('').tipo).toBeNull();
    expect(parseTipoReajusteI10(null).tipo).toBeNull();
    expect(parseTipoReajusteI10('sem info').tipo).toBeNull();
  });
});

describe('parseContratoFromMainHTML — fixtures', () => {
  it('HGLG11: data 2028-08-15 + IGP-M (bloco estruturado)', () => {
    const html = loadFixture('hglg11.html');
    const out = parseContratoFromMainHTML(html);
    expect(out.vencimento_medio_contratos).toBe('2028-08-15');
    expect(out.vencimento_medio_contratos_meses).toBeNull();
    expect(out.tipo_reajuste).toBe('IGPM');
    expect(out.reajuste_percentual).toBeNull();
    expect(out.vencimento_medio_origem).toBe('main');
    expect(out.confianca).toBe('alta');
    expect(out.dy_medio_5a).toBe(10.12);
  });

  it('KNIP11: 24 meses + FIXO 3,5% (texto próximo a labels)', () => {
    const html = loadFixture('knip11.html');
    const out = parseContratoFromMainHTML(html);
    expect(out.vencimento_medio_contratos).toBeNull();
    expect(out.vencimento_medio_contratos_meses).toBe(24);
    expect(out.tipo_reajuste).toBe('FIXO');
    expect(out.reajuste_percentual).toBe(3.5);
    expect(out.confianca).toBe('alta');
  });

  it('XPML11: 18 meses + MISTO', () => {
    const html = loadFixture('xpml11.html');
    const out = parseContratoFromMainHTML(html);
    expect(out.vencimento_medio_contratos_meses).toBe(18);
    expect(out.tipo_reajuste).toBe('MISTO');
    expect(out.confianca).toBe('alta');
    expect(out.dy_medio_5a).toBe(9.87);
  });

  it('MXRF11 (papel): vazio, sem vencimento aplicável', () => {
    const html = loadFixture('mxrf11.html');
    const out = parseContratoFromMainHTML(html);
    expect(out.vencimento_medio_contratos).toBeNull();
    expect(out.vencimento_medio_contratos_meses).toBeNull();
    expect(out.tipo_reajuste).toBeNull();
    expect(out.confianca).toBe('nenhuma');
  });

  it('VINO11: data + Fixo 3%', () => {
    const html = loadFixture('vino11-fixo.html');
    const out = parseContratoFromMainHTML(html);
    expect(out.vencimento_medio_contratos).toBe('2027-12-31');
    expect(out.tipo_reajuste).toBe('FIXO');
    expect(out.reajuste_percentual).toBe(3);
  });

  it('BCFF11 (layout sem bloco "Sobre" e "Contratos"): sem contexto, vazio', () => {
    const html = loadFixture('bcff11-layout-quebrado.html');
    const out = parseContratoFromMainHTML(html);
    // BCFF11 é "fundo de fundos" — sem bloco estruturado de "Contratos/Reajuste"
    // e a menção a "IPCA + 1%" é apenas base de comparação, não o próprio
    // reajuste. Parser conservador: não inventa tipo_reajuste sem contexto.
    expect(out.tipo_reajuste).toBeNull();
    expect(out.vencimento_medio_contratos).toBeNull();
    expect(out.vencimento_medio_contratos_meses).toBeNull();
    expect(out.confianca).toBe('nenhuma');
  });
});

describe('parseContratoFromComunicadoHTML — fallback Comunicado', () => {
  it('extrai data e tipo do comunicado mais recente', () => {
    const html = loadFixture('hglg11-comunicado.html');
    const out = parseContratoFromComunicadoHTML(html);
    expect(out.vencimento_medio_contratos).toBe('2029-05-20');
    expect(out.tipo_reajuste).toBe('IGPM');
    expect(out.vencimento_medio_origem).toBe('comunicado');
    expect(out.confianca).toBe('alta');
  });

  it('aceita data explícita do comunicado como coletado_em', () => {
    const html = loadFixture('hglg11-comunicado.html');
    const out = parseContratoFromComunicadoHTML(html, '2026-06-15');
    expect(out.vencimento_medio_origem).toBe('comunicado');
  });

  it('retorna estrutura vazia para HTML sem informação', () => {
    const out = parseContratoFromComunicadoHTML('<html><body>sem nada</body></html>');
    expect(out.vencimento_medio_contratos).toBeNull();
    expect(out.vencimento_medio_contratos_meses).toBeNull();
    expect(out.tipo_reajuste).toBeNull();
    expect(out.confianca).toBe('nenhuma');
  });
});

describe('parseContratoFromFallbackHTML — última linha', () => {
  it('marca origem fallback', () => {
    const out = parseContratoFromFallbackHTML('<html><body><p>IPCA + 1% a.a.</p></body></html>');
    expect(out.vencimento_medio_origem).toBe('fallback');
    expect(out.tipo_reajuste).toBe('IPCA');
  });
  it('retorna vazio para HTML vazio ou inválido', () => {
    expect(parseContratoFromFallbackHTML('').confianca).toBe('nenhuma');
    expect(parseContratoFromFallbackHTML(null).confianca).toBe('nenhuma');
  });
});

describe('Robustez contra HTML hostil', () => {
  it('não lança com HTML malformado', () => {
    expect(() => parseContratoFromMainHTML('<div>sem fechamento')).not.toThrow();
    expect(() => parseContratoFromMainHTML('<><><>')).not.toThrow();
    expect(() => parseContratoFromMainHTML('texto puro sem tags')).not.toThrow();
  });
  it('não vaza HTML no payload (XSS-prevention na origem)', () => {
    const html = '<html><body><p>Vencimento: <script>alert(1)</script> 01/01/2030</p></body></html>';
    const out = parseContratoFromMainHTML(html);
    expect(out.vencimento_medio_contratos).toBe('2030-01-01');
    // Garante que não retornamos o texto sujo:
    expect(JSON.stringify(out)).not.toContain('<script>');
  });
  it('lida com tags scripts/styles inline', () => {
    const html = `
      <html><body>
        <script>var x = 36; // meses falsos</script>
        <style>.vencimento { display: none; }</style>
        <p>Vencimento em 24 meses</p>
      </body></html>`;
    const out = parseContratoFromMainHTML(html);
    expect(out.vencimento_medio_contratos_meses).toBe(24);
  });
});

describe('RF-007 — múltiplos seletores / resiliência', () => {
  it('layout variante A: bloco em <div class="reajuste">', () => {
    const html = `<html><body>
      <div class="reajuste">Vencimento: 30/06/2029 · Índice IGP-M anual</div>
    </body></html>`;
    const out = parseContratoFromMainHTML(html);
    expect(out.vencimento_medio_contratos).toBe('2029-06-30');
    expect(out.tipo_reajuste).toBe('IGPM');
  });
  it('layout variante B: header h3 + texto próximo', () => {
    const html = `<html><body>
      <h3>Reajuste</h3>
      <p>Contratos atualizados pelo IPCA. Vencimento em 36 meses.</p>
    </body></html>`;
    const out = parseContratoFromMainHTML(html);
    expect(out.tipo_reajuste).toBe('IPCA');
    expect(out.vencimento_medio_contratos_meses).toBe(36);
  });
  it('layout variante C: tudo num único parágrafo', () => {
    const html = `<html><body>
      <p>Sobre o fundo: Vencimento médio: 15/08/2028. Reajuste IGP-M.</p>
    </body></html>`;
    const out = parseContratoFromMainHTML(html);
    expect(out.vencimento_medio_contratos).toBe('2028-08-15');
    expect(out.tipo_reajuste).toBe('IGPM');
  });
});
