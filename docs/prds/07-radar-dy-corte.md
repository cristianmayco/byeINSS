# PRD: Radar de DY Suspeito — Alerta de Corte Iminente

## 1. Visão Geral

O Radar de DY Suspeito identifica FIIs cujo Dividend Yield dos últimos 12 meses está anormalmente acima da média histórica. O principal indicador será a razão entre `dy_12m` e `dy_medio_5a`, com níveis de atenção configuráveis. Um DY elevado pode decorrer de queda acentuada da cotação, pagamento não recorrente ou deterioração dos proventos, situações que merecem revisão antes de novos aportes.

A feature exibirá um alerta consolidado no Dashboard e um badge de status em cada FII da tabela de Posições. O cálculo será local, determinístico e explicável, sem recomendar automaticamente compra ou venda.

### Problemas que resolve

1. **Anomalias de DY passam despercebidas:** o usuário vê um DY elevado como oportunidade, mas não percebe que ele está muito distante do histórico do fundo.
2. **Falta de priorização na revisão da carteira:** o usuário precisa comparar manualmente cada FII com sua média histórica para encontrar possíveis riscos.
3. **Análise inconsistente:** sem thresholds centralizados, o critério de “DY muito alto” varia entre telas, momentos e avaliações do usuário.

### Personas e casos de uso

#### Persona 1 — Investidor de renda mensal

Mantém uma carteira de FIIs para geração de renda e acompanha os proventos mensalmente.

- Ao abrir o Dashboard, quer saber imediatamente se algum FII apresenta DY fora do padrão.
- Antes de realizar um novo aporte, quer verificar se o DY elevado pode representar uma armadilha.
- Quer priorizar quais posições precisam de análise fundamentalista.

#### Persona 2 — Investidor avançado

Compara indicadores históricos e ajusta seus próprios critérios de risco.

- Quer configurar os limites amarelo e vermelho.
- Quer visualizar o valor do DY atual, a média histórica e a razão calculada.
- Quer usar a tendência recente dos proventos como contexto adicional.

#### Persona 3 — Investidor iniciante

Pode interpretar DY alto como sinal exclusivamente positivo.

- Precisa de mensagens claras explicando que DY elevado não garante renda sustentável.
- Precisa distinguir “atenção” de “risco elevado” sem depender apenas de cores.
- Quer entender por que um fundo recebeu determinado badge.

---

## 2. Objetivos &amp; Métricas de Sucesso

### Objetivos mensuráveis

1. Classificar 100% dos FIIs elegíveis da carteira como `NORMAL`, `AMARELO` ou `VERMELHO` em cada atualização dos dados.
2. Exibir o mesmo nível, razão e mensagem para um FII no Dashboard e na tabela de Posições, sem divergências entre telas.
3. Permitir que o usuário altere os dois thresholds e veja a reclassificação sem reiniciar o aplicativo.
4. Identificar e destacar todos os casos acima dos thresholds configurados em até um ciclo de renderização após sincronização ou alteração da configuração.
5. Garantir que pelo menos 80% dos participantes de um teste moderado compreendam que o alerta indica necessidade de revisão, e não uma ordem de venda.

### KPIs

| KPI | Definição | Meta |
|---|---|---:|
| Cobertura de classificação | FIIs classificados ÷ FIIs com `dy_12m` e `dy_medio_5a` válidos | 100% |
| Cobertura de dados | FIIs elegíveis ÷ FIIs ativos com posição | ≥ 90% após sincronização |
| Consistência entre telas | Casos com classificação divergente entre Dashboard e Posições | 0 |
| Correção de limites | Casos de teste de fronteira aprovados | 100% |
| Persistência da configuração | Configurações mantidas após reiniciar o app | 100% |
| Latência do cálculo | Tempo p95 de resposta para até 500 FIIs | &lt; 100 ms |
| Impacto na renderização | Aumento p95 no carregamento de Dashboard ou Posições | &lt; 200 ms |
| Compreensão do alerta | Usuários que entendem que o alerta não confirma um corte | ≥ 80% |
| Erro ao salvar configuração | Tentativas válidas que não persistem | &lt; 1% em testes |

Os KPIs técnicos poderão ser medidos por testes automatizados e logs locais. Não haverá telemetria externa ou envio de dados da carteira.

---

## 3. Requisitos Funcionais

### Cálculo e elegibilidade

1. **RF-001 — Universo monitorado:** o Radar deverá avaliar todos os ativos do tipo `FII` que estejam ativos e possuam quantidade atual maior que zero. Ativos zerados, inativos ou de outros tipos não deverão aparecer no alerta global.

2. **RF-002 — Fonte primária:** o cálculo deverá utilizar `dy_12m` como DY atual e `dy_medio_5a` como baseline histórico. Ambos deverão ser interpretados na mesma unidade percentual, por exemplo, `12.5` para `12,5%`.

3. **RF-003 — Fórmula:** para cada FII elegível, o backend deverá calcular `ratio = dy_12m / dy_medio_5a`. A razão deverá ser mantida com precisão completa no cálculo e arredondada apenas na apresentação.

4. **RF-004 — Classificação padrão:** com os valores padrão, `ratio &gt; 1.25` deverá resultar em `AMARELO`, e `ratio &gt; 1.50` deverá resultar em `VERMELHO`. Valores menores ou iguais ao threshold amarelo serão classificados como `NORMAL`.

5. **RF-005 — Ordem de avaliação:** o backend deverá avaliar primeiro o limite vermelho e depois o amarelo, garantindo que uma razão acima do limite vermelho nunca seja classificada como amarela.

6. **RF-006 — Fronteiras estritas:** por utilizar o operador “maior que”, uma razão exatamente igual a `1.25` será `NORMAL`, e uma razão exatamente igual a `1.50` será `AMARELO`, com os thresholds padrão. Esse comportamento deverá ser coberto por testes automatizados.

7. **RF-007 — Dados inválidos:** valores ausentes, não numéricos, infinitos, negativos ou `dy_medio_5a = 0` deverão resultar em `SEM_DADOS`, sem gerar alerta amarelo ou vermelho.

8. **RF-008 — Fallback de DY atual:** se `dy_12m` estiver ausente, o sistema poderá calculá-lo por `soma dos proventos elegíveis dos últimos 12 meses / cotação atual × 100`, desde que existam cotação válida e cobertura histórica suficiente. O item deverá informar `fonte_dy_12m = CALCULADO`; sem essas condições, permanecerá como `SEM_DADOS`.

9. **RF-009 — Proventos elegíveis:** cálculos derivados do histórico deverão considerar `DIVIDENDO` e `RENDIMENTO`, excluindo `AMORTIZACAO`, bonificações e outros eventos que não representem rendimento recorrente.

10. **RF-010 — Tendência de proventos:** quando houver pelo menos 12 meses completos de histórico confiável, o sistema deverá comparar a média mensal dos três últimos meses completos com a média mensal móvel dos últimos 12 meses completos. A tendência será apresentada como `EM_QUEDA`, `ESTAVEL` ou `EM_ALTA`, usando variação de `-15%` e `+15%` como limites iniciais.

11. **RF-011 — Papel da tendência:** a tendência dos proventos será contexto explicativo e não alterará a classificação baseada na razão de DY na primeira versão. Se a tendência não puder ser calculada, o alerta principal continuará disponível quando `dy_12m` e `dy_medio_5a` forem válidos.

### Dashboard

12. **RF-012 — Alerta global:** o Dashboard deverá apresentar um componente “Radar de DY” com as quantidades de FIIs em nível vermelho, amarelo e sem dados.

13. **RF-013 — Lista de alertas:** quando houver casos amarelos ou vermelhos, o componente deverá listar os FIIs afetados, exibindo ticker, nível, razão, DY 12M e DY médio de cinco anos.

14. **RF-014 — Ordenação:** os itens do alerta global deverão ser ordenados primeiro por nível, com vermelhos antes dos amarelos, depois por razão decrescente e, em caso de empate, por ticker.

15. **RF-015 — Estado saudável:** quando não houver alertas, o Dashboard deverá exibir um estado compacto de sucesso com a mensagem “Nenhum DY suspeito nos FIIs elegíveis”, sem ocultar a quantidade de ativos sem dados.

16. **RF-016 — Navegação:** clicar ou acionar pelo teclado um item do alerta deverá abrir o detalhamento do Radar para o FII correspondente ou direcionar o usuário à sua linha na tela de Posições.

### Tabela de Posições

17. **RF-017 — Badge por FII:** cada FII da tabela de Posições deverá apresentar um badge na coluna “Radar DY”, inclusive nos estados `NORMAL` e `SEM_DADOS`.

18. **RF-018 — Conteúdo do badge:** o badge deverá combinar texto, ícone e valor resumido, por exemplo, “Crítico · 1,63×”, “Atenção · 1,31×”, “Normal · 1,12×” ou “Sem dados”.

19. **RF-019 — Detalhamento:** ao acionar o badge, o sistema deverá exibir ticker, nível, DY 12M, DY médio de cinco anos, razão, thresholds aplicados, fonte dos dados, tendência recente e data da última atualização disponível.

20. **RF-020 — Explicação:** o detalhamento deverá explicar em linguagem simples por que o FII foi classificado e informar que o indicador não confirma um corte nem constitui recomendação de compra ou venda.

### Configuração

21. **RF-021 — Ativação global:** a tela de Configurações deverá oferecer um controle para ativar ou desativar o Radar de DY. O Radar será habilitado por padrão.

22. **RF-022 — Thresholds configuráveis:** o usuário deverá poder alterar os limites amarelo e vermelho. A interface deverá mostrar simultaneamente a razão persistida e sua interpretação, por exemplo, `1,25×`, equivalente a “25% acima da média”.

23. **RF-023 — Validação:** os valores deverão obedecer a `1.00 &lt; amarelo &lt; vermelho &lt;= 10.00`, com diferença mínima de `0.01`. Valores inválidos não deverão ser persistidos e deverão produzir mensagem de erro específica junto ao campo.

24. **RF-024 — Salvamento atômico:** os dois thresholds deverão ser validados e salvos em uma única operação. Se um deles for inválido, nenhum dos valores deverá ser alterado.

25. **RF-025 — Valores padrão:** a tela deverá oferecer a ação “Restaurar padrões”, que define amarelo como `1.25` e vermelho como `1.50`, solicitando confirmação antes de salvar.

26. **RF-026 — Reclassificação imediata:** após salvar ou restaurar os thresholds, Dashboard e Posições deverão ser reclassificados sem necessidade de reiniciar ou sincronizar novamente os dados.

27. **RF-027 — Radar desativado:** com o Radar desabilitado, alertas e badges de risco deverão ser ocultados, e o Dashboard deverá exibir o estado “Radar de DY desativado” com acesso à configuração.

### Atualização e consistência

28. **RF-028 — Momentos de atualização:** o Radar deverá ser recalculado na abertura das telas, após sincronização dos indicadores, após importação de histórico relevante e após alteração da configuração.

29. **RF-029 — Cálculo centralizado:** Dashboard e Posições deverão consumir a mesma função ou serviço de classificação no backend. A lógica de thresholds não deverá ser duplicada no renderer.

30. **RF-030 — Dados desatualizados:** quando a data disponível indicar dados antigos, o item deverá receber a flag `desatualizado` e exibir “Dados possivelmente desatualizados”. A desatualização não deverá elevar nem reduzir automaticamente o nível calculado.

31. **RF-031 — Falha parcial:** a ausência de dados em um FII não deverá impedir o cálculo dos demais. O resumo deverá separar `SEM_DADOS` das classificações normais e de alerta.

32. **RF-032 — Formatação local:** percentuais deverão ser exibidos no padrão `pt-BR`, enquanto os valores enviados pela API continuarão numéricos e independentes de localização.

### Critérios de aceite globais

- Um FII com `dy_12m = 12.6` e `dy_medio_5a = 10.0`, nos thresholds padrão, é classificado como `AMARELO`.
- Um FII com `dy_12m = 15.1` e `dy_medio_5a = 10.0` é classificado como `VERMELHO`.
- Uma razão exatamente igual a `1.25` é `NORMAL`; uma razão exatamente igual a `1.50` é `AMARELO`.
- Dashboard, Posições e detalhamento exibem o mesmo nível e a mesma razão para o mesmo FII.
- Alterar o threshold vermelho de `1.50` para `1.60` reclassifica imediatamente um FII com razão `1.55` de vermelho para amarelo.
- Reiniciar o Electron mantém as configurações salvas.
- FIIs sem baseline válido aparecem como `SEM_DADOS` e nunca como “Normal”.

---

## 4. Requisitos Não-Funcionais

### Performance

- O cálculo completo deverá responder em menos de 100 ms no percentil 95 para uma carteira de até 500 FIIs, em hardware compatível com os requisitos atuais do app.
- A implementação deverá usar consultas em lote e evitar uma consulta SQL por FII.
- O renderer deverá fazer no máximo uma requisição em lote para obter as classificações da tela de Posições.
- Não será necessário persistir cache na primeira versão; cache poderá ser introduzido se os testes demonstrarem necessidade.

### Privacidade

- Todos os cálculos, configurações e históricos permanecerão no banco SQLite local.
- A feature não deverá enviar tickers, valores da carteira, indicadores ou eventos de uso para serviços externos.
- O Radar deverá funcionar offline após os dados necessários já terem sido sincronizados.

### Segurança

- A API local deverá continuar limitada a `127.0.0.1`.
- Parâmetros de consulta e configuração deverão ser validados antes do uso.
- Consultas deverão usar parâmetros preparados, sem concatenação de valores fornecidos pelo usuário.
- Mensagens de erro apresentadas na UI não deverão expor stack traces, caminhos locais ou SQL.

### Confiabilidade e precisão

- A função de classificação deverá ser determinística para o mesmo conjunto de dados e configuração.
- Cálculos deverão usar valores numéricos sem arredondamento intermediário.
- A UI não deverá converter valores ausentes em zero.
- Casos de fronteira, valores inválidos e precedência de níveis deverão possuir testes unitários.

### Compatibilidade

- A feature deverá funcionar nas mesmas plataformas suportadas atualmente pelo app Electron.
- As alterações no banco deverão ser idempotentes e compatíveis com instalações existentes.
- A ampliação de endpoints existentes não deverá remover ou renomear campos já consumidos pelo renderer.

### Usabilidade

- O significado dos níveis deverá ser compreensível sem conhecimento prévio da fórmula.
- Os textos deverão evitar afirmar que um corte ocorrerá com certeza.
- A configuração deverá apresentar exemplos do efeito de cada threshold.

### Manutenibilidade

- A fórmula e a classificação deverão residir em um módulo de domínio reutilizável pelo Dashboard, Posições e APIs.
- Thresholds padrão não deverão ser duplicados em múltiplos arquivos.
- A resposta da API deverá informar os thresholds efetivamente aplicados, facilitando diagnóstico e testes.

### Observabilidade local

- Falhas de consulta ou cálculo deverão ser registradas apenas nos logs locais do app.
- Os logs não deverão incluir quantidades, patrimônio, observações pessoais ou o histórico completo de operações.
- Erros em um único ativo deverão conter o identificador técnico necessário para diagnóstico sem interromper os demais cálculos.

---

## 5. Modelo de Dados

### Decisão de persistência

Não será criada uma tabela específica para alertas. A classificação deverá ser calculada sob demanda a partir dos indicadores, histórico de proventos e configurações, evitando alertas obsoletos persistidos no banco.

A tabela existente `config(chave, valor)` será reutilizada. A lista de chaves permitidas na API de configuração deverá ser ampliada.

### Novas configurações

| Chave | Tipo lógico | Valor padrão | Descrição |
|---|---|---:|---|
| `radar_dy_habilitado` | Boolean armazenado como texto | `1` | Ativa ou desativa o Radar globalmente |
| `radar_dy_limiar_amarelo` | Decimal armazenado como texto | `1.25` | Razão acima da qual o FII fica amarelo |
| `radar_dy_limiar_vermelho` | Decimal armazenado como texto | `1.50` | Razão acima da qual o FII fica vermelho |

A configuração existente `alerta_dy_limite`, baseada em um DY absoluto, deverá permanecer independente. Ela não deverá ser reutilizada como threshold do Radar, pois mede um conceito diferente.

### Dados existentes utilizados

| Origem | Campo | Uso |
|---|---|---|
| `ativos` | `id` | Identificação do ativo |
| `ativos` | `ticker` | Apresentação e associação entre telas |
| `ativos` | `tipo` | Restringir o Radar a FIIs |
| `ativos` | `ativo` | Restringir o alerta global a posições ativas |
| `ativos` | `dy_12m` | Numerador principal |
| `ativos` | `dy_medio_5a` | Denominador principal, entregue pelo PRD 02 |
| `ativos` | `updated_at` | Referência de atualização quando não houver timestamp mais específico |
| `lancamentos` | `tipo`, `quantidade` | Determinar se existe posição atual |
| `proventos` | `data_pagto` | Construir janelas históricas |
| `proventos` | `valor_por_cota` | Calcular tendência e fallback do DY |
| `proventos` | `tipo` | Excluir amortizações e eventos não recorrentes |
| `cotacoes` | `preco`, `data` | Fallback do `dy_12m` e informação de atualização |

### Campos derivados, não persistidos

| Campo | Tipo | Descrição |
|---|---|---|
| `nivel` | Enum | `NORMAL`, `AMARELO`, `VERMELHO` ou `SEM_DADOS` |
| `ratio` | Decimal | `dy_12m / dy_medio_5a` |
| `fonte_dy_12m` | Enum | `SCRAPER` ou `CALCULADO` |
| `tendencia_proventos` | Enum | `EM_QUEDA`, `ESTAVEL`, `EM_ALTA` ou `INDETERMINADA` |
| `variacao_proventos_pct` | Decimal/null | Variação entre a média recente e a média móvel |
| `meses_historico` | Inteiro | Cobertura histórica conhecida |
| `desatualizado` | Boolean | Indica possível defasagem dos dados |
| `dados_em` | ISO 8601/null | Melhor timestamp de atualização disponível |
| `motivo_sem_dados` | Enum/null | Explica por que o cálculo não foi realizado |

### Migração

A migração deverá inserir as três configurações com `INSERT OR IGNORE`, preservando valores já definidos. Nenhuma nova coluna específica do Radar será obrigatória, além de `dy_medio_5a`, que pertence à dependência PRD 02.

---

## 6. APIs / Endpoints

### Contrato de erro

Novos endpoints deverão retornar erros no formato:

```json
{
  "error": "Descrição legível do erro",
  "code": "INVALID_THRESHOLDS"
}
```

O campo `error` mantém compatibilidade com o padrão atual; `code` permite tratamento específico pela UI.

### Endpoints

| Método | Rota | Request | Response | Erros |
|---|---|---|---|---|
| `GET` | `/api/radar-dy` | Query opcional: `escopo=posicoes`, `nivel=TODOS\|ALERTA\|NORMAL\|AMARELO\|VERMELHO\|SEM_DADOS` | Configuração aplicada, resumo e lista de FIIs classificados | `400 INVALID_QUERY`, `500 RADAR_CALCULATION_ERROR` |
| `GET` | `/api/radar-dy/:ticker` | Ticker na rota | Detalhamento completo de um FII, inclusive se estiver fora da carteira | `404 ATIVO_NOT_FOUND`, `400 INVALID_TICKER`, `500 RADAR_CALCULATION_ERROR` |
| `GET` | `/api/dashboard/alertas` | Sem alteração obrigatória no request | Mantém os alertas existentes e acrescenta itens `tipo = DY_SUSPEITO` | `500 DASHBOARD_ALERTS_ERROR` |
| `GET` | `/api/config` | Sem body | Inclui as três novas chaves com os demais valores de configuração | `500 CONFIG_READ_ERROR` |
| `PUT` | `/api/config` | Body parcial com `radar_dy_habilitado`, `radar_dy_limiar_amarelo` e/ou `radar_dy_limiar_vermelho` | `{ "ok": true, "config": { ... } }` com valores efetivamente persistidos | `400 INVALID_THRESHOLDS`, `400 INVALID_CONFIG_VALUE`, `500 CONFIG_WRITE_ERROR` |

### Exemplo de `GET /api/radar-dy?escopo=posicoes`

```json
{
  "gerado_em": "2026-07-19T15:30:00.000Z",
  "habilitado": true,
  "thresholds": {
    "amarelo": 1.25,
    "vermelho": 1.5
  },
  "resumo": {
    "total_posicoes_fii": 20,
    "elegiveis": 18,
    "normal": 14,
    "amarelo": 3,
    "vermelho": 1,
    "sem_dados": 2
  },
  "itens": [
    {
      "ativo_id": 12,
      "ticker": "EXMP11",
      "nivel": "VERMELHO",
      "dy_12m": 14.7,
      "dy_medio_5a": 9.2,
      "ratio": 1.5978260869,
      "fonte_dy_12m": "SCRAPER",
      "tendencia_proventos": "EM_QUEDA",
      "variacao_proventos_pct": -18.2,
      "meses_historico": 60,
      "desatualizado": false,
      "dados_em": "2026-07-19T10:00:00.000Z",
      "mensagem": "DY 12M está 59,8% acima da média de 5 anos. Risco elevado: revise a sustentabilidade dos proventos."
    }
  ]
}
```

### Exemplo de item sem dados

```json
{
  "ativo_id": 19,
  "ticker": "NOVO11",
  "nivel": "SEM_DADOS",
  "dy_12m": 11.4,
  "dy_medio_5a": null,
  "ratio": null,
  "fonte_dy_12m": "SCRAPER",
  "tendencia_proventos": "INDETERMINADA",
  "meses_historico": 8,
  "motivo_sem_dados": "DY_MEDIO_5A_AUSENTE",
  "mensagem": "Não há média histórica suficiente para avaliar este FII."
}
```

### Exemplo de atualização da configuração

```json
{
  "radar_dy_habilitado": true,
  "radar_dy_limiar_amarelo": 1.3,
  "radar_dy_limiar_vermelho": 1.6
}
```

### Regras da API

- `nivel=ALERTA` equivale à união de `AMARELO` e `VERMELHO`.
- Ausência de dados em um FII deverá retornar HTTP `200` com `nivel = SEM_DADOS`, e não erro HTTP.
- O endpoint em lote deverá executar uma consulta agregada e nunca chamar o endpoint individual repetidamente.
- O endpoint de configuração deverá validar os valores considerando tanto o body recebido quanto os valores já persistidos.
- O Dashboard deverá manter compatibilidade com consumidores existentes de `/api/dashboard/alertas`.

---

## 7. UI / UX

### Frame 1 — Dashboard com alertas

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Dashboard                                             [Sincronizar] │
├──────────────────────────────────────────────────────────────────────┤
│ RADAR DE DY                                      [Configurar]        │
│ 1 crítico  ·  2 em atenção  ·  1 sem dados                          │
│                                                                      │
│ [!!] EXMP11  Crítico   1,60×   DY 14,7% vs média 9,2%  [Revisar]   │
│ [ !] ABCD11  Atenção   1,34×   DY 12,6% vs média 9,4%  [Revisar]   │
│ [ !] XPTO11  Atenção   1,29×   DY 11,9% vs média 9,2%  [Revisar]   │
│                                                                      │
│ DY elevado não confirma corte. Verifique preço, proventos e gestão. │
└──────────────────────────────────────────────────────────────────────┘
```

### Frame 2 — Dashboard sem alertas

```text
┌──────────────────────────────────────────────────────────────────────┐
│ RADAR DE DY                                      [Configurar]        │
│ [✓] Nenhum DY suspeito nos 18 FIIs elegíveis.                       │
│     2 FIIs não puderam ser avaliados.                 [Ver detalhes]│
└──────────────────────────────────────────────────────────────────────┘
```

### Frame 3 — Tabela de Posições

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Posições                                                                │
├─────────┬──────────┬─────────┬────────────┬──────────────────────────────┤
│ Ticker  │ Cotação  │ DY 12M  │ Média 5a   │ Radar DY                     │
├─────────┼──────────┼─────────┼────────────┼──────────────────────────────┤
│ EXMP11  │ R$ 88,20 │ 14,7%   │ 9,2%       │ [!! Crítico · 1,60×]         │
│ ABCD11  │ R$ 96,10 │ 12,6%   │ 9,4%       │ [!  Atenção · 1,34×]         │
│ OKAY11  │ R$ 101,40│ 9,8%    │ 9,1%       │ [✓  Normal · 1,08×]          │
│ NOVO11  │ R$ 94,00 │ 11,4%   │ —          │ [?  Sem dados]               │
└─────────┴──────────┴─────────┴────────────┴──────────────────────────────┘
```

### Frame 4 — Detalhamento e configuração

```text
┌──────────────────────────────────────────────┐
│ EXMP11 — Radar de DY                     [×] │
├──────────────────────────────────────────────┤
│ [!!] Risco elevado                          │
│                                              │
│ DY dos últimos 12 meses          14,7%       │
│ DY médio de 5 anos                9,2%       │
│ Razão                              1,60×      │
│ Acima da média                    +59,8%      │
│ Proventos recentes             Em queda      │
│ Dados atualizados em        19/07/2026       │
│                                              │
│ O DY está acima do limite crítico de 1,50×. │
│ Isso pode refletir queda do preço, evento    │
│ não recorrente ou risco nos proventos.       │
│                                              │
│ Este indicador não é recomendação de venda. │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ Configurações › Radar de DY                  │
├──────────────────────────────────────────────┤
│ Radar habilitado                   [ ON ]    │
│                                              │
│ Atenção a partir de                         │
│ [ 1,25 ] ×   25% acima da média              │
│                                              │
│ Crítico a partir de                         │
│ [ 1,50 ] ×   50% acima da média              │
│                                              │
│ O limite crítico deve ser maior que atenção.│
│                                              │
│ [Restaurar padrões]       [Cancelar] [Salvar]│
└──────────────────────────────────────────────┘
```

### Estados da interface

#### Loading

- Exibir skeleton no componente do Dashboard e na coluna do Radar.
- Não apresentar temporariamente “Normal” enquanto o cálculo estiver pendente.
- Controles de configuração ficam desabilitados durante o salvamento.

#### Empty/sucesso sem alertas

- Exibir “Nenhum DY suspeito nos FIIs elegíveis”.
- Informar separadamente quantos FIIs não puderam ser avaliados.
- Não usar uma área vazia ou ocultar completamente o componente.

#### Success com alertas

- Exibir resumo por nível e lista ordenada.
- Vermelhos devem ter maior destaque visual que amarelos.
- Mostrar no máximo cinco itens inicialmente, com ação “Ver todos” quando necessário.

#### Sem dados

- Badge “Sem dados” com explicação específica no detalhamento.
- Possíveis mensagens: “DY 12M ausente”, “Média de 5 anos ausente”, “Cotação ausente” ou “Histórico insuficiente”.
- Nunca representar ausência de dados como DY `0%`.

#### Dados desatualizados

- Exibir indicador textual “Dados possivelmente desatualizados”.
- Manter a classificação calculada, mas reduzir a ênfase visual e oferecer ação de sincronização quando disponível.

#### Error

- Preservar o restante da tela e mostrar “Não foi possível calcular o Radar de DY”.
- Disponibilizar ação “Tentar novamente”.
- Não reutilizar dados antigos sem identificá-los como desatualizados.

#### Desativado

- Dashboard apresenta componente compacto com “Radar de DY desativado”.
- Badges de Posições ficam ocultos.
- Ação “Ativar” direciona à configuração.

#### Salvando configuração

- Botão “Salvar” apresenta estado de progresso e impede submissão duplicada.
- Em caso de sucesso, exibir confirmação breve e reclassificar os dados.
- Em caso de erro, manter os valores digitados para correção.

### Acessibilidade

- Estados não deverão depender apenas das cores: usar ícone, texto do nível e valor da razão.
- O vermelho deverá ser anunciado como “Risco elevado”; o amarelo, como “Atenção”.
- Badges e itens clicáveis deverão ser acessíveis por `Tab`, `Enter` e `Space`.
- O detalhamento deverá manter foco preso enquanto aberto, fechar com `Esc` e devolver o foco ao elemento de origem.
- Cabeçalhos da tabela deverão usar semântica apropriada e a coluna “Radar DY” deverá possuir nome acessível.
- Mensagens de erro dos campos deverão ser associadas por `aria-describedby`.
- Alterações após salvar thresholds deverão ser anunciadas em uma região `aria-live="polite"`.
- Cores e textos deverão atender, no mínimo, ao WCAG 2.1 AA para contraste.
- Tooltips não deverão ser a única forma de acessar explicações.
- Valores como `1,60×` deverão possuir rótulo acessível equivalente a “uma vírgula sessenta vez a média histórica”.

---

## 8. Casos de Borda

1. **Média histórica nula ou zero:** o FII deve ficar como `SEM_DADOS`; a aplicação não deverá realizar divisão por zero.

2. **DY atual nulo, negativo ou inválido:** o sistema deverá tentar o fallback somente quando histórico e cotação forem suficientes; caso contrário, retornará `SEM_DADOS`.

3. **Razão exatamente no threshold:** `1.25` será `NORMAL` e `1.50` será `AMARELO` nos valores padrão, pois a regra usa comparação estritamente maior.

4. **Razão acima dos dois thresholds:** o FII deverá ser vermelho, nunca amarelo, independentemente da ordem em que as condições forem implementadas.

5. **FII com menos de cinco anos:** se `dy_medio_5a` não estiver disponível, o fundo ficará como `SEM_DADOS`. O sistema não deverá tratar uma média de poucos meses como equivalente automático à média de cinco anos.

6. **Histórico de proventos incompleto:** o cálculo principal poderá ocorrer se os dois DYs forem válidos, mas a tendência será `INDETERMINADA` e a interface deverá informar a cobertura limitada.

7. **Amortização elevada:** amortizações deverão ser excluídas do fallback de DY e da tendência para evitar que devolução de capital seja interpretada como rendimento recorrente.

8. **Pagamento extraordinário:** o Radar poderá ser acionado mesmo sem risco real de corte. O detalhamento deverá orientar o usuário a verificar eventos não recorrentes, sem apresentar a classificação como diagnóstico definitivo.

9. **Dados antigos após falha de sincronização:** a classificação poderá ser exibida com a flag `desatualizado`, acompanhada da data disponível e de uma ação de nova sincronização.

10. **Alteração dos thresholds durante a tela aberta:** todos os componentes visíveis deverão ser reclassificados com a nova configuração, sem manter badges antigos.

11. **Configuração inválida ou corrompida no banco:** o backend deverá usar os padrões `1.25` e `1.50`, registrar a ocorrência localmente e informar na resposta que foi aplicado fallback de configuração.

12. **Duplicidade no histórico:** registros duplicados não deverão inflar o fallback ou a tendência. A deduplicação do PRD 01 deverá ser garantida antes da agregação.

---

## 9. Dependências

### Dependências obrigatórias

1. **PRD 02 — DY médio de cinco anos**
   - Campo `dy_medio_5a` disponível em `ativos`.
   - Scraper capaz de coletar e atualizar o indicador.
   - Unidade e formato compatíveis com `dy_12m`.

2. **PRD 01 — Histórico de dividendos**
   - Histórico persistido em `proventos`.
   - Deduplicação confiável dos registros.
   - Distinção entre dividendos/rendimentos e amortizações.
   - Cobertura suficiente para tendência e fallback.

3. **DY dos últimos 12 meses**
   - Campo `dy_12m` existente e alimentado pelo scraper.
   - Definição documentada da metodologia usada pela fonte.

4. **Cotações**
   - Última cotação disponível para o fallback calculado.
   - Datas suficientes para identificar possível desatualização.

5. **Configuração local**
   - Tabela `config` existente.
   - Ampliação da lista de chaves permitidas no endpoint `/api/config`.
   - Migração idempotente para inserir os valores padrão.

6. **Dashboard e Posições**
   - Componente de alertas do Dashboard disponível para receber o novo tipo.
   - Tabela de Posições preparada para uma nova coluna e detalhamento.
   - Serviço compartilhado de acesso à API no renderer.

### Dependências recomendadas

- Timestamp específico de atualização dos indicadores, caso seja incluído pelo PRD 02.
- Testes com fixtures contendo FIIs normais, amarelos, vermelhos, sem dados e com amortizações.
- Processo de sincronização capaz de notificar as telas após atualizar indicadores e proventos.

---

## 10. Esforço Estimado

Estimativa considerando PRD 01 e PRD 02 concluídos e dados já disponíveis.

| Área | Atividade | Estimativa |
|---|---|---:|
| Produto/UX | Refinamento de mensagens, estados e critérios | 0,25 dia |
| Banco/configuração | Defaults, allowlist e migração idempotente | 0,25 dia |
| Backend | Serviço de cálculo e classificação | 0,50 dia |
| Backend | Consultas em lote, tendência e fallback | 0,50 dia |
| Backend | Endpoints e integração com alertas existentes | 0,50 dia |
| Frontend | Componente global do Dashboard | 0,50 dia |
| Frontend | Badge, coluna e detalhamento em Posições | 0,50 dia |
| Frontend | Configuração e validação dos thresholds | 0,50 dia |
| Testes | Unitários, integração e casos de fronteira | 0,50 dia |
| QA/a11y | Validação visual, teclado, leitores e regressão | 0,50 dia |
| **Total** |  | **4,5 dias** |

### Faixa de planejamento

- **MVP enxuto, sem tendência detalhada:** 2,5 a 3 dias.
- **Escopo completo deste PRD:** 4 a 4,5 dias.
- **Caso PRD 01 ou PRD 02 não estejam concluídos:** adicionar o esforço correspondente dessas dependências, estimado separadamente.

---

## 11. Riscos &amp; Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Usuário interpretar vermelho como ordem de venda | Decisão financeira precipitada | Usar “risco elevado” e “revisar fundamentos”; exibir aviso de que não é recomendação nem confirmação de corte |
| Dados desatualizados ou metodologia inconsistente entre os DYs | Alertas falsos ou ausentes | Exibir data e fonte, validar unidades, sinalizar dados antigos e disponibilizar sincronização |
| Pagamento extraordinário ou queda temporária do preço gerar falso positivo | Perda de confiança no Radar | Mostrar histórico/tendência, mencionar eventos não recorrentes e manter cálculo explicável |
| Thresholds muito sensíveis causarem fadiga de alertas | Usuário ignorar o componente | Permitir configuração, fornecer defaults conservadores e ordenar apenas os casos mais relevantes |
| FIIs novos ou com pouco histórico ficarem sem classificação | Cobertura incompleta | Exibir `SEM_DADOS` explicitamente e não apresentar ausência de informação como normalidade |
| Implementações diferentes no Dashboard e Posições | Classificações contraditórias | Centralizar a lógica no backend e retornar nível e thresholds já calculados |
| Consulta por ativo causar lentidão | Degradação de Dashboard e Posições | Usar agregação em lote, índices existentes e uma única requisição por tela |

---

## 12. Out of Scope

- Prever cortes de dividendos por machine learning ou modelos estatísticos probabilísticos.
- Afirmar que um corte ocorrerá ou estimar sua data e magnitude.
- Recomendar automaticamente compra, venda, manutenção ou redução de posição.
- Executar ordens em corretoras.
- Enviar alertas por push, e-mail, SMS, WhatsApp ou notificações remotas.
- Monitoramento em tempo real ou intraday de preços e DY.
- Thresholds diferentes por FII, segmento ou tipo de gestão.
- Silenciar ou dispensar alertas individualmente.
- Aplicar o Radar a ações, ETFs, BDRs, criptomoedas ou títulos públicos.
- Incluir ativos da Watchlist no alerta global; esta versão cobre somente posições ativas.
- Criar um gráfico histórico completo de DY; o detalhamento mostra apenas indicadores e tendência resumida.
- Coletar `dy_medio_5a` ou implementar o scraper do histórico de dividendos, pois essas entregas pertencem aos PRDs 02 e 01.
- Substituir análise de relatórios gerenciais, fatos relevantes, vacância, inadimplência, emissões ou qualidade da gestão.
- Calcular uma média histórica de DY apenas com dividendos quando não houver histórico de preços comparável.
