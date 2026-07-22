// Parser puro do histórico de dividendos do Investidor10 (PRD 01).
// Roda em jsdom (vitest) e em window.eval dentro da BrowserWindow (Electron).
// Estratégia (RF-003/004/005):
//  - Localiza a tabela pela presença das colunas Competência + Tipo (semântica).
//  - Lê cada linha: competência (MM/YYYY), tipo, data_pagto (DD/MM/YYYY),
//    valor_por_cota (BR: "R$ 0,80" → 0.80).
//  - Normaliza tipo (RF-006): null para desconhecido.
//  - Gera origem_chave determinística para dedup (RF-008).
//
// Dual-mode CJS+ESM (vitest infere named exports do module.exports).

// MM/YYYY → YYYY-MM
function parseCompetenciaBR(input) {
  if (input == null) return null;
  const s = String(input).trim();
  const m = s.match(/^(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const mes = Number(m[1]);
  if (mes < 1 || mes > 12) return null;
  return `${m[2]}-${String(mes).padStart(2, '0')}`;
}

function parseDataBR(input) {
  if (input == null) return null;
  const s = String(input).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseValorBR(input) {
  if (input == null) return null;
  let s = String(input).trim().replace(/\s+/g, '');
  s = s.replace(/^R\$/i, '').replace(/[^\d,\-.]/g, '');
  if (s === '' || s === ',' || s === '.') return null;
  const num = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function normalizarTipo(raw) {
  if (raw == null) return null;
  const t = String(raw).trim().toUpperCase().normalize('NFD')
    .replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (t === 'dividendo' || t === 'dividendos') return 'DIVIDENDO';
  if (t === 'rendimento' || t === 'rendimentos') return 'RENDIMENTO';
  if (t === 'amortizacao' || t === 'amortizacoes') return 'AMORTIZACAO';
  if (t === 'bonificacao' || t === 'bonificacoes') return 'BONIFICACAO';
  return null;
}

function buildOrigemChave(item) {
  const ticker = String(item.ticker || '').toUpperCase();
  const competencia = String(item.competencia || '');
  const tipo = String(item.tipo || '');
  const valor = Number(item.valor_por_cota || 0).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return `${ticker}:${competencia}:${tipo}:${valor}`;
}

function acharIndiceColuna(headers, patterns) {
  for (let i = 0; i < headers.length; i++) {
    const cell = headers[i];
    if (!cell) continue;
    const raw = (cell.textContent || '').trim().toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '');
    for (const p of patterns) {
      if (raw === p || raw.includes(p)) return i;
    }
  }
  return -1;
}

function encontrarTabela(doc) {
  const tabelas = [...doc.querySelectorAll('table')];
  for (const t of tabelas) {
    const headers = [...t.querySelectorAll('thead th, thead td')];
    if (headers.length === 0) continue;
    const idxCompetencia = acharIndiceColuna(headers, ['competencia', 'mes/ano', 'mm/aaaa', 'periodo']);
    const idxTipo = acharIndiceColuna(headers, ['tipo', 'tipo de provento']);
    if (idxCompetencia >= 0 && idxTipo >= 0) return t;
  }
  return null;
}

/**
 * Extrai linhas da tabela de histórico.
 * @param {Document} doc
 * @param {string} ticker
 * @returns {Array<{ticker, competencia, data_com, data_pagto, valor_por_cota,
 *                  tipo, raw_tipo, origem_chave}>}
 */
function extractHistoricoFromDocument(doc, ticker) {
  const table = encontrarTabela(doc);
  if (!table) return [];

  const headerCells = [...table.querySelectorAll('thead th, thead td')];
  const idxCompetencia = acharIndiceColuna(headerCells, ['competencia', 'mes/ano', 'mm/aaaa', 'periodo']);
  const idxTipo = acharIndiceColuna(headerCells, ['tipo', 'tipo de provento']);
  const idxDataPagto = acharIndiceColuna(headerCells, [
    'data de pagamento', 'data do pagamento', 'data pagto', 'pagamento'
  ]);
  const idxValor = acharIndiceColuna(headerCells, [
    'valor por cota', 'r$/cota', 'r$', 'valor'
  ]);

  const dataRows = [...table.querySelectorAll('tbody tr')];
  const out = [];
  for (const row of dataRows) {
    const cells = [...row.querySelectorAll('td, th')];
    if (cells.length < 2) continue;
    const get = (i) => (i >= 0 && cells[i] ? cells[i].textContent.trim() : null);

    const competencia = parseCompetenciaBR(get(idxCompetencia));
    if (!competencia) continue;
    const data_pagto = parseDataBR(get(idxDataPagto)) || `${competencia}-15`;
    const valor = parseValorBR(get(idxValor));
    if (valor == null || valor <= 0) continue;
    const rawTipo = get(idxTipo);
    const tipo = normalizarTipo(rawTipo);

    const item = {
      ticker: String(ticker || '').toUpperCase(),
      competencia,
      data_com: data_pagto,
      data_pagto,
      valor_por_cota: valor,
      tipo,
      raw_tipo: rawTipo || null,
      origem_chave: ''
    };
    item.origem_chave = buildOrigemChave(item);
    out.push(item);
  }
  return out;
}

module.exports = {
  parseCompetenciaBR,
  parseDataBR,
  parseValorBR,
  normalizarTipo,
  buildOrigemChave,
  extractHistoricoFromDocument
};