# Plan: PRD 02 — DY médio de 5 anos e rentabilidade real

**Source PRD:** `docs/prds/02-dy-medio-5anos-rentabilidade.md`  
**Referência de roadmap:** `docs/fii-features.md`, §2.2 e §7  
**Branch alvo:** `feat/prd-02-indicadores-historicos`  
**Branch no momento do planejamento:** `master` — pré-condição ainda não atendida  
**Esforço estimado total:** 5 dias úteis  
**Estratégia de entrega:** 3 sub-PRs, seguindo a granularidade e os gates usados no PRD 12  
**Estado:** aguardando aprovação; nenhuma implementação deve começar antes da confirmação das decisões abertas ao fim da seção 3

## 1. Resumo executivo

Ao fim do PRD 02, o byeINSS terá schema 1.3 capaz de armazenar o DY médio de cinco anos e seis rentabilidades históricas dos FIIs, coleta resiliente desses dados no Investidor10, APIs locais de consulta e ressincronização, comparação pura entre DY 12M e histórico, duas novas superfícies em Posições e um alerta consolidado no Dashboard, com preservação dos últimos valores válidos quando a fonte falhar. Esta é a próxima escolha do roadmap porque materializa a **Fase 1 — Fundamentos baratos** de `docs/fii-features.md` §7 e atende diretamente a feature classificada como **CRÍTICA** no §2.2: dar contexto histórico ao DY atual e separar retorno nominal de ganho real antes de avançar para análises derivadas como score Buy & Hold e radar de DY.

## 2. Dependências e pré-condições

### Pré-condições já verificadas

- [x] PRD 12 concluído em três sub-PRs.
- [x] Schema atual em `1.2`, com framework `schema_migrations`, backup pré-DDL e migration versionada em `src/server/db.js`.
- [x] Scraper base disponível em `src/main/scraper.js`, incluindo `extractFIIDetalhes` e `extractAllFIIDetalhes`.
- [x] Canal IPC `scraper:enriquecer-todos` já registrado em `src/main/main.js` e exposto em `src/preload/preload.js`.
- [x] `db/init.sql` e `FALLBACK_SCHEMA_INLINE` estão sincronizados para o schema 1.2 do PRD 12.
- [x] Segurança base do Electron preservada: `nodeIntegration: false`, `contextIsolation: true` e partição `persist:investidor10`.
- [x] Padrões de referência existentes: `src/shared/contratos.js`, `src/shared/scraper-contratos.js`, smoke tests de migration/API e fixtures I10 do PRD 12.

### Pré-condições ainda pendentes

- [ ] Criar ou mudar para a branch `feat/prd-02-indicadores-historicos`; não implementar em `master`.
- [ ] Aprovar este plano e a decisão de classificação descrita na seção 3.
- [ ] Preparar uma cópia descartável de banco real em schema 1.2 para o smoke de migration 1.2 → 1.3.
- [ ] Confirmar que as fixtures existentes do PRD 12 continuam representando ao menos dois layouts válidos da página I10 antes de complementá-las.

### Componentes que ainda não existem ou precisam ser estendidos

- [ ] Criar `src/shared/indicadores.js` para cálculo, classificação e merge sem Electron, Express ou SQLite.
- [ ] Adicionar sete indicadores e duas metainformações — nove colunas físicas no total — em `ativos`.
- [ ] Criar os parsers `parseDyMedio5a` e `parseRentabilidades` e integrá-los a `extractFIIDetalhes`.
- [ ] Criar `src/server/routes/indicadores.js` e montá-lo em `src/server/index.js`.
- [ ] Estender `/api/dashboard/alertas` sem quebrar o formato de array já consumido pelo renderer.
- [ ] Criar uma camada testável de UI em `src/renderer/js/indicadores-ui.js` e integrá-la a `pages.js`.
- [ ] Estender o resultado do enriquecimento em lote e criar o resync REST.
- [ ] Criar/estender as suítes, fixtures e smokes detalhados na seção 7.

### Dependências entre entregas

- Sub-PR 1 bloqueia Sub-PRs 2 e 3 porque define schema, funções puras, persistência e contrato da API.
- Sub-PR 2 pode começar após o contrato da API do Sub-PR 1 estar estabilizado; pode usar mock enquanto o Sub-PR 3 é executado.
- Sub-PR 3 depende de `mergeIndicadores` e dos parsers entregues no Sub-PR 1.
- Alterações em `db/init.sql` ou `src/server/db.js` não podem ser integradas sem gate do `schema-reviewer`.
- Alterações em `src/main`, `src/server` ou `src/renderer` não podem ser integradas sem gate do `electron-security-reviewer`.

## 3. Decisões de arquitetura mínimas

### 3.1. Schema 1.2 → 1.3

- O PRD original descreve 1.1 → 1.2, mas o PRD 12 já consumiu a versão 1.2; esta entrega será uma migration monotônica `1.3`.
- A migration adicionará **sete indicadores nullable**:
  - `dy_medio_5a`
  - `rentab_nominal_1a`
  - `rentab_nominal_2a`
  - `rentab_nominal_5a`
  - `rentab_real_1a`
  - `rentab_real_2a`
  - `rentab_real_5a`
- Também adicionará **duas metainformações nullable**:
  - `dy_medio_5a_fonte`
  - `dy_medio_5a_atualizado_em`
- Portanto, a alteração tem nove colunas físicas, embora o domínio funcional continue sendo descrito como “sete novos indicadores”.
- Os nomes curtos `rentab_*` do briefing de implementação serão os nomes canônicos de banco e API. Eles substituem, para esta execução, os nomes longos `rentabilidade_*` ainda presentes no texto original do PRD.
- Não haverá backfill aproximado; registros existentes permanecerão `NULL` até nova coleta.
- `updated_at` dos registros existentes não será tocado pela migration.
- Reversão operacional será por restauração do backup criado antes do DDL, seguindo o padrão do PRD 12; o smoke deve provar restauração e integridade, não depender de `DROP COLUMN`.

### 3.2. Lógica pura em `src/shared/indicadores.js`

- O módulo não importará Electron, Express, `better-sqlite3` ou relógio global.
- Espelhará a separação de responsabilidades de `src/shared/contratos.js`.
- Contratos públicos planejados:
  - `calcularDyVs5a(dy_12m, dy_medio_5a)`: devolve percentual sem arredondamento de apresentação; devolve `null` se `dy_12m` não for finito ou se `dy_medio_5a` não for finito ou for menor/igual a zero.
  - `classificarDyVs5a(pct)`: devolve classificação posicional e nível visual, conforme a decisão 3.6.
  - `mergeIndicadores(prev, novo)`: considera somente a whitelist dos sete indicadores; substitui um campo apenas quando `novo[campo] != null`; preserva zero e valores negativos; não muta os objetos recebidos.
- Data/hora de persistência será injetada pela camada de persistência/teste. O módulo puro não chamará `new Date()`.

### 3.3. Persistência sem “null apaga valor”

- O parser representa ausência ou erro de parsing como `null`; ele não acessa estado anterior.
- `mergeIndicadores` será aplicado na fronteira de persistência de `extractAllFIIDetalhes` e do endpoint de resync, antes do `UPDATE` preparado.
- Apenas campos válidos entram no `UPDATE`; zero e negativos contam como válidos.
- Se nenhum dos sete indicadores for válido, o ticker será uma falha legível e nenhum timestamp será alterado.
- `ativos.updated_at` será alterado somente quando pelo menos um indicador válido for efetivamente aceito para persistência.
- `dy_medio_5a_fonte` e `dy_medio_5a_atualizado_em` só serão atualizados quando `dy_medio_5a` válido for persistido; sucesso apenas nas rentabilidades não inventa metadado de DY.
- `campos_atualizados` conterá somente campos válidos aceitos; o teste de idempotência verificará que uma segunda execução não cria ativo, não converte valor válido em `NULL` e não piora a cobertura.

### 3.4. Scraper e fronteira de segurança

- `parseDyMedio5a(html)` e `parseRentabilidades(html)` serão funções determinísticas e exportáveis para testes, mesmo permanecendo integradas a `src/main/scraper.js`.
- `extractFIIDetalhes` continuará orquestrando a navegação Electron e agregará o resultado dos parsers ao payload existente.
- Seletores serão semânticos e multi-layout: rótulos do box “Rendimento”, caption/título da tabela, cabeçalhos `Nominal`/`Real` e rótulos normalizados de período; índices fixos de coluna não serão usados.
- Antes de montar ou navegar para qualquer URL, o ticker será normalizado e validado por `^[A-Z]{4}11$`.
- A URL será construída por API de URL e o hostname permitido será exatamente `investidor10.com.br` ou subdomínio explicitamente autorizado; verificações por simples `includes` não serão usadas na nova lógica.
- O wait do DOM aguardará especificamente o box/tabela necessários até timeout controlado, sem registrar HTML completo, cookies ou credenciais.

### 3.5. Contrato das APIs novas

- Endpoints de indicadores usarão o envelope comum:
  - lista: `{ data: [...], meta: { schema: '1.3', total, avaliados, sem_dados } }`;
  - detalhe: `{ data: {...}, meta: { schema: '1.3', total: 1 } }`.
- `GET /api/fiis/indicadores` aceitará os filtros e ordenação do PRD: `ativo_only`, status/classificação, `sort=dy_vs_5a_pct` e `order=asc|desc`, com `400` para valores inválidos.
- `GET /api/fiis/indicadores/:ticker` validará o ticker estritamente e retornará `404` quando o ativo não existir ou não for `tipo='FII'`.
- Statements usarão parâmetros preparados; nomes dinâmicos de ordenação serão selecionados por whitelist.
- A rota estática `/resync` será registrada antes de `/:ticker` para não ser interpretada como ticker.
- O servidor continuará vinculado somente a `127.0.0.1`.

### 3.6. Classificação de domínio e cores

Há uma divergência entre o resumo executivo solicitado, o PRD original e a regra visual pedida. Para não ocultá-la, o plano propõe dois eixos explícitos:

- `classificacao` descreve a posição contra a média:
  - `EM_LINHA`: 95% a 105%, inclusive;
  - `ABAIXO`: menor que 95%;
  - `ACIMA`: maior que 105%;
  - `SEM_DADOS`: cálculo indisponível.
- `status_dy_historico`/`nivel` descreve severidade visual:
  - `CONSISTENTE`/verde: 95% a 105%, inclusive;
  - `ATENCAO`/amarelo: 80% a menor que 95%, ou maior que 105% até 125%;
  - `CRITICO`/vermelho: menor que 80%, ou maior que 125%;
  - `SEM_DADOS`: cálculo indisponível.
- Limites exatos: 80% é `ATENCAO`; 95% e 105% são `EM_LINHA`/`CONSISTENTE`; 125% ainda é `ATENCAO`; apenas acima de 125% é `CRITICO`.
- O Dashboard deste PRD alertará **somente desvios abaixo de 95%**, preservando como out of scope o radar de DY acima do histórico. A coloração alta em Posições é informativa e não dispara recomendação nem alerta global.
- O tooltip explicará a fórmula `DY 12M ÷ DY médio 5a × 100` e mostrará os dois valores-base.
- Esta proposta precisa ser confirmada na aprovação do plano antes de S1.2, pois o PRD original usa `CONSISTENTE/ATENCAO/CRITICO` como classificação única, enquanto o briefing atual exige também `EM_LINHA/ABAIXO/ACIMA`.

### 3.7. Integração com alertas do Dashboard

- Escolha: **reusar `GET /api/dashboard/alertas`**, mantendo a paridade com o PRD 12 e evitando um novo endpoint de Dashboard.
- Como a rota atual retorna um array, será acrescentado no máximo um item opcional com `tipo: 'DY_HISTORICO_BAIXO'`, contagens de afetados/críticos/avaliados/sem dados e a lista de FIIs afetados.
- O formato de array existente será preservado para não quebrar alertas de preço-teto, concentração e DY alto.
- O drill-down será feito para `#posicoes` com query no hash, status abaixo da média e ordenação crescente por `dy_vs_5a_pct`; `src/renderer/js/router.js` será estendido para preservar e validar esses filtros.
- Falha no cálculo do novo alerta não removerá os demais alertas do Dashboard e será tratada no renderer sem derrubar a página.

### 3.8. FIIs com menos de cinco anos

- Sem `dy_medio_5a`, o estado será `SEM_DADOS`, sem comparação e sem alerta global.
- A UI usará “— (histórico de 5 anos indisponível)” como fallback seguro.
- O texto “— (listado em YYYY)” só será usado se o ano de listagem estiver disponível em dado já confiável no payload. Não será criada uma coluna `data_listagem` fora do schema aprovado apenas para preencher esse texto.

## 4. Sub-PRs

### Sub-PR 1 — Backend, schema, lógica pura, scraper e API

**Esforço:** 2,5 dias  
**Skills:** `schema-migration`, `tdd-workflow`, `test-author`, `scraper-testing`  
**Agents/gates:** `test-author`, `schema-reviewer`; `electron-security-reviewer` obrigatório para os deltas em `src/main` e `src/server`  
**Bloqueado por:** branch criada, plano aprovado e decisão 3.6 confirmada  
**Bloqueia:** Sub-PRs 2 e 3

#### S1.1. Migration 1.2 → 1.3 e schemas sincronizados — 0,5 dia

- [ ] Escrever primeiro os testes Red em `src/__tests__/db-migrations.test.js` para schema novo, banco 1.2 realista, preservação e idempotência.
- [ ] Adicionar migration imutável `1.3` ao array `MIGRATIONS` de `src/server/db.js`.
- [ ] Verificar `PRAGMA table_info(ativos)` antes de cada `ALTER TABLE`, suportando recuperação de aplicação parcial.
- [ ] Adicionar os sete indicadores e as duas metainformações nullable.
- [ ] Atualizar `config.versao_schema` para `1.3` dentro da mesma transação da migration.
- [ ] Manter backup obrigatório antes do DDL e validar restauração como rollback operacional.
- [ ] Atualizar `db/init.sql` para instalações novas.
- [ ] Atualizar `FALLBACK_SCHEMA_INLINE` em `src/server/db.js` com as mesmas colunas e versão.
- [ ] Provar que registros e valores do PRD 12 permanecem intactos e que `updated_at` não muda durante a migration.
- [ ] Estender `scripts/test-migrations-smoke.js` e `scripts/smoke-migration-real.js` para 1.2 → 1.3.

#### S1.2. Lógica pura de indicadores — 0,5 dia

- [ ] Criar `src/shared/indicadores.js` com `calcularDyVs5a`, `classificarDyVs5a` e `mergeIndicadores`.
- [ ] Centralizar a whitelist dos sete campos para impedir merge/persistência de propriedades arbitrárias.
- [ ] Manter precisão completa no cálculo; arredondar apenas na camada de apresentação.
- [ ] Cobrir `null`, `undefined`, `NaN`, zero, negativos, denominador zero e limites 80/95/105/125.
- [ ] Provar que `mergeIndicadores` preserva o valor anterior diante de `null`, mas aceita `0` e número negativo.
- [ ] Criar `src/__tests__/shared/indicadores.test.js` em ciclo Red → Green → Refactor.

#### S1.3. Parsers I10 e fixtures — 0,75 dia

- [ ] Criar/exportar `parseDyMedio5a(html)` e `parseRentabilidades(html)` de forma isoladamente testável.
- [ ] Estender `extractFIIDetalhes` para agregar `dy_medio_5a` e as seis rentabilidades.
- [ ] Normalizar acentos, caixa e espaços dos rótulos sem confundir `1 ano` com `1 mês`.
- [ ] Reconhecer `1a`/`1 ano`/`12 meses`, `2a`/`2 anos`/`24 meses` e `5a`/`5 anos`/`60 meses`.
- [ ] Mapear `Nominal` e `Real` pelo cabeçalho, independentemente da ordem visual.
- [ ] Converter percentuais brasileiros para pontos percentuais, incluindo `1.234,56%`, negativos e zero.
- [ ] Não recalcular IPCA, anualizar ou compor os valores informados pela fonte.
- [ ] Estender as fixtures existentes `hglg11.html`, `knip11.html`, `xpml11.html` e `mxrf11.html` em `src/__tests__/fixtures/i10/`.
- [ ] Representar ao menos: layout padrão, colunas invertidas, rótulos longos, valores negativos, zero e FII sem histórico de cinco anos.
- [ ] Cobrir página parcialmente carregada, tabela ausente, conteúdo inválido e extração parcial.
- [ ] Criar `src/__tests__/shared/scraper-indicadores.test.js` usando jsdom/fixtures.
- [ ] Validar ticker antes da URL e hostname antes da navegação; manter `nodeIntegration` desligado e `contextIsolation` ligado.

#### S1.4. Persistência segura no enriquecimento — 0,375 dia

- [ ] Ler os sete valores atuais antes do merge.
- [ ] Aplicar `mergeIndicadores` antes do `UPDATE` preparado.
- [ ] Persistir individualmente os campos válidos; `null` não apaga valor anterior.
- [ ] Atualizar `updated_at` somente quando houver indicador válido aceito.
- [ ] Atualizar fonte/data do DY somente quando houver `dy_medio_5a` válido.
- [ ] Marcar ticker como falha se nenhum indicador novo puder ser extraído.
- [ ] Preservar sucesso parcial quando apenas alguns períodos estiverem disponíveis.
- [ ] Testar idempotência, atualização parcial e não regressão dos campos do PRD 12.

#### S1.5. Endpoints REST e smoke API — 0,375 dia

- [ ] Criar `src/server/routes/indicadores.js`.
- [ ] Montar o router em `src/server/index.js` sob `/api/fiis/indicadores`.
- [ ] Implementar `GET /api/fiis/indicadores` com os sete campos, `dy_12m`, percentual, classificação, status visual, metadados e filtros.
- [ ] Implementar `GET /api/fiis/indicadores/:ticker`, restrito a `tipo='FII'`.
- [ ] Retornar `400` para ticker/query inválidos, `404` para ausente/não-FII e erro local sanitizado para falha de banco.
- [ ] Usar envelope `{ data, meta }`, schema `1.3` e totais de cobertura.
- [ ] Criar `src/__tests__/integration/api-indicadores.test.js`.
- [ ] Estender `scripts/smoke-api-endpoints.js` sem remover os cenários do PRD 12.
- [ ] Medir p95 para até 500 ativos e registrar falha se exceder 200 ms no smoke de performance.

#### Critério de done do Sub-PR 1

- [ ] Migration 1.2 → 1.3 idempotente e recuperável por backup, testada em banco 1.2 real/descaracterizado.
- [ ] Fresh install, fallback inline e banco migrado expõem as mesmas nove novas colunas.
- [ ] `config.versao_schema = '1.3'` e dados preexistentes preservados integralmente.
- [ ] Cenários críticos de cálculo, merge, parser, persistência e API cobertos.
- [ ] Cobertura dos campos presentes nas fixtures ≥95%.
- [ ] p95 dos endpoints de leitura ≤200 ms para até 500 ativos.
- [ ] Smoke de migration e API verde.
- [ ] `schema-reviewer` sem findings ALTOS.
- [ ] `electron-security-reviewer` sem findings ALTOS nos arquivos main/server alterados.

### Sub-PR 2 — UI de Posições e alerta histórico no Dashboard

**Esforço:** 1,5 dia  
**Skills:** `tdd-workflow`, `test-author`  
**Agents/gates:** `test-author`, `electron-security-reviewer`, `code-reviewer`  
**Bloqueado por:** contrato de API e classificações do Sub-PR 1  
**Pode rodar em paralelo com:** Sub-PR 3, usando mock do envelope da API

#### S2.1. Camada UI testável e integração HTML/CSS — 0,25 dia

- [ ] Criar `src/renderer/js/indicadores-ui.js`, seguindo o padrão isolável de `contratos-ui.js`.
- [ ] Carregar o módulo em `src/renderer/index.html` antes de `pages.js`.
- [ ] Adicionar estilos em `src/renderer/css/styles.css`, usando variáveis existentes e contraste WCAG 2.1 AA.
- [ ] Construir DOM com `textContent`/elementos seguros para conteúdo variável, sem interpolar dados não confiáveis como markup.

#### S2.2. Posições: colunas, filtro, ordenação e detalhe — 0,625 dia

- [ ] Fazer `renderPosicoes` consultar `/api/fiis/indicadores` em paralelo com dados existentes e tratar falha isoladamente.
- [ ] Adicionar a coluna “DY vs 5y” com percentual, texto de estado, chip e tooltip/fórmula.
- [ ] Adicionar a coluna “Rent. real 12M”, mapeada para `rentab_real_1a`, com formatação `pt-BR` e sinal explícito.
- [ ] Manter a feature exclusiva para linhas `tipo='FII'`; outros ativos exibem estado não aplicável.
- [ ] Exibir verde para em linha, amarelo para atenção e vermelho para crítico, sem depender somente da cor.
- [ ] Exibir `0,00%` para zero e preservar o sinal em valores negativos.
- [ ] Exibir “—” com rótulo explícito para sem histórico/listado recentemente.
- [ ] Implementar filtro por `CONSISTENTE`, `ATENCAO`, `CRITICO` e `SEM_DADOS`, além do atalho combinado vindo do Dashboard.
- [ ] Implementar ordenação numérica por `dy_vs_5a_pct` e `rentab_real_1a`, mantendo `SEM_DADOS` em posição determinística.
- [ ] Estender `src/renderer/js/router.js` para parsear e validar query do hash de Posições sem comprometer `#fii/:ticker`.
- [ ] Implementar controle acessível de detalhe com matriz Nominal × Real para 1, 2 e 5 anos.
- [ ] Abrir detalhe por clique, Enter ou Espaço; fechar por Escape; prender e restaurar foco.
- [ ] Garantir tabela semântica, caption, cabeçalhos com `scope`, rolagem horizontal e links de ticker com `aria-label` próprio.

#### S2.3. Dashboard e alertas existentes — 0,375 dia

- [ ] Estender `GET /api/dashboard/alertas` com no máximo um item `DY_HISTORICO_BAIXO`.
- [ ] Considerar apenas FIIs ativos com quantidade consolidada maior que zero.
- [ ] Gerar alerta somente para relações abaixo de 95%; `CRITICO` quando houver ao menos um caso abaixo de 80%, senão `ATENCAO`.
- [ ] Incluir total afetado, total crítico, avaliados e sem dados.
- [ ] Quando nenhum FII for avaliável, apresentar estado informativo “Indicadores históricos ainda não disponíveis”, sem afirmar ausência de desvios.
- [ ] Listar FIIs afetados com links validados para `#fii/:ticker` e ação “Ver FIIs” para Posições filtrada/ordenada.
- [ ] Respeitar `dashboardRenderSequence` antes de alterar o DOM.
- [ ] Isolar falha do novo alerta para não derrubar KPIs, gráficos ou alertas existentes.
- [ ] Usar região de status persistente, sem anúncio urgente repetido a cada render.

#### S2.4. Estados, atualização parcial e testes UI — 0,25 dia

- [ ] Cobrir loading, success, success parcial, vazio, sem dados, erro da API e cache offline.
- [ ] Manter últimos valores válidos visíveis durante nova coleta.
- [ ] Manter o toast existente com `role="status"` e `aria-live="polite"`.
- [ ] Criar `src/__tests__/renderer/posicoes-indicadores.test.js`.
- [ ] Criar `src/__tests__/renderer/dashboard-indicadores.test.js`.
- [ ] Estender a suíte do router para filtros de hash e regressão de `#fii/:ticker`.
- [ ] Medir render de 50 FIIs e falhar acima de 500 ms no ambiente de benchmark definido.

#### Critério de done do Sub-PR 2

- [ ] Posições exibe as duas novas colunas somente onde aplicável.
- [ ] Chips, textos, tooltips e estados são consistentes com o padrão visual do PRD 12 sub-PR 2.
- [ ] Filtros, ordenação e drill-down do Dashboard funcionam por hash.
- [ ] Matriz 1a/2a/5a é operável por teclado, fecha com Escape e restaura foco.
- [ ] Dashboard mostra no máximo um alerta consolidado e não inclui posição com quantidade zero.
- [ ] Falha no endpoint de indicadores não derruba Posições nem Dashboard.
- [ ] Render de 50 FIIs ≤500 ms no benchmark definido.
- [ ] Testes Vitest + jsdom verdes.
- [ ] `electron-security-reviewer` sem findings ALTOS.
- [ ] `code-reviewer` sem findings ALTOS.

### Sub-PR 3 — Enriquecimento em lote e endpoint de resync

**Decisão de escopo:** cabe no PRD e será incluído. O batch é obrigatório pelos RF-010/RF-011/RF-024; o endpoint REST é uma extensão pequena e reaproveita o padrão validado no PRD 12 sub-PR 3.  
**Esforço:** 1 dia  
**Skills:** `tdd-workflow`, `test-author`, `scraper-testing`, `doc-sync`  
**Agents/gates:** `test-author`, `electron-security-reviewer`, `code-reviewer`  
**Bloqueado por:** Sub-PR 1

#### S3.1. Batch resiliente e contrato de resultado — 0,4 dia

- [ ] Estender `scraper:enriquecer-todos` para persistir os sete indicadores por meio de `mergeIndicadores`.
- [ ] Processar apenas FIIs com `ativo=1`.
- [ ] Continuar para o ticker seguinte após timeout, bloqueio, captcha, sessão expirada, parser sem dados ou falha de persistência individual.
- [ ] Retornar `{ total, sucessos, falhas, detalhes }`.
- [ ] Retornar por ticker `{ ticker, success, campos_atualizados, erro }`.
- [ ] Manter temporariamente `resultados` como alias compatível para o renderer atual; migrar `pages.js` para `detalhes` neste sub-PR.
- [ ] Não marcar sucesso quando todos os sete indicadores vierem inválidos/nulos.
- [ ] Preservar campos válidos em sucesso parcial e informar exatamente os campos aceitos.
- [ ] Não duplicar ativos nem piorar dados após duas execuções.

#### S3.2. `POST /api/fiis/indicadores/resync` — 0,25 dia

- [ ] Implementar a rota estática `/resync` em `src/server/routes/indicadores.js` antes de `/:ticker`.
- [ ] Aceitar body opcional `{ tickers?: string[] }`; ausência processa todos os FIIs ativos.
- [ ] Normalizar para maiúsculas, remover duplicatas de forma determinística e validar todos por `^[A-Z]{4}11$` antes de qualquer navegação.
- [ ] Rejeitar body/ticker inválido com `400`, sem executar lote parcial silencioso.
- [ ] Reusar a mesma função de batch do IPC, evitando duas implementações de merge/persistência.
- [ ] Sanitizar erro HTTP e não expor stack, path local, HTML, cookies ou credenciais.

#### S3.3. Testes de lote, falha parcial e orçamento — 0,25 dia

- [ ] Criar `src/__tests__/integration/api-scraper-indicadores.test.js`.
- [ ] Cobrir batch simulado com 17 FIIs e sucesso ≥95% no cenário nominal.
- [ ] Cobrir falha em um FII sem interromper os outros 16.
- [ ] Cobrir atualização parcial via `mergeIndicadores`, zero, negativo e `null` preservado.
- [ ] Cobrir execução repetida/idempotente.
- [ ] Cobrir body ausente, lista vazia, duplicatas, ticker minúsculo, inválido e ativo não-FII.
- [ ] Medir duração p95 do cenário de 17 FIIs com orçamento ≤120 s.
- [ ] Começar sequencialmente; somente se o orçamento falhar, considerar concorrência máxima de quatro workers, respeitando robots.txt e evitando rajadas.

#### S3.4. UI do resultado, documentação e fechamento — 0,1 dia

- [ ] Atualizar a tela Importar para consumir `detalhes`, exibir sucessos/falhas por ticker e permitir nova tentativa sem apagar cache.
- [ ] Não iniciar duas execuções simultâneas; manter mensagem de até dois minutos quando não houver progresso granular.
- [ ] Atualizar `README.md` com fluxo de atualização e endpoints.
- [ ] Atualizar `CHANGELOG.md` com os três sub-PRs e schema 1.3.
- [ ] Revisar `SECURITY.md`; alterar somente se o novo endpoint ou a política de navegação introduzir informação que ainda não esteja documentada.
- [ ] Executar hook `doc-sync` antes do fechamento.

#### Critério de done do Sub-PR 3

- [ ] Batch processa FIIs ativos, isola falhas e devolve totais consistentes.
- [ ] Resposta por ticker contém `ticker`, `success`, `campos_atualizados` e `erro`.
- [ ] `POST /api/fiis/indicadores/resync` valida o lote inteiro antes de navegar.
- [ ] Rodar duas vezes não duplica ativos e não substitui valor válido por `NULL`.
- [ ] Cenário nominal atinge ≥95% de sucesso e ≤120 s para 17 FIIs.
- [ ] UI mostra sucesso parcial e mantém os últimos dados válidos.
- [ ] `scraper-testing` verde nas fixtures e no batch.
- [ ] `electron-security-reviewer` sem findings ALTOS.
- [ ] `code-reviewer` sem findings ALTOS.
- [ ] README e CHANGELOG sincronizados.

## 5. Critérios de aceite por sub-PR

### Sub-PR 1

- [ ] Schema versionado de 1.2 para 1.3; migration executada uma vez, transacional e idempotente.
- [ ] Backup pré-DDL e restauração validados em banco 1.2 real/descaracterizado.
- [ ] Sete indicadores mais duas metainformações presentes em migration, `init.sql` e fallback inline.
- [ ] Nenhum registro, valor ou campo do PRD 12 perdido/alterado pela migration.
- [ ] Cálculo mantém precisão e retorna sem dados diante de denominador ausente/zero/negativo.
- [ ] Limites 80%, 95%, 105% e 125% cobertos exatamente.
- [ ] Merge não apaga valor válido com `null` e preserva zero/negativo.
- [ ] Parsers reconhecem os três períodos e as colunas por semântica em dois ou mais layouts.
- [ ] Extração em pontos percentuais, sem recálculo de rentabilidade real.
- [ ] Endpoints list/detail retornam envelope, schema, totais e erros 400/404 corretos.
- [ ] Somente ativos FII aparecem nos endpoints.
- [ ] Cobertura crítica e KPIs de API/fixture atingidos.
- [ ] `schema-reviewer` aprovado.

### Sub-PR 2

- [ ] “DY vs 5y” e “Rent. real 12M” aparecem em Posições com formatação `pt-BR`.
- [ ] Cores possuem rótulo textual equivalente e tooltip acessível com fórmula/valores-base.
- [ ] Sem dados não é convertido em zero ou falsa ausência de desvios.
- [ ] Filtro, ordenação e detalhe Nominal × Real funcionam por mouse e teclado.
- [ ] Dashboard considera apenas FII ativo com quantidade atual maior que zero.
- [ ] Dashboard mostra total afetado, críticos, avaliados e sem dados.
- [ ] Links para `#fii/:ticker` e atalho para Posições filtrada funcionam.
- [ ] `renderSequence` impede escrita tardia após navegação rápida.
- [ ] Falhas parciais preservam a página e os dados em cache.
- [ ] Render de 50 FIIs dentro de 500 ms.
- [ ] `electron-security-reviewer` e `code-reviewer` aprovados.

### Sub-PR 3

- [ ] Batch de 17 FIIs isola falha individual e mantém os sucessos.
- [ ] Resultado global contém `total`, `sucessos`, `falhas` e `detalhes` coerentes.
- [ ] Resultado individual contém campos atualizados e erro legível.
- [ ] Persistência parcial usa `mergeIndicadores` em todos os caminhos.
- [ ] IPC existente continua funcional; alias legado removível em PR futuro sem quebra imediata.
- [ ] Resync REST valida body e tickers antes da primeira URL.
- [ ] Idempotência comprovada em duas execuções.
- [ ] Taxa de sucesso nominal ≥95% e p95 de 17 FIIs ≤120 s.
- [ ] `scraper-testing`, `electron-security-reviewer` e `code-reviewer` aprovados.
- [ ] Documentação sincronizada.

## 6. Riscos e mitigações

- **Risco:** a tabela de rentabilidade muda de layout no Investidor10.  
  **Mitigação:** parser multi-seletor por semântica, no estilo do PRD 12 sub-PR 3; fixtures para pelo menos dois layouts, ordem invertida de colunas e rótulos alternativos.

- **Risco:** FIIs listados há menos de cinco anos não têm `dy_medio_5a`.  
  **Mitigação:** manter `NULL`, classificar como `SEM_DADOS`, não alertar e exibir “— (listado em YYYY)” quando o ano estiver disponível; caso contrário, “— (histórico de 5 anos indisponível)”.

- **Risco:** migration 1.3 colide com dados existentes do PRD 12.  
  **Mitigação:** todas as novas colunas nullable, inspeção `PRAGMA table_info`, transação única, backup antes do DDL, smoke em banco 1.2 e comparação de contagem/valores antes e depois.

- **Risco:** enriquecimento de 17 FIIs excede 120 s.  
  **Mitigação:** medir p95 no smoke; começar sequencial; se necessário, paralelizar com limite máximo de quatro workers, respeitando robots.txt e sem rajadas.

- **Risco:** helper numérico atual converte zero em `null` por uso de fallback truthy.  
  **Mitigação:** parser específico deve distinguir `Number.isFinite(0)` de falha e ter testes explícitos para `0,00%` e números negativos.

- **Risco:** divergência entre nomes `rentabilidade_*` do PRD e `rentab_*` do briefing causa contratos inconsistentes.  
  **Mitigação:** adotar `rentab_*` como nomenclatura canônica em schema, API, scraper, UI e testes; registrar a decisão no CHANGELOG e não manter dois conjuntos de colunas.

- **Risco:** divergência entre classificação única do PRD e faixas visuais solicitadas gera alerta indevido acima da média.  
  **Mitigação:** separar classificação posicional de severidade visual e limitar explicitamente o alerta global a valores abaixo de 95%; confirmar a decisão 3.6 antes de implementar.

- **Risco:** adicionar o resync ao mesmo router faz `/resync` cair em `/:ticker`.  
  **Mitigação:** declarar a rota estática antes da dinâmica e cobrir por teste de integração.

- **Risco:** falha do novo cálculo quebra o array de alertas atual.  
  **Mitigação:** cálculo isolado, no máximo um item opcional, preservação do formato de array e testes de regressão dos alertas já existentes.

- **Risco:** UI usa cor como única informação ou modal perde foco.  
  **Mitigação:** rótulos textuais, `aria-describedby`, contraste AA, operação por teclado, focus trap, Escape e restauração de foco.

- **Risco:** navegação construída com ticker hostil ou domínio semelhante.  
  **Mitigação:** regex estrita antes da URL, construção por API de URL, hostname exato e revisão do `electron-security-reviewer`.

### Fora do escopo preservado

- Rentabilidades de 1 mês e 3 meses.
- Cálculo próprio de rentabilidade nominal/real ou séries de IPCA.
- Histórico mensal completo de dividendos e detecção de cortes consecutivos.
- Alerta global de DY acima de 125%/150%; a coloração alta de Posições não altera esse out of scope.
- Agendamento automático, execução em background, notificação do sistema, e-mail ou push.
- Novos gráficos ou atualização do Chart.js vendorizado.
- Comparação com IFIX, CDI, IPCA ou outros benchmarks.
- Thresholds configuráveis nesta versão.
- Edição manual dos sete indicadores.
- Recomendação de compra, venda ou rebalanceamento.
- Aplicação a ações, ETFs, Tesouro Direto ou criptoativos.
- Nova tela independente de análise fundamentalista.
- Nova coluna persistida de data de listagem.

## 7. Plano de teste

### Suítes a estender

- `src/__tests__/db-migrations.test.js`
  - Fresh install em 1.3.
  - Upgrade de banco 1.2 com dados do PRD 12.
  - Nove colunas físicas presentes e nullable.
  - `versao_schema=1.3`.
  - Aplicação repetida sem erro/duplicação.
  - Migration parcialmente aplicada recuperada por `PRAGMA table_info`.
  - Preservação de registros, valores e `updated_at`.
  - `integrity_check` e `foreign_key_check` verdes.

- `src/__tests__/integration/api-dashboard-alertas.test.js`
  - Regressão de alertas existentes.
  - Zero ou um item `DY_HISTORICO_BAIXO`.
  - Apenas FII ativo com quantidade positiva.
  - Atenção, crítico, sem dados e nenhuma cobertura.
  - Valores acima da média não geram este alerta global.

- Suíte existente do router em `src/__tests__/renderer/`
  - Hash de Posições com filtros válidos.
  - Query inválida sanitizada/ignorada.
  - Regressão de `#fii/:ticker` e ticker hostil.

### Suítes novas

- `src/__tests__/shared/indicadores.test.js`
  - Happy path do percentual.
  - Precisão sem arredondamento prematuro.
  - `null`, `undefined`, `NaN`, zero, negativos e divisão por zero.
  - Limites exatos 80/95/105/125.
  - Dois eixos de classificação e `SEM_DADOS`.
  - Merge imutável, whitelist, atualização parcial, zero/negativo válidos e `null` preservado.

- `src/__tests__/shared/scraper-indicadores.test.js`
  - DY médio no box Rendimento.
  - Nominal/Real × 1a/2a/5a.
  - Ordem de colunas normal e invertida.
  - Rótulos abreviados e longos, caixa, acentos e espaços.
  - Percentuais brasileiros, milhares, negativos e zero.
  - Períodos ausentes, FII recente, DOM parcial e layout não reconhecido.
  - Cobertura ≥95% dos campos presentes nas fixtures.
  - Ticker/URL/hostname validados antes da navegação.

- `src/__tests__/integration/api-indicadores.test.js`
  - Lista envelopada e detalhe envelopado.
  - Todos os sete campos, DY 12M, percentual, classificação, nível e metadados.
  - `ativo_only`, filtros, sort/order e validação de query.
  - 400 ticker inválido, 404 inexistente e 404 não-FII.
  - `SEM_DADOS` para DY ausente ou média menor/igual a zero.
  - SQL preparado/whitelist de ordenação.

- `src/__tests__/renderer/posicoes-indicadores.test.js`
  - Duas colunas e restrição a FII.
  - Formatação pt-BR de positivo, negativo, zero e ausente.
  - Chips com texto/cor e tooltip com valores-base.
  - Filtro, ordenação e estado vindo do hash.
  - Detalhe Nominal × Real, Enter/Espaço/Escape, focus trap e retorno de foco.
  - Loading, erro isolado, vazio e sem dados.
  - Conteúdo hostil renderizado como texto.

- `src/__tests__/renderer/dashboard-indicadores.test.js`
  - Alerta Atenção e Crítico.
  - Contagens e lista de links por ticker.
  - Nenhuma posição, nenhuma cobertura, sem desvio e falha da API.
  - `renderSequence` impede render tardio.
  - Ação abre Posições filtrada e ordenada.
  - Região de status não é anunciada como alerta urgente repetido.

- `src/__tests__/integration/api-scraper-indicadores.test.js`
  - Batch de 17 FIIs.
  - Uma falha não derruba os demais.
  - Merge parcial e preservação do banco.
  - Idempotência em duas execuções.
  - Contrato global/por ticker.
  - POST resync com todos, subconjunto, minúsculas, duplicatas, vazio e inválidos.
  - Nenhuma navegação quando a validação do lote falha.

- `src/__tests__/performance/indicadores-performance.test.js`
  - p95 de GET list/detail para até 500 ativos ≤200 ms.
  - Render de Posições com 50 FIIs ≤500 ms.
  - Orçamento do batch mockado/instrumentado e coleta de métricas determinística.

### Fixtures exatas a estender

- `src/__tests__/fixtures/i10/hglg11.html`: layout estruturado, dados completos e rótulos curtos.
- `src/__tests__/fixtures/i10/knip11.html`: rótulos “1 ano/2 anos/5 anos” e ordem alternativa.
- `src/__tests__/fixtures/i10/xpml11.html`: colunas Nominal/Real invertidas e valor negativo.
- `src/__tests__/fixtures/i10/mxrf11.html`: histórico ausente/parcial, garantindo `NULL` sem apagar cache.

### Smokes e regressão

- `scripts/test-migrations-smoke.js`: incluir schema 1.3, idempotência e checks de integridade.
- `scripts/smoke-migration-real.js`: migrar cópia de banco 1.2, comparar antes/depois e validar restauração do backup.
- `scripts/smoke-api-endpoints.js`: preservar os 12 cenários do PRD 12 e acrescentar lista, detalhe, filtros, ticker inválido, não-FII e classificação.
- `scripts/smoke-prd02-performance.js`: medir API, render sintético e batch de 17 FIIs sem telemetria remota.
- `npm test`: suíte integral, incluindo regressão do PRD 12.
- `npm run test:coverage`: meta ≥95% nos arquivos novos e 100% dos cenários críticos de parser, classificação, API, lote, falha parcial e idempotência.

## 8. Atomic commits

1. `feat(fii): sub-PR 1 do PRD 02 — schema 1.3 (7 colunas em ativos) + lógica pura de indicadores + parsers I10 + endpoints REST`
2. `feat(fii): sub-PR 2 do PRD 02 — colunas DY vs 5y e Rent. real 12M em Posições + alerta histórico no Dashboard`
3. `feat(fii): sub-PR 3 do PRD 02 — enriquecimento em lote com mergeIndicadores + endpoint /resync`

Regras para cada commit:

- [ ] Começar por testes Red e terminar com a suíte relevante verde.
- [ ] Não misturar mudanças de outro sub-PR, exceto ajustes mínimos de integração documentados.
- [ ] Rodar os gates correspondentes antes de considerar o commit pronto.
- [ ] Incluir documentação no terceiro commit após `doc-sync`.
- [ ] Não fazer push ou abrir PR sem solicitação explícita do usuário.

## 9. Ordem de execução

1. **Preparação**
   - Criar `feat/prd-02-indicadores-historicos` a partir de `master` limpo.
   - Confirmar a decisão de classificação da seção 3.6.
   - Preparar banco descartável 1.2 e baseline das fixtures.

2. **Sub-PR 1 — backend**
   - S1.1 migration e schemas.
   - Gate imediato `schema-reviewer`; se reprovar, voltar a S1.1.
   - S1.2 lógica pura.
   - S1.3 parsers/fixtures.
   - S1.4 persistência.
   - S1.5 API/smoke.
   - Gate `electron-security-reviewer` para main/server.
   - Corrigir qualquer finding ALTO na etapa de origem antes do commit.

3. **Sub-PR 2 — UI**
   - Pode começar após estabilização do envelope da API.
   - S2.1 módulo UI/CSS.
   - S2.2 Posições.
   - S2.3 Dashboard/backend de alerta.
   - S2.4 estados e testes.
   - Gates `electron-security-reviewer` e `code-reviewer`; finding ALTO volta à etapa correspondente.

4. **Sub-PR 3 — lote/resync**
   - Executar depois do Sub-PR 1; pode ocorrer em paralelo ao Sub-PR 2.
   - S3.1 batch.
   - S3.2 endpoint.
   - S3.3 testes/KPIs.
   - S3.4 UI de resultado/docs.
   - Gates `scraper-testing`, `electron-security-reviewer` e `code-reviewer`.

5. **Fechamento cruzado**
   - Rodar suite integral, coverage e todos os smokes.
   - Executar `doc-sync`.
   - Repetir `schema-reviewer` se qualquer ajuste final tocar `db/init.sql` ou `src/server/db.js`.
   - Repetir revisores de segurança/código nos deltas finais.
   - Parar e consultar o usuário se surgir nova ambiguidade de escopo.

## 10. Done quando

- [ ] Todos os critérios de aceite das seções 4 e 5 estão fechados.
- [ ] Schema 1.3 funciona em fresh install, fallback e upgrade de banco 1.2.
- [ ] Sete indicadores e duas metainformações permanecem sincronizados entre migration, init e fallback.
- [ ] `null` de parsing nunca apaga dado válido; zero e negativo são preservados.
- [ ] `updated_at` só muda quando ao menos um indicador válido é persistido.
- [ ] Classificação tem 100% de acerto nos limites 80%, 95%, 105% e 125% conforme decisão aprovada.
- [ ] Endpoints list/detail/resync validam FII e mantêm dados locais.
- [ ] Posições e Dashboard entregam estados loading/error/empty/partial/success e acessibilidade WCAG AA.
- [ ] Falha em um FII não derruba o batch; resultado por ticker é legível e idempotente.
- [ ] Taxa nominal de sucesso ≥95% e cobertura de campos nas fixtures ≥95%.
- [ ] p95 API ≤200 ms, render de 50 FIIs ≤500 ms e enriquecimento de 17 FIIs ≤120 s.
- [ ] `npm test` verde.
- [ ] `npm run test:coverage` com ≥95% nos arquivos novos e cobertura integral dos cenários críticos.
- [ ] Smokes de migration, API e performance verdes.
- [ ] README e CHANGELOG sincronizados; SECURITY revisado.
- [ ] `schema-reviewer`, `electron-security-reviewer` e `code-reviewer` aprovados sem findings ALTOS nos arquivos alterados.
- [ ] Três atomic commits usam exatamente os sufixos definidos na seção 8.
- [ ] Nenhum item fora de escopo foi incorporado silenciosamente.
