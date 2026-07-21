# Changelog

Todas as mudanças notáveis do byeINSS são documentadas aqui.
Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [Unreleased]

### Added — PRD 02: Indicadores Históricos de DY e Rentabilidade Real (schema 1.3)

- **Schema 1.3 — migration versionada**: 9 colunas nullable em `ativos`
  (`dy_medio_5a`, `rentab_nominal_1a/2a/5a`, `rentab_real_1a/2a/5a`,
  `dy_medio_5a_fonte`, `dy_medio_5a_atualizado_em`) + seed
  `indicador_dy_vs_5a_abaixo_pct=95` (threshold configurável).
  Idempotente; cobre caminho fresh install e DBs legados 1.1/1.2.
- **Lógica pura em `src/shared/indicadores.js`**:
  - `calcularDyVs5a({ dy_12m, dy_medio_5a })` → razão + pct + flag
    `HISTORICO_ZERADO` para divisão por zero.
  - `classificarDyVs5a({ pct, limiar_abaixo_pct, limiar_acima_pct })`
    → `{ classificacao, severidade, motivo }` com boundaries
    `≤80 CRITICO / <95 ATENCAO / ≤105 EM_LINHA / <125 ATENCAO / >125 CRITICO`.
  - `mergeIndicadores(prev, novo, opts)` → persistência segura (RF-008):
    `null` em novo NÃO apaga valor anterior.
  - `normalizarRotuloRentabilidade` (`1a`|`1 ano`|`12 meses` → `1a`).
  - `parsePercentBr('12,34%')` → `12.34` (suporta formato BR com milhar).
- **Scraper I10 estendido** (`src/main/scraper.js`): `extractFIIDetalhes`
  agora extrai `dy_medio_5a` (multi-label) e a tabela de **Rentabilidade**
  (Nominal/Real × 1a/2a/5a) com parser multi-layout.
  `extractAllFIIDetalhes` persiste via `mergeIndicadores`.
- **Endpoints REST**:
  - `GET  /api/fiis/indicadores` — lista FIIs com classificação e
    `meta.contadores_por_severidade`.
  - `GET  /api/fiis/indicadores/:ticker` — detalhe individual
    (regex `^[A-Z]{4}11$`, 400/404 apropriados).
  - `POST /api/fiis/scraper/indicadores/resync` — dispara enriquecimento
    em lote (body opcional `{ tickers?: string[] }`). Falha de um ticker
    NÃO derruba o batch (RF-007). Idempotente (RF-008).
  - `GET  /api/fiis/scraper/indicadores/status` — health-check.
- **UI Posições**: 2 colunas novas — **DY vs 5y** (badge com cor por
  severidade, tooltip explicativo) e **Rent. real 12M** (formato pt-BR,
  classe `--negative` para valores negativos).
- **UI Dashboard**: bloco de alerta "DY 12M abaixo da média histórica
  de 5 anos" com lista dos FIIs afetados, link para `#fii/:ticker`,
  respeita `renderSequence` para evitar race entre navegações.
- **A11y**: `role="status"` + `aria-label` descritivo nos badges;
  `aria-labelledby` ligando o bloco de alerta ao `<h3>`; tooltip via
  `title` nativo; fallback `—` (sem inventar dado).
- **Testes**:
  - `src/__tests__/shared/indicadores.test.js` (45 casos).
  - `src/__tests__/integration/api-indicadores.test.js` (20 casos).
  - `src/__tests__/integration/api-scraper-indicadores.test.js` (11 casos).
  - `src/__tests__/renderer/indicadores-ui.test.js` (29 casos).
  - `src/__tests__/db-migrations.test.js` estendida (14 casos totais).
  - `scripts/test-migrations-smoke.js` estendida (64 casos totais).
- **Gates**: `schema-reviewer` APPROVE + `electron-security-reviewer` APPROVED.
- **Total**: 330/330 vitest (era 219 antes) + 64/64 smoke. Zero regressão.

### Fixed — Alertas de preço-teto

- **Dashboard `/api/dashboard/alertas` nunca emitia alerta de preço-teto**: o endpoint só gerava `CONCENTRACAO` e `DY_ALTO`, embora o frontend já tivesse ícones para `PRECO_TETO` (🎯) e `OPORTUNIDADE` (🟢). Agora emite esses alertas para **todos** os FIIs ativos com preço-teto e cotação (independente de já possuir o ativo — vale como sinal de compra na watchlist). O guard `if (qtd <= 0) return` deixava de fora FIIs não detidos; alertas de preço agora rodam antes desse guard, enquanto concentração/DY seguem restritos a posições detidas.
- **Página Preço-teto — "zona morta"**: FIIs com preço entre o teto e `teto × 1,1` não recebiam classificação (mostravam "—"). Adicionado o estado `🟡 PRÓXIMO DO TETO` e rótulos explícitos para "sem cotação" e "defina o teto", cobrindo toda a faixa.
- Testes: `src/__tests__/integration/api-dashboard-alertas.test.js` (6 casos).

### Added — Cobertura de testes

- **Provider de cobertura** `@vitest/coverage-v8` + script `npm run test:coverage`.
- **`api-dashboard.test.js`** (17 casos): `/resumo`, `/sinais` (todos os ramos MUITO_BARATO→MUITO_CARO + SEM_TETO/SEM_PRECO), `/proventos-mensais`, `/projecao-proventos`, `/evolucao`, `/simular`, `/fire`. Cobertura de `dashboard.js`: **35% → 99%**.
- **`pages-preco-teto.test.js`** (7 casos): classificação de sinal da página Preço-teto, com guarda de regressão para a "zona morta".

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

### Added — PRD 12: Vencimento Médio de Contratos (sub-PR 2 UI)

- **Detalhe por FII `#fii/:ticker`**: nova rota renderer parametrizada (regex `^[A-Z]{4}11$` no `:ticker`, via `src/renderer/js/router.js`); mostra header com link "Voltar para Posições", card-resumo (ticker, segmento, qtd, PM, preço atual) e o card "Contratos & Reajuste". Ativos não-FII / FII não cadastrado / ticker inválido caem em estado vazio com mensagem explícita.
- **Card "Contratos & Reajuste"** (`src/renderer/js/contratos-ui.js`) com estados visuais discretos: `success` / `alert` / `partial` / `expired` / `error` / `not-applicable` / `empty`. Cor da borda esquerda + badge de risco (`contract-risk`) comunicam o estado. Botão de ajuda com tooltip (hover + `:focus-visible`) explica data, meses até vencer e tipo de reajuste.
- **Modal acessível de edição manual** reaproveita o `PUT /api/fiis/contratos/:ticker` existente: `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`, foco preso no primeiro campo ao abrir, retorno do foco ao gatilho (`[data-action="edit"]`) ao salvar/fechar, fechamento por `Esc` e clique no backdrop, mensagens de erro em `role="alert"` com `aria-live="assertive"`. Retry automático desativado honestamente — em falha de rede o modal mostra o erro e o usuário decide.
- **Bloco de alerta no Dashboard** consome `GET /api/dashboard/alertas-vencimento` (já existente). Lista cruza com posições em aberto (`qtd > 0`) e respeita `renderSequence` para evitar condições de corrida entre navegações rápidas. Falha no endpoint não derruba o Dashboard.
- **Campo configurável "Janela de alerta de vencimento (meses)"** em **Configurações** lê/grava `vencimento_janela_alerta_meses` (default 24, mesma chave do sub-PR 1). Validação client-side: inteiro > 0, com `aria-invalid` + foco no campo em erro e `role="status"`/`role="alert"` no status de salvamento.
- **A11y transversal**: `<nav aria-label>`, `aria-current="page"` no item ativo, `<div role="status" aria-live="polite">` no toast e no `#config-status`, foco no `.page-title` (`tabindex=-1`) após cada navegação, links de ticker com `aria-label` próprio.
- **Testes Vitest + jsdom**: stack novo (`vitest`, `jsdom`, `supertest` em devDependencies) com `npm test` / `npm run test:watch`. Suítes em `src/__tests__/renderer/` cobrem router, contratos-ui, dashboard-contratos, pages-contratos, config-contratos e app-routing. 144 testes Vitest passando; suites de smoke e E2E permanecem verdes.

### Added — PRD 12: Vencimento Médio de Contratos (sub-PR 3 scraper)

- **Parsers puros em `src/shared/scraper-contratos.js`** (sem dependência de Electron/better-sqlite3):
  - `parseContratoFromMainHTML(html)` — extrai vencimento + tipo de reajuste da página `/fiis/{ticker}/`, com heurística multi-seletor que prefere blocos `<section>`/`<div>` com id|class contendo "contrato|reajuste" antes de "sobre|informações" (RF-007 resiliência a mudanças de layout).
  - `parseContratoFromComunicadoHTML(html, comunicadoDate)` — fallback da página `/fiis/{ticker}/comunicados/`, isola o `<article data-date>` mais recente.
  - `parseContratoFromFallbackHTML(html)` — última linha: scan global do HTML.
  - `parseTipoReajusteI10(text, opts)` — detecta IGP-M / IPCA / FIXO / MISTO / OUTRO. Detecta MISTO quando o texto menciona múltiplos índices canônicos ("parte IGP-M, parte IPCA"). FIXO é self-describing ("Fixo 3,5% a.a.") e tem precedência sobre rótulos compostos.
  - `parseDateBR(text)` / `parseMesNumber(text)` / `brNumberToFloat(raw)` — utilidades puras.
- **Orchestrator Electron em `src/main/scraper-contratos.js`**:
  - `fetchContratoData(ticker)` — orquestra main page → fallback Comunicado com timeout duro de 3s por FII (PRD 12 NFR-performance). Não cria nova BrowserWindow; reusa singleton com contextIsolation + sandbox.
  - `resyncAll(db, opts)` — percorre todos os FIIs (exceto `vencimento_medio_origem='manual'`, RF-009), persiste via `persistContrato()` e loga cada tentativa em `fii_scraper_log` (RF-008).
  - Falha de um ticker não derruba o batch (PRD 12 §8 RF-007).
- **Endpoint REST `POST /api/fiis/scraper/contratos/resync`** (`src/server/routes/scraper-contratos.js`):
  - Body opcional `{ tickers?: string[] }`; se vazio, roda em todos os FIIs da carteira.
  - Resposta: `{ total, sucessos, falhas, janela_execucao_ms, detalhes: [{ ticker, success, source, persisted, motivo_skip, error, confianca }] }`.
  - Validação estrita: 400 em ticker inválido, regex FII.
  - 503 quando o scraper não carrega (Electron indisponível).
  - Endpoint complementar `GET /status` para health-check.
- **Fixtures HTML realistas em `src/__tests__/fixtures/i10/`**:
  - `hglg11.html` (data + IGP-M em bloco estruturado), `knip11.html` (24 meses + FIXO 3,5%), `xpml11.html` (18 meses + MISTO), `mxrf11.html` (papel — vazio intencional), `vino11-fixo.html` (FIXO 3% a.a.), `bcff11-layout-quebrado.html` (FII sem bloco estruturado, parser conservador devolve vazio), `hglg11-comunicado.html` (fallback Comunicado com data+IGPM).
- **45 testes novos** (`src/__tests__/shared/scraper-contratos.test.js` + `src/__tests__/integration/api-scraper-contratos.test.js`): cobrem happy path + edge cases PRD 12 §8 (RF-007 resiliência, RF-008 log, RF-009 manual override), fixtures variadas, validação de body, persistência transacional, e cenário de falha de um ticker dentro do batch.
- Total: **219 testes Vitest passando** em 1.38s. PRD 12 §13 agora marca todos os sub-PRs como entregues.

### Changed

- `src/server/db.js` agora tem função `runMigrations(db)` que mantém `config.versao_schema` em sincronia com a migration aplicada (fix #3 schema-reviewer).
- `init.sql` e o fallback inline em `db.js` declaram CHECK constraints para `tipo_reajuste`, `reajuste_percentual` e `vencimento_medio_contratos_meses`.

### Fixed

- **DBs legados 1.1** agora migram automaticamente para 1.2: 7 colunas adicionadas via `ALTER TABLE`, tabela `fii_scraper_log` criada, índices criados, `versao_schema` bumped — tudo dentro de uma única transaction.
- Backup automático agora aborta a inicialização se não conseguir copiar o `.db` (antes silenciava e seguia em frente).

### Out of scope (próximos sub-PRs PRD 12)

- ~~Scraper I10 com extração de vencimento + tipo de reajuste~~ ✅ sub-PR 3
- ~~`POST /api/fiis/scraper/contratos/resync`~~ ✅ sub-PR 3

## [1.0.0] — projeto base

- Estrutura inicial: Electron 32, Express 4, better-sqlite3 11.3, Chart.js 4.4 vendorizado
- 9 rotas REST: ativos, lançamentos, proventos, cotações, metas, dashboard, import, config, cenários
- Importação via I10 (browser isolado) e planilha PREÇO-TETO
- Simulador FIRE e cenários
