// TDD Red Phase — PRD 03 RF-006, RF-007, RF-008, RF-009, RF-022.

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { importarProventos } from '../shared/proventos-import.js';

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
  // Cria dois FIIs para teste
  db.prepare("INSERT INTO ativos (ticker) VALUES ('HGLG11'), ('XPML11'), ('KNIP11')").run();
  return db;
}

describe('importarProventos — RF-006 tipo desconhecido', () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it('RF-006: tipo desconhecido IGNORA o item (não vira DIVIDENDO silenciosamente)', () => {
    const r = importarProventos(db, [
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.50, tipo: 'Outros' }
    ]);
    expect(r.inseridos).toBe(0);
    expect(r.ignorados).toBe(1);
    expect(r.tipo_desconhecidos).toHaveLength(1);
    expect(r.tipo_desconhecidos[0]).toMatchObject({ ticker: 'HGLG11', raw_tipo: 'Outros' });
    expect(r.por_tipo).not.toHaveProperty('Outros');
    // DB confirma: nada inserido
    const c = db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c;
    expect(c).toBe(0);
  });

  it('insere AMORTIZACAO corretamente', () => {
    const r = importarProventos(db, [
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.20, tipo: 'AMORTIZACAO' },
      { ticker: 'XPML11', data_pagto: '2026-07-20', valor_por_cota: 1.05, tipo: 'RENDIMENTO' },
      { ticker: 'KNIP11', data_pagto: '2026-07-20', valor_por_cota: 0.50, tipo: 'BONIFICACAO' }
    ]);
    expect(r.inseridos).toBe(3);
    expect(r.ignorados).toBe(0);
    expect(r.tipo_desconhecidos).toEqual([]);
    expect(r.por_tipo.AMORTIZACAO).toBeCloseTo(0.20, 5);
    expect(r.por_tipo.RENDIMENTO).toBeCloseTo(1.05, 5);
    expect(r.por_tipo.BONIFICACAO).toBeCloseTo(0.50, 5);
    // CHECK constraint aceita os 4 tipos
    const rows = db.prepare('SELECT tipo, valor_por_cota FROM proventos ORDER BY ativo_id').all();
    expect(rows).toEqual([
      { tipo: 'AMORTIZACAO', valor_por_cota: 0.20 },
      { tipo: 'RENDIMENTO', valor_por_cota: 1.05 },
      { tipo: 'BONIFICACAO', valor_por_cota: 0.50 }
    ]);
  });

  it('RF-005: tipo normalizado (lowercase/acento/variação)', () => {
    const r = importarProventos(db, [
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.50, tipo: 'Amortização' },
      { ticker: 'XPML11', data_pagto: '2026-07-20', valor_por_cota: 0.30, tipo: 'dividendo' },
      { ticker: 'KNIP11', data_pagto: '2026-07-20', valor_por_cota: 0.25, raw_tipo: 'RENDIMENTOS' }
    ]);
    expect(r.inseridos).toBe(3);
  });

  it('RF-007: deduplicação por chave lógica completa', () => {
    // Dois pagamentos na mesma data, MESMO ticker, valores DIFERENTES (caso 2 do PRD)
    importarProventos(db, [
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.80, tipo: 'DIVIDENDO' }
    ]);
    const r = importarProventos(db, [
      // DUPLICADO exato → ignorado
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.80, tipo: 'DIVIDENDO' },
      // MESMA data, valor diferente → insere (não é dup)
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.20, tipo: 'AMORTIZACAO' }
    ]);
    expect(r.duplicados).toBe(1);
    expect(r.inseridos).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c).toBe(2);
  });

  it('RF-007/08: dividendo + amortização na mesma data coexistem (caso 1 do PRD)', () => {
    const r = importarProventos(db, [
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.80, tipo: 'DIVIDENDO' },
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.20, tipo: 'AMORTIZACAO' }
    ]);
    expect(r.inseridos).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c).toBe(2);
  });

  it('RF-008: reclassifica DIVIDENDO legado para AMORTIZACAO quando único candidato', () => {
    // Insere um DIVIDENDO manualmente (legado)
    db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                VALUES (1, '2026-07-20', 0.80, 'DIVIDENDO')`).run();
    // Importa uma AMORTIZACAO com mesma chave
    const r = importarProventos(db, [
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.80, tipo: 'AMORTIZACAO' }
    ]);
    expect(r.reclassificados).toBe(1);
    expect(r.inseridos).toBe(0);  // não inseriu novo — reclassificou
    const row = db.prepare(`SELECT tipo FROM proventos WHERE ativo_id=1`).get();
    expect(row.tipo).toBe('AMORTIZACAO');
  });

  it('RF-008 caso 9: NÃO reclassifica quando >1 candidato legado bate', () => {
    db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                VALUES (1, '2026-07-20', 0.80, 'DIVIDENDO'),
                       (1, '2026-07-20', 0.80, 'DIVIDENDO')`).run();
    const r = importarProventos(db, [
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.80, tipo: 'AMORTIZACAO' }
    ]);
    expect(r.reclassificados).toBe(0);
    expect(r.inseridos).toBe(1);
    // LEGADO permanece + novo AMORTIZACAO inserido
    expect(db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c).toBe(3);
  });

  it('RF-011/15: rejeita data inválida e valor negativo', () => {
    const r = importarProventos(db, [
      { ticker: 'HGLG11', data_pagto: '20/07/2026', valor_por_cota: 0.50, tipo: 'DIVIDENDO' },
      { ticker: 'XPML11', data_pagto: '2026-07-20', valor_por_cota: -0.5, tipo: 'DIVIDENDO' },
      { ticker: 'KNIP11', data_pagto: '2026-07-20', valor_por_cota: 0, tipo: 'DIVIDENDO' }
    ]);
    expect(r.inseridos).toBe(0);
    expect(r.ignorados).toBe(3);
    expect(r.erros.find(e => e.codigo === 'data_pagto_iso_obrigatoria')).toBeDefined();
    expect(r.erros.find(e => e.codigo === 'valor_positivo_obrigatorio')).toBeDefined();
  });

  it('RF-022: retorna contagens por tipo e tipo_desconhecidos', () => {
    const r = importarProventos(db, [
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.20, tipo: 'AMORTIZACAO' },
      { ticker: 'HGLG11', data_pagto: '2026-07-20', valor_por_cota: 0.80, tipo: 'DIVIDENDO' },
      { ticker: 'XPML11', data_pagto: '2026-07-20', valor_por_cota: 0.30, tipo: 'Outros' }
    ]);
    expect(r.inseridos).toBe(2);
    expect(r.tipo_desconhecidos).toHaveLength(1);
    expect(r.por_tipo.AMORTIZACAO).toBeCloseTo(0.20, 5);
    expect(r.por_tipo.DIVIDENDO).toBeCloseTo(0.80, 5);
  });
});
