# Changelog

Todas as mudanças notáveis do byeINSS são documentadas aqui.
Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [Unreleased]

### Added — PRD 12: Vencimento Médio de Contratos (schema 1.2)

- **Schema 1.2 — migration versionada**: framework `schema_migrations` + 7 colunas em `ativos` (vencimento_medio_contratos, vencimento_medio_contratos_meses, tipo_reajuste, reajuste_percentual, vencimento_medio_origem, vencimento_medio_coletado_em, alerta_vencimento) + tabela `fii_scraper_log` + 3 índices. Backup automático do DB antes de qualquer DDL.
- **Endpoints REST** (PRD 12 §6):
  - `GET  /api/fiis/contratos/:ticker` — leitura consolidada
  - `PUT  /api/fiis/contratos/:ticker` — upsert manual (marca `origem='manual'`)
  - `GET  /api/dashboard/alertas-vencimento` — lista FIIs com vencimento < janela
- **Lógica pura em `src/shared/contratos.js`**: `calcularAlertaVencimento`, `parseTipoReajuste`, `validarDadosContratos`. Sem dependência de Electron/SQLite.
- **Config `vencimento_janela_alerta_meses`** (default 24): fonte única para a janela de alerta, configurável via `/api/config`.
- **Tipos de reajuste** (enum em SQL CHECK + em JS): `IGPM`, `IPCA`, `FIXO`, `MISTO`, `OUTRO`. FIXO exige `reajuste_percentual`.
- **Validações**:
  - 400 ticker inválido (regex `^[A-Z]{4}11$` para FII ou `^[A-Z]{4}[0-9]$` para ação)
  - 400 conflito data+meses
  - 422 FIXO sem percentual
  - 400 tipo_reajuste fora do enum
  - 404 ticker inexistente em `ativos`
- **Auditoria**: cada PUT grava uma linha em `fii_scraper_log` por campo alterado.
- **Harness de testes**: `scripts/test-migrations-smoke.js` (58 casos) + `scripts/smoke-migration-real.js` (E2E em DB real) + `scripts/smoke-api-endpoints.js` (12 cenários HTTP). Testes vitest também em `src/__tests__/` (49 casos).

### Changed

- `src/server/db.js` agora tem função `runMigrations(db)` que mantém `config.versao_schema` em sincronia com a migration aplicada (fix #3 schema-reviewer).
- `init.sql` e o fallback inline em `db.js` declaram CHECK constraints para `tipo_reajuste`, `reajuste_percentual` e `vencimento_medio_contratos_meses`.

### Fixed

- **DBs legados 1.1** agora migram automaticamente para 1.2: 7 colunas adicionadas via `ALTER TABLE`, tabela `fii_scraper_log` criada, índices criados, `versao_schema` bumped — tudo dentro de uma única transaction.
- Backup automático agora aborta a inicialização se não conseguir copiar o `.db` (antes silenciava e seguia em frente).

### Out of scope (próximos sub-PRs PRD 12)

- Scraper I10 com extração de vencimento + tipo de reajuste
- `POST /api/fiis/scraper/contratos/resync`
- UI de detalhe do FII com bloco "Contratos & Reajuste"
- Bloco de alerta no Dashboard

## [1.0.0] — projeto base

- Estrutura inicial: Electron 32, Express 4, better-sqlite3 11.3, Chart.js 4.4 vendorizado
- 9 rotas REST: ativos, lançamentos, proventos, cotações, metas, dashboard, import, config, cenários
- Importação via I10 (browser isolado) e planilha PREÇO-TETO
- Simulador FIRE e cenários
