# PRD 01 — Histórico de Dividendos e Sustentabilidade de DY

Plano de implementação da feature (branch feat/prd-01-historico-dividendos). Sub-PR 1 fechado; segue o plano de revisão por reviewers (schema/code/security/Playwright) antes de merge.

## Status atual

**Schema final:** 1.5 (revisão do plano original — PRD 03 já havia bumpado para 1.4, então renumeramos para 1.5)
**Branch:** `feat/prd-01-historico-dividendos` (a partir de master commit `d3a95d7`)
**Testes:** 464/464 verde após Sub-PR 1

## Sub-PR 1 — Schema 1.5 + lógica pura (parcialmente concluído)

### Entregue

- ✅ `db/init.sql`: proventos agora tem colunas `competencia`, `precisao_data`, `status`, `fonte`, `origem_chave`, `created_at`, `updated_at`. CHECK constraints para `precisao_data`, `status`, `fonte`. FK de saída (`→ ativos`) preservada.
- ✅ `db/init.sql`: tabela `fii_dividendos_sync` com provenance (status ENUM, contadores, primeiras/últimas competências, coverage_complete, erro).
- ✅ Índices novos: `idx_proventos_ativo_competencia`, `idx_proventos_status_pagto`, `idx_proventos_tipo_competencia`, `idx_fii_divsync_ts`.
- ✅ `src/server/db.js`: migration 1.5 adicionada em MIGRATIONS via `ALTER TABLE` (não recria — dados do PRD 03 intactos). Default `'0000-00'` para competencia + UPDATE retroativo preenche `strftime('%Y-%m', data_pagto)` e marca `fonte='LEGADO'`.
- ✅ 7 testes novos em `db-migration-1.5.test.js` cobrindo init.sql schema, idempotência, comportamento em DB legados, ALTER não-conflitante.
- ✅ Ajustes em testes do PRD 03 (`db-migration-1.4.test.js`) — versão final esperada agora é 1.5 após runMigrations completo.

### Decisões importantes

1. **Versão 1.4 → 1.5** (divergência do plano original — PRD 03 consumiu o 1.4).
2. **`ALTER TABLE ADD COLUMN` em vez de recriar tabela** — preserva os dados do PRD 03 (5 tipos check, 4 índices). SQLite ainda não suporta `ADD CONSTRAINT`, então os CHECKs/índices novos vão via TRIGGER futuro ou via validação no serviço de import.
3. **`created_at` e `updated_at` com DEFAULT constante `''`** — SQLite recusa `ADD COLUMN ... DEFAULT (datetime('now'))` quando a tabela tem dados; o UPDATE retroativo popula com datetime('now') quando valor é vazio.
4. **`UNIQUE (fonte, origem_chave)` do plano original removido** — registros legados com `origem_chave=NULL` quebrariam UNIQUE constraint. Deduplicação agora vive no serviço de import (`insertHistoricoDividendos` em `src/shared/dividendos-import.js` — Sub-PR 2).

## Pendente no Sub-PR 1

- [ ] Criar `src/shared/dividendos-hist.js` (lógica pura: DY realizado, sustentável, sinais, cadência).
- [ ] Testes unitários para a lógica pura (estimado: ~30 testes seguindo mesmo padrão de `proventos-helpers.test.js`).

## Sub-PR 2 — Scraper I10 + batch (próximo)

- [ ] `src/main/scraper-historico.js` com `extractDividendosHistorico(ticker)` (paginação "carregar mais").
- [ ] `src/shared/dividendos-import.js` com `importarHistoricoDividendos(db, ticker, rows)` — dedup por `origem_chave`, reconciliação com legados, retorno com contagens por tipo (RF-022).
- [ ] Fixtures I10 (HTML de página de FII com seção de dividendos em 2 layouts: canônico e "carregar mais").
- [ ] IPC: `scraper:dividendos-historico(ticker)`, `scraper:dividendos-historico-todos`, `scraper:dividendos-progresso`, `scraper:dividendos-cancelar`.

## Sub-PR 3 — Backend + UI

- [ ] `src/server/routes/proventos-historico.js`: `GET /historico/:ticker`, `GET /metricas/:ticker`, `GET /sinais`, `POST /historico/:ticker/importar`.
- [ ] Atualizar `GET /api/proventos` para usar `competencia` quando `data_pagto` for nulo e excluir `status='AGENDADO'` e `tipo='AMORTIZACAO'` do cálculo de renda.
- [ ] Rota renderer `#fii-historico/[A-Z]{4}11` em `router.js`.
- [ ] `src/renderer/js/dividendos-hist-ui.js` + `pages-fii-historico.js`: linha do tempo Chart.js + tabela paginada + badges de estado.
- [ ] Link "Histórico" em Posições (RF-001) + badge de estado do FII (RF-023).
- [ ] Adicionar resumo de sincronização na Importação (RF-024).

## Sub-PR 4 — Validação cruzada + docs + PR

- [ ] Spawn schema-reviewer, code-reviewer, electron-security-reviewer, Playwright visual.
- [ ] CHANGELOG.md, README.md, SECURITY.md.
- [ ] Plano de revisão pós-PDR (regressões conhecidas: testes PRD 03 que esperavam versão final 1.4).
