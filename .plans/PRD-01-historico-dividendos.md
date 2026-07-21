# Plan: PRD 01 — Histórico de dividendos e sustentabilidade de DY por FII

**Source PRD:** `docs/prds/01-historico-dividendos.md`
**Referência de roadmap:** `docs/fii-features.md`, §2.1 (CRÍTICA — "Histórico de proventos")
**Branch alvo:** `feat/prd-01-historico-dividendos`
**Branch no momento do planejamento:** `master` — pré-condição ainda não atendida
**Esforço estimado total:** 3 dias úteis (3 sub-PRs, fatiados segundo o padrão do PRD 12 / PRD 02)
**Schema inicial:** 1.3 (PRD 02 acabou de ser commitado em `bc5d561` / `c40fe48` / `be61df9` / `b1f3d05` / `92e7fd1` / `56c7777` / `ce800fa`)
**Schema final deste PRD:** **1.4**
**Estado:** aguardando aprovação; nenhuma implementação deve começar antes da confirmação das decisões abertas ao fim da seção 3.

## 1. Resumo executivo

Ao fim do PRD 01, o byeINSS terá schema **1.4** capaz de armazenar o histórico completo de proventos (incluindo `AMORTIZACAO`, `competencia`, `precisao_data`, `status`, `fonte` e `origem_chave`), uma tabela `fii_dividendos_sync` que materializa proveniência por FII, scraping resiliente do histórico no Investidor10 com paginação "carregar mais", funções puras para DY realizado 12M, DY sustentável, detecção de corte/aumento e classificação de cadência, três endpoints REST novos (`/historico/:ticker`, `/metricas/:ticker`, `/sinais`) e a rota `#fii-historico/:ticker` com linha do tempo Chart.js, tabela paginada, badges de estado, marcadores de mudança e resumo da carteira em Posições. PRD 01 é o próximo porque `docs/fii-features.md` §2.1 classifica o histórico de proventos como **CRÍTICA** e é exatamente a peça que destrava comparações com DY atual, cadência, cortes/aumentos eDY sustentável — todas as outras features do roadmap que dependem de série temporal de dividendos (radar de DY, magic number, score Buy & Hold) ficam bloqueadas sem ela. O PRD 03 (Amortização) está absorvido: o tipo `AMORTIZACAO` passa a viver na migration 1.4 e o restante do PRD 03 vira follow-up de refinamento quando for priorizado.

## 2. Dependências e pré-condições

### Pré-condições já verificadas

- [x] PRD 12 (Vencimento de Contratos) entregue em três sub-PRs — framework `schema_migrations`, backup pré-DDL e migration versionada já em `src/server/db.js`.
- [x] PRD 02 (Indicadores Históricos) entregue em quatro sub-PRs — schema em **1.3**, `dy_medio_5a` e rentabilidades disponíveis em `ativos`, lógica pura em `src/shared/indicadores.js`, parsers I10 em `src/main/scraper-indicadores.js`, endpoints REST em `src/server/routes/indicadores.js`, UI em `src/renderer/js/indicadores-ui.js`.
- [x] Scraper base em `src/main/scraper.js` com `extractFIIDetalhes`, padrão de multi-layout já validado.
- [x] Canal IPC `scraper:enriquecer-todos` registrado em `src/main/main.js` e exposto em `src/preload/preload.js`.
- [x] Pattern `mergeX` (PRD 02) garantindo que `null` de parser nunca apaga valor anterior.
- [x] Partição `persist:investidor10`, `nodeIntegration: false`, `contextIsolation: true`, hostname `investidor10.com.br` (e subdomínios autorizados) já validados.
- [x] Chart.js vendorizado em `src/renderer/vendor/chart.min.js`, sem dependência nova obrigatória.
- [x] `db/init.sql` e `FALLBACK_SCHEMA_INLINE` em sincronia para 1.3.
- [x] Suítes `src/__tests__/db-migrations.test.js`, `src/__tests__/shared/`, `src/__tests__/integration/`, `src/__tests__/renderer/` e fixtures `src/__tests__/fixtures/i10/` (`hglg11`, `knip11`, `xpml11`, `mxrf11`).
- [x] Routers: `src/server/routes/indicadores.js`, `src/server/routes/proventos.js`, `src/server/routes/scraper-contratos.js`, `src/server/routes/scraper-indicadores.js`.
- [x] Skills de harness `schema-migration`, `tdd-workflow`, `scraper-testing`, `test-author`, `schema-reviewer`, `electron-security-reviewer`, `doc-sync`, `code-reviewer`.

### Pré-condições ainda pendentes

- [ ] Criar ou mudar para a branch `feat/prd-01-historico-dividendos` antes de qualquer implementação.
- [ ] Aprovar este plano.
- [ ] Confirmar as decisões abertas da seção 3 (3.2 retenção de IDs, 3.3 confiança do DY sustentável, 3.4 fonte `LEGADO` para registro manual pré-existente).
- [ ] Preparar cópia descartável de banco real em schema **1.3** para o smoke da migration 1.3 → 1.4.
- [ ] Confirmar que as fixtures existentes do PRD 02 (`hglg11`, `knip11`, `xpml11`, `mxrf11`) ainda servem como base e ampliar para cenários de dividendos.

### Componentes que ainda não existem ou precisam ser estendidos

- [ ] Criar `src/shared/dividendos-hist.js` com a lógica pura (DY realizado, sustentável, sinais, cadência).
- [ ] Adicionar migration **1.4** ao array `MIGRATIONS` de `src/server/db.js` (recriação de `proventos` + tabela `fii_dividendos_sync` + chaves de `config`).
- [ ] Atualizar `db/init.sql` e `FALLBACK_SCHEMA_INLINE` com a nova definição de `proventos` + `fii_dividendos_sync`.
- [ ] Criar `src/main/scraper-historico.js` com `extractDividendosHistorico(ticker)` + `persistHistorico(...)`.
- [ ] Criar `src/server/routes/proventos-historico.js` com `GET /historico/:ticker`, `GET /metricas/:ticker`, `GET /sinais`, `POST /historico/:ticker/importar`.
- [ ] Atualizar `GET /api/proventos` para usar `competencia` quando `data_pagto` for nulo e excluir `status='AGENDADO'` e `tipo='AMORTIZACAO'` dos cálculos de renda recorrente.
- [ ] Criar `src/renderer/js/dividendos-hist-ui.js` (módulo isolável) e `src/renderer/js/pages-fii-historico.js` (render da nova rota).
- [ ] Adicionar rota `#fii-historico/:ticker` em `src/renderer/js/router.js` com regex `^#fii-historico/[A-Z]{4}11$`.
- [ ] Adicionar link "Histórico de dividendos" na ação de cada FII em Posições (RF-001).
- [ ] Adicionar badge por FII em Posições (RF-023) e mostrar estado de dividendos no Dashboard.
- [ ] Criar canal IPC `scraper:dividendos-historico(ticker)`, `scraper:dividendos-historico-todos()`, `scraper:dividendos-cancelar()`, `scraper:dividendos-progresso`.
- [ ] Criar/estender suítes, fixtures e smokes detalhados na seção 7.

### Dependências entre entregas

- Sub-PR 1 bloqueia Sub-PRs 2 e 3 (define schema, lógica pura, scraper, contrato da API).
- Sub-PR 2 pode começar após o contrato de API do Sub-PR 1 estar estabilizado; pode usar mock do envelope enquanto o Sub-PR 3 é executado.
- Sub-PR 3 depende dos parsers, `mergeHistorico` e da função de batch entregues no Sub-PR 1.
- Alterações em `db/init.sql` ou `src/server/db.js` não podem ser integradas sem gate do `schema-reviewer`.
- Alterações em `src/main`, `src/server` ou `src/renderer` não podem ser integradas sem gate do `electron-security-reviewer`.

## 3. Decisões de arquitetura mínimas

### 3.1. Schema 1.3 → 1.4

- A migration **recria** `proventos` via padrão `proventos_v2` + `INSERT` + `DROP` + `RENAME` descrito no PRD 01 §5. Não é uma evolução `ALTER TABLE` coluna a coluna: CHECK constraints novos, novo `UNIQUE (fonte, origem_chave)` e dois CHECKs cruzados (`precisao_data` ↔ `data_pagto`, `fonte=INVESTIDOR10` → `origem_chave IS NOT NULL`) não são viáveis incrementalmente em SQLite sem recriação.
- A nova estrutura adiciona as colunas:
  - `competencia TEXT NOT NULL` com CHECK `(length=7 AND substr(5,1)='-' AND mês 1..12)`.
  - `precisao_data TEXT NOT NULL DEFAULT 'DIA'` com CHECK `(DIA|MES)`.
  - `tipo TEXT NOT NULL DEFAULT 'DIVIDENDO'` com CHECK `(DIVIDENDO|RENDIMENTO|BONIFICACAO|AMORTIZACAO)`.
  - `status TEXT NOT NULL DEFAULT 'PAGO'` com CHECK `(PAGO|AGENDADO)`.
  - `fonte TEXT NOT NULL DEFAULT 'MANUAL'` com CHECK `(MANUAL|INVESTIDOR10|IMPORTACAO|LEGADO)`.
  - `origem_chave TEXT`.
  - `created_at TEXT NOT NULL DEFAULT (datetime('now'))`, `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`.
  - CHECK `(precisao_data='DIA' AND data_pagto IS NOT NULL) OR (precisao_data='MES' AND data_pagto IS NULL)`.
  - CHECK `(fonte <> 'INVESTIDOR10') OR origem_chave IS NOT NULL`.
  - `UNIQUE (fonte, origem_chave)`.
- Cria também a tabela `fii_dividendos_sync` com `status` em `(NUNCA|EM_ANDAMENTO|SUCESSO|PARCIAL|ERRO|CANCELADO)`, contadores de leitura/inserção/atualização/duplicatas/conflitos, primeiro/última competência, cobertura completa e timestamp de erro.
- Cria índices: `idx_proventos_ativo_competencia (ativo_id, status, competencia DESC)`, `idx_proventos_status_pagto (status, data_pagto DESC)`, `idx_proventos_tipo_competencia (tipo, competencia DESC)`.
- Insere cinco chaves em `config` (`dividendos_variacao_alerta_pct`, `dividendos_janela_referencia_meses`, `dividendos_janela_sustentavel_meses`, `dividendos_janela_sustentavel_min_meses`, `dividendos_sync_desatualizado_dias`) e atualiza `config.versao_schema` para `1.4`.
- Pré-validação obrigatória **antes** do DDL: se a query de validação (PRD §5) retornar qualquer linha, abortar a migration com erro legível e orientar restauração do backup.
- Backup pré-DDL obrigatório (mesmo padrão do PRD 12) e `PRAGMA foreign_key_check` ao final; falha controlada se retornar qualquer linha.
- `updated_at` de registros existentes não será tocado pela migration (a recriação usa `datetime('now')` apenas nos defaults de inserção inicial; não há backfill de proveniência nova).

### 3.2. Retenção de IDs em `proventos`

- A migration insere em `proventos_v2` com o `id` antigo preservado (RF-025). Após `DROP` + `RENAME`, AUTOINCREMENT continua na sequência original.
- A origem dos registros legados será `fonte='LEGADO'` e `origem_chave='LEGADO:' || id` para garantir `UNIQUE (fonte, origem_chave)` e abrir espaço para a chave I10 não colidir.
- Decisão precisa de confirmação: **confirmar antes de S1.1** se registros manuais pré-existentes (com `tipo IS NULL` ou `data_pagto` futuro) também migram como `LEGADO` ou se vão para `MANUAL`. A leitura literal do PRD §5 diz `LEGADO` para todos os atuais, então seguimos essa leitura salvo veto explícito do usuário.

### 3.3. Confiança do DY sustentável

- `ALTA` ≥36 meses completos com sincronização há ≤30 dias.
- `MEDIA` 24..35 meses, OU ≥36 meses mas sincronização >30 dias.
- `INDISPONIVEL` <24 meses, cotação ausente/zero/negativa, sincronização sabidamente parcial (`cobertura_completa=0` em `fii_dividendos_sync`).
- Os limites exatos (parâmetros `dividendos_janela_sustentavel_meses=36` e `dividendos_janela_sustentavel_min_meses=24`) ficam em `config` para permitir ajuste futuro, mas o PRD 01 não cria UI de edição desses thresholds.

### 3.4. Classificação de estado e `dividendos_variacao_alerta_pct`

- A regra canônica do PRD 01 §3 RF-016/RF-017/RF-018 usa limiar de **±15%** sobre a média dos 12 totais mensais recorrentes anteriores.
- `ESTAVEL` quando todos os 12 meses estão na faixa `[limite_inferior, limite_superior]`.
- `EM_OBSERVACAO` quando **uma** competência cai abaixo ou sobe acima do limite.
- `CORTE_CONFIRMADO` / `AUMENTO_CONFIRMADO` quando **duas competências consecutivas** confirmam a direção.
- `INSUFICIENTE` quando há menos de 9 meses pagantes nos últimos 12 (cadência irregular, RF-018).
- `DESATUALIZADO` quando a sincronização bem-sucedida tiver mais de `dividendos_sync_desatualizado_dias=30`.
- O threshold `15%` é configurável (`dividendos_variacao_alerta_pct`), mas a UI deste PRD não expõe edição.
- **Decisão aberta (3.4-a):** definir se a UI apresentará um sexto estado (`SEM_DADOS` quando nunca houve sincronização) ou se manteremos `INSUFICIENTE` como guardião único para vazio/parcial — o PRD lista "dados insuficientes" e "desatualizado" como badges distintos, então a proposta é manter **seis** estados (ESTAVEL, EM_OBSERVACAO, CORTE_CONFIRMADO, AUMENTO_CONFIRMADO, INSUFICIENTE, DESATUALIZADO) mais um fallback neutro `SEM_HISTORICO` quando nunca houve sync. Confirmar.

### 3.5. Lógica pura em `src/shared/dividendos-hist.js`

- O módulo não importará Electron, Express, `better-sqlite3` ou relógio global.
- Espelha a separação de responsabilidades de `src/shared/indicadores.js`.
- Data de referência será injetada (`new Date('2026-07-21T00:00:00Z')` em testes) para garantir determinismo.
- Arredondamento será aplicado apenas na camada de apresentação; cálculos usarão valores armazenados.
- Funções públicas planejadas:
  - `calcularDyRealizado12m(proventos, cotacaoReferencia, dataReferencia)` — soma DIVIDENDO+RENDIMENTO por competência nos últimos 12 meses-calendário anteriores à data de referência, divide pela cotação de referência (positiva mais recente ≤ dataReferencia) e devolve percentual; devolve `null` se cobertura <12 meses ou cotação inválida.
  - `calcularDySustentavel(proventos, cotacaoReferencia, dataReferencia, coberturaCompleta)` — agrega DIVIDENDO+RENDIMENTO por mês, preenche zero nos meses cobertos sem pagamento, e devolve `min(média 24m, média 36m) × 12 / cotacao`. Se <24 meses de cobertura ou cotação inválida ou `coberturaCompleta=false`, devolve `null`. Retorna também `{ valor, confianca, motivos }`.
  - `detectarCorte(proventos, dataReferencia, limitePct=15)` — devolve `true` se duas competências consecutivas caem ≥limitePct abaixo da média móvel de 12 totais mensais recorrentes anteriores.
  - `detectarAumento(proventos, dataReferencia, limitePct=15)` — simétrico para aumento.
  - `classificarCadencia(proventos, dataReferencia, janela=12, minimoPagantes=9)` — `REGULAR` ou `IRREGULAR`.
  - `classificarEstado(...)` — agrega todas as funções acima em `{ estado, motivos, variacao_pct, competencia, confianca }` consumidos pela UI e por `GET /api/proventos/sinais`.
  - `mergeHistorico(prev, novo)` — espelha o `mergeIndicadores` do PRD 02: aceita `null` como ausência (não apaga valor anterior), zero e negativo são válidos, não muta objetos. Usado por `persistHistorico`.
  - `gerarChaveOrigem(ticker, competencia, dataPagtoOuMes, tipo, valor8casas, ordem)` — produz `INVESTIDOR10|<TICKER>|<COMPETENCIA>|<DATA_PAGTO ou MES>|<TIPO>|<VALOR>|<ORDEM>`.

### 3.6. Idempotência e reconciliação

- Antes de inserir, `persistHistorico` verificará:
  - correspondência exata por `(fonte, origem_chave)` — UNIQUE garante zero duplicatas;
  - correspondência manual/legado pelo mesmo `(ativo_id, competencia, valor_por_cota tolerância 1e-8, tipo)`;
- Registro manual existente **nunca** será sobrescrito (RF-009). Correspondência única será tratada como já existente; ambígua ou divergente vai para `registros_conflitantes` em `fii_dividendos_sync` e é mostrada no resumo da sincronização.

### 3.7. Scraper e fronteira de segurança

- `extractDividendosHistorico(ticker)` será função determinística e exportável para testes, mesmo permanecendo integrada a `src/main/scraper-historico.js`.
- Antes de montar ou navegar para qualquer URL, o ticker será normalizado e validado por `^[A-Z]{4}11$` (RF Segurança).
- A URL será construída por API de URL e o hostname permitido será exatamente `investidor10.com.br` ou subdomínio explicitamente autorizado (reaproveitando o helper do PRD 02).
- `persistHistorico` envolverá toda a gravação do FII em uma única transação; falha em uma linha não derruba a transação inteira — ela é contabilizada como `ignorada` e segue. Falha de banco não persistido reverte a transação e mantém registros anteriores.
- Paginação / "carregar mais" será detectada por seletor semântico (botão "carregar mais", paginação numerada, fim-de-rolagem) e exercida em loop até não haver novas linhas ou atingir limite duro configurável (default: 120 competências).

### 3.8. Contrato das APIs novas

- Envelope comum: `{ data, meta: { schema: '1.4', ... } }` ou, para o endpoint paginado, `{ ticker, data_referencia, cobertura, items, paginacao }` conforme PRD §6.
- `GET /api/proventos/historico/:ticker` aceita `periodo=12m|36m|5a|all`, `tipos=DIVIDENDO,RENDIMENTO,AMORTIZACAO`, `status=PAGO`, `page=1`, `limit=100`. Limite padrão 100, máximo 500.
- `GET /api/proventos/metricas/:ticker` aceita `data_referencia=YYYY-MM-DD`. Retorna 200 com `null` + `qualidade_dados.motivos` quando cálculo indisponível (não 404).
- `GET /api/proventos/sinais` aceita `ativo_only=1`, `estado=CORTE_CONFIRMADO`, `desatualizado=true|false`.
- `POST /api/proventos/historico/:ticker/importar` recebe payload pré-extraído pelo main process; valida `extraido_em`, `cobertura_completa`, `dy_medio_5a` e `eventos[]`. Bloqueia reentrância com `409 SINCRONIZACAO_EM_ANDAMENTO` quando `fii_dividendos_sync.status='EM_ANDAMENTO'`.
- `GET /api/proventos` (legado) será atualizado para usar `competencia` quando `data_pagto` for nulo, e excluir `status='AGENDADO'` e `tipo='AMORTIZACAO'` dos cálculos de renda recorrente.
- Erro padrão `{ erro: { codigo, mensagem, detalhes } }`.
- Validação de ticker estrita (`^[A-Z]{4}11$`) antes de qualquer navegação ou query parametrizada.
- Statements sempre parametrizados; whitelist de ordenação quando aplicável.

### 3.9. UI e A11y

- Reaproveitar a paleta e os tokens visuais do PRD 02 (`src/renderer/css/styles.css`) e o padrão de modal acessível (`focus trap`, retorno de foco, `aria-describedby`, contraste WCAG AA).
- Status nunca dependerá apenas de cor: usaremos texto, formato de marcador e ícone textual (RF-019/RF-021/A11y).
- Linha do tempo com um único eixo Y; referência sustentável em linha tracejada; amortizações em marcador losango distinto (não apenas cor diferente).
- Tabela paginada em 100/página, filtros por tipo, ordenação da mais recente para mais antiga.
- Toggle de período (12M/36M/5A/Tudo) e toggle para amortizações.
- Progresso de sincronização por FII em região `aria-live="polite"`.
- `prefers-reduced-motion` respeitado em animações do gráfico.
- Tooltip nunca trará informação exclusiva por hover (A11y).

### 3.10. Compatibilidade e persistência segura

- `mergeHistorico` será aplicado na fronteira de persistência: `null` de parser não apaga valor anterior; zero/negativo são aceitos.
- `updated_at` da linha só muda quando há pelo menos um campo válido aceito.
- Se nenhum evento do payload for válido, o ticker é falha legível e nenhum timestamp é alterado.
- Cadência irregular e eventos `AGENDADO`/`AMORTIZACAO` nunca entram em métricas realizadas (RF-006, RF-007).

## 4. Sub-PRs

### Sub-PR 1 — Backend: schema 1.4, lógica pura, scraper e API

**Esforço:** 1,5 dia
**Skills:** `schema-migration`, `tdd-workflow`, `test-author`, `scraper-testing`
**Agents/gates:** `test-author`, `schema-reviewer`, `electron-security-reviewer`
**Bloqueado por:** branch criada, plano aprovado, decisão 3.4-a confirmada
**Bloqueia:** Sub-PRs 2 e 3

#### S1.1. Migration 1.3 → 1.4 e schemas sincronizados — 0,5 dia

- [ ] Escrever primeiro os testes Red em `src/__tests__/db-migrations.test.js` para fresh install 1.4, upgrade de banco 1.3 com dados do PRD 12/02, preservação de IDs, pré-validação falhando, `UNIQUE (fonte, origem_chave)`, CHECKs cruzados, idempotência e `foreign_key_check` verde.
- [ ] Adicionar migration **1.4** ao array `MIGRATIONS` de `src/server/db.js` com pré-validação obrigatória e DDL conforme PRD §5.
- [ ] Recriar `proventos` via `proventos_v2` + `INSERT` + `DROP` + `RENAME`, preservando IDs e marcando legados como `fonte='LEGADO'`.
- [ ] Criar `fii_dividendos_sync`, índices `idx_proventos_ativo_competencia`, `idx_proventos_status_pagto`, `idx_proventos_tipo_competencia`.
- [ ] Inserir/atualizar chaves em `config` (`dividendos_variacao_alerta_pct`, `dividendos_janela_referencia_meses`, `dividendos_janela_sustentavel_meses`, `dividendos_janela_sustentavel_min_meses`, `dividendos_sync_desatualizado_dias`, `versao_schema=1.4`).
- [ ] Manter backup pré-DDL obrigatório e validar restauração como rollback operacional.
- [ ] Atualizar `db/init.sql` (instalação nova) com `proventos` recriado e `fii_dividendos_sync`.
- [ ] Atualizar `FALLBACK_SCHEMA_INLINE` em `src/server/db.js` com a mesma definição e versão.
- [ ] Provar que registros do PRD 12 e PRD 02 permanecem intactos e que `updated_at` não muda durante a migration.
- [ ] Estender `scripts/test-migrations-smoke.js` e `scripts/smoke-migration-real.js` para 1.3 → 1.4.

#### S1.2. Lógica pura de dividendos — 0,4 dia

- [ ] Criar `src/shared/dividendos-hist.js` com `calcularDyRealizado12m`, `calcularDySustentavel`, `detectarCorte`, `detectarAumento`, `classificarCadencia`, `classificarEstado`, `mergeHistorico` e `gerarChaveOrigem`.
- [ ] Aceitar `dataReferencia` injetada; usar `Intl` apenas se necessário para parsing, mas com helpers testáveis.
- [ ] Manter precisão completa no cálculo; arredondar apenas na camada de apresentação.
- [ ] Tratar `null`/`undefined`/`NaN`/zero/negativos e divisão por zero.
- [ ] Cobrir limites ±15% e dois meses consecutivos (RF-016/RF-017) com testes determinísticos.
- [ ] Cobrir cadência `REGULAR`/`IRREGULAR` com 9+ meses pagantes como fronteira.
- [ ] Cobrir `mergeHistorico`: `null` preserva valor anterior, zero/negativo aceitos, imutabilidade dos objetos.
- [ ] Criar `src/__tests__/shared/dividendos-hist.test.js` em ciclo Red → Green → Refactor.

#### S1.3. Scraper I10 + fixtures — 0,4 dia

- [ ] Criar `src/main/scraper-historico.js` com `extractDividendosHistorico(ticker)` e `persistHistorico(ticker, payload)`.
- [ ] Implementar detector de paginação ("carregar mais", paginação numerada, fim-de-rolagem) e loop até não haver novas linhas ou limite duro configurável.
- [ ] Normalizar competência para `YYYY-MM`, valor para número positivo com até 8 casas, `precisao_data` em DIA/MES, `tipo` em DIVIDENDO|RENDIMENTO|BONIFICACAO|AMORTIZACAO.
- [ ] Gerar `origem_chave` determinística conforme PRD §5 (`gerarChaveOrigem`).
- [ ] Validar ticker por `^[A-Z]{4}11$` antes da URL e hostname `investidor10.com.br` antes da navegação (reaproveitar helper do PRD 02).
- [ ] Estender fixtures existentes em `src/__tests__/fixtures/i10/` com casos de dividendos:
  - `knip11.html`: layout mensal puro.
  - `xpml11.html`: mensal + amortização semestral.
  - `mxrf11.html`: papel vazio (sem histórico) e caso parcialmente carregado.
  - `hglg11.html`: layout "carregar mais".
- [ ] Cobrir página parcialmente carregada, tabela ausente, conteúdo inválido, valor zero/negativo/NaN.
- [ ] Criar `src/__tests__/shared/scraper-historico.test.js` (jsdom + fixtures) com cobertura ≥95% dos campos das fixtures.
- [ ] Garantir `nodeIntegration: false`, `contextIsolation: true` e ausência de log de HTML/cookies/credenciais.

#### S1.4. Persistência segura e reconciliação — 0,1 dia

- [ ] Aplicar `mergeHistorico` antes de qualquer `INSERT`/`UPDATE`.
- [ ] Persistir em transação única por FII.
- [ ] Atualizar `fii_dividendos_sync` com `lidos/inseridos/atualizados/duplicados/conflitantes/ignorados/primeira_competencia/ultima_competencia/cobertura_completa/ultimo_erro`.
- [ ] Não sobrescrever registro manual existente (RF-009).
- [ ] Atualizar `ativos.updated_at` somente quando houver pelo menos um campo válido aceito.
- [ ] Marcar ticker como falha legível quando nenhum evento válido for extraído.
- [ ] Testar idempotência, atualização parcial e não regressão dos campos do PRD 12/02.

#### S1.5. Endpoints REST e smoke API — 0,1 dia

- [ ] Criar `src/server/routes/proventos-historico.js`.
- [ ] Implementar `GET /api/proventos/historico/:ticker`, `GET /api/proventos/metricas/:ticker`, `GET /api/proventos/sinais`, `POST /api/proventos/historico/:ticker/importar`.
- [ ] Atualizar `GET /api/proventos` para usar `competencia` quando `data_pagto` for nulo e excluir `status='AGENDADO'` e `tipo='AMORTIZACAO'` dos cálculos de renda recorrente.
- [ ] Bloquear reentrância com `409 SINCRONIZACAO_EM_ANDAMENTO` quando `fii_dividendos_sync.status='EM_ANDAMENTO'`.
- [ ] Sanitizar erros: nunca expor stack, path local, HTML, cookies ou credenciais.
- [ ] Montar router em `src/server/index.js` antes das rotas estáticas conflitantes (padrão PRD 02).
- [ ] Criar `src/__tests__/integration/api-proventos-historico.test.js`.
- [ ] Medir p95 para 20 FIIs e 10 anos de registros e falhar se exceder 200 ms.
- [ ] Estender `scripts/smoke-api-endpoints.js` sem remover cenários do PRD 12/02.

#### Critério de done do Sub-PR 1

- [ ] Migration 1.3 → 1.4 idempotente e recuperável por backup, testada em banco 1.3 real/descaracterizado.
- [ ] Fresh install, fallback inline e banco migrado expõem a mesma estrutura de `proventos` + `fii_dividendos_sync`.
- [ ] `config.versao_schema = '1.4'` e dados preexistentes (PRD 12/02) preservados integralmente.
- [ ] Cenários críticos de cálculo, merge, parser, persistência e API cobertos.
- [ ] p95 dos endpoints de leitura ≤200 ms para 20 FIIs e 10 anos.
- [ ] Smoke de migration e API verde.
- [ ] `schema-reviewer` sem findings ALTOS.
- [ ] `electron-security-reviewer` sem findings ALTOS nos arquivos main/server alterados.

### Sub-PR 2 — UI: rota `#fii-historico/:ticker`, Posições e Dashboard

**Esforço:** 1 dia
**Skills:** `tdd-workflow`, `test-author`
**Agents/gates:** `test-author`, `electron-security-reviewer`, `code-reviewer`
**Bloqueado por:** contrato de API e classificações do Sub-PR 1
**Pode rodar em paralelo com:** Sub-PR 3, usando mock do envelope da API

#### S2.1. Camada UI testável e integração HTML/CSS — 0,2 dia

- [ ] Criar `src/renderer/js/dividendos-hist-ui.js`, seguindo o padrão isolável de `indicadores-ui.js`.
- [ ] Criar `src/renderer/js/pages-fii-historico.js` com `renderFiiHistorico(ticker, root)` e helpers de paginação/filtros.
- [ ] Carregar ambos em `src/renderer/index.html` antes de `pages.js`.
- [ ] Adicionar estilos em `src/renderer/css/styles.css` reaproveitando tokens do PRD 02 e garantindo contraste WCAG AA.
- [ ] Construir DOM com `textContent`/elementos seguros para conteúdo variável, sem interpolar dados não confiáveis como markup.

#### S2.2. Rota `#fii-historico/:ticker` — 0,4 dia

- [ ] Adicionar rota `#fii-historico/:ticker` em `src/renderer/js/router.js` com regex `^#fii-historico/[A-Z]{4}11$`.
- [ ] Render de KPIs (DY realizado 12M, DY sustentável, DY médio 5a, tendência, cotação, confiança, fonte, variação recente) com skeletons em loading.
- [ ] Linha do tempo Chart.js com eixo Y BRL/cota, eixo X por competência, linha recorrente sólida, referência sustentável tracejada, amortizações em losango, marcadores de mudança com rótulo textual.
- [ ] Toggle de período (12M/36M/5A/Tudo) e toggle para amortizações, sem refazer scraping nem bloquear UI.
- [ ] Tabela paginada em 100/página, ordenação mais recente → mais antiga, filtros por tipo, formato `pt-BR`.
- [ ] Lista de sinais detectados abaixo do gráfico (texto + marcador), não dependente exclusivamente de cor.
- [ ] Bloco de proveniência (última tentativa, última sync bem-sucedida, período coberto, número de registros, com fallback "Não disponível").
- [ ] Botão "Atualizar histórico" acionando IPC `scraper:dividendos-historico(ticker)`.
- [ ] Estados: inicial, loading, sincronizando, success atualizado, success desatualizado, empty nunca sincronizado, empty legítimo, dados insuficientes, parcial, error autenticação, error fonte, error local, sem cotação.
- [ ] A11y: `aria-describedby`, `aria-live="polite"` no progresso, foco no título, focus trap em modal, Escape fecha e restaura foco, `prefers-reduced-motion` respeitado.
- [ ] Criar `src/__tests__/renderer/pages-fii-historico.test.js` (jsdom).

#### S2.3. Posições: link, badges e resumo da carteira — 0,2 dia

- [ ] Adicionar link "Histórico de dividendos" na ação de cada FII em Posições (RF-001).
- [ ] Adicionar badge por FII em Posições com último estado conhecido (RF-023): ESTAVEL | EM_OBSERVACAO | CORTE_CONFIRMADO | AUMENTO_CONFIRMADO | INSUFICIENTE | DESATUALIZADO | SEM_HISTORICO.
- [ ] Resumo da carteira em Posições: contagem por estado, com link para filtro.
- [ ] Atualizar `renderPosicoes` para consultar `/api/proventos/sinais` em paralelo com dados existentes e tratar falha isoladamente.
- [ ] Manter feature exclusiva para linhas `tipo='FII'`; outros ativos exibem estado não aplicável.
- [ ] Estender `src/renderer/js/router.js` para parsear e validar query do hash de Posições sem comprometer `#fii/:ticker` ou `#fii-historico/:ticker`.

#### S2.4. Dashboard: estado de dividendos da carteira — 0,2 dia

- [ ] Estender `GET /api/dashboard/alertas` com no máximo um item `DIVIDENDOS_CORTE_CONFIRMADO` quando houver FIIs da carteira em `CORTE_CONFIRMADO` ou `AUMENTO_CONFIRMADO`.
- [ ] Considerar apenas FIIs ativos com quantidade consolidada maior que zero.
- [ ] Listar FIIs afetados com links validados para `#fii-historico/:ticker`.
- [ ] Respeitar `dashboardRenderSequence` antes de alterar o DOM.
- [ ] Isolar falha do novo alerta para não derrubar KPIs, gráficos ou alertas existentes.
- [ ] Usar região de status persistente, sem anúncio urgente repetido a cada render.
- [ ] Criar `src/__tests__/renderer/dashboard-dividendos.test.js` (regressão + novo alerta).

#### Critério de done do Sub-PR 2

- [ ] Posições exibe link "Histórico de dividendos", badge por FII e resumo da carteira.
- [ ] Rota `#fii-historico/:ticker` renderiza KPIs, gráfico, tabela, lista de sinais e proveniência.
- [ ] Estados loading/error/empty/partial/success e acessibilidade WCAG AA.
- [ ] Toggles de período e amortizações não refazem scraping nem bloqueiam UI.
- [ ] Gráfico de até 120 pontos renderiza em <500 ms após resposta.
- [ ] Dashboard mostra no máximo um alerta consolidado e não inclui posição com quantidade zero.
- [ ] Falha em `/api/proventos/sinais` ou `/api/proventos/metricas/:ticker` não derruba Posições nem Dashboard.
- [ ] Testes Vitest + jsdom verdes.
- [ ] `electron-security-reviewer` sem findings ALTOS.
- [ ] `code-reviewer` sem findings ALTOS.

### Sub-PR 3 — Enriquecimento em lote, IPC e performance smoke

**Decisão de escopo:** o batch é obrigatório pelos RF-002/RF-010/RF-024; o endpoint REST de importação é a porta de entrada do payload já extraído pelo main process (RF-027) e o canal IPC é mandatório pelo PRD. Sub-PR 3 fica **dentro** deste PRD. Smoke de performance (17 FIIs ≤5 min) entra como entregável deste sub-PR.
**Esforço:** 0,5 dia
**Skills:** `tdd-workflow`, `test-author`, `scraper-testing`, `doc-sync`
**Agents/gates:** `test-author`, `electron-security-reviewer`, `code-reviewer`
**Bloqueado por:** Sub-PR 1

#### S3.1. Canal IPC de histórico e cancelamento — 0,15 dia

- [ ] Registrar `scraper:dividendos-historico(ticker)`, `scraper:dividendos-historico-todos()`, `scraper:dividendos-cancelar()`, `scraper:dividendos-progresso` em `src/main/main.js`.
- [ ] Expor handlers correspondentes em `src/preload/preload.js` sem liberar acesso genérico ao Node.
- [ ] Processar FIIs sequencialmente; emitir progresso por ticker; permitir cancelamento antes do próximo fundo.
- [ ] Falha em um ticker não derruba os outros; erros específicos ficam em `fii_dividendos_sync.ultimo_erro`.

#### S3.2. Endpoint de importação e resync REST — 0,1 dia

- [ ] O `POST /api/proventos/historico/:ticker/importar` (já entregue no Sub-PR 1) é a porta de entrada do payload extraído.
- [ ] Adicionar `POST /api/proventos/historico/resync` que recebe `{ tickers?: string[] }`, normaliza (maiúsculas + dedup determinístico), valida `^[A-Z]{4}11$` para todos antes de qualquer navegação e reusa a mesma função de batch do IPC.
- [ ] Rejeitar body/ticker inválido com `400`, sem executar lote parcial silencioso.

#### S3.3. Testes de lote, falha parcial e orçamento — 0,15 dia

- [ ] Criar `src/__tests__/integration/api-scraper-historico.test.js`.
- [ ] Cobrir batch simulado com 17 FIIs e sucesso ≥95% no cenário nominal.
- [ ] Cobrir falha em um FII sem interromper os outros 16.
- [ ] Cobrar atualização parcial via `mergeHistorico`, zero, negativo e `null` preservado.
- [ ] Cobrir execução repetida/idempotente (RF-008).
- [ ] Cobrir body ausente, lista vazia, duplicatas, ticker minúsculo, inválido e ativo não-FII.
- [ ] Medir duração p95 do cenário de 17 FIIs com orçamento ≤300 s (meta PRD: ≤5 min, RF-002/KPI).
- [ ] Começar sequencialmente; somente se o orçamento falhar, considerar concorrência máxima de 4 workers, respeitando `robots.txt` e evitando rajadas.

#### S3.4. Documentação e fechamento — 0,1 dia

- [ ] Atualizar `README.md` com fluxo de sincronização e endpoints.
- [ ] Atualizar `CHANGELOG.md` com os três sub-PRs e schema 1.4.
- [ ] Revisar `SECURITY.md`; alterar somente se o novo endpoint ou a política de navegação introduzir informação que ainda não esteja documentada.
- [ ] Atualizar `docs/fii-features.md` marcando PRD 01 como entregue.
- [ ] Executar hook `doc-sync` antes do fechamento.

#### Critério de done do Sub-PR 3

- [ ] Batch processa FIIs ativos, isola falhas e devolve totais consistentes.
- [ ] `POST /api/proventos/historico/:ticker/importar` e `POST /api/proventos/historico/resync` validam lote antes de navegar.
- [ ] Rodar duas vezes não duplica ativos e não substitui valor válido por `NULL`.
- [ ] Cenário nominal atinge ≥95% de sucesso e ≤300 s para 17 FIIs.
- [ ] UI mostra progresso e permite cancelamento.
- [ ] `scraper-testing` verde nas fixtures e no batch.
- [ ] `electron-security-reviewer` sem findings ALTOS.
- [ ] `code-reviewer` sem findings ALTOS.
- [ ] README, CHANGELOG e `docs/fii-features.md` sincronizados.

## 5. Critérios de aceite por sub-PR

### Sub-PR 1

- [ ] Schema versionado de 1.3 para 1.4; migration executada uma vez, transacional e idempotente.
- [ ] Pré-validação obrigatória aborta a migration com erro legível quando há registros inválidos.
- [ ] Backup pré-DDL e restauração validados em banco 1.3 real/descaracterizado.
- [ ] `proventos` recriado com `competencia`, `precisao_data`, `status`, `fonte`, `origem_chave`, `AMORTIZACAO` e todos os CHECKs/UNIQUE; `fii_dividendos_sync` criada; índices criados.
- [ ] Nenhum registro, valor ou campo do PRD 12/02 perdido/alterado pela migration.
- [ ] Cálculo de DY mantém precisão e retorna `null` diante de denominador ausente/zero/negativo.
- [ ] Limites ±15% e dois meses consecutivos cobertos exatamente (RF-016/RF-017).
- [ ] Cadência `REGULAR`/`IRREGULAR` com 9+ meses pagantes como fronteira.
- [ ] `mergeHistorico` não apaga valor válido com `null` e preserva zero/negativo.
- [ ] Scraper cobre os três layouts (paginação numerada, "carregar mais", fim-de-rolagem) com fixtures.
- [ ] Ticker/URL/hostname validados antes da navegação.
- [ ] Endpoints `historico/:ticker`, `metricas/:ticker`, `sinais`, `historico/:ticker/importar` retornam envelope correto e 400/404/409/422/500 quando aplicável.
- [ ] `GET /api/proventos` legado usa `competencia` quando `data_pagto` é nulo e exclui `AGENDADO`/`AMORTIZACAO` de renda recorrente.
- [ ] `schema-reviewer` aprovado.

### Sub-PR 2

- [ ] Rota `#fii-historico/:ticker` com regex `^[A-Z]{4}11$`.
- [ ] KPIs, gráfico, tabela, lista de sinais e proveniência renderizam corretamente.
- [ ] Gráfico com um único eixo Y, recorrente sólido, sustentável tracejado, amortizações em losango.
- [ ] Marcadores e rótulos textuais para início/confirmação de corte/aumento.
- [ ] Toggles de período (12M/36M/5A/Tudo) e amortizações não refazem scraping.
- [ ] Tabela paginada em 100/página, filtros por tipo, formato `pt-BR`.
- [ ] Link "Histórico de dividendos" presente em Posições (RF-001).
- [ ] Badge por FII em Posições e resumo da carteira com contagem por estado (RF-023).
- [ ] Dashboard mostra no máximo um alerta `DIVIDENDOS_CORTE_CONFIRMADO` consolidado e não inclui posição com quantidade zero.
- [ ] Falha em `/api/proventos/sinais` ou `/api/proventos/metricas/:ticker` não derruba Posições nem Dashboard.
- [ ] Render de até 120 pontos em <500 ms após resposta.
- [ ] `electron-security-reviewer` e `code-reviewer` aprovados.

### Sub-PR 3

- [ ] Batch de 17 FIIs isola falha individual e mantém os sucessos.
- [ ] Resultado global contém totais e detalhes coerentes.
- [ ] Persistência parcial usa `mergeHistorico` em todos os caminhos.
- [ ] IPC `scraper:dividendos-historico(-todos|-cancelar|-progresso)` registrado e exposto em preload sem `nodeIntegration`.
- [ ] `POST /api/proventos/historico/resync` valida body e tickers antes da primeira URL.
- [ ] Idempotência comprovada em duas execuções (RF-008).
- [ ] Taxa de sucesso nominal ≥95% e p95 de 17 FIIs ≤300 s.
- [ ] `scraper-testing`, `electron-security-reviewer` e `code-reviewer` aprovados.
- [ ] Documentação sincronizada.

## 6. Riscos e mitigações

- **Risco:** Tabela "Dividendos" do I10 tem layouts diferentes (paginada, "carregar mais", expand inline).  
  **Mitigação:** parser multi-layout estilo PRD 12; detector de paginação; fixtures com pelo menos três layouts.

- **Risco:** Migração 1.4 falha em bancos com `proventos` malformados.  
  **Mitigação:** pré-validação obrigatória; backup pré-DDL; abortar com erro legível; orientar restauração.

- **Risco:** Sincronização 17 FIIs > 5 min.  
  **Mitigação:** medição p95 no smoke; sequencial por padrão; paralelização limitada (4 workers) preservando `robots.txt` se necessário.

- **Risco:** Amortizações gerarem falso aumento de DY.  
  **Mitigação:** `tipo='AMORTIZACAO'` é excluído das métricas realizadas (RF-007) e exige duas competências consecutivas para confirmar aumento (RF-017).

- **Risco:** Registro manual ser sobrescrito por import.  
  **Mitigação:** `mergeHistorico` + regra RF-009; conflito entra em `fii_dividendos_sync.registros_conflitantes` e é exibido no resumo da sincronização.

- **Risco:** Helper numérico converter `0` em `null` por fallback truthy.  
  **Mitigação:** parser distingue `Number.isFinite(0)` de falha; testes explícitos para `0,00%` e números negativos.

- **Risco:** UI depender apenas de cor para sinalizar estados.  
  **Mitigação:** rótulos textuais, formato de marcador distinto, ícone textual, `aria-describedby` e contraste AA.

- **Risco:** Modal de detalhe perder foco.  
  **Mitigação:** focus trap, retorno de foco, fechamento por Escape.

- **Risco:** Navegação construída com ticker hostil ou domínio semelhante.  
  **Mitigação:** regex estrita antes da URL, construção por API de URL, hostname exato e revisão do `electron-security-reviewer`.

- **Risco:** Sincronização apagar manualmente registros preexistentes.  
  **Mitigação:** `mergeHistorico`; `null` nunca apaga; zero/negativo preservados; testes explícitos de não regressão.

- **Risco:** Divergência entre cobertura completa (`cobertura_completa=1`) e DY sustentável.  
  **Mitigação:** regra determinística `cobertura_completa=false → confianca=INDISPONIVEL` com motivo `SINCRONIZACAO_INCOMPLETA` (RF-013/RF-014).

- **Risco:** Datas parciais (apenas mm/aaaa) induziremDY superestimado.  
  **Mitigação:** `precisao_data='MES'`, `data_pagto IS NULL`, UI mostra "mm/aaaa" e nunca inventa dia (RF-005).

- **Risco:** `proventos_v2` falhar em upgrade por conflito de chave.  
  **Mitigação:** `origem_chave='LEGADO:' || id` e teste explícito de unicidade pós-migration.

## 7. Plano de teste

### Suítes a estender

- `src/__tests__/db-migrations.test.js`
  - Fresh install em 1.4.
  - Upgrade de banco 1.3 com dados do PRD 12 e PRD 02.
  - Estrutura nova de `proventos` + `fii_dividendos_sync` + índices presentes.
  - `versao_schema=1.4`.
  - Aplicação repetida sem erro/duplicação.
  - Migration parcialmente aplicada recuperada por `PRAGMA table_info`.
  - Preservação de IDs, registros, valores e `updated_at` do PRD 12/02.
  - `integrity_check` e `foreign_key_check` verdes.
  - Pré-validação falhando aborta a migration com erro legível.

- `src/__tests__/integration/api-dashboard-alertas.test.js`
  - Regressão de alertas existentes.
  - Zero ou um item `DIVIDENDOS_CORTE_CONFIRMADO`.
  - Apenas FII ativo com quantidade positiva.
  - Lista de FIIs afetados com links validados.

- `src/__tests__/integration/api-proventos.test.js` (legado)
  - Usa `competencia` quando `data_pagto` é nulo.
  - Exclui `AGENDADO` e `AMORTIZACAO` dos cálculos de renda recorrente.

- Suíte existente do router em `src/__tests__/renderer/`
  - Hash `#fii-historico/:ticker` válido.
  - Query inválida sanitizada/ignorada.
  - Regressão de `#fii/:ticker`, `#posicoes` e ticker hostil.

### Suítes novas

- `src/__tests__/shared/dividendos-hist.test.js`
  - Happy path de DY realizado 12M e DY sustentável.
  - Precisão sem arredondamento prematuro.
  - `null`, `undefined`, `NaN`, zero, negativos e divisão por zero.
  - Limites exatos ±15% e dois meses consecutivos.
  - Cadência `REGULAR`/`IRREGULAR` com 9+ meses pagantes como fronteira.
  - `classificarEstado` agrega sinais + cadência + proveniência.
  - `mergeHistorico` imutável, atualização parcial, zero/negativo válidos e `null` preservado.
  - `gerarChaveOrigem` determinística para duas linhas idênticas (RF §5).

- `src/__tests__/shared/scraper-historico.test.js`
  - KNIP11 mensal puro.
  - XPML11 mensal + amortização semestral.
  - MXRF11 sem histórico (papel vazio).
  - HGLG11 com "carregar mais".
  - Paginação numerada, "carregar mais" e fim-de-rolagem.
  - Competência mm/aaaa → `precisao_data='MES'`, `data_pagto IS NULL`.
  - Valor zero/negativo/NaN rejeitado e contabilizado como ignorado.
  - Duas linhas idênticas recebem ordens distintas em `origem_chave`.
  - Cobertura ≥95% dos campos presentes nas fixtures.
  - Ticker/URL/hostname validados antes da navegação.

- `src/__tests__/integration/api-proventos-historico.test.js`
  - `GET /api/proventos/historico/:ticker` paginado, filtros, ordenação e 400/404.
  - `GET /api/proventos/metricas/:ticker` com 200 + `null` + `qualidade_dados.motivos` para casos insuficientes.
  - `GET /api/proventos/sinais` com filtros e contagens.
  - `POST /api/proventos/historico/:ticker/importar` com payload válido, conflito, reentrância (409) e inconsistência (422).
  - `GET /api/proventos` legado cobrindo `competencia` quando `data_pagto IS NULL` e exclusão de `AGENDADO`/`AMORTIZACAO`.
  - p95 ≤200 ms para 20 FIIs e 10 anos de registros.

- `src/__tests__/renderer/pages-fii-historico.test.js`
  - Render de KPIs, gráfico, tabela, lista de sinais e proveniência.
  - Estados: loading, success, success desatualizado, vazio, parcial, sem cotação, sem histórico, error fonte, error local.
  - Toggles de período e amortizações sem refazer scraping.
  - Marcadores textuais para corte/aumento.
  - Tabela paginada em 100/página e filtros por tipo.
  - A11y: `aria-describedby`, `aria-live`, foco no título, focus trap, Escape, `prefers-reduced-motion`.
  - Render de 120 pontos em <500 ms (medido com mock do Chart.js).

- `src/__tests__/renderer/posicoes-dividendos.test.js`
  - Link "Histórico de dividendos" por FII (RF-001).
  - Badge por FII com último estado conhecido (RF-023).
  - Resumo da carteira com contagens por estado.
  - Falha isolada não derruba Posições.

- `src/__tests__/renderer/dashboard-dividendos.test.js`
  - Alerta `DIVIDENDOS_CORTE_CONFIRMADO` (presença/ausência).
  - Apenas FII ativo com quantidade > 0.
  - Lista de links por ticker e contagens.
  - `renderSequence` impede render tardio.

- `src/__tests__/integration/api-scraper-historico.test.js`
  - Batch de 17 FIIs.
  - Uma falha não derruba os demais.
  - Merge parcial e preservação do banco.
  - Idempotência em duas execuções.
  - Contrato global/por ticker.
  - `POST /api/proventos/historico/:ticker/importar` e `POST /api/proventos/historico/resync` com todos, subconjunto, minúsculas, duplicatas, vazio e inválidos.
  - Nenhuma navegação quando a validação do lote falha.

- `src/__tests__/performance/dividendos-hist-performance.test.js`
  - p95 de `GET /historico/:ticker` e `GET /metricas/:ticker` para 20 FIIs e 10 anos ≤200 ms.
  - Render de 120 pontos no gráfico ≤500 ms após resposta.
  - Orçamento do batch de 17 FIIs ≤300 s.

### Fixtures exatas a estender

- `src/__tests__/fixtures/i10/knip11.html`: layout mensal puro, ≥24 competências.
- `src/__tests__/fixtures/i10/xpml11.html`: mensal + amortização semestral.
- `src/__tests__/fixtures/i10/mxrf11.html`: papel vazio (sem histórico) e parcialmente carregado.
- `src/__tests__/fixtures/i10/hglg11.html`: paginação "carregar mais".
- (Opcional) `src/__tests__/fixtures/i10/hglg11-mes-ano.html`: variante onde apenas mês/ano é disponibilizado.

### Smokes e regressão

- `scripts/test-migrations-smoke.js`: incluir schema 1.4, idempotência, pré-validação e `foreign_key_check`.
- `scripts/smoke-migration-real.js`: migrar cópia de banco 1.3, comparar antes/depois e validar restauração do backup.
- `scripts/smoke-api-endpoints.js`: preservar cenários do PRD 12/02 e acrescentar `historico/:ticker`, `metricas/:ticker`, `sinais`, `importar`, `resync`, reentrância (409), ticker inválido (400), FII não encontrado (404), payload inconsistente (422).
- `scripts/smoke-prd01-performance.js`: medir API, render sintético e batch de 17 FIIs sem telemetria remota.
- `npm test`: suíte integral, incluindo regressão do PRD 12 e PRD 02.
- `npm run test:coverage`: meta ≥95% nos arquivos novos e 100% dos cenários críticos de cálculo, parser, classificação, API, lote, falha parcial e idempotência.

## 8. Atomic commits

1. `feat(fii): sub-PR 1 do PRD 01 — schema 1.4 (recriação proventos + AMORTIZACAO) + lógica pura + scraper I10 + endpoints REST`
2. `feat(fii): sub-PR 2 do PRD 01 — rota #fii-historico/:ticker com Chart.js + tabela paginada + badges em Posições + alerta no Dashboard`
3. `feat(fii): sub-PR 3 do PRD 01 — IPC scraper:dividendos-historico(-todos|-cancelar|-progresso) + endpoint /api/proventos/historico/resync + performance smoke 17 FIIs`

Regras para cada commit:

- [ ] Começar por testes Red e terminar com a suíte relevante verde.
- [ ] Não misturar mudanças de outro sub-PR, exceto ajustes mínimos de integração documentados.
- [ ] Rodar os gates correspondentes antes de considerar o commit pronto.
- [ ] Incluir documentação no terceiro commit após `doc-sync`.
- [ ] Não fazer push ou abrir PR sem solicitação explícita do usuário.

## 9. Ordem de execução

1. **Preparação**
   - Criar `feat/prd-01-historico-dividendos` a partir de `master` limpo.
   - Confirmar a decisão de classificação da seção 3.4-a (seis estados + `SEM_HISTORICO` vs `INSUFICIENTE` único).
   - Preparar banco descartável 1.3 e baseline das fixtures.

2. **Sub-PR 1 — backend**
   - S1.1 migration e schemas.
   - Gate imediato `schema-reviewer`; se reprovar, voltar a S1.1.
   - S1.2 lógica pura.
   - S1.3 scraper/fixtures.
   - S1.4 persistência.
   - S1.5 API/smoke.
   - Gate `electron-security-reviewer` para main/server.
   - Corrigir qualquer finding ALTO na etapa de origem antes do commit.

3. **Sub-PR 2 — UI**
   - Pode começar após estabilização do envelope da API.
   - S2.1 módulo UI/CSS.
   - S2.2 rota `#fii-historico/:ticker`.
   - S2.3 Posições.
   - S2.4 Dashboard.
   - Gates `electron-security-reviewer` e `code-reviewer`; finding ALTO volta à etapa correspondente.

4. **Sub-PR 3 — IPC/lote/resync**
   - Executar depois do Sub-PR 1; pode ocorrer em paralelo ao Sub-PR 2.
   - S3.1 IPC.
   - S3.2 endpoint.
   - S3.3 testes/KPIs.
   - S3.4 docs.
   - Gates `scraper-testing`, `electron-security-reviewer` e `code-reviewer`.

5. **Fechamento cruzado**
   - Rodar suite integral, coverage e todos os smokes.
   - Executar `doc-sync`.
   - Repetir `schema-reviewer` se qualquer ajuste final tocar `db/init.sql` ou `src/server/db.js`.
   - Repetir revisores de segurança/código nos deltas finais.
   - Parar e consultar o usuário se surgir nova ambiguidade de escopo.

## 10. Done quando

- [ ] Todos os critérios de aceite das seções 4 e 5 estão fechados.
- [ ] Schema 1.4 funciona em fresh install, fallback e upgrade de banco 1.3.
- [ ] Migration preserva IDs, dados e `updated_at` do PRD 12/02; `versao_schema='1.4'`.
- [ ] Pré-validação aborta a migration com erro legível em bancos inválidos.
- [ ] `fonte='LEGADO'` aplicada com `origem_chave='LEGADO:' || id`.
- [ ] Lógica pura cobre ±15%, dois meses consecutivos, cadência 9+ eDY sustentável com confiança ALTA/MEDIA/INDISPONIVEL.
- [ ] Scraper cobre três layouts e gera `origem_chave` determinística para linhas idênticas.
- [ ] Endpoints `historico/:ticker`, `metricas/:ticker`, `sinais`, `importar`, `resync` validam FII e mantêm dados locais.
- [ ] Rota `#fii-historico/:ticker` renderiza KPIs, gráfico, tabela, sinais e proveniência com WCAG AA.
- [ ] Link "Histórico de dividendos" e badges em Posições; resumo da carteira presente.
- [ ] Dashboard mostra no máximo um alerta consolidado e não inclui posição zerada.
- [ ] Falha em um FII não derruba o batch; resultado por ticker é legível e idempotente.
- [ ] Taxa nominal de sucesso ≥95% e cobertura de campos nas fixtures ≥95%.
- [ ] p95 API ≤200 ms, render de 120 pontos ≤500 ms e batch de 17 FIIs ≤300 s.
- [ ] `npm test` verde.
- [ ] `npm run test:coverage` com ≥95% nos arquivos novos e cobertura integral dos cenários críticos.
- [ ] Smokes de migration, API e performance verdes.
- [ ] README, CHANGELOG, `SECURITY.md` e `docs/fii-features.md` sincronizados.
- [ ] `schema-reviewer`, `electron-security-reviewer`, `code-reviewer` e `scraper-testing` aprovados sem findings ALTOS.
- [ ] Três atomic commits usam exatamente os sufixos definidos na seção 8.
- [ ] Nenhum item fora de escopo foi incorporado silenciosamente.

## A. Decisões abertas que precisam de confirmação antes da execução

1. **3.4-a — Conjunto de estados de dividendo na UI:** manter **seis** estados (ESTAVEL, EM_OBSERVACAO, CORTE_CONFIRMADO, AUMENTO_CONFIRMADO, INSUFICIENTE, DESATUALIZADO) mais `SEM_HISTORICO` como fallback neutro, ou consolidar em `INSUFICIENTE` único? Padrão proposto: **seis + `SEM_HISTORICO`** (alinha com PRD §7 "Estados da interface").
2. **3.2 — Migração de registros manuais pré-existentes:** todos viram `fonte='LEGADO'` (leitura literal do PRD §5) ou registros com `tipo IS NULL`/data futura viram `fonte='MANUAL'`? Padrão proposto: **`LEGADO` para todos os atuais** (preserva proveniência histórica e evita classificação indevida).
3. **Dashboard — alerta único `DIVIDENDOS_CORTE_CONFIRMADO`:** vale cobrir também `AUMENTO_CONFIRMADO` no mesmo alerta ou manter escopo apenas em cortes (alinhado com PRD §7)? Padrão proposto: **cortes + aumentos no mesmo alerta** (a UI destaca a direção).
4. **`POST /api/proventos/historico/:ticker/importar` — `409 SINCRONIZACAO_EM_ANDAMENTO`:** manter o bloqueio estrito de reentrância (recomendado pelo PRD §6) ou liberar fila por ticker? Padrão proposto: **bloqueio estrito** com mensagem clara.
5. **Paralelização do batch 17 FIIs:** começar sequencial e só paralelizar se a medição inicial exceder 5 min (recomendado)? Padrão proposto: **sim, sequencial por padrão, 4 workers no máximo**.

Após a confirmação (ou veto) destes cinco pontos, o plano está pronto para iniciar o Sub-PR 1.