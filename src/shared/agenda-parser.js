// Parser puro para a agenda de dividendos do Investidor10.
// Localiza colunas pelo HEADER (semântica), tolera ordem variável e
// normaliza o Tipo (RF-005 — `Dividendos` → `DIVIDENDO`, etc.).
//
// Compatível com jsdom e com `executeJavaScript` no Electron renderer
// (também disponível como `AgendaParser` global no browser/renderer).

// Normaliza texto da coluna Tipo para uma chave canônica.
// Ignora caixa, espaços e acentos. Texto desconhecido → null.
export function normalizarTipo(raw) {
  if (raw == null) return null;
  const t = String(raw).trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (t === 'dividendo' || t === 'dividendos') return 'DIVIDENDO';
  if (t === 'rendimento' || t === 'rendimentos') return 'RENDIMENTO';
  if (t === 'amortizacao' || t === 'amortizacoes') return 'AMORTIZACAO';
  if (t === 'bonificacao' || t === 'bonificacoes') return 'BONIFICACAO';
  return null;
}

// Parser BR para número (R$ 1.234,56 → 1234.56). Aceita strings já limpas.
export function normalizarNumeroBR(raw) {
  if (raw == null || raw === '') return null;
  const cleaned = String(raw).replace(/[^\d,\-.]/g, '');
  const num = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

// DD/MM/YYYY → YYYY-MM-DD
export function normalizarDataBR(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return m[3] + '-' + m[2] + '-' + m[1];
}

// Tenta achar o índice de uma coluna no thead a partir de padrões de texto.
// Aceita múltiplas variantes (plural/singular, acentos, espaços).
// Retorna índice na linha de cabeçalho ou -1 se não achar.
function acharIndiceColuna(headerCells, patterns) {
  for (let i = 0; i < headerCells.length; i++) {
    const cell = headerCells[i];
    if (!cell) continue;
    const raw = (cell.textContent || '').trim().normalize('NFD')
      .replace(/\p{Diacritic}/gu, '').toLowerCase();
    for (const p of patterns) {
      if (raw === p || raw.includes(p)) return i;
    }
  }
  return -1;
}

/**
 * Extrai linhas da tabela de agenda de dividendos do I10.
 * @param {Document} doc - documento (JSDOM document ou document nativo).
 * @param {Object} [opts]
 * @param {string} [opts.tableSelector='table']
 * @returns {{ rows: Array<{ticker, tipo, data_com, data_pagto, valor_por_cota, raw_tipo}>, table_found: boolean, header_columns: string[], missing_columns: object }}
 */
export function extractAgendaDividendos(doc, opts = {}) {
  const tableSelector = opts.tableSelector || 'table';
  const table = doc.querySelector(tableSelector);
  if (!table) return { rows: [], table_found: false, header_columns: [], missing_columns: {} };

  // Tenta pegar cabeçalhos do <thead> primeiro; se vazio, usa a primeira <tr>.
  let headerCells = [...doc.querySelectorAll('thead th, thead td')];
  if (headerCells.length === 0) {
    headerCells = [...table.querySelectorAll('tr:first-child th, tr:first-child td')];
  }
  const headerColumns = headerCells.map(c => String(c.textContent || '').trim());

  // Localiza colunas por SEMÂNTICA — nunca por posição fixa.
  const idxTipo = acharIndiceColuna(headerCells, ['tipo']);
  const idxTicker = acharIndiceColuna(headerCells, ['fii', 'ticker', 'codigo de negociacao', 'ativo']);
  const idxValor = acharIndiceColuna(headerCells, ['valor por cota', 'valor', 'rendimento']);
  const idxDataPagto = acharIndiceColuna(headerCells, [
    'data de pagamento', 'data do pagamento', 'data pagto', 'pagamento'
  ]);
  const idxDataCom = acharIndiceColuna(headerCells, [
    'data com', 'data ex', 'data-com', 'direito', 'com'
  ]);

  const missing_columns = {
    tipo: idxTipo === -1,
    ticker: idxTicker === -1,
    valor: idxValor === -1,
    data_pagto: idxDataPagto === -1
  };

  const dataRows = [...table.querySelectorAll('tbody tr')];
  const rows = dataRows.map((row) => {
    const cells = [...row.querySelectorAll('td, th')];
    if (cells.length < 2) return null;
    const get = (i) => (i >= 0 && cells[i] ? cells[i].textContent.trim() : null);

    // Ticker: aceita texto direto OU link com texto
    let tickerRaw = get(idxTicker);
    if (idxTicker >= 0 && cells[idxTicker]) {
      const linkEl = cells[idxTicker].querySelector('a');
      if (linkEl) tickerRaw = linkEl.textContent.trim();
    }

    const tipoRaw = get(idxTipo);
    const valorRaw = get(idxValor);
    const dataComRaw = get(idxDataCom);
    const dataPagtoRaw = get(idxDataPagto);

    const tickerMatch = tickerRaw && String(tickerRaw).match(/\b([A-Z]{4}11)\b/);
    const ticker = tickerMatch ? tickerMatch[1] : null;

    // RF-006: tipo desconhecido NÃO vira DIVIDENDO silenciosamente.
    const tipo = normalizarTipo(tipoRaw);

    return {
      ticker,
      tipo,                        // null se desconhecido (RF-006)
      raw_tipo: tipoRaw || null,    // texto bruto para log/auditoria (RF-022)
      data_com: normalizarDataBR(dataComRaw),
      data_pagto: normalizarDataBR(dataPagtoRaw),
      valor_por_cota: normalizarNumeroBR(valorRaw)
    };
  }).filter(Boolean);

  return { rows, table_found: true, header_columns: headerColumns, missing_columns };
}

// Expor também como global no renderer (via preload ou script inline).
// Não usamos Object.defineProperty — só anexa se ainda não existir.
if (typeof globalThis !== 'undefined' && !globalThis.AgendaParser) {
  globalThis.AgendaParser = {
    extractAgendaDividendos,
    normalizarTipo,
    normalizarNumeroBR,
    normalizarDataBR
  };
}
