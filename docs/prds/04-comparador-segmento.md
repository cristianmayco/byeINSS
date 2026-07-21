# PRD: Comparador de FIIs vs Média do Segmento

## 1. Visão Geral

O Comparador vs Média do Segmento adicionará ao byeINSS uma referência relativa para P/VP, DY 12M e VPA de cada FII. Os benchmarks serão extraídos do box "Média Tipo/Segmento" da página individual do ativo no Investidor10, armazenados localmente e apresentados nas telas Posições e Preço-teto.

A feature também incorporará o benchmark ao cálculo do preço-teto efetivo e à simulação de rebalanceamento. O preço-teto definido pelo usuário continuará sendo a regra principal; o benchmark poderá apenas tornar a sugestão mais conservadora, nunca elevar automaticamente o preço máximo de compra. Todas as sugestões deverão informar os dados e as regras que determinaram o resultado.

### Problemas que resolve

1. **Avaliação isolada do FII:** P/VP ou DY sem referência setorial não indica se o ativo está negociado com prêmio ou desconto em relação aos pares.
2. **Preço-teto sem contexto relativo:** um ativo pode estar abaixo do teto baseado em DY, mas ainda caro em comparação com o múltiplo médio do segmento.
3. **Rebalanceamento baseado apenas em alocação:** priorizar somente os FIIs mais abaixo da meta pode direcionar novos aportes para ativos relativamente caros ou com DY inferior ao dos pares.

### Personas e casos de uso

| Persona | Necessidade | Caso de uso |
|---|---|---|
| Investidor autônomo de FIIs | Identificar rapidamente prêmio ou desconto relativo | Abre Posições e compara o P/VP do FII com a média do segmento |
| Investidor focado em renda | Avaliar se o DY compensa frente aos pares | Ordena a carteira por "DY vs peer" e investiga ativos abaixo da média |
| Investidor em fase de acumulação/FIRE | Direcionar o aporte mensal | Informa o valor disponível e recebe uma simulação de compras considerando meta, preço-teto e benchmark |
| Investidor conservador | Evitar pagar prêmio excessivo | Consulta o preço-teto efetivo, a regra limitante e a data do benchmark |
| Usuário que revisa a carteira periodicamente | Detectar dados desatualizados | Visualiza o estado "Desatualizado" e executa o enriquecimento dos FIIs antes de decidir |

---

## 2. Objetivos &amp; Métricas de Sucesso

### Objetivos mensuráveis

1. Obter um snapshot válido de P/VP médio, DY 12M médio e VPA médio para pelo menos 90% dos FIIs ativos após uma execução completa do enriquecimento.
2. Permitir que o usuário determine prêmio ou desconto relativo de qualquer FII coberto em menos de 30 segundos.
3. Garantir que 100% das sugestões de rebalanceamento apresentem preço-teto base, benchmark aplicado, preço-teto efetivo e justificativa legível.
4. Impedir que dados ausentes, incompletos ou vencidos tornem a recomendação mais permissiva que a lógica atual de preço-teto.
5. Processar comparações e simulações localmente, sem transmitir carteira, posições ou benchmarks para serviços externos além da navegação já iniciada pelo usuário no Investidor10.

### KPIs

| KPI | Definição | Meta |
|---|---|---|
| Cobertura de benchmark | FIIs ativos com grupo, P/VP médio, DY médio, VPA médio e timestamp válidos ÷ total de FIIs ativos | ≥ 90% por execução |
| Acurácia do parser | Campos corretamente extraídos em fixtures e amostra manualmente validada | ≥ 98% |
| Frescor dos dados | FIIs cobertos com benchmark de até 168 horas | ≥ 90% após atualização |
| Explicabilidade | Sugestões com todos os campos de origem, fórmula e motivo limitante | 100% |
| Desempenho da API | p95 dos endpoints de comparação para uma base com até 500 ativos | < 150 ms |
| Desempenho do rebalanceamento | p95 da simulação com até 500 posições | < 300 ms |
| Usabilidade | Participantes que identificam corretamente o FII mais descontado em teste moderado | ≥ 80% sem ajuda |
| Segurança de fallback | Casos com benchmark inválido que preservam o preço-teto base, sem aumento automático | 100% |

As métricas de uso deverão ser verificadas por testes locais, QA e sessões de usabilidade. Não haverá telemetria remota obrigatória.

---

## 3. Requisitos Funcionais

1. **RF-001 — Elegibilidade:** O comparador será aplicado somente a ativos com `tipo = 'FII'`. Outros tipos de ativo continuarão usando a lógica atual e exibirão "Não aplicável" nos campos de peer.

2. **RF-002 — Extração do benchmark:** `extractFIIDetalhes` deverá localizar o box cujo título normalizado corresponda a "Média Tipo/Segmento" e extrair exclusivamente dele P/VP médio, DY 12M médio, Valor Patrimonial médio e VPA médio.

3. **RF-003 — Identificação do grupo:** O scraper deverá capturar, quando disponível, o nome do grupo usado pelo Investidor10 e classificá-lo como `SEGMENTO`, `TIPO` ou `NAO_INFORMADO`. O grupo do benchmark não deverá sobrescrever automaticamente o campo genérico `ativos.segmento`.

4. **RF-004 — Normalização numérica:** O parser deverá aceitar formatos brasileiros com ponto de milhar, vírgula decimal, símbolo de moeda, percentual e sufixos como mil, milhão, milhões, bi e bilhão. Valores vazios, não numéricos, negativos ou incompatíveis com o indicador deverão ser tratados como ausentes, nunca como zero.

5. **RF-005 — Snapshot atômico:** O conjunto de benchmark somente será substituído quando grupo, P/VP médio, DY médio e VPA médio forem extraídos e validados na mesma página. Em extração parcial, o snapshot anterior será preservado sem alteração do timestamp, e o ticker será reportado com aviso.

6. **RF-006 — Atualização individual e em lote:** Os fluxos Electron `scraper:enriquecer-fii` e `scraper:enriquecer-todos` deverão persistir os novos campos. A atualização em lote deverá continuar após falha individual e retornar total, sucessos, falhas, avisos e dados extraídos por ticker.

7. **RF-007 — Rastreabilidade:** Cada snapshot válido deverá armazenar fonte e horário UTC da coleta. A interface deverá mostrar esses dados no detalhe e sinalizar como desatualizado qualquer benchmark com idade superior ao valor configurado em `peer_validade_horas`.

8. **RF-008 — Cálculo de P/VP vs peer:** O backend deverá calcular `pvp_vs_peer_pct = ((p_vp / pvp_medio_segmento) - 1) × 100`. Resultado negativo significa desconto relativo; resultado positivo significa prêmio relativo.

9. **RF-009 — Cálculo de DY vs peer:** O backend deverá calcular `dy_vs_peer_pct = ((dy_12m / dy_medio_segmento) - 1) × 100`. Resultado positivo significa DY superior à média, sem implicar que o rendimento seja sustentável.

10. **RF-010 — Cálculo de VPA vs peer:** O backend deverá calcular `vpa_vs_peer_pct = ((vp_cota / vpa_medio_segmento) - 1) × 100`. O resultado será informativo e não participará do preço-teto nem da priorização, pois o valor nominal por cota não representa, isoladamente, prêmio ou desconto.

11. **RF-011 — Classificação geral:** Um benchmark atualizado será classificado como `DESFAVORAVEL` quando P/VP estiver pelo menos 5% acima da média ou DY estiver pelo menos 10% abaixo; será `FAVORAVEL` quando P/VP estiver pelo menos 5% abaixo e DY não estiver mais de 5% abaixo. Os demais casos serão `NEUTRO`, e a condição desfavorável terá precedência em sinais conflitantes.

12. **RF-012 — Colunas em Posições:** A tabela Posições deverá adicionar as colunas "P/VP vs peer", "DY vs peer" e "VPA vs peer". Cada célula mostrará o desvio percentual, um rótulo textual e um estado específico para dado ausente ou vencido.

13. **RF-013 — Detalhe por FII:** Ao acionar qualquer célula de peer, o usuário deverá acessar um popover ou painel com valor do FII, média do grupo, desvio, grupo usado, classificação, fonte, horário da coleta e explicação da fórmula.

14. **RF-014 — Ordenação:** As três colunas de peer deverão ser ordenáveis, mantendo valores ausentes ou não aplicáveis ao final. A ordenação padrão de Posições continuará sendo por ticker.

15. **RF-015 — Referência de preço do peer:** Para benchmark válido e atualizado, o backend deverá calcular `preco_referencia_peer = vp_cota × pvp_medio_segmento`. Esse valor representa o preço teórico da cota caso o FII negociasse no P/VP médio do grupo.

16. **RF-016 — Preço-teto efetivo:** Quando existirem preço-teto base e referência peer válidos, deverá ser aplicado `preco_teto_efetivo = MIN(preco_teto, preco_referencia_peer × (1 + peer_margem_teto_pct / 100))`. O benchmark nunca poderá aumentar o preço-teto base; na ausência de teto base, a referência peer será apenas informativa e não criará um sinal de compra.

17. **RF-017 — Compatibilidade com "Muito bom":** O campo `preco_muito_bom` não será sobrescrito. O ativo somente poderá receber o sinal "Muito barato" quando o preço atual atender simultaneamente ao limite "Muito bom" existente e ao preço-teto efetivo.

18. **RF-018 — Tela Preço-teto:** A tela deverá mostrar preço atual, preço-teto base, referência peer, preço-teto efetivo, regra limitante (`DY_BASE`, `PEER_PVP` ou `FALLBACK_SEM_PEER`) e sinal. Todos os sinais de preço usados pela tela e pelo rebalanceamento deverão vir da mesma função de domínio no backend.

19. **RF-019 — Simulação de rebalanceamento:** O usuário poderá informar um aporte e obter quantidades inteiras sugeridas para FIIs ativos, abaixo da alocação-alvo, com cotação válida e preço atual menor ou igual ao preço-teto efetivo. A simulação não deverá sugerir vendas nem persistir lançamentos.

20. **RF-020 — Lacuna de alocação:** Para cada FII, o rebalanceamento deverá calcular `gap_alvo = MAX(0, alvo_pct_carteira / 100 × (patrimonio_atual + aporte) - saldo_atual)`. Ativos sem lacuna suficiente para adquirir ao menos uma cota não serão selecionados.

21. **RF-021 — Peso do peer no rebalanceamento:** O peso inicial será `gap_alvo × multiplicador_peer`, usando 1,15 para `FAVORAVEL`, 1,00 para `NEUTRO` ou fallback e 0,75 para `DESFAVORAVEL`. A verba será distribuída proporcionalmente aos pesos, limitada pela lacuna de cada ativo, arredondada para cotas inteiras e redistribuída enquanto houver saldo capaz de comprar uma cota elegível.

22. **RF-022 — Fallback seguro:** Benchmark ausente, incompleto ou vencido deverá resultar em multiplicador neutro e uso exclusivo do preço-teto base. A resposta deverá declarar `benchmark_aplicado: false` e o motivo do fallback.

23. **RF-023 — Explicação da sugestão:** Cada item sugerido deverá informar quantidade, valor, lacuna antes e depois, classificação peer, multiplicador, preço-teto base, preço de referência peer, preço-teto efetivo e regra limitante. FIIs ignorados deverão ser retornados com motivos como `SEM_COTACAO`, `SEM_TETO`, `ACIMA_DO_TETO`, `SEM_GAP` ou `PEER_DESATUALIZADO_COM_FALLBACK`.

24. **RF-024 — Preservação das configurações do usuário:** Atualizações do scraper não poderão modificar `dy_minimo`, `preco_teto`, `preco_muito_bom`, `alvo_pct_carteira`, `nota`, `observacao` ou outros campos editáveis pelo usuário.

25. **RF-025 — Mensagem de escopo:** A simulação deverá ser identificada como apoio ao rebalanceamento, e não como recomendação personalizada de compra. A interface deverá informar que média do segmento e DY não substituem análise de risco, qualidade, liquidez e sustentabilidade dos rendimentos.

---

## 4. Requisitos Não-Funcionais

### Performance

- Endpoints de leitura deverão responder em menos de 150 ms no p95 para até 500 ativos em máquina de referência.
- A simulação de rebalanceamento deverá concluir em menos de 300 ms no p95 para até 500 posições.
- A tabela Posições deverá apresentar conteúdo utilizável em até 500 ms após a resposta da API.
- O enriquecimento continuará sequencial para evitar carga excessiva no Investidor10, com timeout individual de 15 segundos e progresso por ticker.

### Privacidade

- Posições, metas, preço-teto, benchmarks e simulações permanecerão no SQLite local.
- O banco continuará armazenado no diretório `userData` do Electron, normalmente `~/.config/byeinss/byeinss.db` no Linux.
- Cookies e autenticação do Investidor10 permanecerão na partição Electron `persist:investidor10`.
- Nenhuma telemetria, carteira ou sugestão será enviada a serviços remotos sem consentimento explícito.

### Segurança

- A navegação do scraper continuará restrita ao domínio permitido do Investidor10.
- Dados extraídos do DOM serão tratados como entrada não confiável e validados antes da persistência.
- Valores vindos da API deverão ser escapados antes da inclusão no HTML.
- O endpoint de rebalanceamento aceitará somente valores numéricos finitos e positivos dentro do limite operacional definido pela aplicação.

### Compatibilidade

- A feature deverá funcionar com Electron, Node, Express 4, better-sqlite3 e o frontend vanilla JS existentes.
- Registros anteriores à migração, com colunas peer nulas, deverão continuar legíveis.
- Endpoints existentes deverão manter os campos atuais e apenas adicionar propriedades, evitando quebra do frontend ou de importadores.
- `/home/cristian/byeINSS/db/init.sql` e o schema inline de fallback em `/home/cristian/byeINSS/src/server/db.js` deverão permanecer equivalentes.

### Confiabilidade e integridade

- A migração deverá ser transacional e executada uma única vez por versão de schema.
- Falha em um ticker não poderá cancelar o enriquecimento dos demais.
- O snapshot peer deverá ser atualizado como unidade lógica, evitando combinações de métricas coletadas em momentos diferentes.
- Dados vencidos poderão ser exibidos com aviso, mas não poderão restringir ou favorecer silenciosamente uma simulação.

### Manutenibilidade e testes

- O parser do box deverá ser isolado e testável com fixtures HTML.
- Fórmulas de comparação, preço-teto efetivo, classificação e rebalanceamento deverão residir no backend e possuir testes unitários determinísticos.
- Textos de label do Investidor10 deverão ser normalizados e mapeados por aliases, sem depender exclusivamente de seletores CSS voláteis.
- Erros do scraper deverão registrar localmente ticker, etapa e mensagem, sem registrar cookies ou conteúdo sensível.

---

## 5. Modelo de Dados

### Schema para instalações novas

A definição de `ativos` em `/home/cristian/byeINSS/db/init.sql` deverá passar a ser:

```sql
CREATE TABLE IF NOT EXISTS ativos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL DEFAULT 'FII',
  segmento TEXT,
  razao_social TEXT,
  cnpj TEXT,
  gestor TEXT,
  taxa_adm REAL,
  nota INTEGER DEFAULT 5,
  observacao TEXT,
  dy_minimo REAL,
  preco_teto REAL,
  preco_muito_bom REAL,
  p_vp REAL,
  vp_cota REAL,
  vacancia REAL,
  num_imoveis INTEGER,
  dy_12m REAL,
  dy_24m REAL,
  ultimo_dividendo REAL,
  ultimo_pagto TEXT,
  pvp_medio_segmento REAL,
  dy_medio_segmento REAL,
  pl_medio_segmento REAL,
  vpa_medio_segmento REAL,
  peer_grupo_nome TEXT,
  peer_grupo_tipo TEXT,
  peer_fonte TEXT,
  peer_atualizado_em TEXT,
  alvo_pct_carteira REAL DEFAULT 1.76,
  ativo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Os mesmos campos deverão ser adicionados ao `CREATE TABLE` de fallback em `/home/cristian/byeINSS/src/server/db.js`.

### Migração de instalações existentes

A migração deverá ser executada somente quando `versao_schema` for inferior a `1.2`:

```sql
BEGIN IMMEDIATE;

ALTER TABLE ativos ADD COLUMN pvp_medio_segmento REAL;
ALTER TABLE ativos ADD COLUMN dy_medio_segmento REAL;
ALTER TABLE ativos ADD COLUMN pl_medio_segmento REAL;
ALTER TABLE ativos ADD COLUMN vpa_medio_segmento REAL;
ALTER TABLE ativos ADD COLUMN peer_grupo_nome TEXT;
ALTER TABLE ativos ADD COLUMN peer_grupo_tipo TEXT;
ALTER TABLE ativos ADD COLUMN peer_fonte TEXT;
ALTER TABLE ativos ADD COLUMN peer_atualizado_em TEXT;

INSERT OR IGNORE INTO config (chave, valor) VALUES
  ('peer_desvio_neutro_pct', '5.0'),
  ('peer_dy_desfavoravel_pct', '10.0'),
  ('peer_validade_horas', '168'),
  ('peer_margem_teto_pct', '0.0'),
  ('peer_multiplicador_favoravel', '1.15'),
  ('peer_multiplicador_neutro', '1.00'),
  ('peer_multiplicador_desfavoravel', '0.75');

INSERT INTO config (chave, valor)
VALUES ('versao_schema', '1.2')
ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor;

COMMIT;
```

Como o SQLite não suporta `ADD COLUMN IF NOT EXISTS`, o runner deverá consultar `PRAGMA table_info(ativos)` e `config.versao_schema` antes de executar os comandos. A transação inteira deverá ser revertida se qualquer coluna obrigatória não puder ser criada.

### Migração dos dados existentes

- Não haverá inferência ou backfill de médias com base nos FIIs presentes na carteira.
- Os novos campos permanecerão `NULL` até o primeiro enriquecimento bem-sucedido.
- A migração não deverá alterar `updated_at`, preço-teto, DY mínimo, segmento ou qualquer configuração definida pelo usuário.
- Após a migração, o primeiro enriquecimento completo deverá apresentar o resumo de cobertura e os tickers sem benchmark.

### Dicionário dos novos campos

| Campo | Tipo | Nulo | Descrição |
|---|---|---:|---|
| `pvp_medio_segmento` | REAL | Sim | P/VP médio informado no box |
| `dy_medio_segmento` | REAL | Sim | DY 12M médio do grupo, em percentual |
| `pl_medio_segmento` | REAL | Sim | Valor patrimonial total médio do grupo; armazenado para rastreabilidade, sem uso no score desta versão |
| `vpa_medio_segmento` | REAL | Sim | Valor patrimonial médio por cota |
| `peer_grupo_nome` | TEXT | Sim | Nome do segmento ou tipo informado pela fonte |
| `peer_grupo_tipo` | TEXT | Sim | `SEGMENTO`, `TIPO` ou `NAO_INFORMADO` |
| `peer_fonte` | TEXT | Sim | Inicialmente `investidor10` |
| `peer_atualizado_em` | TEXT | Sim | Data e hora UTC do snapshot válido |

### Campos calculados, não persistidos

```text
pvp_vs_peer_pct =
  ((p_vp / pvp_medio_segmento) - 1) * 100

dy_vs_peer_pct =
  ((dy_12m / dy_medio_segmento) - 1) * 100

vpa_vs_peer_pct =
  ((vp_cota / vpa_medio_segmento) - 1) * 100

preco_referencia_peer =
  vp_cota * pvp_medio_segmento

preco_teto_efetivo =
  MIN(
    preco_teto,
    preco_referencia_peer * (1 + peer_margem_teto_pct / 100)
  )
```

Divisão por zero, denominador ausente, valor não finito ou benchmark vencido deverá produzir `NULL` para o cálculo afetado.

---

## 6. APIs / Endpoints

| Método | Rota | Request | Response | Erros |
|---|---|---|---|---|
| GET, alterado | `/api/ativos?tipo=FII&ativo_only=1` | Query opcional existente | Array atual acrescido de `pvp_medio_segmento`, `dy_medio_segmento`, `vpa_medio_segmento`, metadados e objeto calculado `peer` | `400` para filtros inválidos; `500` para erro local |
| GET, novo | `/api/fiis/:ticker/comparativo-peer` | Ticker B3, por exemplo `HGLG11` | Valores próprios, médias, desvios, classificação, grupo, frescor, fórmulas e referência de preço | `400` para ticker inválido; `404` para ativo inexistente; ausência de benchmark retorna `200` com estado `SEM_DADOS` |
| GET, alterado | `/api/dashboard/sinais` | Sem body | Sinais com `preco_teto_base`, `preco_referencia_peer`, `preco_teto_efetivo`, `benchmark_aplicado`, `regra_limitante`, `ratio_preco_teto` e `sinal` | `500` para erro de cálculo ou banco |
| POST, novo | `/api/dashboard/rebalanceamento` | `{ "aporte": 2000 }` | Totais da simulação, sugestões, sobra e FIIs ignorados com justificativas | `400` para aporte ausente, não finito ou ≤ 0; estado sem candidatos retorna `200` com lista vazia; `500` para erro interno |

### Exemplo de comparativo por FII

```json
{
  "ticker": "HGLG11",
  "grupo": {
    "nome": "Logístico",
    "tipo": "SEGMENTO",
    "fonte": "investidor10",
    "atualizado_em": "2026-07-19T14:30:00.000Z",
    "desatualizado": false
  },
  "pvp": {
    "fii": 0.89,
    "peer": 0.95,
    "desvio_pct": -6.32
  },
  "dy_12m": {
    "fii": 9.8,
    "peer": 9.1,
    "desvio_pct": 7.69
  },
  "vpa": {
    "fii": 101.2,
    "peer": 96.7,
    "desvio_pct": 4.65,
    "uso": "INFORMATIVO"
  },
  "classificacao": "FAVORAVEL",
  "preco_referencia_peer": 96.14
}
```

### Exemplo de resposta do rebalanceamento

```json
{
  "aporte": 2000,
  "patrimonio_antes": 100000,
  "patrimonio_projetado": 102000,
  "valor_alocado": 1916.50,
  "sobra": 83.50,
  "sugestoes": [
    {
      "ticker": "HGLG11",
      "quantidade": 5,
      "preco_unitario": 158.30,
      "valor": 791.50,
      "gap_alvo_antes": 1100,
      "gap_alvo_depois": 308.50,
      "classificacao_peer": "FAVORAVEL",
      "multiplicador_peer": 1.15,
      "preco_teto_base": 170,
      "preco_referencia_peer": 165,
      "preco_teto_efetivo": 165,
      "regra_limitante": "PEER_PVP",
      "benchmark_aplicado": true
    }
  ],
  "ignorados": [
    {
      "ticker": "XPTO11",
      "motivo": "ACIMA_DO_TETO"
    }
  ]
}
```

### Contratos Electron relacionados

Os contratos IPC existentes serão alterados sem mudança de nome:

- `scraper:enriquecer-fii` passará a retornar também `benchmark`, `avisos` e `snapshot_valido`.
- `scraper:enriquecer-todos` passará a retornar `cobertura_peer`, `falhas` e `avisos`, além dos totais atuais.
- O frontend não deverá persistir médias diretamente; a gravação continuará sob responsabilidade do processo principal.

---

## 7. UI / UX

### Frame 1 — Posições com colunas vs peer

```text
+------------------------------------------------------------------------------------------+
| POSIÇÕES                                           [Atualizar dados] [Adicionar ativo]   |
| Benchmark atualizado há 2h - cobertura: 18 de 20 FIIs                                   |
+----------+------------+-------+--------+---------------+-------------+-------------------+
| Ticker   | Segmento   | P/VP  | DY 12M | P/VP vs peer | DY vs peer  | VPA vs peer       |
+----------+------------+-------+--------+---------------+-------------+-------------------+
| HGLG11   | Logístico  | 0,89  | 9,80%  | -6,3% Desconto| +7,7% Acima | +4,7% Informativo |
| KNRI11   | Híbrido    | 1,03  | 7,60%  | +5,1% Prêmio  | -8,2% Abaixo| -2,0% Informativo |
| NOVO11   | Logístico  | 0,94  |   --   | Dados ausentes| Dados aus.  | Dados ausentes     |
+----------+------------+-------+--------+---------------+-------------+-------------------+
| Acione um comparativo para ver valores, grupo, fórmula, fonte e horário.                 |
+------------------------------------------------------------------------------------------+
```

### Frame 2 — Comparativo detalhado do FII

```text
+--------------------------------------------------------------+
| HGLG11 - Comparativo com Logístico                     [X]   |
| Fonte: Investidor10 | Atualizado em 19/07/2026 11:30         |
+----------------+-------------+-------------+-----------------+
| Indicador      | HGLG11      | Média peer  | Diferença       |
+----------------+-------------+-------------+-----------------+
| P/VP           | 0,89        | 0,95        | -6,3% Desconto  |
| DY 12M         | 9,80%       | 9,10%       | +7,7% Acima     |
| VPA            | R$ 101,20   | R$ 96,70    | +4,7% Inform.   |
+----------------+-------------+-------------+-----------------+
| Classificação geral: FAVORÁVEL                               |
| Referência peer: R$ 96,14                                    |
| VPA nominal é contextual e não participa da classificação.  |
+--------------------------------------------------------------+
```

### Frame 3 — Preço-teto com benchmark

```text
+------------------------------------------------------------------------------------------------+
| PREÇO-TETO E BENCHMARK                                                                         |
+---------+---------+------------+------------+---------------+----------------+-----------------+
| Ticker  | Atual   | Teto base  | Ref. peer  | Teto efetivo  | Regra limitante| Sinal           |
+---------+---------+------------+------------+---------------+----------------+-----------------+
| HGLG11  | 158,30  | 170,00     | 165,00     | 165,00        | PEER P/VP      | NO TETO         |
| KNRI11  | 162,00  | 155,00     | 171,00     | 155,00        | DY BASE        | CARO            |
| NOVO11  |  91,00  |  95,00     | --         |  95,00        | SEM PEER       | NO TETO         |
+---------+---------+------------+------------+---------------+----------------+-----------------+
| O benchmark pode reduzir o teto efetivo, mas nunca elevar o teto base.                          |
+------------------------------------------------------------------------------------------------+
```

### Frame 4 — Simulação de rebalanceamento

```text
+----------------------------------------------------------------------------------+
| REBALANCEAMENTO SUGERIDO                                                         |
| Aporte disponível: [ R$ 2.000,00 ]                         [Calcular sugestão]   |
+---------+------+----------+----------+------------+------------+------------------+
| Ticker  | Qtd  | Valor    | Gap alvo | Peer       | Teto efet. | Motivo           |
+---------+------+----------+----------+------------+------------+------------------+
| HGLG11  | 5    | 791,50   | 1.100,00 | Favorável  | 165,00     | Abaixo da meta   |
| MXRF11  | 62   | 625,58   |   900,00 | Neutro     |  10,20     | Abaixo da meta   |
| VILG11  | 6    | 499,42   |   620,00 | Desfavor.  |  84,00     | Peso reduzido    |
+---------+------+----------+----------+------------+------------+------------------+
| Alocado: R$ 1.916,50 | Sobra: R$ 83,50                                       |
| [Ver ativos ignorados]                                           [Fechar]        |
+----------------------------------------------------------------------------------+
```

### Estados de interface

- **Loading:** skeleton nas linhas e mensagem "Carregando comparativos"; durante enriquecimento, mostrar progresso `ticker atual / total`.
- **Empty — sem posições:** informar que não há FIIs com quantidade positiva e oferecer acesso a "Adicionar ativo" ou "Importar".
- **Empty — sem benchmark:** mostrar "Sem média do segmento" e ação "Atualizar dados", sem exibir `0,00`.
- **Desatualizado:** manter o último valor visível com rótulo "Desatualizado", horário da coleta e aviso de que ele não foi aplicado à simulação.
- **Parcial:** mostrar somente comparações matematicamente válidas e classificação geral "Dados incompletos".
- **Error — API:** preservar o layout da página, mostrar mensagem sanitizada e ação "Tentar novamente".
- **Error — scraper individual:** mostrar ticker, etapa que falhou e permitir nova tentativa sem descartar os sucessos.
- **Success:** exibir desvios, classificação, fonte e horário; após enriquecimento, apresentar cobertura e quantidade de avisos.
- **Sem candidatos ao rebalanceamento:** explicar os motivos agregados, como "Todos os FIIs estão acima do teto" ou "Aporte insuficiente para uma cota".
- **Fallback:** mostrar explicitamente "Benchmark não aplicado; usando preço-teto base".

### Acessibilidade

- Cores não serão o único meio de comunicação; chips deverão conter "Desconto", "Prêmio", "Acima", "Abaixo", "Favorável", "Neutro" ou "Desfavorável".
- Todas as tabelas deverão ter `caption`, cabeçalhos com `scope="col"` e associação clara entre ticker e valores.
- Células interativas deverão ser botões acessíveis por teclado, com foco visível e `aria-describedby`.
- Tooltips e painéis deverão abrir por clique, Enter ou Espaço, fechar por Escape e devolver o foco ao elemento de origem.
- O leitor de tela deverá receber descrições como "P/VP 6,3 por cento abaixo da média do segmento Logístico".
- Estados de atualização e conclusão do scraper deverão usar região `aria-live="polite"`.
- Textos, chips, bordas de foco e estados de erro deverão atender contraste WCAG 2.1 AA.
- A tabela deverá manter rolagem horizontal sem ocultar o ticker e sem exigir interação por hover.

---

## 8. Casos de Borda

1. **Segmento com apenas um FII:** Se a fonte não fornecer uma média representativa, o estado será `SEM_DADOS`; o próprio valor do FII não poderá ser tratado como benchmark válido.

2. **Grupo informado como tipo, não segmento:** O valor poderá ser exibido, mas deverá ser identificado como média por `TIPO`. A interface não poderá rotulá-lo falsamente como segmento específico.

3. **Mudança de segmento:** Um novo snapshot com grupo diferente substituirá o grupo anterior somente se todo o conjunto obrigatório for válido. O detalhe deverá passar a exibir o novo grupo e timestamp.

4. **Divergência entre `segmento` e `peer_grupo_nome`:** Ambos serão preservados; `segmento` continuará sendo o cadastro do ativo e `peer_grupo_nome` identificará a taxonomia usada pela fonte.

5. **Extração parcial do box:** Nenhum campo do snapshot anterior será misturado com o novo conjunto parcial. O ticker será marcado com aviso e manterá a data anterior.

6. **Mudança no DOM ou nos labels do I10:** O parser deverá falhar de forma controlada, sem capturar valores de outros boxes e sem zerar dados existentes.

7. **P/VP médio ou VPA médio igual a zero ou negativo:** O benchmark será inválido para o cálculo correspondente e não será aplicado ao preço-teto.

8. **DY médio igual a zero:** O desvio relativo de DY será `NULL`; nenhum infinito ou divisão por zero poderá chegar à API ou à interface.

9. **FII sem P/VP, DY 12M ou VPA próprio:** Cada comparação afetada mostrará "Dado do FII ausente". O benchmark armazenado poderá continuar válido para consulta, mas não para classificação completa.

10. **FII recém-listado:** A ausência de média ou DY 12M não será interpretada como baixo desempenho. O estado deverá permanecer neutro ou incompleto.

11. **VPA muito acima ou abaixo da média:** O desvio será exibido como contexto, sem chip de caro/barato e sem impacto no rebalanceamento.

12. **Benchmark vencido:** Os valores antigos poderão ser consultados, mas preço-teto efetivo e multiplicador de rebalanceamento usarão fallback neutro.

13. **Preço-teto base ausente:** A referência peer será exibida, porém o ativo receberá `SEM_TETO` e não entrará na sugestão de compra.

14. **Cotação ausente ou inválida:** Não será possível calcular sinal, quantidade ou valor de compra; o ativo será listado entre os ignorados como `SEM_COTACAO`.

15. **Aporte pequeno, ativo sobrealocado ou todos acima do teto:** A API retornará uma simulação válida com lista vazia ou sobra, sem forçar compra nem ultrapassar a alocação-alvo.

---

## 9. Dependências

- Função `extractFIIDetalhes` e fluxo de enriquecimento existentes em `/home/cristian/byeINSS/src/main/scraper.js`.
- Sessão Electron autenticada ou acesso à página pública do Investidor10.
- IPCs registrados em `/home/cristian/byeINSS/src/main/main.js` e expostos por `/home/cristian/byeINSS/src/preload/preload.js`.
- Schema base em `/home/cristian/byeINSS/db/init.sql`.
- Criação de um mecanismo de migração por versão, pois o `CREATE TABLE IF NOT EXISTS` atual não adiciona colunas em bancos existentes.
- Dados próprios já existentes: `p_vp`, `dy_12m`, `vp_cota`, `preco_teto`, `preco_muito_bom`, `alvo_pct_carteira`, cotação atual e quantidade.
- Endpoints `/api/ativos`, `/api/dashboard/resumo` e `/api/dashboard/sinais`.
- Telas Posições e Preço-teto em `/home/cristian/byeINSS/src/renderer/js/pages.js`.
- Estilos de tabela, chips, foco e estados em `/home/cristian/byeINSS/src/renderer/css/styles.css`.
- Fixtures HTML representativas do box do Investidor10 para testes do parser.
- A feature não depende de histórico de dividendos, DY médio de cinco anos, Score Buy &amp; Hold ou watchlist.

---

## 10. Esforço Estimado

**Estimativa total:** 8,5 a 10,5 dias úteis de uma pessoa desenvolvedora, com referência de 9,5 dias.

| Área | Esforço |
|---|---:|
| Mapeamento do DOM, aliases e fixtures do box | 1,0 dia |
| Migração, schema inicial e fallback inline | 1,0 dia |
| Parser e persistência individual/em lote | 1,5 dia |
| Serviço de comparação, preço-teto e APIs | 1,5 dia |
| Algoritmo e endpoint de rebalanceamento | 1,0 dia |
| UI de Posições e detalhe do comparativo | 1,0 dia |
| UI de Preço-teto e rebalanceamento | 1,0 dia |
| Testes unitários, integração e regressão | 1,0 dia |
| Acessibilidade, estados de erro e QA final | 0,5 dia |

A estimativa pode aumentar se o box apresentar estruturas DOM diferentes por tipo de FII, conteúdo carregado de forma assíncrona ou bloqueios adicionais de navegação.

---

## 11. Riscos &amp; Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Alteração do DOM ou dos labels do Investidor10 | Extração incorreta ou cobertura reduzida | Parser limitado ao box, aliases normalizados, fixtures, validação semântica e falha segura sem sobrescrever snapshot válido |
| Metodologia da média não documentada ou mudança de composição | Comparações podem parecer mais precisas do que realmente são | Exibir grupo, tipo, fonte, timestamp e disclaimer; tratar o benchmark como referência, não como valor intrínseco |
| Benchmark desatualizado | Sinal ou sugestão baseada em mercado antigo | Validade padrão de 168 horas, aviso visual e fallback automático para preço-teto base |
| Excesso de confiança na sugestão | Usuário interpretar simulação como recomendação financeira | Fórmulas transparentes, justificativa por linha, papel conservador do peer, VPA fora do score e ausência de execução automática |
| Falha na migração do SQLite local | Indisponibilidade ou perda de dados | Migração transacional, controle de versão, inspeção prévia das colunas, teste em cópia do banco e preservação dos campos existentes |

---

## 12. Out of Scope

- Calcular médias do segmento internamente a partir dos FIIs da carteira.
- Raspar todo o universo de FIIs para construir um benchmark próprio.
- Manter histórico temporal das médias de segmento.
- Comparar Ações, ETFs, Tesouro Direto, Cripto ou outros tipos de ativo.
- Usar Valor Patrimonial total ou VPA nominal na classificação de caro/barato.
- Ajustar o benchmark por qualidade da gestão, vacância, liquidez, risco de crédito, duração ou concentração de inquilinos.
- Definir automaticamente `dy_minimo`, `preco_teto`, `preco_muito_bom` ou `alvo_pct_carteira`.
- Elevar o preço-teto base porque o segmento negocia com múltiplos maiores.
- Sugerir vendas, zeragem, redução de posição ou realização de lucro.
- Criar lançamentos de compra automaticamente ou integrar com corretoras.
- Permitir edição manual das médias obtidas da fonte nesta versão.
- Substituir análise fundamentalista ou produzir recomendação personalizada de investimento.
