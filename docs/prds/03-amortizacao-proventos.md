# PRD: Amortizações Separadas em Proventos de FIIs

## 1. Visão Geral

### Resumo

A feature introduz o tipo `AMORTIZACAO` no ciclo completo de proventos do byeINSS: armazenamento no SQLite, captura da agenda do Investidor10, importação, APIs, lançamento manual, filtros, gráfico mensal empilhado e projeção anual. A amortização será tratada como devolução de capital e apresentada separadamente dos dividendos e rendimentos distribuíveis.

A projeção de renda recorrente e o Dividend Yield distribuível passarão a considerar somente `DIVIDENDO` e `RENDIMENTO`. Amortizações serão exibidas como fluxo de caixa separado e somente entrarão na projeção quando houver um evento futuro explicitamente registrado na agenda, sem extrapolação mensal ou anual.

### Problemas que resolve

1. **DY e renda recorrente superestimados:** amortizações atualmente classificadas como dividendos aumentam artificialmente o DY distribuível e a projeção de renda anual.
2. **Ausência de transparência sobre a origem dos pagamentos:** o usuário não consegue distinguir resultado distribuído de devolução de capital.
3. **Perda de informação na importação:** o scraper da agenda do Investidor10 ignora a coluna "Tipo" e persiste todos os eventos como `DIVIDENDO`.

### Personas e casos de uso

- **Investidor de FIIs focado em renda:** quer saber quanto recebeu de renda recorrente sem confundir amortização com rendimento sustentável.
- **Investidor em fase de independência financeira:** usa a projeção anual para avaliar renda passiva futura e precisa excluir devoluções extraordinárias de capital.
- **Investidor que acompanha fundos em liquidação ou desinvestimento:** quer identificar meses em que o fluxo de caixa foi elevado por amortizações.
- **Usuário que importa a agenda do Investidor10:** espera que "Dividendos" e "Amortização" sejam classificados automaticamente e sem duplicidades.
- **Usuário que lança proventos manualmente:** precisa selecionar o tipo correto, inclusive quando um mesmo FII paga dividendo e amortização na mesma data.

## 2. Objetivos &amp; Métricas de Sucesso

### Objetivos mensuráveis

1. Classificar corretamente pelo menos **99% dos eventos com tipo reconhecido** em uma amostra de homologação de 200 linhas da agenda do Investidor10.
2. Garantir que **100% das amortizações identificadas** sejam excluídas do DY distribuível e da projeção recorrente anual.
3. Migrar bancos existentes com **100% de preservação de IDs, relacionamentos, datas e valores** dos proventos.
4. Permitir que o usuário filtre qualquer combinação de tipos e atualize gráfico e histórico em até **300 ms** para uma base local de 10 mil proventos.
5. Garantir importação idempotente: repetir a mesma importação deve gerar **zero novos registros duplicados**.

### KPIs

| KPI | Definição | Meta |
|---|---|---:|
| Acurácia de classificação | Eventos cujo tipo persistido corresponde ao tipo exibido pelo I10 | ≥ 99% |
| Amortizações no numerador do DY distribuível | Eventos `AMORTIZACAO` incluídos indevidamente | 0 |
| Amortizações anualizadas | Eventos de amortização multiplicados por 12 sem agenda explícita | 0 |
| Integridade da migração | Diferença entre contagem, soma de IDs e soma de valores antes/depois | 0 |
| Duplicação na reimportação | Novos registros após importar duas vezes o mesmo conjunto | 0 |
| Latência local da agregação mensal | P95 do endpoint com até 50 mil registros | < 200 ms |
| Tempo de atualização do filtro | Clique no filtro até atualização de gráfico e tabela | < 300 ms |
| Cobertura dos fluxos críticos | Migração, scraper, deduplicação, filtros e projeção cobertos por testes | 100% dos cenários críticos |

Os KPIs serão medidos por testes automatizados, fixtures do scraper e logs locais de diagnóstico. Nenhuma telemetria externa será adicionada.

## 3. Requisitos Funcionais

1. **RF-001 — Novo tipo de provento:** o domínio de `proventos.tipo` deve aceitar exatamente `DIVIDENDO`, `RENDIMENTO`, `BONIFICACAO` e `AMORTIZACAO`. Novos registros sem tipo explícito continuarão usando `DIVIDENDO` como padrão para compatibilidade.

2. **RF-002 — Migração versionada:** a inicialização do banco deve executar uma migração única da versão `1.1` para `1.2`, recriando a tabela `proventos` dentro de transação. A migração deve criar backup, validar integridade e não ser repetida quando `versao_schema` já for `1.2` ou superior.

3. **RF-003 — Preservação de dados existentes:** IDs, chaves estrangeiras, datas, valores por cota e tipos válidos existentes devem ser copiados sem alteração. Registros legados com `tipo IS NULL` devem ser normalizados para `DIVIDENDO` e contabilizados no log da migração.

4. **RF-004 — Captura da coluna Tipo:** `extractAgendaDividendos` deve localizar a coluna "Tipo" pelo cabeçalho normalizado da tabela, sem depender de posição fixa. Cada item extraído deve retornar `tipo` juntamente com ticker, datas e valor por cota.

5. **RF-005 — Normalização do tipo externo:** o scraper deve mapear `Dividendo`/`Dividendos` para `DIVIDENDO`, `Rendimento`/`Rendimentos` para `RENDIMENTO` e `Amortização`/`Amortizacao` para `AMORTIZACAO`. A normalização deve ignorar caixa, espaços e acentos.

6. **RF-006 — Tipo desconhecido:** um texto de tipo não reconhecido não pode ser convertido silenciosamente para `DIVIDENDO`. O evento deve ser ignorado, registrado como `tipo_desconhecido` e incluído no resumo de erros da importação.

7. **RF-007 — Importação idempotente:** a deduplicação deve considerar `ativo_id`, `data_com`, `data_pagto`, `valor_por_cota` e `tipo`. Eventos do mesmo FII e data, mas com tipos ou valores diferentes, devem coexistir.

8. **RF-008 — Reconciliação de registros legados:** se a agenda trouxer uma amortização que corresponda de forma inequívoca a um único registro legado classificado como `DIVIDENDO`, com mesmo ativo, datas e valor, a importação poderá reclassificá-lo para `AMORTIZACAO`. O resultado deve informar quantos registros foram reclassificados.

9. **RF-009 — Importação JSON:** o importador do Investidor10 deve validar e preservar o campo `tipo` de cada provento. Registros sem tipo mantêm o comportamento legado de assumir `DIVIDENDO`; valores explicitamente inválidos devem ser rejeitados.

10. **RF-010 — Lançamento manual:** os formulários individual e em lote devem disponibilizar os quatro tipos válidos. A interface em lote deve permitir mais de uma linha para o mesmo ticker, possibilitando registrar parcelas de dividendo e amortização na mesma data.

11. **RF-011 — Validação de entrada:** `ativo_id` ou ticker válido, data de pagamento, valor por cota maior que zero e tipo válido são obrigatórios. Datas devem usar o formato ISO `YYYY-MM-DD`.

12. **RF-012 — Filtro por tipo:** a tela de Proventos deve oferecer filtros combináveis para Dividendos, Rendimentos, Amortizações e Bonificações, além da ação "Todos". O filtro deve atualizar o gráfico, o total contextual e o histórico sem recarregar a página.

13. **RF-013 — Persistência do filtro:** a seleção de tipos e do período deve ser representada no hash da navegação, permitindo atualizar a tela ou compartilhar a rota local sem perder o estado. Valores inválidos no hash devem ser ignorados.

14. **RF-014 — Gráfico empilhado:** a tela deve exibir um gráfico de barras por mês, com uma série para cada tipo selecionado e empilhamento nos eixos X e Y. O período padrão será os últimos 12 meses, com opções de 24 meses e todo o histórico.

15. **RF-015 — Valor financeiro recebido:** os totais históricos devem usar `valor_por_cota × quantidade_elegivel`, e não apenas somar valores por cota. A quantidade elegível será a posição acumulada na `data_com`; quando ela não existir, será usada a posição na `data_pagto`.

16. **RF-016 — Separação dos indicadores:** a tela deve apresentar "Dividendos distribuíveis 12M" para `DIVIDENDO + RENDIMENTO` e "Amortizações 12M" para `AMORTIZACAO`. `BONIFICACAO` deve permanecer separada e não compor total de caixa nem DY distribuível.

17. **RF-017 — Projeção distribuível:** para cada FII, a projeção recorrente deve localizar a data mais recente que possua `DIVIDENDO` ou `RENDIMENTO`, somar as parcelas distribuíveis dessa data, multiplicar pela quantidade atual e anualizar por 12. Um registro mais recente de amortização não pode substituir o último provento recorrente.

18. **RF-018 — Amortizações futuras:** a projeção deve somar separadamente apenas amortizações explicitamente agendadas entre a data atual e os próximos 12 meses. Amortizações passadas ou o último valor amortizado não devem ser multiplicados por 12.

19. **RF-019 — DY distribuível:** o DY da carteira, o alerta de DY alto e os indicadores de proventos recorrentes devem considerar somente `DIVIDENDO` e `RENDIMENTO`. O denominador do DY da carteira será o patrimônio atual das posições abertas.

20. **RF-020 — Compatibilidade dos contratos:** os campos legados `proventos_12m`, `dy_carteira_12m`, `total_mensal` e `total_anual` devem permanecer disponíveis, mas passarão a representar exclusivamente valores distribuíveis. Novos campos explícitos devem informar amortizações e fluxo de caixa total.

21. **RF-021 — Histórico detalhado:** cada linha do histórico deve exibir data de pagamento, ticker, valor por cota, quantidade elegível, valor total e tipo. O tipo deve ser apresentado por texto e badge, sem depender somente de cor.

22. **RF-022 — Resumo da importação:** a importação da agenda deve retornar totais de lidos, inseridos, duplicados, reclassificados, ignorados e tipos desconhecidos, além da contagem por tipo. Falhas em uma linha não devem descartar registros válidos da mesma extração.

23. **RF-023 — Schema de novas instalações:** tanto `db/init.sql` quanto o schema inline de fallback em `src/server/db.js` devem conter a nova restrição. Bancos novos não devem depender da execução da migração legada.

24. **RF-024 — Sem dados inventados:** quando não houver provento recorrente válido, a projeção distribuível do FII deve ser zero e a UI deve mostrar "Sem base recorrente". Quando não houver amortizações futuras, deve mostrar "Nenhuma amortização prevista", e não repetir amortizações anteriores.

## 4. Requisitos Não-Funcionais

### Performance

- Consultas agregadas devem usar índices por tipo e data de pagamento.
- O endpoint mensal deve responder em menos de 200 ms no P95 em uma máquina de referência com 50 mil proventos e 200 ativos.
- O frontend deve receber dados já agregados para o gráfico; não deve carregar todo o histórico para calcular séries longas.
- Alterações de filtro devem destruir ou atualizar corretamente a instância anterior do Chart.js, evitando vazamento de memória.

### Privacidade

- Todos os dados financeiros, cookies e credenciais permanecem no dispositivo do usuário.
- Nenhum evento, tipo de provento ou métrica de carteira será enviado para serviços externos.
- A sessão do Investidor10 continuará isolada na partição persistente do Electron já existente.

### Integridade e confiabilidade

- A migração deve ser atômica, precedida de backup e protegida por versão de schema.
- A aplicação deve interromper a migração diante de tipos desconhecidos não nulos, divergência de contagem ou violação de chave estrangeira.
- A importação deve ser idempotente e executada em transação.
- Falha na extração do I10 não pode remover nem alterar registros locais já válidos.

### Segurança

- Todos os filtros e tipos devem ser validados contra uma allowlist no backend.
- Consultas devem continuar usando prepared statements do `better-sqlite3`.
- Textos oriundos do scraper devem ser normalizados antes de persistir e escapados antes de renderizar.
- Erros de banco não devem expor caminhos locais completos ou SQL interno na interface.

### Compatibilidade

- Compatível com a versão de SQLite embarcada pelo `better-sqlite3`.
- Compatível com Express 4, Electron, frontend vanilla JS e Chart.js já utilizados.
- A navegação deve continuar baseada em hash.
- Bancos existentes na versão `1.1` devem ser atualizados sem ação manual.
- O schema em `db/init.sql` e o fallback inline devem permanecer equivalentes.

### Precisão e consistência

- Datas devem ser tratadas como datas ISO locais, sem conversão de fuso que altere o mês do pagamento.
- Valores monetários devem manter a precisão armazenada em `REAL` e ser formatados em BRL somente na apresentação.
- O mesmo conjunto de tipos distribuíveis deve ser reutilizado em API, dashboard, alertas e projeção, evitando regras divergentes.

### Observabilidade local

- A migração deve registrar versão anterior, versão final, quantidade copiada, tipos normalizados e resultado das verificações.
- A importação deve registrar contagens, nunca valores financeiros completos ou credenciais.
- Logs devem permanecer locais e não bloquear a inicialização em caso de indisponibilidade do scraper.

## 5. Modelo de Dados

### Semântica dos tipos

| Tipo | Significado | Compõe renda distribuível | Compõe DY distribuível | Pode compor fluxo de caixa |
|---|---|---:|---:|---:|
| `DIVIDENDO` | Distribuição de resultado classificada como dividendo | Sim | Sim | Sim |
| `RENDIMENTO` | Rendimento recorrente do FII | Sim | Sim | Sim |
| `AMORTIZACAO` | Devolução de capital | Não | Não | Sim |
| `BONIFICACAO` | Bonificação ou evento não tratado como caixa recorrente | Não | Não | Não |

A classificação é informativa e não substitui apuração tributária.

### Schema final para novas instalações

```sql
CREATE TABLE IF NOT EXISTS proventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ativo_id INTEGER NOT NULL,
  data_com TEXT,
  data_pagto TEXT NOT NULL,
  valor_por_cota REAL NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'DIVIDENDO'
    CHECK (
      tipo IN (
        'DIVIDENDO',
        'RENDIMENTO',
        'BONIFICACAO',
        'AMORTIZACAO'
      )
    ),
  FOREIGN KEY (ativo_id) REFERENCES ativos(id)
);

CREATE INDEX IF NOT EXISTS idx_proventos_ativo_data
  ON proventos(ativo_id, data_pagto DESC);

CREATE INDEX IF NOT EXISTS idx_proventos_tipo_data
  ON proventos(tipo, data_pagto DESC);
```

Não deve ser usado `ALTER TABLE ... MODIFY`, `ALTER COLUMN` ou equivalente, pois o SQLite não permite alterar diretamente uma `CHECK constraint`.

### Migração exata da versão 1.1 para 1.2

#### Passo 1 — Preparação e backup

1. Abrir o banco em modo exclusivo para migração, antes de iniciar o servidor Express.
2. Finalizar o WAL e criar uma cópia do arquivo por meio da API de backup do `better-sqlite3`.
3. Nome recomendado: `byeinss.db.bak-schema-1.1-<timestamp>`.
4. Se o backup falhar, não iniciar a migração.

```sql
PRAGMA wal_checkpoint(FULL);
```

#### Passo 2 — Capturar os valores de controle

```sql
SELECT
  COUNT(*) AS rows_before,
  COALESCE(SUM(id), 0) AS ids_before,
  COALESCE(SUM(ativo_id), 0) AS ativos_before,
  COALESCE(SUM(valor_por_cota), 0) AS valores_before
FROM proventos;
```

Os quatro valores devem ser mantidos em memória para comparação antes do `COMMIT`.

#### Passo 3 — Validar tipos legados

```sql
SELECT id, tipo
FROM proventos
WHERE tipo IS NOT NULL
  AND UPPER(TRIM(tipo)) NOT IN (
    'DIVIDENDO',
    'RENDIMENTO',
    'BONIFICACAO',
    'AMORTIZACAO'
  );
```

- Se a consulta retornar qualquer registro, a migração deve ser interrompida e o usuário informado de que existem tipos não reconhecidos.
- Registros com `tipo IS NULL` são permitidos no preflight e serão normalizados para `DIVIDENDO`, preservando o comportamento legado.

#### Passo 4 — Desabilitar chaves estrangeiras antes da transação

```sql
PRAGMA foreign_keys = OFF;
```

A instrução deve ser executada fora da transação.

#### Passo 5 — Criar e preencher a nova tabela

```sql
BEGIN IMMEDIATE;

DROP TABLE IF EXISTS proventos_v2;

CREATE TABLE proventos_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ativo_id INTEGER NOT NULL,
  data_com TEXT,
  data_pagto TEXT NOT NULL,
  valor_por_cota REAL NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'DIVIDENDO'
    CHECK (
      tipo IN (
        'DIVIDENDO',
        'RENDIMENTO',
        'BONIFICACAO',
        'AMORTIZACAO'
      )
    ),
  FOREIGN KEY (ativo_id) REFERENCES ativos(id)
);

INSERT INTO proventos_v2 (
  id,
  ativo_id,
  data_com,
  data_pagto,
  valor_por_cota,
  tipo
)
SELECT
  id,
  ativo_id,
  data_com,
  data_pagto,
  valor_por_cota,
  CASE
    WHEN tipo IS NULL THEN 'DIVIDENDO'
    ELSE UPPER(TRIM(tipo))
  END
FROM proventos;
```

#### Passo 6 — Validar a cópia antes de remover a tabela original

```sql
SELECT
  COUNT(*) AS rows_after,
  COALESCE(SUM(id), 0) AS ids_after,
  COALESCE(SUM(ativo_id), 0) AS ativos_after,
  COALESCE(SUM(valor_por_cota), 0) AS valores_after
FROM proventos_v2;

PRAGMA foreign_key_check(proventos_v2);
```

A aplicação deve executar `ROLLBACK` se:

- `rows_after <> rows_before`;
- `ids_after <> ids_before`;
- `ativos_after <> ativos_before`;
- a diferença absoluta entre `valores_after` e `valores_before` ultrapassar `0.000001`;
- `PRAGMA foreign_key_check(proventos_v2)` retornar qualquer linha.

#### Passo 7 — Substituir a tabela e recriar índices

```sql
DROP TABLE proventos;

ALTER TABLE proventos_v2 RENAME TO proventos;

CREATE INDEX idx_proventos_ativo_data
  ON proventos(ativo_id, data_pagto DESC);

CREATE INDEX idx_proventos_tipo_data
  ON proventos(tipo, data_pagto DESC);

INSERT OR IGNORE INTO config (chave, valor)
VALUES ('versao_schema', '1.2');

UPDATE config
SET valor = '1.2'
WHERE chave = 'versao_schema';
```

#### Passo 8 — Confirmar ou desfazer

Se todas as comparações do Passo 6 forem válidas:

```sql
COMMIT;
```

Caso contrário:

```sql
ROLLBACK;
```

#### Passo 9 — Reativar e verificar integridade

```sql
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
PRAGMA integrity_check;
```

Critérios obrigatórios:

- `PRAGMA foreign_keys` deve retornar `1`;
- `PRAGMA foreign_key_check` não deve retornar linhas;
- `PRAGMA integrity_check` deve retornar `ok`;
- `config.versao_schema` deve retornar `1.2`.

```sql
SELECT valor
FROM config
WHERE chave = 'versao_schema';
```

Se a verificação final falhar, a aplicação deve fechar a conexão e restaurar o backup criado no Passo 1.

### Regra de deduplicação

Não será criada uma restrição `UNIQUE` no MVP para evitar falha de migração causada por duplicidades legadas. Toda importação deve usar uma consulta parametrizada equivalente a:

```sql
SELECT id, tipo
FROM proventos
WHERE ativo_id = ?
  AND data_pagto = ?
  AND valor_por_cota = ?
  AND tipo = ?
  AND (
    data_com = ?
    OR (data_com IS NULL AND ? IS NULL)
  )
LIMIT 1;
```

Essa chave lógica permite que o mesmo FII possua, na mesma data, uma parcela de dividendo e outra de amortização.

## 6. APIs / Endpoints

| Método | Rota | Request | Response | Erros |
|---|---|---|---|---|
| `GET` | `/api/proventos` — alterado | Query opcional: `ativo_id`, `ano`, `inicio`, `fim`, `tipos=DIVIDENDO,AMORTIZACAO` | Array de `{ id, ativo_id, ticker, data_com, data_pagto, valor_por_cota, tipo, quantidade_elegivel, valor_total }`, ordenado por pagamento decrescente | `400` para tipo ou data inválida; `500` para erro local de banco |
| `POST` | `/api/proventos` — alterado | `{ ativo_id, data_com?, data_pagto, valor_por_cota, tipo }` | `201` com o registro criado, incluindo `id` e tipo normalizado | `400` para campos ausentes/data inválida; `404` para ativo inexistente; `409` para duplicidade; `422` para tipo ou valor inválido |
| `POST` | `/api/proventos/batch` — alterado | `{ data_pagto, data_com?, proventos: [{ ticker, valor_por_cota, tipo }] }`. O campo legado `dividendos` pode ser aceito temporariamente como alias de itens `DIVIDENDO` | `{ inseridos, reclassificados, duplicados, ignorados, por_tipo, erros: [{ indice, ticker, codigo }] }` | `400` para payload inválido; erros de item são retornados em `erros`; `500` somente se a transação inteira falhar |
| `GET` | `/api/dashboard/proventos-mensais` — alterado | Query opcional: `inicio`, `fim`, `tipos`; padrão: últimos 12 meses | Array de `{ mes, por_tipo, distribuiveis, amortizacoes, bonificacoes, total_caixa }` em ordem cronológica | `400` para período/tipo inválido; `500` para erro de agregação |
| `GET` | `/api/dashboard/projecao-proventos` — alterado | Sem body; horizonte fixo de 12 meses | `{ total_distribuivel_mensal, total_distribuivel_anual, total_amortizacoes_previstas, dy_carteira_distribuivel, total_mensal, total_anual, detalhes, amortizacoes_previstas }` | `500` para erro de cálculo; ausência de dados retorna totais zero, não erro |
| `GET` | `/api/dashboard/resumo` — alterado | Sem body | Mantém o contrato atual e adiciona `{ amortizacoes_12m, amortizacoes_total, fluxo_caixa_proventos_12m }`. `proventos_12m` e `dy_carteira_12m` passam a representar somente distribuíveis | `500` para erro local de banco |

### Contrato da agregação mensal

Exemplo:

```json
[
  {
    "mes": "2026-07",
    "por_tipo": {
      "DIVIDENDO": 900.0,
      "RENDIMENTO": 320.0,
      "AMORTIZACAO": 500.0,
      "BONIFICACAO": 0
    },
    "distribuiveis": 1220.0,
    "amortizacoes": 500.0,
    "bonificacoes": 0,
    "total_caixa": 1720.0
  }
]
```

### Contrato da projeção anual

Exemplo:

```json
{
  "total_distribuivel_mensal": 1220.0,
  "total_distribuivel_anual": 14640.0,
  "total_amortizacoes_previstas": 500.0,
  "dy_carteira_distribuivel": 9.42,
  "total_mensal": 1220.0,
  "total_anual": 14640.0,
  "detalhes": [
    {
      "ticker": "ABCD11",
      "qtd": 100,
      "ultimo_distribuivel_por_cota": 0.8,
      "ultimo_pagto_distribuivel": "2026-07-15",
      "mensal_distribuivel": 80.0,
      "anual_distribuivel": 960.0,
      "dy_anual_distribuivel": 9.6,
      "desatualizado": false
    }
  ],
  "amortizacoes_previstas": [
    {
      "ticker": "WXYZ11",
      "data_com": "2026-07-20",
      "data_pagto": "2026-07-31",
      "valor_por_cota": 5.0,
      "quantidade_estimada": 100,
      "valor_total_estimado": 500.0
    }
  ]
}
```

Os aliases legados `total_mensal` e `total_anual` serão iguais aos respectivos valores distribuíveis, nunca à soma com amortizações.

## 7. UI / UX

### Frame 1 — Tela padrão de Proventos

```text
+--------------------------------------------------------------------------------+
| Proventos                                      [Atualizar proventos do mês]     |
| Renda distribuível, amortizações e projeção anual                              |
+--------------------------------------------------------------------------------+
| Período: [12 meses v]  [Todos] [Dividendos] [Rendimentos] [Amortizações] [Bon.]|
+-----------------------+----------------------+---------------------------------+
| Distribuíveis 12M     | Amortizações 12M     | Projeção distribuível 12M      |
| R$ 14.640,00          | R$ 2.500,00          | R$ 16.320,00                   |
+-----------------------+----------------------+---------------------------------+
| Proventos mensais por tipo                                                     |
| Legenda: [D] Dividendos [R] Rendimentos [A] Amortizações [B] Bonificações      |
|                                                                                |
| R$ 2k |              [A]                                                       |
|       |       [R]    [D]        [D]                                            |
| R$ 1k | [D]   [D]    [D]  [R]   [D]                                            |
|       +----------------------------------------------------------------        |
|         Fev    Mar    Abr   Mai   Jun                                           |
+--------------------------------------------------------------------------------+
| Histórico recente                                                             |
| Pagamento | FII    | Valor/cota | Qtd. elegível | Total      | Tipo           |
| 15/07/26  | ABCD11 | R$ 0,80    | 100           | R$ 80,00   | Dividendo      |
| 15/07/26  | WXYZ11 | R$ 5,00    | 100           | R$ 500,00  | Amortização    |
+--------------------------------------------------------------------------------+
```

### Frame 2 — Filtro de amortizações ativo

```text
+--------------------------------------------------------------------------------+
| Período: [24 meses v]  [Todos] [Dividendos] [Rendimentos] [Amortizações*] [Bon.]|
| Filtro ativo: Amortizações                                       [Limpar]      |
+--------------------------------------------------------------------------------+
| Total filtrado: R$ 8.750,00 | 4 eventos | 3 FIIs                              |
+--------------------------------------------------------------------------------+
| Amortizações por mês                                                         |
|                                                                                |
| R$ 5k |                         [A]                                             |
| R$ 2k |        [A]                           [A]                                |
|       +----------------------------------------------------------------        |
|         Ago       Nov       Fev       Mai       Ago                            |
+--------------------------------------------------------------------------------+
| Nenhum dividendo ou rendimento é exibido enquanto este filtro estiver ativo.  |
+--------------------------------------------------------------------------------+
```

### Frame 3 — Atualização em lote com suporte a parcelas

```text
+-----------------------------------------------------------------------+
| Atualizar proventos do mês                                            |
| Data de pagamento [2026-07-31]  Data-com [2026-07-20]                 |
+-----------------------------------------------------------------------+
| FII       | Tipo                  | Valor por cota | Ação              |
| ABCD11    | [DIVIDENDO       v]   | [0,8000]       | [Remover]         |
| ABCD11    | [AMORTIZACAO     v]   | [0,2000]       | [Remover]         |
| WXYZ11    | [RENDIMENTO      v]   | [1,0500]       | [Remover]         |
|                                                                       |
| [Adicionar parcela]                  [Cancelar] [Salvar proventos]     |
+-----------------------------------------------------------------------+
| É permitido registrar tipos diferentes para o mesmo FII e data.       |
+-----------------------------------------------------------------------+
```

### Frame 4 — Projeção anual separada

```text
+--------------------------------------------------------------------------------+
| Projeção para os próximos 12 meses                                             |
+--------------------------------------+-----------------------------------------+
| Dividendos distribuíveis             | Amortizações previstas                  |
| R$ 16.320,00                         | R$ 500,00                               |
| Estimativa recorrente anualizada      | Apenas eventos já informados na agenda |
+--------------------------------------+-----------------------------------------+
| Projeção recorrente por FII                                                     |
| FII    | Qtd | Último distribuível | Mensal | Anual     | DY distribuível      |
| ABCD11 | 100 | R$ 0,80             | R$ 80  | R$ 960   | 9,60%                 |
+--------------------------------------------------------------------------------+
| Amortizações previstas                                                        |
| FII    | Pagamento  | Valor/cota | Qtd. estimada | Total estimado             |
| WXYZ11 | 31/07/2026 | R$ 5,00    | 100           | R$ 500,00                  |
+--------------------------------------------------------------------------------+
```

### Estados da interface

- **Loading:** skeleton para KPIs, gráfico e tabelas; controles de filtro permanecem desabilitados até a resposta.
- **Empty geral:** "Sem proventos registrados" com ação para lançar ou importar a agenda.
- **Empty do filtro:** "Nenhum provento encontrado para os tipos e período selecionados", com botão "Limpar filtros".
- **Sem base recorrente:** projeção zero com orientação para cadastrar dividendos ou rendimentos.
- **Sem amortização prevista:** card com valor zero e texto "Nenhuma amortização prevista na agenda".
- **Success:** gráfico, KPIs e histórico renderizados; importações exibem resumo por tipo.
- **Success parcial:** registros válidos são salvos e erros por linha são apresentados sem perder o preenchimento inválido.
- **Error de API:** mensagem não técnica, ação "Tentar novamente" e preservação dos filtros.
- **Error de migração:** bloquear uso do banco alterado, informar restauração do backup e fornecer caminho para suporte local sem expor dados financeiros.
- **Dados desatualizados:** projeção baseada em último distribuível com mais de 90 dias recebe badge "Base desatualizada".
- **Tipo desconhecido no scraper:** aviso com quantidade ignorada e orientação para atualizar o app ou registrar manualmente.

### Acessibilidade (a11y)

- Filtros devem ser botões com `aria-pressed`, operáveis por teclado e com foco visível.
- O gráfico deve possuir `aria-label` descritivo e uma tabela textual equivalente acessível a leitores de tela.
- Tipos não podem ser diferenciados apenas por cor; usar texto, bordas, padrões ou símbolos na legenda e nos tooltips.
- Cores devem atender contraste mínimo WCAG AA: 4,5:1 para texto normal e 3:1 para elementos gráficos relevantes.
- Cabeçalhos de tabela devem usar `<th scope="col">`; linhas agrupadas devem manter ordem de leitura lógica.
- Tooltips do gráfico devem informar mês, tipo, valor e total do mês.
- Resumos de importação e erros devem usar região `aria-live="polite"`.
- Modais devem manter foco contido, fechar com `Esc` e devolver o foco ao botão que os abriu.
- Animações do Chart.js devem ser reduzidas ou removidas quando `prefers-reduced-motion` estiver ativo.

## 8. Casos de Borda

1. **Pagamento dividido:** um FII paga R$ 0,80 de dividendo e R$ 0,20 de amortização na mesma data; ambos os registros devem ser preservados e exibidos separadamente.

2. **Mesmo tipo e data, valores diferentes:** duas parcelas distribuíveis na mesma data não podem ser colapsadas se os valores ou datas-com forem diferentes.

3. **Plural, acentos e caixa:** `Dividendos`, `DIVIDENDO`, `Amortização`, `amortizacao` e textos com espaços extras devem ser normalizados corretamente.

4. **Tipo externo desconhecido:** valores como `Outros`, `Subscrição` ou uma célula vazia no scraper devem ser ignorados e reportados, nunca assumidos como dividendo.

5. **Coluna Tipo ausente:** se o I10 alterar o DOM e o scraper não encontrar o cabeçalho, a importação da agenda deve falhar de forma controlada antes de persistir eventos com classificação incorreta.

6. **Registros legados nulos:** `tipo IS NULL` durante a migração deve ser convertido para `DIVIDENDO`, com a quantidade normalizada registrada em log.

7. **Registro legado já incorreto:** amortizações antigas gravadas como `DIVIDENDO` não podem ser inferidas automaticamente quando não houver correspondência atual na agenda; continuarão como estão até correção ou nova fonte confiável.

8. **Reimportação da agenda:** executar a mesma importação várias vezes deve resultar em duplicados contabilizados, sem novos inserts.

9. **Reconciliação ambígua:** se mais de um dividendo legado corresponder a uma amortização importada, nenhum deve ser reclassificado automaticamente; o caso deve ser reportado.

10. **Último evento é amortização:** a projeção deve buscar o último `DIVIDENDO` ou `RENDIMENTO` anterior, e não usar a amortização como renda mensal.

11. **FII apenas com amortizações:** a projeção distribuível deve ser zero; amortizações futuras explícitas continuam visíveis separadamente.

12. **Sem data-com:** a quantidade elegível histórica deve ser calculada na data de pagamento, e a UI deve indicar que esse foi o critério utilizado.

13. **Venda entre data-com e pagamento:** a quantidade usada deve ser a posição na data-com, preservando o direito adquirido antes da venda.

14. **Evento futuro sem posição:** amortização agendada para um ativo sem quantidade atual deve aparecer na agenda com total estimado zero, sem valor negativo.

15. **Valor zero, negativo ou não numérico:** o backend deve rejeitar o registro com erro de validação e não iniciar insert parcial daquele item.

16. **Bonificação:** deve aparecer no gráfico e filtro quando selecionada, mas não compor renda distribuível, DY ou fluxo de caixa monetário.

17. **Provento recorrente antigo:** se o último distribuível tiver mais de 90 dias, a projeção poderá ser calculada para compatibilidade, mas deve ser marcada como desatualizada.

18. **Mudança de mês por fuso:** uma data ISO não pode migrar para o mês anterior ou seguinte por conversão UTC no frontend.

19. **Banco sem tabela `config`:** a migração deve garantir que o schema-base foi inicializado antes de consultar ou atualizar `versao_schema`.

20. **Falha durante a migração:** qualquer erro entre `BEGIN IMMEDIATE` e `COMMIT` deve executar `ROLLBACK`, manter a tabela original e permitir restauração do backup.

## 9. Dependências

- Tabela `proventos` e tabela `ativos` existentes e íntegras.
- Lançamentos de compra e venda necessários para calcular quantidade elegível e valor total recebido.
- Inicialização centralizada do `better-sqlite3` antes da subida do Express.
- Implementação de um executor de migrações versionadas no fluxo de `initDb`; o `init.sql` isolado não altera tabelas existentes.
- Rotas atuais de proventos e dashboard.
- `extractAgendaDividendos` e IPC `scraperAgendaDividendos` existentes no Electron.
- Serviço `import-i10.js` para importação JSON.
- Chart.js já carregado no renderer.
- Gerenciamento existente de gráficos por `chartsToDestroy`.
- Fixtures representativas da tabela de agenda do I10, incluindo dividendo, amortização, linha dividida, tipo ausente e alteração de ordem das colunas.
- Não depende da implementação do histórico completo de dividendos, DY médio de cinco anos, watchlist ou suporte a ativos que não sejam FIIs.

## 10. Esforço Estimado

### Estimativa total

**7 dias-pessoa**, com faixa de segurança de **6 a 9 dias**, considerando desenvolvimento, testes e homologação com banco existente.

Com duas pessoas trabalhando em paralelo após a definição do contrato, o prazo de calendário pode ser reduzido para aproximadamente 4 a 5 dias úteis.

### Breakdown por área

| Área | Atividades | Estimativa |
|---|---|---:|
| Banco e migração | Schema final, executor versionado, backup, validações, fallback inline e testes de rollback | 1,0 dia |
| Scraper e importadores | Parser por cabeçalho, normalização, deduplicação, reconciliação e resumo por tipo | 1,0 dia |
| Backend e APIs | Filtros, validação, cálculo de quantidade elegível, agregações, DY e projeção separada | 1,5 dia |
| Frontend | Filtros, hash, KPIs, badges, tabelas, modal em lote e gráfico empilhado | 2,0 dias |
| Testes e QA | Migração com dados reais anonimizados, fixtures do scraper, APIs, projeção e casos de borda | 1,5 dia |
| **Total** |  | **7,0 dias** |

## 11. Riscos &amp; Mitigações

1. **Mudança no DOM do Investidor10**
   - **Risco:** o scraper deixa de encontrar ou classificar a coluna "Tipo".
   - **Mitigação:** localizar colunas pelo cabeçalho normalizado, manter fixtures de HTML, falhar de forma segura quando o cabeçalho estiver ausente e nunca assumir `DIVIDENDO` para texto desconhecido.

2. **Perda ou corrupção durante a migração**
   - **Risco:** recriação da tabela pode perder IDs, valores ou vínculos.
   - **Mitigação:** backup obrigatório, transação `BEGIN IMMEDIATE`, comparação de contagem e somas de controle, `foreign_key_check`, `integrity_check` e restauração automática em caso de falha.

3. **Dados históricos já classificados incorretamente**
   - **Risco:** amortizações antigas permanecem como dividendos e continuam afetando períodos históricos.
   - **Mitigação:** reconciliação automática somente em correspondências inequívocas, relatório de reclassificados e comunicação clara de que registros sem fonte confiável não serão alterados.

4. **Projeção interpretada como garantia de renda**
   - **Risco:** anualizar o último rendimento pode superestimar fundos com pagamentos irregulares ou dados desatualizados.
   - **Mitigação:** rótulo "estimativa recorrente", badge de desatualização, tooltip com metodologia e amortizações futuras limitadas a eventos explicitamente agendados.

5. **Deduplicação elimina uma parcela válida**
   - **Risco:** evento dividido entre dividendo e amortização na mesma data é tratado como duplicado.
   - **Mitigação:** chave lógica inclui tipo, valor e data-com; adicionar testes específicos para pagamentos divididos.

## 12. Out of Scope

- Ajustar automaticamente preço médio, custo de aquisição ou patrimônio contábil após uma amortização.
- Apurar imposto de renda, come-cotas, ganho de capital, custo fiscal ou preencher declaração tributária.
- Fornecer aconselhamento fiscal sobre a classificação informada pela fonte.
- Prever amortizações não anunciadas ou anualizar amortizações históricas.
- Reclassificar em massa todo o histórico legado sem uma fonte confiável que identifique o tipo original.
- Raspar retroativamente todo o histórico de dividendos de cada FII.
- Alterar cálculos de compra, venda, preço-teto, rebalanceamento ou cenários patrimoniais.
- Adicionar `JCP` ou funcionalidades específicas para ações, ETFs, BDRs, Tesouro Direto ou criptoativos.
- Criar alertas externos, notificações push, e-mail ou sincronização em nuvem.
- Substituir Chart.js ou migrar o frontend vanilla JS para outro framework.
- Implementar integrações com fontes de dados diferentes do fluxo já existente do Investidor10.
