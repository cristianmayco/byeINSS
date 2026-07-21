# PRD: Histórico de Dividendos e Sustentabilidade de DY por FII

## 1. Visão Geral

O byeINSS passará a importar e exibir o histórico completo de proventos pagos por cada FII, limitado ao período disponibilizado pela fonte. A feature oferecerá uma linha do tempo mensal por cota, tabela detalhada, identificação de amortizações, detecção de cortes e aumentos recorrentes e informações sobre cobertura e atualização dos dados.

Com base nos pagamentos efetivamente registrados e na cotação mais recente, o app calculará o DY realizado dos últimos 12 meses e um DY sustentável estimado. Esses indicadores serão comparados ao DY médio de cinco anos informado pela fonte. Neste PRD, "realizado" significa calculado com proventos efetivamente pagos; não significa retorno ajustado pela inflação.

**Problemas que resolve:**

1. O usuário não consegue identificar visualmente se os rendimentos de um FII estão estáveis, aumentando ou sendo cortados.
2. O DY atual disponível pode mascarar pagamentos extraordinários, amortizações, preço desatualizado ou uma deterioração recente da distribuição.
3. A análise atual depende do último dividendo e não oferece contexto histórico suficiente para comparar o momento atual com o padrão de longo prazo do fundo.

**Personas e casos de uso principais:**

- **Investidor de renda mensal:** acompanha se os FIIs da carteira mantêm distribuições recorrentes e identifica cortes antes de atualizar suas projeções de renda.
- **Investidor fundamentalista de longo prazo:** compara o DY realizado, o DY sustentável estimado e o DY médio de cinco anos antes de aportar ou rebalancear.
- **Usuário responsável por cerca de 17 FIIs:** sincroniza toda a carteira de uma vez, revisa alertas e abre o detalhe apenas dos fundos com mudanças relevantes.

## 2. Objetivos &amp; Métricas de Sucesso

### Objetivos mensuráveis

1. Importar pelo menos 95% dos registros históricos publicamente disponíveis na fonte para cada FII suportado, respeitando o limite temporal da própria fonte.
2. Garantir idempotência: uma segunda sincronização sem mudanças na fonte deve inserir zero registros duplicados.
3. Disponibilizar DY realizado de 12 meses para pelo menos 90% dos FIIs que tenham 12 meses de cobertura e cotação válida.
4. Detectar corretamente cortes e aumentos nos cenários definidos em testes, com 100% de aderência às regras determinísticas deste PRD.
5. Carregar o histórico e as métricas de um FII em até 1 segundo no computador local de referência, sem bloquear a navegação durante a sincronização.

### KPIs

| KPI | Meta |
|---|---:|
| Cobertura de registros disponíveis na fonte | ≥ 95% |
| FIIs sincronizados com sucesso em uma execução completa | ≥ 95% |
| Duplicatas inseridas em uma sincronização repetida | 0 |
| Conflitos não resolvidos entre dados manuais e importados | < 1% dos registros |
| FIIs elegíveis com DY realizado calculado | ≥ 90% |
| Aderência dos sinais de corte/aumento aos testes de referência | 100% |
| Tempo p95 dos endpoints de leitura | < 200 ms |
| Tempo para renderizar até 120 pontos no gráfico | < 500 ms após a resposta |
| Tempo típico para sincronizar 17 FIIs, excluindo login | ≤ 5 minutos |
| Erros que causem perda de dados preexistentes | 0 |

Os KPIs serão avaliados por testes automatizados, fixtures do scraper e informações locais de diagnóstico. Nenhuma métrica será enviada para telemetria ou servidor externo.

## 3. Requisitos Funcionais

1. **RF-001 — Acesso ao histórico.** Cada FII exibido em "Posições" deverá oferecer a ação "Histórico de dividendos", abrindo a rota `#fii-historico/:ticker`. A rota deve aceitar somente tickers de FIIs cadastrados.

2. **RF-002 — Sincronização individual e em lote.** O usuário poderá sincronizar o histórico de um FII na tela de detalhe ou todos os FIIs ativos da carteira pela tela de importação. A sincronização em lote será sequencial, exibirá progresso por ticker e permitirá cancelamento antes do próximo fundo.

3. **RF-003 — Extração do histórico completo.** Uma nova função `extractDividendosHistorico(ticker)` deverá acessar `/fiis/{ticker}/`, abrir a seção de dividendos e percorrer paginação ou ações de "carregar mais" até não existirem novas linhas. "Completo" significa todo o período exposto pela fonte, que atualmente pode começar apenas em 2019, e não necessariamente desde a constituição do fundo.

4. **RF-004 — Normalização dos registros.** O scraper deverá extrair, quando disponíveis, competência, data de pagamento, data-com, valor por cota e tipo. Valores serão normalizados para número positivo com até oito casas decimais, datas exatas para `YYYY-MM-DD` e competências para `YYYY-MM`.

5. **RF-005 — Precisão temporal explícita.** Quando a fonte apresentar somente mês e ano, o sistema armazenará a competência e deixará `data_pagto` nula, sem inventar um dia. A interface mostrará "mm/aaaa" e informará que a fonte não forneceu a data exata.

6. **RF-006 — Separação entre pago e agendado.** Somente registros com `status = 'PAGO'` participarão do histórico realizado, dos cálculos e da detecção de mudanças. A agenda futura continuará armazenada como `AGENDADO` e será visualmente separada.

7. **RF-007 — Classificação dos proventos.** O sistema deverá reconhecer `DIVIDENDO`, `RENDIMENTO`, `BONIFICACAO` e `AMORTIZACAO`. Amortizações e bonificações serão exibidas no histórico, mas excluídas do DY realizado, do DY sustentável e dos sinais de corte ou aumento.

8. **RF-008 — Importação idempotente.** Cada linha importada deverá receber uma chave de origem determinística. Antes de inserir, o sistema também verificará registros legados ou manuais com o mesmo ativo, competência ou data, tipo e valor com tolerância de `0,00000001`.

9. **RF-009 — Resolução de conflitos.** Um registro manual existente nunca será sobrescrito silenciosamente pelo scraper. Correspondência única será tratada como registro já existente; correspondências ambíguas ou valores divergentes serão contabilizados como conflitos e apresentados no resumo da sincronização.

10. **RF-010 — Persistência transacional.** Os dados de cada FII serão persistidos em uma única transação. Uma falha no meio do processamento não poderá deixar metade dos registros daquele FII gravada; falhas em um ticker não deverão desfazer os FIIs já sincronizados com sucesso.

11. **RF-011 — DY médio de cinco anos.** Durante a sincronização, o scraper deverá capturar `dy_medio_5a` da página do FII, junto com fonte e data de atualização. Valor ausente será armazenado como `NULL`, nunca como zero.

12. **RF-012 — DY atual de 12 meses realizado.** O cálculo será:

    ```text
    provento_12m_por_cota =
      soma de DIVIDENDO + RENDIMENTO pagos nos últimos 12 meses-calendário

    dy_atual_12m_realizado =
      (provento_12m_por_cota / cotacao_referencia) × 100
    ```

    A cotação de referência será a cotação mais recente com `data <= data_referencia`. O cálculo será indisponível se houver menos de 12 meses de cobertura completa ou não existir cotação positiva.

13. **RF-013 — DY sustentável estimado.** O sistema agregará `DIVIDENDO` e `RENDIMENTO` por mês, incluindo zero nos meses cobertos sem pagamento. Com 36 meses de cobertura, usará `min(média mensal de 24 meses, média mensal de 36 meses)`; com 24 a 35 meses, usará a média de 24 meses.

    ```text
    dy_sustentavel_estimado =
      (valor_mensal_sustentavel × 12 / cotacao_referencia) × 100
    ```

    O indicador ficará indisponível com menos de 24 meses de cobertura, cotação inválida ou sincronização sabidamente incompleta.

14. **RF-014 — Confiança do DY sustentável.** O resultado terá confiança `ALTA` com pelo menos 36 meses completos e sincronização feita há até 30 dias, `MEDIA` com 24 a 35 meses ou dados mais antigos e `INDISPONIVEL` quando os pré-requisitos não forem atendidos. A interface deverá explicar os motivos da classificação.

15. **RF-015 — Comparação com DY de cinco anos.** O app exibirá a diferença em pontos percentuais e a razão entre o DY realizado e o DY médio de cinco anos:

    ```text
    diferenca_pp = dy_atual_12m_realizado - dy_medio_5a
    razao_5a = dy_atual_12m_realizado / dy_medio_5a
    ```

    A classificação será "acima da média" quando `razao_5a > 1,05`, "em linha" entre `0,95` e `1,05` e "abaixo da média" quando `< 0,95`.

16. **RF-016 — Detecção de corte e aumento.** Para FIIs com pagamentos em pelo menos nove dos 12 meses anteriores, o valor de cada competência será comparado à média dos 12 totais mensais recorrentes anteriores. Variação menor ou igual a `-15%` indicará possível corte e maior ou igual a `+15%` indicará possível aumento.

17. **RF-017 — Confirmação do sinal.** Uma única competência acima do limite produzirá o estado `EM_OBSERVACAO`; duas competências mensais consecutivas na mesma direção produzirão `CORTE_CONFIRMADO` ou `AUMENTO_CONFIRMADO`. Valores entre os limites produzirão `ESTAVEL` e interromperão uma sequência ainda não confirmada.

18. **RF-018 — Cadência irregular.** Fundos com menos de nove meses pagantes nos 12 meses anteriores serão classificados como de cadência irregular. Para eles, o app exibirá a evolução e as métricas anuais, mas não emitirá um sinal confirmado de corte ou aumento sem histórico comparável suficiente.

19. **RF-019 — Linha do tempo.** O gráfico mostrará valor pago por cota no eixo Y, em BRL, e competência no eixo X. O valor recorrente, a referência sustentável e amortizações poderão ser diferenciados por linha, traço e formato de marcador, sempre em um único eixo.

20. **RF-020 — Interações do gráfico.** O usuário poderá selecionar períodos de 12 meses, 36 meses, cinco anos ou todo o histórico e ativar ou ocultar amortizações. Foco, hover ou toque em um ponto deverá mostrar competência, valor por cota, tipo, precisão da data, variação contra a base e fonte.

21. **RF-021 — Marcadores de mudança.** Competências que iniciarem ou confirmarem corte ou aumento deverão receber marcador e rótulo textual no gráfico. Os mesmos eventos serão apresentados em uma lista de sinais abaixo do gráfico, sem depender exclusivamente de cor.

22. **RF-022 — Tabela histórica.** Abaixo do gráfico haverá uma tabela ordenada da competência mais recente para a mais antiga, com competência/data, valor por cota, tipo, status, variação, fonte e indicador de precisão. A tabela será paginada em até 100 registros por página e permitirá filtrar por tipo.

23. **RF-023 — Resumo da carteira.** A tela "Posições" deverá exibir um badge por FII com o último estado conhecido: estável, em observação, corte confirmado, aumento confirmado, dados insuficientes ou desatualizado. Um resumo apresentará quantos FIIs da carteira estão em cada estado.

24. **RF-024 — Atualização e proveniência.** A tela informará data e hora da última tentativa, última sincronização bem-sucedida, período coberto e número de registros importados. Informações ausentes serão apresentadas como "Não disponível", sem substituição por zero.

25. **RF-025 — Compatibilidade com proventos existentes.** Os formulários e endpoints atuais de cadastro manual e em lote continuarão funcionando. Consultas e telas existentes deverão usar `competencia` quando `data_pagto` for nula e excluir registros `AGENDADO` ou `AMORTIZACAO` dos cálculos de renda recorrente.

26. **RF-026 — Recalculo determinístico.** Métricas e sinais deverão ser recalculados quando houver importação, inclusão, alteração ou exclusão de provento, mudança na cotação de referência ou alteração dos parâmetros de configuração. Não será permitido manter um resultado antigo sem indicar sua defasagem.

27. **RF-027 — Sincronização por IPC.** O controle da `BrowserWindow` continuará no processo principal do Electron, por IPC, com handlers para um ticker e para todos os FIIs. O Express receberá apenas dados já extraídos e fornecerá os endpoints locais de persistência e leitura.

28. **RF-028 — Comunicação responsável.** DY sustentável e sinais de corte ou aumento serão apresentados como estimativas quantitativas, não como recomendação de compra, venda ou garantia de renda futura. O tooltip deverá informar a fórmula e os tipos de provento incluídos.

## 4. Requisitos Não-Funcionais

### Performance

- Endpoints de histórico, métricas e resumo deverão responder em menos de 200 ms no p95 para uma carteira de 20 FIIs e até 10 anos de registros mensais.
- O gráfico deverá renderizar até 120 competências em menos de 500 ms após o recebimento dos dados.
- A troca de período ou tipo não deverá refazer scraping nem bloquear a interface.
- A sincronização deverá ocorrer fora do fluxo de renderização da tela principal e mostrar progresso por FII.
- O limite padrão da API será 100 registros e o limite máximo será 500.

### Privacidade

- Todos os dados permanecerão no SQLite local em `~/.config/byeinss/byeinss.db` ou diretório equivalente do sistema operacional.
- Nenhuma métrica de uso, histórico, ticker, erro ou informação de carteira será enviada para telemetria.
- Login, cookies e sessão do Investidor10 permanecerão no perfil isolado `persist:investidor10`.
- A API continuará vinculada somente a `127.0.0.1`.

### Segurança

- O ticker será validado pelo padrão `^[A-Z]{4}11$` antes de compor qualquer URL.
- A navegação do scraper usará validação exata de `URL.hostname`, permitindo somente `investidor10.com.br` e subdomínios explicitamente aprovados.
- `nodeIntegration` permanecerá desabilitado e `contextIsolation` habilitado.
- O código executado no DOM deverá ser estático; conteúdo extraído não poderá ser interpolado como JavaScript executável.
- Requests e registros importados deverão ser validados quanto a tipo, data, competência, valor positivo e vínculo com um FII existente.

### Compatibilidade

- Electron 32, Node embarcado, Express 4.21 e better-sqlite3 11.3.
- SQLite local em modo WAL.
- Frontend em HTML, CSS e JavaScript vanilla, sem introdução de framework.
- Chart.js vendorizado em `src/renderer/vendor/chart.min.js`.
- Navegação por hash, incluindo `#fii-historico/:ticker`.
- Linux Ubuntu 22.04+, Debian 12+ e Fedora 38+; Windows 10+; macOS 11+.
- Formatação monetária em `pt-BR`/BRL, DY em percentual e períodos em meses ou anos.

### Confiabilidade e integridade

- Toda migração deverá criar backup do banco antes da primeira alteração.
- A migração e cada importação por FII deverão ser transacionais.
- A aplicação deverá executar `PRAGMA foreign_key_check` após a migração.
- O scraper deverá aceitar sucesso parcial por carteira e manter o erro específico de cada ticker.
- Uma sincronização nunca poderá apagar registros manuais apenas porque eles deixaram de aparecer na fonte.

### Qualidade e testabilidade

- O parser deverá ser testável com fixtures HTML, sem depender de acesso real ao site.
- Fórmulas de DY e detecção de sinais deverão ser funções puras, com data de referência injetável.
- Datas deverão ser comparadas como datas ISO ou competências, sem depender do fuso horário da máquina.
- Arredondamento será aplicado somente na apresentação; cálculos usarão os valores armazenados.

## 5. Modelo de Dados

### Migração versionada para bancos existentes

A migração deverá ser executada uma única vez quando `versao_schema < 1.2`. Antes dela, o runner deverá executar a consulta de validação abaixo e interromper a atualização se retornar registros:

```sql
SELECT id, data_pagto, valor_por_cota, tipo
FROM proventos
WHERE data_pagto IS NULL
   OR valor_por_cota IS NULL
   OR valor_por_cota <= 0
   OR COALESCE(tipo, 'DIVIDENDO') NOT IN (
     'DIVIDENDO',
     'RENDIMENTO',
     'BONIFICACAO'
   );
```

Com a validação aprovada, executar:

```sql
PRAGMA foreign_keys = OFF;

BEGIN IMMEDIATE;

ALTER TABLE ativos
  ADD COLUMN dy_medio_5a REAL
  CHECK (dy_medio_5a IS NULL OR dy_medio_5a >= 0);

ALTER TABLE ativos
  ADD COLUMN dy_medio_5a_fonte TEXT;

ALTER TABLE ativos
  ADD COLUMN dy_medio_5a_atualizado_em TEXT;

CREATE TABLE proventos_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ativo_id INTEGER NOT NULL,
  data_com TEXT,
  data_pagto TEXT,
  competencia TEXT NOT NULL
    CHECK (
      length(competencia) = 7
      AND substr(competencia, 5, 1) = '-'
      AND CAST(substr(competencia, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    ),
  precisao_data TEXT NOT NULL DEFAULT 'DIA'
    CHECK (precisao_data IN ('DIA', 'MES')),
  valor_por_cota REAL NOT NULL
    CHECK (valor_por_cota > 0),
  tipo TEXT NOT NULL DEFAULT 'DIVIDENDO'
    CHECK (
      tipo IN (
        'DIVIDENDO',
        'RENDIMENTO',
        'BONIFICACAO',
        'AMORTIZACAO'
      )
    ),
  status TEXT NOT NULL DEFAULT 'PAGO'
    CHECK (status IN ('PAGO', 'AGENDADO')),
  fonte TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (
      fonte IN (
        'MANUAL',
        'INVESTIDOR10',
        'IMPORTACAO',
        'LEGADO'
      )
    ),
  origem_chave TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (precisao_data = 'DIA' AND data_pagto IS NOT NULL)
    OR
    (precisao_data = 'MES' AND data_pagto IS NULL)
  ),
  CHECK (
    fonte <> 'INVESTIDOR10'
    OR origem_chave IS NOT NULL
  ),
  FOREIGN KEY (ativo_id) REFERENCES ativos(id),
  UNIQUE (fonte, origem_chave)
);

INSERT INTO proventos_v2 (
  id,
  ativo_id,
  data_com,
  data_pagto,
  competencia,
  precisao_data,
  valor_por_cota,
  tipo,
  status,
  fonte,
  origem_chave,
  created_at,
  updated_at
)
SELECT
  id,
  ativo_id,
  data_com,
  data_pagto,
  substr(data_pagto, 1, 7),
  'DIA',
  valor_por_cota,
  COALESCE(tipo, 'DIVIDENDO'),
  CASE
    WHEN date(data_pagto) <= date('now') THEN 'PAGO'
    ELSE 'AGENDADO'
  END,
  'LEGADO',
  'LEGADO:' || id,
  datetime('now'),
  datetime('now')
FROM proventos;

DROP TABLE proventos;

ALTER TABLE proventos_v2 RENAME TO proventos;

CREATE INDEX idx_proventos_ativo_competencia
  ON proventos(ativo_id, status, competencia DESC);

CREATE INDEX idx_proventos_status_pagto
  ON proventos(status, data_pagto DESC);

CREATE INDEX idx_proventos_tipo_competencia
  ON proventos(tipo, competencia DESC);

CREATE TABLE fii_dividendos_sync (
  ativo_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'NUNCA'
    CHECK (
      status IN (
        'NUNCA',
        'EM_ANDAMENTO',
        'SUCESSO',
        'PARCIAL',
        'ERRO',
        'CANCELADO'
      )
    ),
  fonte TEXT NOT NULL DEFAULT 'INVESTIDOR10',
  tentativa_em TEXT,
  concluido_em TEXT,
  primeira_competencia TEXT,
  ultima_competencia TEXT,
  cobertura_completa INTEGER NOT NULL DEFAULT 0
    CHECK (cobertura_completa IN (0, 1)),
  registros_lidos INTEGER NOT NULL DEFAULT 0,
  registros_inseridos INTEGER NOT NULL DEFAULT 0,
  registros_atualizados INTEGER NOT NULL DEFAULT 0,
  registros_duplicados INTEGER NOT NULL DEFAULT 0,
  registros_conflitantes INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  FOREIGN KEY (ativo_id) REFERENCES ativos(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO config (chave, valor) VALUES
  ('dividendos_variacao_alerta_pct', '15.0'),
  ('dividendos_janela_referencia_meses', '12'),
  ('dividendos_janela_sustentavel_meses', '36'),
  ('dividendos_janela_sustentavel_min_meses', '24'),
  ('dividendos_sync_desatualizado_dias', '30');

INSERT INTO config (chave, valor)
VALUES ('versao_schema', '1.2')
ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor;

COMMIT;

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
```

### Regras da migração

- Os IDs existentes de `proventos` serão preservados.
- Registros anteriores à migração receberão `fonte = 'LEGADO'` e uma `origem_chave` baseada no ID.
- Registros futuros já importados pela agenda serão migrados para `AGENDADO`; os demais serão `PAGO`.
- Nenhum registro será consolidado ou removido durante a migração.
- `db/init.sql` e o schema inline de contingência deverão receber a definição final das tabelas para novas instalações.
- Se `PRAGMA foreign_key_check` retornar qualquer linha, a inicialização deverá falhar de forma controlada e orientar a restauração do backup.

### Chave de origem dos registros importados

Na ausência de um identificador nativo da fonte:

```text
INVESTIDOR10|
<TICKER>|
<COMPETENCIA>|
<DATA_PAGTO ou MES>|
<TIPO>|
<VALOR_COM_8_CASAS>|
<ORDEM_ENTRE_LINHAS_IDENTICAS>
```

A ordem será calculada somente entre linhas normalizadas com os mesmos campos, evitando dependência da posição global da página.

## 6. APIs / Endpoints

Todos os erros seguirão o formato:

```json
{
  "erro": {
    "codigo": "CODIGO_ESTAVEL",
    "mensagem": "Mensagem legível",
    "detalhes": {}
  }
}
```

| Método | Rota | Request | Response | Erros |
|---|---|---|---|---|
| `GET` | `/api/proventos/historico/:ticker` | Query: `periodo=12m\|36m\|5a\|all`, `tipos=DIVIDENDO,RENDIMENTO,AMORTIZACAO`, `status=PAGO`, `page=1`, `limit=100` | `{ ticker, data_referencia, cobertura, items: [{ id, competencia, data_pagto, precisao_data, valor_por_cota, tipo, status, fonte }], paginacao }` | `400 TICKER_INVALIDO`, `400 FILTRO_INVALIDO`, `404 FII_NAO_ENCONTRADO`, `500 ERRO_BANCO` |
| `GET` | `/api/proventos/metricas/:ticker` | Query opcional: `data_referencia=YYYY-MM-DD` | `{ ticker, cotacao_referencia, dy_atual_12m_realizado, dy_sustentavel_estimado, confianca, dy_medio_5a, diferenca_pp, razao_5a, sinal, qualidade_dados }` | `400 DATA_INVALIDA`, `404 FII_NAO_ENCONTRADO`, `500 ERRO_CALCULO` |
| `GET` | `/api/proventos/sinais` | Query: `ativo_only=1`, `estado=CORTE_CONFIRMADO`, `desatualizado=true\|false` | `{ atualizado_em, totais_por_estado, fiis: [{ ticker, estado, variacao_pct, competencia, confianca, ultima_sync }] }` | `400 FILTRO_INVALIDO`, `500 ERRO_BANCO` |
| `POST` | `/api/proventos/historico/:ticker/importar` | `{ extraido_em, cobertura_completa, dy_medio_5a, eventos: [{ competencia, data_pagto, data_com, precisao_data, valor_por_cota, tipo, status, origem_chave }] }` | `{ ticker, lidos, inseridos, atualizados, duplicados, conflitantes, ignorados, cobertura }` | `400 PAYLOAD_INVALIDO`, `404 FII_NAO_ENCONTRADO`, `409 SINCRONIZACAO_EM_ANDAMENTO`, `422 DADOS_INCONSISTENTES`, `500 ERRO_PERSISTENCIA` |

Dados insuficientes para calcular uma métrica não serão tratados como erro HTTP. O endpoint retornará `200`, valor `null` e uma lista `qualidade_dados.motivos`, como `HISTORICO_MENOR_12M`, `COTACAO_AUSENTE` ou `SINCRONIZACAO_INCOMPLETA`.

A abertura e condução da página externa usarão IPC:

```text
scraper:dividendos-historico(ticker)
scraper:dividendos-historico-todos()
scraper:dividendos-cancelar()
scraper:dividendos-progresso
```

## 7. UI / UX

### Frame 1 — Acesso pela carteira

```text
+--------------------------------------------------------------------------+
| Posições                                            [Sincronizar dados]   |
+----------+-----------+---------+----------+------------------------------+
| Ticker   | DY 12M    | DY sust.| Tendência| Ações                        |
+----------+-----------+---------+----------+------------------------------+
| HGLG11   |  8,7%     |  8,2%   | Estável  | [Histórico] [Editar]         |
| MXRF11   | 12,4%     | 10,1%   | Observação| [Histórico] [Editar]        |
| XPML11   |  7,1%     |  8,0%   | Corte    | [Histórico] [Editar]         |
| ABCD11   |    —      |    —    | Sem dados| [Sincronizar histórico]      |
+----------+-----------+---------+----------+------------------------------+
```

### Frame 2 — Resumo e linha do tempo

```text
+--------------------------------------------------------------------------+
| HGLG11 — Histórico de dividendos                 [Atualizar histórico]   |
| Última sincronização: 18/07/2026 21:10 | Cobertura: jan/2019–jul/2026   |
+----------------+----------------+----------------+------------------------+
| DY realizado   | DY sustentável | DY médio 5a    | Tendência              |
| 8,7%           | 8,2%           | 8,4%           | Estável                |
| Cotação R$ ... | Confiança alta | Fonte: I10     | Variação recente: 2,1% |
+--------------------------------------------------------------------------+
| Período: [12M] [36M] [5A] [Tudo]   [x] Mostrar amortizações              |
|                                                                          |
| R$/cota                                                                  |
| 1,10 |                    o                                             |
| 1,00 |       o--o--o--o--o---o----o          Linha: valor recorrente    |
| 0,90 | ----- referência sustentável -----    Traço: referência          |
| 0,80 |                                      Losango: amortização         |
|      +------------------------------------------------------------- mês  |
|        jan/25              jul/25              jan/26            jul/26  |
+--------------------------------------------------------------------------+
| Sinal: distribuição dentro da faixa histórica. [Como é calculado?]       |
+--------------------------------------------------------------------------+
```

O gráfico terá apenas um eixo Y. A referência sustentável utilizará linha tracejada, e amortizações usarão um marcador diferente em vez de depender somente de uma nova cor.

### Frame 3 — Tabela e eventos detectados

```text
+--------------------------------------------------------------------------+
| Eventos detectados                                                       |
| [Observação] mai/2026: valor 16,2% abaixo da média anterior              |
| [Estável]    jun/2026: distribuição retornou à faixa de referência       |
+--------------------------------------------------------------------------+
| Filtro: [Todos os tipos v]                   Página 1 de 2 [<] [>]       |
+----------+------------+------------+-------------+----------+------------+
| Compet. | Pagamento  | Valor/cota | Tipo        | Variação | Fonte      |
+----------+------------+------------+-------------+----------+------------+
| jul/2026 | 15/07/2026 | R$ 1,1000  | Rendimento  | +2,1%    | I10        |
| jun/2026 | mês apenas | R$ 1,0800  | Rendimento  | +0,3%    | I10        |
| mai/2026 | 15/05/2026 | R$ 0,9000  | Rendimento  | -16,2%   | Manual     |
| abr/2026 | 22/04/2026 | R$ 0,2000  | Amortização | excluída | I10        |
+----------+------------+------------+-------------+----------+------------+
```

### Frame 4 — Sincronização de todos os FIIs

```text
+--------------------------------------------------------------------------+
| Sincronizando histórico: 7 de 17                                        |
| [#####################-----------------------------] 41%                 |
|                                                                          |
| HGLG11   Concluído       84 registros                                    |
| MXRF11   Concluído       91 registros, 2 já existentes                   |
| XPML11   Em andamento    Carregando página 2                             |
| ABCD11   Pendente                                                        |
|                                                                          |
| A interface pode continuar sendo usada durante a importação.             |
|                                             [Cancelar após este FII]      |
+--------------------------------------------------------------------------+
```

### Frame 5 — Sem dados ou falha parcial

```text
+--------------------------------------------------------------------------+
| ABCD11 — Histórico de dividendos                                         |
+--------------------------------------------------------------------------+
| Não há histórico sincronizado para este FII.                             |
|                                                                          |
| Possíveis motivos:                                                       |
| - fundo ainda não sincronizado;                                          |
| - fonte não disponibiliza histórico;                                     |
| - fundo listado há pouco tempo.                                          |
|                                                                          |
| [Sincronizar agora] [Cadastrar provento manualmente]                     |
+--------------------------------------------------------------------------+

ou

+--------------------------------------------------------------------------+
| Histórico disponível até mai/2026.                                       |
| A última tentativa falhou ao carregar as páginas restantes.              |
| Os dados anteriores foram preservados. [Tentar novamente] [Ver detalhes] |
+--------------------------------------------------------------------------+
```

### Estados da interface

- **Inicial:** tela ainda não consultou histórico nem status.
- **Loading:** skeleton para KPIs, gráfico e tabela.
- **Sincronizando:** progresso por FII, etapa atual e ação de cancelamento.
- **Success atualizado:** histórico, métricas e horário da última sincronização.
- **Success desatualizado:** dados exibidos com aviso quando a sincronização bem-sucedida tiver mais de 30 dias.
- **Empty nunca sincronizado:** explicação e CTA para sincronizar.
- **Empty legítimo:** fonte consultada com sucesso, mas nenhum pagamento encontrado.
- **Dados insuficientes:** histórico exibido, mas uma ou mais métricas ficam indisponíveis.
- **Parcial:** dados existentes preservados e aviso sobre cobertura incompleta.
- **Error de autenticação:** orientação para abrir a janela isolada e refazer login.
- **Error da fonte:** mensagem legível, ticker afetado e opção de tentar novamente.
- **Error local:** falha de persistência sem descartar os dados anteriores.
- **Sem cotação:** valores por cota são exibidos, mas os DYs ficam indisponíveis.

### Acessibilidade (a11y)

- Status nunca dependerá apenas de cor; usará texto, formato de marcador e, quando aplicável, ícone textual.
- Contraste mínimo WCAG AA para texto, controles, linhas e estados de foco.
- Paleta do gráfico deverá ser validada para visão normal e deficiências de percepção de cores, nos fundos claro e escuro efetivamente suportados.
- O gráfico terá título, resumo textual e `aria-describedby` apontando para a explicação e a tabela equivalente.
- Todos os dados do gráfico estarão disponíveis na tabela, inclusive marcadores de corte e aumento.
- Filtros, paginação, tooltips e seleção de pontos serão acessíveis por teclado.
- Pontos focáveis deverão ter área de interação maior que o marcador visual.
- Progresso de sincronização será anunciado por uma região `aria-live="polite"`, sem anunciar cada alteração interna excessivamente.
- Foco será movido para o título da tela ao navegar e devolvido ao botão acionador quando um modal for fechado.
- Animações respeitarão `prefers-reduced-motion`.
- Tooltips não conterão informação disponível exclusivamente por hover.

## 8. Casos de Borda

1. **FII com menos de 12 meses:** mostrar histórico e DY parcial, sem apresentar o parcial como DY realizado anual.
2. **FII com 12 a 23 meses:** calcular DY realizado de 12 meses, mas manter o DY sustentável indisponível.
3. **FII com somente mês e ano na fonte:** armazenar `data_pagto = NULL` e `precisao_data = 'MES'`.
4. **Mais de um pagamento na mesma competência:** somar os tipos recorrentes para análise mensal, preservando cada registro separadamente na tabela.
5. **Dividendo e amortização no mesmo dia:** armazenar duas linhas e excluir apenas a amortização dos cálculos recorrentes.
6. **Agenda futura presente no banco:** manter como `AGENDADO` e impedir sua entrada em qualquer métrica realizada.
7. **Pagamento trimestral, semestral ou irregular:** calcular totais anuais quando houver cobertura, mas não confirmar automaticamente corte ou aumento sem cadência comparável.
8. **Mês sem pagamento:** considerar zero somente quando a cobertura da fonte for completa e o mês estiver encerrado; ausência em sincronização parcial será tratada como dado desconhecido.
9. **FII recém-listado ou incorporado:** apresentar a data inicial disponível e não preencher retroativamente períodos anteriores.
10. **Mudança de ticker, incorporação ou liquidação:** não mesclar históricos automaticamente; exigir mapeamento explícito entre os ativos.
11. **Registro manual igual ao importado:** reconhecer a correspondência sem apagar a autoria manual nem criar duplicata.
12. **Registros manuais e importados divergentes:** preservar ambos, sinalizar conflito e excluir o conflito das métricas até resolução quando não houver forma segura de determinar o valor correto.
13. **Cotação ausente, zero ou desatualizada:** manter a série em BRL/cota, impedir divisão inválida e indicar a data da cotação quando houver.
14. **DY médio de cinco anos ausente:** exibir DY realizado e sustentável, mas deixar comparação de cinco anos como "Não disponível".
15. **DOM alterado, paginação interrompida ou timeout:** marcar sincronização como parcial/erro, preservar o histórico anterior e registrar o ticker e a etapa que falharam.
16. **Valor zero, negativo, `NaN` ou texto malformado:** rejeitar a linha, contabilizá-la como ignorada e não interromper outras linhas válidas.
17. **Diferença de fuso no fim do mês:** calcular competências a partir da data textual da fonte, sem converter meia-noite local para UTC.
18. **Fonte limitada a 2019:** informar "início disponível na fonte" e não alegar cobertura desde a criação do fundo.
19. **Duas linhas idênticas legítimas:** usar a ordem entre linhas normalizadas idênticas na chave de origem para não consolidá-las indevidamente.
20. **Sincronização cancelada:** concluir ou desfazer a transação do FII atual e não iniciar o próximo ticker.

## 9. Dependências

### Pré-requisitos

- Tabela `ativos` com ticker, tipo e estado ativo.
- Tabela `cotacoes` com ao menos uma cotação positiva para os cálculos de DY.
- Tabela `proventos` e atualização das consultas existentes para os novos campos.
- Criação de um mecanismo de migração versionada; executar apenas `CREATE TABLE IF NOT EXISTS` não atualiza bancos existentes.
- BrowserWindow isolada e sessão `persist:investidor10`.
- Exposição dos novos handlers no preload, sem liberar acesso genérico ao Node.
- Página individual do FII e histórico publicamente acessível ou acessível pela sessão do usuário.
- Parser ampliado de `extractFIIDetalhes` para `dy_medio_5a`.

### Bibliotecas

- Nenhuma biblioteca adicional obrigatória.
- Reutilizar `better-sqlite3`, Express 4 e Chart.js já vendorizado.
- Usar APIs nativas de `Intl.NumberFormat` para BRL e percentual.
- Testes do parser podem usar fixtures HTML e o ambiente de DOM já adotado pelo projeto; qualquer nova dependência de testes deverá permanecer apenas em `devDependencies`.

## 10. Esforço Estimado

**Estimativa total:** 10 a 12 dias úteis de desenvolvimento, incluindo testes e hardening do scraper.

| Área | Atividades | Estimativa |
|---|---|---:|
| Schema e migração | Migração versionada, reconstrução de `proventos`, índices, status de sincronização, backup e compatibilidade | 1,5 dia |
| Scraper e IPC | Parser histórico, paginação, normalização, progresso, cancelamento, captura de DY 5a e tratamento de falhas | 2,5 dias |
| API e cálculos | Endpoints, reconciliação, fórmulas de DY, confiança, sinais e resumo da carteira | 2 dias |
| UI / UX | Rota de detalhe, KPIs, gráfico, tabela, filtros, sincronização, estados e responsividade | 2,5 dias |
| Testes e estabilização | Fixtures, migração, idempotência, fórmulas, casos de borda, integração Electron e regressão | 2 dias |
| **Total base** |  | **10,5 dias** |

A estimativa pode aumentar em até dois dias se a fonte exigir interação não previsível para revelar toda a paginação ou apresentar estruturas diferentes entre FIIs.

## 11. Riscos &amp; Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Alterações frequentes no DOM da fonte | Interrupção total ou parcial da sincronização | Parser por estrutura e rótulos, seletores alternativos, fixtures versionadas, detecção explícita de layout desconhecido e opção de cadastro manual |
| Histórico incompleto ou sem data exata | Métricas superestimadas ou falsa impressão de precisão | Registrar cobertura, precisão e fonte; nunca inventar datas; bloquear métricas sustentáveis quando a cobertura for incompleta |
| Amortizações ou pagamentos extraordinários gerarem falso aumento | Projeção de renda excessivamente otimista | Classificar tipos, excluir amortizações e bonificações e exigir duas competências consecutivas para confirmar mudança |
| Cotação atual e DY médio de cinco anos com datas ou metodologias diferentes | Comparação enganosa | Mostrar datas e fontes, usar badges de desatualização, explicar fórmulas e apresentar diferença como indicador, não recomendação |
| Migração criar perda, duplicidade ou incompatibilidade com telas atuais | Corrupção do banco local e regressão | Backup prévio, transação, preservação de IDs, testes com cópia de banco real, `foreign_key_check` e atualização conjunta das queries antigas |
| Sincronização dos 17 FIIs causar bloqueio ou restrição da fonte | Experiência lenta ou bloqueio temporário | Processamento sequencial, intervalo entre páginas, retry limitado, cancelamento, progresso e ausência de sincronização automática em background |

## 12. Out of Scope

- Suporte dedicado a ações, ETFs, BDRs, Tesouro Direto ou cripto.
- Histórico de cotação completo, retorno total, ganho de capital ou comparação com IFIX.
- DY real ajustado pelo IPCA.
- Previsão por inteligência artificial, recomendação de compra ou venda e garantia de renda futura.
- Cálculo de renda efetivamente recebida com base na quantidade de cotas possuída em cada data-com.
- Tratamento tributário, declaração de imposto de renda ou cálculo de amortização no custo médio.
- Alertas por e-mail, push, SMS ou qualquer serviço externo.
- Sincronização automática em segundo plano sem ação explícita do usuário.
- Uso de servidor remoto, nuvem, telemetria ou compartilhamento da carteira.
- Integração e conciliação com múltiplas fontes, B3, CVM ou administradores dos fundos.
- Extração de comunicados, relatórios gerenciais, PDFs ou OCR.
- Reconstrução independente do DY médio de cinco anos quando ele não for disponibilizado pela fonte.
- Edição em massa ou resolução automática de conflitos entre registros manuais e importados.
