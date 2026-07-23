# Changelog

Todas as mudanças notáveis do byeINSS são documentadas aqui.
Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [Unreleased]

### Added — PRD 07: Radar de DY Suspeito — Alerta de Corte Iminente (schema 1.7+)

- **Lógica pura (`src/shared/radar-dy.js`)**:
  `calcularRatio` (dy_12m / dy_medio_5a, com null-safety + precisão completa),
  `classificarRadar` (NORMAL/AMARELO/VERMELHO/SEM_DADOS com fronteiras
  estritas: 1.25 → NORMAL, 1.50 → AMARELO, > 1.50 → VERMELHO),
  `avaliarRadarFII` (contrato canônico), `agregarResumo`,
  `ordenarAlertas` (RF-014: VERMELHO antes de AMARELO, ratio desc,
  ticker asc), `validarThresholds` (RF-023: 1.00 < amarelo < vermelho
  <= 10.00, diff >= 0.01).
- **Configurações em `config`** (3 seeds novos, sem nova coluna):
  `radar_dy_habilitado` (default `1`), `radar_dy_limiar_amarelo`
  (default `1.25`), `radar_dy_limiar_vermelho` (default `1.50`).
- **Helpers UI (`src/shared/radar-dy-ui.js`)**: `formatarBadgeRadar`
  com texto/classe/ícone/aria-label (Crítico/Atenção/Normal/Sem dados),
  `formatarAlertaConsolidado` (RF-015), `formatarTendencia`
  (EM_QUEDA/ESTAVEL/EM_ALTA).
- **Endpoints REST (`src/server/routes/radar-dy.js`)**:
  - `GET /api/fiis/radar-dy` — lista FIIs com classificação, ordenado
    por severidade. Envelope com `schema`, `thresholds`, `resumo`
    e `items`.
  - `GET /api/fiis/radar-dy/:ticker` — detalhe por FII (400 ticker
    inválido, 404 inexistente, 404 não-FII).
  - `PUT /api/fiis/radar-dy` — atualiza thresholds atomicamente
    (RF-024). 400 INVALID_THRESHOLDS em valores inválidos.
  - Bind 127.0.0.1, prepared statements, mensagens sanitizadas.
- **Sem schema novo**: nenhum `ALTER TABLE`. Lê `dy_12m` e `dy_medio_5a`
  já existentes (PRD 02). Cálculo 100% on-the-fly, sem cache.
- **Testes**: 3 suítes novas / 62 testes (31 shared/radar-dy +
  12 shared/radar-dy-ui + 19 integration/api-radar-dy).
- Suíte completa: 719/719 testes verdes.

### Added — PRD 04: Comparador vs Média do Segmento (schema 1.7)

- **Schema 1.6 → 1.7 (migration versionada)**: 8 colunas novas em
  `ativos` para snapshot atômico do benchmark do segmento
  (`pvp_medio_segmento`, `dy_medio_segmento`, `pl_medio_segmento`,
  `vpa_medio_segmento`, `peer_grupo_nome`, `peer_grupo_tipo` com CHECK
  `SEGMENTO|TIPO|NAO_INFORMADO`, `peer_fonte`, `peer_atualizado_em`).
  7 limiares em `config`: `peer_desvio_neutro_pct` (5.0),
  `peer_dy_desfavoravel_pct` (10.0), `peer_validade_horas` (168),
  `peer_margem_teto_pct` (0.0), `peer_multiplicador_favoravel` (1.15),
  `peer_multiplicador_neutro` (1.00), `peer_multiplicador_desfavoravel`
  (0.75). Idempotente e transacional.
- **Lógica pura (`src/shared/peer.js`)**:
  `calcularPvpVsPeer`/`calcularDyVsPeer`/`calcularVpaVsPeer` (RF-008/009/010),
  `classificarPeer` com precedência de `DESFAVORAVEL` (RF-011),
  `precoReferenciaPeer` (RF-015), `precoTetoEfetivo` que **nunca eleva
  o teto base** (RF-016), `multiplicadorPeer` (RF-021),
  `mergeSnapshotPeer` whitelist+imutável (RF-005/008),
  `benchmarkVencido` (RF-007), `simularRebalanceamento` com distribuição
  proporcional ao peso + redistribuição de sobra (RF-019..023).
- **Parser I10 (`src/shared/scraper-peer.js`)**: extrai do box "Média
  Tipo/Segmento" o snapshot canônico. Tolerante a variações de título
  (`Média Tipo/Segmento` / `Média do Segmento` / `Média do Tipo`) e a
  sufixos BR (mil/milhões/bilhões/bi). Detecta grupo
  (`SEGMENTO`/`TIPO`/`NAO_INFORMADO`). Snapshot só válido se os 4
  numéricos forem extraídos (atomicidade, RF-005).
- **Endpoints REST**:
  - `GET /api/fiis/:ticker/comparativo-peer` — detalhe por FII com
    desvios, classificação, `preco_teto_efetivo`, `regra_limitante`,
    `multiplicador_peer`, estado (`OK`/`DESATUALIZADO`/`SEM_DADOS`).
    400 ticker inválido, 404 inexistente ou não-FII.
  - `POST /api/dashboard/rebalanceamento` — body `{aporte}` retorna
    sugestões (com quantidade inteira, valor, gap antes/depois, peer
    classification) e ignorados (com motivos `SEM_COTACAO`,
    `SEM_TETO`, `ACIMA_DO_TETO`, `SEM_GAP`,
    `PEER_DESATUALIZADO_COM_FALLBACK`).
  - Envelope `{ schema: "1.7", configuracao: {...}, ... }`.
- **Helpers UI puros**:
  - `src/shared/peer-ui.js` (P5): formatação pt-BR das 3 colunas
    `P/VP vs peer` / `DY vs peer` / `VPA vs peer`, chip de
    classificação, filtro por status, ordenação numérica com
    `SEM_DADOS` no fim.
  - `src/shared/rebalanceamento-ui.js` (P6): formatação da tabela
    Preço-teto (sinal MUITO_BARATO/NO_TETO/CARO/MUITO_CARO/SEM_TETO,
    ratio_preco_teto, regra_limitante) e da simulação (sugestões +
    ignorados com motivos pt-BR).
- **Testes**: 6 suítes novas / 138 testes novos (44 shared/peer +
  29 shared/scraper-peer + 26 shared/peer-ui + 14 shared/rebalanceamento-ui
  + 18 integration/api-peer + 9 db-migration-1.7). Suíte completa: 657
  testes verdes.
- **DOM integration**: a integração efetiva das colunas e do modal de
  rebalanceamento em `pages.js` foi postergada para um PR de UI dedicado
  (alto risco de regressão). Helpers ficam prontos e testados para
  reuso.
- **Limites**: peer **nunca eleva** o preço-teto base (RF-016);
  benchmark vencido usa multiplicador neutro (RF-022); ausência de
  cotação/preço-teto bloqueia a entrada na simulação.

### Added — PRD 01: Histórico de DividendoseSustentabilidadedeDY por FII (schema 1.5)

- **Schema 1.4 → 1.5 (migration versionada)**: 7 colunas novas em `proventos`
  via `ALTER TABLE` (competencia, precisao_data, status, fonte,
  origem_chave, created_at, updated_at). Tabela nova
  `fii_dividendos_sync` com provenance por FII (status ENUM
  NUNCA/EM_ANDAMENTO/SUCESSO/PARCIAL/ERRO/CANCELADO, contadores,
  primeira/ultima_competencia, cobertura_completa, erro). Idempotente.
- **Lógica pura (`src/shared/dividendos-hist.js`)**: `calcularDYRealizado12M`
  (RF-012), `calcularDYSustentavel` (RF-013) com confiança ALTA/MEDIA/
  INDISPONIVEL (RF-014), `classificarSinais` ESTAVEL/EM_OBSERVACAO/
  CORTE_CONFIRMADO/AUMENTO_CONFIRMADO (RF-016/017), `resumirCadencia`
  REGULAR/IRREGULAR (RF-018).
- **Importer (`src/shared/dividendos-import.js`)**: dedup por
  `(fonte, origem_chave)` (RF-008), reconciliação com manuais
  (RF-009: manual NUNCA é sobrescrito), tipo desconhecido → ignorados
  (RF-006/011), retorna `inseridos/duplicados/ignorados/por_tipo/erros`
  (RF-022), atualiza `fii_dividendos_sync` (RF-024).
- **Scraper I10 (`src/main/scraper-historico.js`)**: parser por HEADER
  semântico (RF-004), normaliza tipo e competência MM/YYYY → YYYY-MM
  (RF-005), gera `origem_chave` determinística. Carregado via
  `executeJavaScript` no Electron (mesmo padrão do `agenda-parser`).
- **Endpoints**:
  - `GET /api/fii-historico/:ticker` — histórico paginado + métricas
    (DY realizado 12M, DY sustentável com confiança, comparação vs
    DY 5a com classificação, sinais com estado por variação,
    sync_status). Aceita `?pagina=&tamanhoPagina=&hoje=`.
  - `POST /api/fii-historico/:ticker/importar` — recebe rows do
    scraper Electron e delega para `importarHistoricoDividendos`.
- **UI**:
  - Nova rota `#fii-historico/[A-Z]{4}11` no router.
  - Página dedicada com KPIs (DY realizado, DY sustentável vs DY 5a,
    cadência), badge de estado atual dos sinais, sync status, tabela
    paginada com filtro por tipo (RF-022).
  - Botão "Histórico" adicionado na tabela de Posições (RF-001).
- **IPC**:
  - `scraper:dividendos-historico(ticker)` — scraping individual.
  - `scraper:dividendos-historico-todos` — batch sequencial para todos
    os FIIs da carteira, retorna resumo com sucessos/erros.
- **Testes**: 32 novos testes cobrindo migration 1.5, lógica pura,
  importer, scraper parser, integração HTTP da rota, router.

### Added — PRD 03: Amortizações Separadas em Proventos de FIIs (schema 1.4)

- **Schema 1.4 — migration versionada**: tabela `proventos` agora aceita o
  tipo `AMORTIZACAO` via `CHECK (tipo IN ('DIVIDENDO','RENDIMENTO','BONIFICACAO','AMORTIZACAO'))`.
  Recriação via `proventos_v2` (SQLite não tem `ALTER ADD CHECK`).
  Backup automático via `VACUUM INTO` antes do DDL; validações
  obrigatórias (count + sums + FK + integrity_check). Idempotente.
- **Parser puro (`src/shared/agenda-parser.js`)** — localiza colunas
  por HEADER (semântica), tolera ordem variável de colunas no I10,
  normaliza `Dividendos`→`DIVIDENDO`, `Amortização`→`AMORTIZACAO`,
  etc. Tipo desconhecido retorna `null` (RF-006: nunca assume
  `DIVIDENDO` silenciosamente).
- **Scraper I10 (`src/main/scraper.js`)** — `extractAgendaDividendos`
  usa o parser inline, retorna resumo com contagens por tipo,
  `total_lidos`, `total_inseridos`, `duplicados`, `reclassificados`,
  `ignorados`, `erros` e `tipo_desconhecidos`. Falha controlada se
  o I10 remover a coluna "Tipo" (RF-004 / PRD caso 5).
- **Serviço de import (`src/shared/proventos-import.js`)** —
  deduplicação por chave lógica completa (`ativo_id`, `data_pagto`,
  `valor_por_cota`, `tipo`, `data_com`); permite que DIVIDENDO +
  AMORTIZACAO coexistam na mesma data. Reconciliação opcional de
  legados `DIVIDENDO` → `AMORTIZACAO` quando há candidato único.
- **Endpoints (`src/server/routes/proventos.js`,
  `src/server/routes/dashboard.js`)**:
  - `GET /api/proventos?tipos=…&inicio=&fim=` retorna
    `quantidade_elegivel` e `valor_total` por linha (RF-015).
  - `POST /api/proventos` valida tipo (422), data ISO (400),
    valor > 0, dedup (409).
  - `POST /api/proventos/batch` aceita `proventos[{ticker,
    valor_por_cota, tipo}]` (novo) ou `dividendos[]` (alias legado
    assume `DIVIDENDO`).
  - `GET /api/dashboard/proventos-mensais?tipos=&inicio=&fim=` agrega
    por mês com `distribuiveis` (DIV+REND), `amortizacoes`,
    `bonificacoes` e `total_caixa`. Bonificação NÃO compõe caixa
    (RF-016).
  - `GET /api/dashboard/projecao-proventos` retorna
    `total_distribuivel_mensal/anual`, `dy_carteira_distribuivel`,
    `detalhes[]` com `sem_base_recorrente`/`desatualizado`, e
    `amortizacoes_previstas` (sem multiplicar por 12).
  - `GET /api/dashboard/resumo` — campos `proventos_12m` e
    `dy_carteira_12m` agora passam a ser **somente distribuíveis**
    (RF-020). Novos: `amortizacoes_12m`,
    `fluxo_caixa_proventos_12m`, `amortizacoes_total`.
- **UI (`src/renderer/js/proventos-ui.js` + `pages.js`)** —
  KPIs re-organizados em 3 colunas (Distribuíveis 12M /
  Amortizações 12M / Projeção distribuível 12M); gráfico Chart.js
  **empilhado** por tipo; tabela histórica com `quantidade_elegivel`,
  `valor_total` e badge de tipo com `role=status`; bloco separado
  de amortizações previstas; tabela textual paralela para leitores
  de tela (a11y WCAG AA); `prefers-reduced-motion` desabilita
  animação; modal em lote permite **adicionar parcelas** para o mesmo
  FII (DIVIDENDO + AMORTIZACAO na mesma data — RF-010). Filtros
  `?tipos=` refletidos no hash da URL (RF-013).
- **Testes** — 71 novos testes:
  - 12 testes da migration 1.4 (db-migration-1.4.test.js)
  - 13 testes do parser da agenda (agenda-parser.test.js)
  - 9 testes do import service (proventos-import.test.js)
  - 14 testes dos helpers puros (proventos-helpers.test.js)
  - 17 testes de integração HTTP (api-proventos-amortizacao.test.js)
  - 21 testes dos helpers de UI (proventos-ui.test.js)
  - 2 testes atualizados em api-dashboard.test.js para o novo
    contrato.

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

### Added — PRD 02 sub-PR 4: fechamento de 4 gaps de UI (RF-018/019/021/022/023)

- **RF-018 — Matriz Nominal×Real acessível**: botão "Detalhes" em cada FII
  da tabela Posições expande uma `<table role="grid">` com 6 valores
  (Nominal/Real × 1a/2a/5a), `aria-label` descritivo, fallback "—" para
  valores ausentes.
- **RF-019 — Filtros + ordenação em Posições**:
  - `aplicarFiltroEOrdenacaoPosicoes` (lógica pura): filtro por
    classificação (CONSISTENTE/ATENCAO/CRITICO/SEM_DADOS ou combinação),
    ordenação numérica `dy_vs_5a_pct` ou `rentab_real_1a` (asc/desc),
    nulls no fim.
  - `renderizarFiltrosClassificacaoPosicoes` (UI): chips toggleáveis com
    `aria-pressed` (TODOS + 4 classificações canônicas). Click → atualiza
    hash `#posicoes?filtro=...` → re-render automático.
  - Hash round-trip: `parseFiltroClassificacaoFromHash` / `gerarHashFiltro`.
- **RF-021 — Contadores completos no bloco de alerta**: 5 atributos
  `data-*` (`total-afetado`, `criticos`, `atencao`, `avaliada`, `sem-dados`)
  no `<section data-bloco="indicadores-alerta">`. Título atualizado para
  incluir "X crítico(s), Y atenção (Z de W avaliados)".
- **RF-022 — Ação "Ver FIIs (N)"**: link no bloco de alerta com
  `href="#posicoes?filtro=ATENCAO,CRITICO"` e `aria-label` descritivo.
- **RF-023 — Estado vazio com ação específica**: quando não há FIIs
  avaliáveis E (lista vazia OU todos INSUFICIENTE), renderiza
  `<section data-bloco="indicadores-vazio">` com mensagem
  "Indicadores históricos ainda não disponíveis" e botão
  "Atualizar indicadores" que dispara
  `POST /api/fiis/scraper/indicadores/resync` (toast em falha).
- **CSS** (styles.css): `.indicadores-filtros`, `.indicadores-filtro-chip`,
  `.indicadores-vazio`, `.rentab-matriz` — todos AA-friendly sobre tema
  escuro.
- **Testes**: `src/__tests__/renderer/indicadores-ui-rf18.test.js` (novo,
  31 casos cobrindo matriz, toggle, filtros, ordenação, hash, chips,
  contadores RF-021, ação Ver FIIs RF-022, empty state RF-023).
- **Total**: 361/361 vitest (era 330 antes) + 64/64 smoke.
  **PRD 02 100% coberto** — 25 RFs ✅.

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
