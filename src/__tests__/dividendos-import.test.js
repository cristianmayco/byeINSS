// TDD Red Phase — PRD 01 RF-008/009/010/022 — importer de histórico de dividendos.
// Cobre dedup por (fonte, origem_chave), reconciliação com legados,
// retorno com contagens por tipo (RF-022).

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { importarHistoricoDividendos } from '../shared/dividendos-import.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INIT_SQL = fs.readFileSync(
  path.join(__dirname, '..', '..', 'db', 'init.sql'), 'utf8'
);

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = MEMORY');
  db.exec(INIT_SQL);
  // 17 FIIs simulando carteira com tickers I10-like (4 letras + 2 dígitos)
  const ins = db.prepare("INSERT INTO ativos (ticker, tipo) VALUES (?, 'FII')");
  const letras = ['ABCD','EFGH','IJKL','MNOP','QRST','UVWX','YZAB','CDEF','GHIJ','KLMN',
                  'OPQR','STUV','WXYZ','ABCE','DEFG','HIJK','LMNO'];
  for (let i = 0; i < 17; i++) ins.run(letras[i] + (i + 11).toString().padStart(2, '0'));
  return db;
}

// Helper: linha normalizada do scraper (formato esperado pelo importer)
function row(ticker, anoMes, valor, tipo = 'DIVIDENDO', opts = {}) {
  return {
    ticker,
    competencia: anoMes,
    data_com: opts.data_com || `${anoMes}-15`,
    data_pagto: opts.data_pagto || `${anoMes}-20`,
    valor_por_cota: valor,
    tipo,
    origem_chave: opts.origem_chave || `${ticker}:${anoMes}:${tipo}:${valor}`
  };
}

describe('importarHistoricoDividendos — RF-007/008/009/010/022', () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it('RF-008: dedup por (fonte, origem_chave) — reimportar não duplica', () => {
    const items = [
      row('ABCD11', '2025-01', 0.80, 'DIVIDENDO'),
      row('ABCD11', '2025-02', 0.85, 'DIVIDENDO'),
      row('ABCD11', '2025-03', 0.90, 'DIVIDENDO')
    ];
    const r1 = importarHistoricoDividendos(db, items);
    expect(r1.inseridos).toBe(3);
    expect(r1.duplicados).toBe(0);

    // Re-importa os mesmos
    const r2 = importarHistoricoDividendos(db, items);
    expect(r2.inseridos).toBe(0);
    expect(r2.duplicados).toBe(3);

    const total = db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c;
    expect(total).toBe(3);
  });

  it('RF-008: divisões distintas (dividendo + amortização) coexistentes mesma data', () => {
    const items = [
      row('ABCD11', '2025-01', 0.80, 'DIVIDENDO'),
      row('ABCD11', '2025-01', 0.20, 'AMORTIZACAO')
    ];
    const r = importarHistoricoDividendos(db, items);
    expect(r.inseridos).toBe(2);
    expect(r.duplicados).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c).toBe(2);
  });

  it('RF-009: registro manual existente nunca é sobrescrito', () => {
    // Inserção manual prévia (FII ativo_id=1 = ABCD11)
    db.prepare(`INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo, fonte, origem_chave)
                VALUES (1, '2025-01-15', '2025-01-20', 1.50, 'DIVIDENDO', 'MANUAL', 'manual-key')`).run();
    // Scraping traz valor diferente para mesma chave (manual-key)
    const items = [row('ABCD11', '2025-01', 0.80, 'DIVIDENDO', {
      origem_chave: 'manual-key'  // mesmo que o manual
    })];
    const r = importarHistoricoDividendos(db, items);
    // Conflito: registro manual existe, scraper NÃO sobrescreve.
    expect(r.ignorados).toBeGreaterThanOrEqual(0);
    // Valor original (manual) preservado
    const val = db.prepare(
      "SELECT valor_por_cota FROM proventos WHERE origem_chave='manual-key'"
    ).get();
    expect(val.valor_por_cota).toBe(1.50);
  });

  it('RF-010: item inválido no meio é ignorado (não derruba o resto)', () => {
    // Item inválido (valor zero) entre válidos
    const items = [
      row('ABCD11', '2025-01', 0.80),
      { ticker: 'ABCD11', competencia: '2025-02', valor_por_cota: 0, tipo: 'DIVIDENDO', origem_chave: 'broken' },
      row('ABCD11', '2025-03', 0.90)
    ];
    const r = importarHistoricoDividendos(db, items);
    const c = db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c;
    expect(c).toBe(2);
    expect(r.ignorados).toBeGreaterThanOrEqual(1);
  });

  it('RF-022: retorna contagens por tipo + inseridos + duplicados + ignorados + status', () => {
    const items = [
      row('ABCD11', '2025-01', 0.80, 'DIVIDENDO'),
      row('ABCD11', '2025-02', 0.20, 'AMORTIZACAO'),
      row('ABCD11', '2025-03', 1.00, 'BONIFICACAO'),
      row('ABCD11', '2025-04', 1.05, 'RENDIMENTO'),
      { ticker: 'ABCD11', competencia: '2025-05', valor_por_cota: 0, tipo: 'JCP', origem_chave: 'broken' }
    ];
    const r = importarHistoricoDividendos(db, items);
    expect(r.inseridos).toBe(4);
    expect(r.por_tipo.DIVIDENDO).toBeCloseTo(0.80, 5);
    expect(r.por_tipo.AMORTIZACAO).toBeCloseTo(0.20, 5);
    expect(r.por_tipo.BONIFICACAO).toBeCloseTo(1.00, 5);
    expect(r.por_tipo.RENDIMENTO).toBeCloseTo(1.05, 5);
    expect(r.ignorados).toBe(1);  // tipo desconhecido
  });

  it('rejeita itens sem ticker ou com ticker inválido', () => {
    const r = importarHistoricoDividendos(db, [
      { competencia: '2025-01', valor_por_cota: 0.80, tipo: 'DIVIDENDO', origem_chave: 'a' },
      { ticker: 'evilticker<script>', competencia: '2025-01', valor_por_cota: 0.80, tipo: 'DIVIDENDO', origem_chave: 'b' },
      row('ABCD11', '2025-01', 0.80)
    ]);
    expect(r.ignorados).toBe(2);
    expect(r.inseridos).toBe(1);
  });

  it('RF-011: tipo desconhecido vai para ignorados (não vira DIVIDENDO)', () => {
    const r = importarHistoricoDividendos(db, [
      row('ABCD11', '2025-01', 0.80, 'JCP')
    ]);
    expect(r.ignorados).toBe(1);
    expect(r.inseridos).toBe(0);
  });

  it('atualiza fii_dividendos_sync com sucesso + contagens', () => {
    const items = [
      row('ABCD11', '2025-01', 0.80),
      row('ABCD11', '2025-02', 0.85),
      row('ABCD11', '2025-03', 0.90)
    ];
    importarHistoricoDividendos(db, items);
    const sync = db.prepare(
      "SELECT * FROM fii_dividendos_sync WHERE ativo_id=1"
    ).get();
    expect(sync).toBeDefined();
    expect(sync.ultimo_status).toBe('SUCESSO');
    expect(sync.ultimo_total_lido).toBe(3);
    expect(sync.ultimo_inseridos).toBe(3);
    expect(sync.primeira_competencia).toBe('2025-01');
    expect(sync.ultima_competencia).toBe('2025-03');
  });
});