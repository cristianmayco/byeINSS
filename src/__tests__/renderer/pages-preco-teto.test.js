// Cobre renderPrecoTeto (página "Preço-teto & alertas").
// Guarda de regressão para o fix da "zona morta": FIIs com preço entre o teto
// e teto*1.1 antes ficavam sem classificação ("—").

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const PAGES_SOURCE = readFileSync(
  new URL('../../renderer/js/pages.js', import.meta.url), 'utf8',
);

const HTML = `<!doctype html><html lang="pt-BR"><body>
  <main><section id="page-preco-teto" class="page active"></section></main>
</body></html>`;

let dom, window;

function mount(ativos) {
  dom = new JSDOM(HTML, { url: 'http://localhost/#preco-teto', runScripts: 'outside-only' });
  window = dom.window;
  window.brl = v => `R$ ${Number(v || 0).toFixed(2)}`;
  window.pct = v => `${Number(v || 0).toFixed(2)}%`;
  window.escapeHtml = s => String(s ?? '');
  window.openAtivoModal = vi.fn();
  window.api = vi.fn(async (path) => {
    if (path === '/api/ativos?ativo_only=1') return ativos;
    throw new Error(`Sem stub para ${path}`);
  });
  window.eval(PAGES_SOURCE);
  return window;
}

async function renderRow(ativo) {
  mount([ativo]);
  const el = window.document.getElementById('page-preco-teto');
  await window.renderPrecoTeto(el);
  return el.textContent;
}

afterEach(() => { dom?.window.close(); dom = undefined; });

describe('renderPrecoTeto — classificação de sinal', () => {
  test('preço ≤ muito bom → MUITO BARATO', async () => {
    const txt = await renderRow({ id: 1, ticker: 'TGAR11', preco_atual: 50.77, preco_teto: 82.29, preco_muito_bom: 66.46 });
    expect(txt).toMatch(/MUITO BARATO/);
  });

  test('preço ≤ teto (acima do muito bom) → NO TETO', async () => {
    const txt = await renderRow({ id: 1, ticker: 'RBRR11', preco_atual: 77.86, preco_teto: 80, preco_muito_bom: 60 });
    expect(txt).toMatch(/NO TETO/);
  });

  test('ZONA MORTA: preço entre teto e teto*1.1 → PRÓXIMO DO TETO (não fica sem sinal)', async () => {
    // XPLG11 real: 91.59 vs teto 89.14 (ratio ~102.7%) — antes do fix mostrava "—"
    const txt = await renderRow({ id: 1, ticker: 'XPLG11', preco_atual: 91.59, preco_teto: 89.14, preco_muito_bom: 80 });
    expect(txt).toMatch(/PR[ÓO]XIMO DO TETO/);
  });

  test('preço > teto*1.1 → CARO', async () => {
    const txt = await renderRow({ id: 1, ticker: 'KNRI11', preco_atual: 156, preco_teto: 114.29, preco_muito_bom: 100 });
    expect(txt).toMatch(/CARO/);
  });

  test('sem cotação (teto definido, sem preço) → "sem cotação"', async () => {
    const txt = await renderRow({ id: 1, ticker: 'FOOB11', preco_atual: null, preco_teto: 100, preco_muito_bom: 90 });
    expect(txt).toMatch(/sem cota[çc][ãa]o/i);
    expect(txt).not.toMatch(/NO TETO|CARO|MUITO BARATO/);
  });

  test('sem preço-teto → "defina o teto"', async () => {
    const txt = await renderRow({ id: 1, ticker: 'ALZR11', preco_atual: 10, preco_teto: null, preco_muito_bom: null });
    expect(txt).toMatch(/defina o teto/i);
  });

  test('todo FII com teto + cotação recebe algum sinal (cobertura total de faixa)', async () => {
    const casos = [
      { id: 1, ticker: 'A11', preco_atual: 50, preco_teto: 100, preco_muito_bom: 60 }, // muito barato
      { id: 2, ticker: 'B11', preco_atual: 95, preco_teto: 100, preco_muito_bom: 60 }, // no teto
      { id: 3, ticker: 'C11', preco_atual: 105, preco_teto: 100, preco_muito_bom: 60 }, // próximo (dead zone)
      { id: 4, ticker: 'D11', preco_atual: 200, preco_teto: 100, preco_muito_bom: 60 }, // caro
    ];
    mount(casos);
    const el = window.document.getElementById('page-preco-teto');
    await window.renderPrecoTeto(el);
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(4);
    // nenhuma linha com teto+cotação pode ter célula de sinal vazia/"—"
    for (const tr of rows) {
      const sinalCell = tr.querySelectorAll('td')[5];
      expect(sinalCell.textContent.trim()).not.toBe('—');
      expect(sinalCell.textContent.trim()).not.toBe('');
    }
  });
});
