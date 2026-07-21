// Serviço compartilhado (server + futuro batch) que importa uma lista de
// proventos normalizados (vindos do scraper ou JSON manual) aplicando:
//  - RF-007: deduplicação por chave lógica (ativo_id, data_pagto, valor_por_cota, tipo, data_com)
//  - RF-006: tipos desconhecidos (null) são IGNORADOS, não viram DIVIDENDO
//  - RF-008: reconciliação opcional de registros legados (DIVIDENDO → AMORTIZACAO)
//            quando há correspondência inequívoca
//  - RF-022: retorna resumo com contagens por tipo, inseridos, duplicados,
//            reclassificados, ignorados, erros e tipo_desconhecidos
//
// Depende apenas de um objeto better-sqlite3 db (prepares usados aqui
// são preparados localmente; em ambiente de alta concorrência, considere
// mover para `transaction(fn)` no caller).

import { normalizarTipo } from './agenda-parser.js';

const VALID_TIPOS = new Set(['DIVIDENDO', 'RENDIMENTO', 'BONIFICACAO', 'AMORTIZACAO']);

/**
 * Insere e deduplica proventos.
 * @param {Database} db
 * @param {Array<{ticker, data_com?, data_pagto, valor_por_cota, tipo?, raw_tipo?}>} itens
 * @param {{ reconciliarLegados?: boolean }} [opts]
 * @returns {{
 *   inseridos: number,
 *   duplicados: number,
 *   reclassificados: number,
 *   ignorados: number,
 *   por_tipo: Record<string, number>,
 *   erros: Array<{ indice, ticker, codigo }>,
 *   tipo_desconhecidos: Array<{ indice, ticker, raw_tipo }>
 * }}
 */
export function importarProventos(db, itens, opts = {}) {
  const { reconciliarLegados = true } = opts;

  const findAtivo = db.prepare('SELECT id FROM ativos WHERE ticker = ?');
  // RF-007: chave lógica completa (inclui tipo e data_com).
  const findDup = db.prepare(`
    SELECT id, tipo FROM proventos
    WHERE ativo_id = ?
      AND data_pagto = ?
      AND valor_por_cota = ?
      AND tipo = ?
      AND (data_com = ? OR (data_com IS NULL AND ? IS NULL))
    LIMIT 1
  `);
  // Para reconciliação: acha DIVIDENDOs que batem com a amortização importada (sem igualar tipo).
  const findLegacyCandidate = db.prepare(`
    SELECT id, tipo FROM proventos
    WHERE ativo_id = ?
      AND data_pagto = ?
      AND valor_por_cota = ?
      AND tipo = 'DIVIDENDO'
      AND (data_com = ? OR (data_com IS NULL AND ? IS NULL))
    LIMIT 2
  `);
  const updateProv = db.prepare(`UPDATE proventos SET tipo = ? WHERE id = ?`);
  const insertProv = db.prepare(`
    INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo)
    VALUES (?, ?, ?, ?, ?)
  `);

  let inseridos = 0, duplicados = 0, reclassificados = 0, ignorados = 0;
  const por_tipo = { DIVIDENDO: 0, RENDIMENTO: 0, AMORTIZACAO: 0, BONIFICACAO: 0 };
  const erros = [];
  const tipo_desconhecidos = [];

  const trx = db.transaction(() => {
    itens.forEach((item, indice) => {
      try {
        if (!item || typeof item !== 'object') {
          erros.push({ indice, ticker: item && item.ticker, codigo: 'item_invalido' });
          ignorados++;
          return;
        }
        const ticker = String(item.ticker || '').toUpperCase().trim();
        const data_pagto = item.data_pagto;
        const valor = Number(item.valor_por_cota);
        const data_com = item.data_com || null;

        if (!ticker) {
          erros.push({ indice, ticker, codigo: 'ticker_obrigatorio' });
          ignorados++;
          return;
        }
        if (!/^[A-Z]{4}11$/.test(ticker)) {
          erros.push({ indice, ticker, codigo: 'ticker_formato_invalido' });
          ignorados++;
          return;
        }
        if (!data_pagto || !/^\d{4}-\d{2}-\d{2}$/.test(data_pagto)) {
          erros.push({ indice, ticker, codigo: 'data_pagto_iso_obrigatoria' });
          ignorados++;
          return;
        }
        if (!Number.isFinite(valor) || valor <= 0) {
          erros.push({ indice, ticker, codigo: 'valor_positivo_obrigatorio' });
          ignorados++;
          return;
        }

        const tipo = normalizarTipo(item.tipo || item.raw_tipo);
        // RF-006: tipo desconhecido → ignora silenciosamente (mas conta no relatorio).
        if (!tipo || !VALID_TIPOS.has(tipo)) {
          tipo_desconhecidos.push({
            indice,
            ticker,
            raw_tipo: String(item.tipo || item.raw_tipo || '').trim() || null
          });
          ignorados++;
          return;
        }

        const ativo = findAtivo.get(ticker);
        if (!ativo) {
          erros.push({ indice, ticker, codigo: 'ativo_nao_encontrado' });
          ignorados++;
          return;
        }

        // RF-007: checar duplicado
        const dup = findDup.get(ativo.id, data_pagto, valor, tipo, data_com, data_com);
        if (dup) {
          duplicados++;
          return;
        }

        // RF-008: tentar reconciliar legado DIVIDENDO → AMORTIZACAO
        if (reconciliarLegados && tipo === 'AMORTIZACAO') {
          const legados = findLegacyCandidate.all(ativo.id, data_pagto, valor, data_com, data_com);
          if (legados.length === 1 && legados[0].tipo === 'DIVIDENDO') {
            updateProv.run('AMORTIZACAO', legados[0].id);
            reclassificados++;
            por_tipo.AMORTIZACAO += valor;
            return;
          }
          // 0 ou >1 legados candidatos → sem reclassificação automática (PRD 03 caso 9).
        }

        insertProv.run(ativo.id, data_com, data_pagto, valor, tipo);
        inseridos++;
        por_tipo[tipo] += valor;
      } catch (e) {
        erros.push({ indice, ticker: item && item.ticker, codigo: 'excecao', mensagem: e.message });
        ignorados++;
      }
    });
  });
  trx();

  return {
    inseridos,
    duplicados,
    reclassificados,
    ignorados,
    por_tipo,
    erros,
    tipo_desconhecidos
  };
}

export { VALID_TIPOS };
