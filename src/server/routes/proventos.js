const express = require('express');
const router = express.Router();

const { importarProventos } = require('../../shared/proventos-import.js');
const { calcularQuantidadeElegivel } = require('../../shared/proventos-helpers.js');

const TIPOS_VALIDOS = new Set(['DIVIDENDO', 'RENDIMENTO', 'BONIFICACAO', 'AMORTIZACAO']);

function parseTipos(q) {
  if (!q) return null;
  const arr = String(q).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (arr.length === 0) return null;
  for (const t of arr) {
    if (!TIPOS_VALIDOS.has(t)) {
      const err = new Error(`Tipo inválido: ${t}`);
      err.status = 400;
      throw err;
    }
  }
  return arr;
}

function isoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// GET /api/proventos?ativo_id=&ano=&inicio=&fim=&tipos=DIVIDENDO,AMORTIZACAO
router.get('/', (req, res, next) => {
  try {
    const { ativo_id, ano, inicio, fim } = req.query;
    let tipos;
    try { tipos = parseTipos(req.query.tipos); } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    if (inicio && !isoDate(inicio)) {
      return res.status(400).json({ error: 'inicio deve ser ISO YYYY-MM-DD' });
    }
    if (fim && !isoDate(fim)) {
      return res.status(400).json({ error: 'fim deve ser ISO YYYY-MM-DD' });
    }

    let sql = `SELECT p.id, p.ativo_id, a.ticker, p.data_com, p.data_pagto,
                      p.valor_por_cota, p.tipo
               FROM proventos p
               JOIN ativos a ON a.id = p.ativo_id WHERE 1=1`;
    const params = [];
    if (ativo_id) { sql += ' AND p.ativo_id = ?'; params.push(ativo_id); }
    if (ano) { sql += ' AND strftime("%Y", p.data_pagto) = ?'; params.push(ano); }
    if (inicio) { sql += ' AND p.data_pagto >= ?'; params.push(inicio); }
    if (fim) { sql += ' AND p.data_pagto <= ?'; params.push(fim); }
    if (tipos) { sql += ` AND p.tipo IN (${tipos.map(() => '?').join(',')})`; params.push(...tipos); }
    sql += ' ORDER BY p.data_pagto DESC, p.id DESC';
    const rows = req.db.prepare(sql).all(...params);

    // Quantidade elegível + valor total por linha (RF-015).
    const lancCache = new Map(); // ativo_id → array
    const getLanc = (id) => {
      if (!lancCache.has(id)) {
        lancCache.set(id, req.db.prepare(`
          SELECT data, tipo, quantidade FROM lancamentos WHERE ativo_id = ? ORDER BY data
        `).all(id));
      }
      return lancCache.get(id);
    };
    const out = rows.map(p => {
      const qtd = calcularQuantidadeElegivel(getLanc(p.ativo_id), p.data_com, p.data_pagto);
      return {
        ...p,
        quantidade_elegivel: qtd,
        valor_total: Number(p.valor_por_cota) * qtd
      };
    });
    res.json(out);
  } catch (e) { next(e); }
});

// POST /api/proventos
router.post('/', (req, res) => {
  const { ativo_id, data_com, data_pagto, valor_por_cota, tipo } = req.body || {};
  if (!ativo_id || !data_pagto || valor_por_cota == null) {
    return res.status(400).json({ error: 'ativo_id, data_pagto, valor_por_cota são obrigatórios' });
  }
  if (!isoDate(data_pagto)) {
    return res.status(400).json({ error: 'data_pagto deve ser ISO YYYY-MM-DD' });
  }
  if (data_com != null && !isoDate(data_com)) {
    return res.status(400).json({ error: 'data_com deve ser ISO YYYY-MM-DD' });
  }
  const v = Number(valor_por_cota);
  if (!Number.isFinite(v) || v <= 0) {
    return res.status(400).json({ error: 'valor_por_cota deve ser número > 0' });
  }
  const tipoNorm = (tipo || 'DIVIDENDO').toString().toUpperCase();
  if (!TIPOS_VALIDOS.has(tipoNorm)) {
    return res.status(422).json({ error: `tipo inválido: ${tipo}. Aceitos: ${[...TIPOS_VALIDOS].join(',')}` });
  }
  const ativo = req.db.prepare('SELECT id FROM ativos WHERE id = ?').get(ativo_id);
  if (!ativo) return res.status(404).json({ error: 'ativo não encontrado' });

  // RF-007 dedup por chave lógica completa.
  const dup = req.db.prepare(`
    SELECT id FROM proventos
    WHERE ativo_id = ? AND data_pagto = ? AND valor_por_cota = ? AND tipo = ?
      AND (data_com = ? OR (data_com IS NULL AND ? IS NULL))
    LIMIT 1
  `).get(ativo_id, data_pagto, v, tipoNorm, data_com || null, data_com || null);
  if (dup) return res.status(409).json({ error: 'Provento duplicado (chave lógica completa)', id: dup.id });

  const info = req.db.prepare(`
    INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo)
    VALUES (?, ?, ?, ?, ?)
  `).run(ativo_id, data_com || null, data_pagto, v, tipoNorm);
  res.status(201).json({ id: info.lastInsertRowid, tipo: tipoNorm });
});

router.delete('/:id', (req, res) => {
  const info = req.db.prepare('DELETE FROM proventos WHERE id = ?').run(req.params.id);
  res.json({ changes: info.changes });
});

// POST /api/proventos/batch
// Aceita 3 formatos para compatibilidade:
//   { data_pagto, dividendos: [{ticker, valor_por_cota}, ...] } → legado, cada um assume DIVIDENDO
//   { data_pagto, proventos:  [{ticker, valor_por_cota, tipo}, ...] } → novo (RF-010, múltiplas parcelas)
router.post('/batch', (req, res) => {
  const { data_pagto, data_com, dividendos = [], proventos = [] } = req.body || {};
  if (!data_pagto || !isoDate(data_pagto)) {
    return res.status(400).json({ error: 'data_pagto ISO obrigatório' });
  }

  // Normaliza para {ticker, valor_por_cota, tipo, raw_tipo, data_com} por item.
  const itens = [];
  for (const d of dividendos) {
    itens.push({
      ticker: d.ticker,
      valor_por_cota: d.valor_por_cota,
      data_pagto,
      data_com: data_com || null,
      tipo: 'DIVIDENDO',  // legado = DIVIDENDO sempre
      raw_tipo: d.tipo
    });
  }
  for (const p of proventos) {
    itens.push({
      ticker: p.ticker,
      valor_por_cota: p.valor_por_cota,
      data_pagto,
      data_com: data_com || p.data_com || null,
      tipo: p.tipo,
      raw_tipo: p.raw_tipo
    });
  }
  if (itens.length === 0) {
    return res.status(400).json({ error: 'div[] ou proventos[] é obrigatório' });
  }

  const r = importarProventos(req.db, itens, { reconciliarLegados: true });
  res.json({
    inseridos: r.inseridos,
    duplicados: r.duplicados,
    reclassificados: r.reclassificados,
    ignorados: r.ignorados,
    por_tipo: r.por_tipo,
    erros: r.erros,
    tipo_desconhecidos: r.tipo_desconhecidos
  });
});

module.exports = router;
