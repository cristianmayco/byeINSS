# PRD: Indicadores Históricos de DY e Rentabilidade Real para FIIs

## 1. Visão Geral

O byeINSS passará a capturar, armazenar e exibir o DY médio de 5 anos e as rentabilidades nominal e real de 1, 2 e 5 anos dos FIIs da carteira. Os dados serão extraídos da página pública de cada fundo no Investidor10 durante o fluxo existente de enriquecimento fundamentalista.

A feature adicionará à tela Posições uma comparação direta entre o DY dos últimos 12 meses e o DY médio de 5 anos, além da rentabilidade real de 1 ano. O Dashboard receberá um alerta global quando um ou mais FIIs com posição aberta apresentarem DY 12M abaixo da faixa esperada em relação à média histórica.

### Problemas que resolve

1. **DY atual analisado sem contexto histórico:** um DY isolado não permite identificar se o fundo está distribuindo em linha com seu histórico.
2. **Rentabilidade nominal confundida com ganho real:** o usuário pode interpretar retorno positivo como aumento de poder de compra mesmo quando parte relevante foi consumida pela inflação.
3. **Revisão manual da carteira:** atualmente é necessário abrir individualmente os aproximadamente 17 FIIs em uma fonte externa para identificar desvios de DY e comparar rentabilidades.

### Personas e casos de uso

- **Cotista Buy &amp; Hold de FIIs:** acompanha mensalmente a sustentabilidade dos rendimentos e quer identificar rapidamente fundos cujo DY 12M está abaixo da média de 5 anos.
  - Antes de um novo aporte, consulta o DY atual versus o histórico.
  - Na revisão mensal, verifica quais posições exigem investigação.
  - Diferencia retorno nominal de ganho real.

- **Investidor responsável pelo rebalanceamento da carteira:** compara fundos e períodos para decidir quais posições devem ser revisadas, sem tratar o indicador como recomendação automática de compra ou venda.
  - Ordena os FIIs pelo maior desvio negativo em relação ao DY médio.
  - Consulta rentabilidades nominal e real em 1, 2 e 5 anos.
  - Parte do alerta global no Dashboard para a lista filtrada de posições afetadas.

## 2. Objetivos &amp; Métricas de Sucesso

### Objetivos mensuráveis

1. Capturar e persistir os sete novos indicadores para todos os FIIs elegíveis que tenham esses dados disponíveis na fonte.
2. Permitir que o usuário identifique, em até 10 segundos na tela Posições, quais FIIs estão abaixo de 95% do respectivo DY médio de 5 anos.
3. Consolidar em um único alerta no Dashboard todos os FIIs com desvio histórico classificado como Atenção ou Crítico.
4. Atualizar aproximadamente 17 FIIs em até 120 segundos, em condições normais de rede e sem bloqueio da fonte.
5. Migrar bancos existentes sem perda ou alteração dos dados já registrados.

### KPIs

| KPI | Fórmula | Meta |
|---|---|---:|
| Taxa de sucesso por atualização | FIIs processados sem erro técnico ÷ FIIs tentados | ≥ 95% |
| Cobertura dos campos disponíveis | Campos corretamente extraídos ÷ campos presentes na fonte, em fixtures de QA | ≥ 95% |
| Correção da classificação | Casos classificados corretamente nos limites de 80% e 95% | 100% |
| Preservação de dados na migração | Registros e valores preexistentes preservados ÷ total anterior | 100% |
| Tempo de resposta da API local | Percentil 95 dos endpoints de indicadores | ≤ 200 ms |
| Tempo de renderização de Posições | Dados recebidos até tabela interativa | ≤ 500 ms para 50 FIIs |
| Duração do enriquecimento | Percentil 95 para uma carteira de 17 FIIs | ≤ 120 s |
| Cobertura do alerta | FIIs elegíveis avaliados ÷ FIIs com `dy_12m` e `dy_medio_5a` válidos | 100% |

Os KPIs operacionais serão medidos por testes automatizados, fixtures do scraper e logs locais. Não haverá telemetria remota da carteira.

## 3. Requisitos Funcionais

1. **RF-001 — Migração do banco:** o sistema deve adicionar sete colunas nullable à tabela `ativos` e atualizar a versão do schema de `1.1` para `1.2`, preservando integralmente os registros existentes.

2. **RF-002 — Compatibilidade com instalações novas:** o schema de criação em `/home/cristian/byeINSS/db/init.sql` e o schema inline de fallback em `/home/cristian/byeINSS/src/server/db.js` devem conter as mesmas sete colunas.

3. **RF-003 — Captura do DY médio:** `extractFIIDetalhes` deve extrair `dy_medio_5a` do indicador identificado semanticamente como "DY médio 5 anos" ou variação equivalente na página `/fiis/{ticker}/`.

4. **RF-004 — Captura de rentabilidade:** o scraper deve extrair as colunas Nominal e Real da tabela de Rentabilidade para os períodos de 1, 2 e 5 anos, independentemente da ordem visual das colunas.

5. **RF-005 — Normalização de períodos:** o parser deve reconhecer rótulos equivalentes como `1a`, `1 ano` e `12 meses`; `2a`, `2 anos` e `24 meses`; e `5a`, `5 anos` e `60 meses`.

6. **RF-006 — Normalização numérica:** todos os indicadores devem ser armazenados em pontos percentuais, de modo que `12,34%` seja persistido como `12.34`. O parser deve preservar valores negativos e o valor zero, retornando `null` somente para conteúdo ausente ou inválido.

7. **RF-007 — Sem recálculo de rentabilidade real:** as rentabilidades nominal e real devem reproduzir os valores informados pela fonte, sem anualização, composição ou novo cálculo de IPCA pelo byeINSS.

8. **RF-008 — Persistência segura:** um valor válido extraído deve substituir o valor anterior; um `null` causado por ausência ou falha de parsing não deve apagar um valor válido já armazenado. Se nenhum indicador da página puder ser extraído, o FII deve ser registrado como falha na execução.

9. **RF-009 — Atualização temporal:** `ativos.updated_at` deve ser atualizado somente quando pelo menos um dado válido do FII for efetivamente persistido.

10. **RF-010 — Enriquecimento em lote:** o fluxo existente `scraper:enriquecer-todos` deve processar apenas FIIs ativos e continuar a execução quando um FII individual falhar.

11. **RF-011 — Resultado da atualização:** o enriquecimento deve retornar total tentado, quantidade de sucessos e resultado por ticker, incluindo erro legível nas falhas e os novos campos nos sucessos.

12. **RF-012 — Consulta consolidada:** deve existir um endpoint que liste os FIIs com os sete campos, o `dy_12m`, o percentual calculado de comparação histórica e a classificação resultante.

13. **RF-013 — Consulta individual:** deve existir um endpoint de detalhe por ticker, restrito a ativos do tipo `FII`, contendo todos os indicadores históricos e a data da última atualização do registro.

14. **RF-014 — Regra de comparação:** o backend deve calcular `dy_vs_5a_pct = (dy_12m / dy_medio_5a) × 100`, usando a precisão armazenada e arredondando apenas para apresentação.

15. **RF-015 — Classificação histórica:** a comparação deve ser classificada como `CONSISTENTE` quando for maior ou igual a 95%, `ATENCAO` quando for maior ou igual a 80% e menor que 95%, e `CRITICO` quando for menor que 80%.

16. **RF-016 — Dados insuficientes:** se `dy_12m` estiver ausente, ou se `dy_medio_5a` estiver ausente ou for menor ou igual a zero, a classificação deve ser `SEM_DADOS`; esse FII não deve gerar alerta de desvio.

17. **RF-017 — Novas colunas em Posições:** a tabela deve receber as colunas `DY 12M vs 5a` e `Rent. real 1a`. A primeira deve mostrar o percentual de comparação e um rótulo de estado; a segunda deve mostrar a rentabilidade real de 1 ano com sinal positivo, negativo ou zero.

18. **RF-018 — Detalhe dos períodos:** a célula de rentabilidade deve oferecer um controle acessível de detalhes com uma matriz Nominal versus Real para 1, 2 e 5 anos, evitando adicionar seis colunas permanentes à tabela.

19. **RF-019 — Ordenação e filtro:** as novas colunas devem permitir ordenação numérica e a tela deve aceitar filtro por `CONSISTENTE`, `ATENCAO`, `CRITICO` e `SEM_DADOS`.

20. **RF-020 — Alerta global:** o Dashboard deve exibir no máximo um alerta consolidado quando houver pelo menos um FII em `ATENCAO` ou `CRITICO`. A avaliação deve considerar somente FIIs ativos com quantidade atual maior que zero.

21. **RF-021 — Severidade do alerta:** o alerta global deve ser Crítico quando houver ao menos um FII `CRITICO`; caso contrário, deve ser Atenção. A mensagem deve informar total afetado, quantidade crítica, quantidade avaliada e quantidade sem dados.

22. **RF-022 — Navegação do alerta:** a ação "Ver FIIs" deve abrir Posições com filtro para `ATENCAO` e `CRITICO`, ordenando primeiro o menor `dy_vs_5a_pct`.

23. **RF-023 — Cobertura ausente:** se nenhum FII puder ser avaliado, o Dashboard não deve afirmar que não existem desvios; deve mostrar o estado informativo "Indicadores históricos ainda não disponíveis" com ação para o fluxo de atualização.

24. **RF-024 — Atualização parcial:** quando parte do enriquecimento falhar, os valores válidos já atualizados devem permanecer disponíveis e a UI deve mostrar um resumo das falhas sem bloquear a carteira inteira.

25. **RF-025 — Escopo FII:** os novos indicadores, colunas, filtros e alertas devem ser aplicados exclusivamente a ativos com `tipo = 'FII'`.

## 4. Requisitos Não-Funcionais

### Performance

- Os endpoints de leitura devem responder em até 200 ms no percentil 95 para até 500 ativos no banco local.
- A tela Posições deve renderizar até 50 FIIs em até 500 ms após receber a resposta da API.
- A atualização deve visitar os FIIs sequencialmente ou com concorrência limitada, evitando rajadas de requisições à fonte.
- Nenhum índice adicional é obrigatório para a carteira atual; consultas devem ser verificadas novamente caso o volume ultrapasse 500 ativos.

### Privacidade

- Indicadores, carteira e resultados da atualização devem permanecer no SQLite local.
- Nenhuma telemetria, conteúdo da carteira ou credencial deve ser enviado a servidores do byeINSS.
- Cookies e sessão do Investidor10 devem continuar restritos à partição Electron `persist:investidor10`.
- Logs não devem registrar cookies, credenciais, HTML completo da página nem outros dados de autenticação.

### Segurança

- O ticker usado para construir a URL deve ser normalizado para maiúsculas e validado conforme o padrão aceito pelo app antes da navegação.
- O scraper deve continuar restrito ao domínio `investidor10.com.br`, com links externos abertos no navegador do sistema.
- Os valores persistidos devem ser passados como parâmetros de statements preparados, sem interpolação em SQL.
- Os novos endpoints devem permanecer disponíveis apenas no servidor Express local vinculado a `127.0.0.1`.

### Confiabilidade e integridade

- A migração deve ser transacional e executada uma única vez por versão.
- Uma falha em um ticker não deve interromper nem reverter atualizações bem-sucedidas de outros FIIs.
- Ausência de dado deve ser representada por `NULL`, nunca por zero inventado.
- Valores negativos de rentabilidade e valores exatamente iguais a zero devem ser preservados.
- Atualizações repetidas devem ser idempotentes, sem criar novos registros em `ativos`.

### Compatibilidade

- Compatível com Electron, Node.js, Express 4 e `better-sqlite3` já utilizados pelo projeto.
- Compatível com bancos existentes na versão `1.1` e instalações novas.
- Formatação em `pt-BR`, moeda BRL e percentuais com vírgula decimal na apresentação.
- A feature não deve exigir alteração ou nova versão do Chart.js, pois não inclui novos gráficos.
- A tabela deve continuar utilizável na largura mínima atual da janela Electron, com rolagem horizontal quando necessário.

### Manutenibilidade

- Seletores do scraper devem privilegiar rótulos semânticos e cabeçalhos da tabela, não posições fixas no DOM.
- A normalização de percentuais e períodos deve ser centralizada e coberta por fixtures.
- O cálculo de classificação deve existir no backend como uma única função reutilizável pelos endpoints e alertas.

## 5. Modelo de Dados

Todos os campos percentuais usarão `REAL` em pontos percentuais. Exemplos:

- `9,75%` será armazenado como `9.75`.
- `-3,20%` será armazenado como `-3.2`.
- Ausência de informação será armazenada como `NULL`.

### Schema para instalações novas

A definição de `ativos` em instalações novas deve ser:

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
  dy_medio_5a REAL,
  rentabilidade_nominal_1a REAL,
  rentabilidade_nominal_2a REAL,
  rentabilidade_nominal_5a REAL,
  rentabilidade_real_1a REAL,
  rentabilidade_real_2a REAL,
  rentabilidade_real_5a REAL,
  ultimo_dividendo REAL,
  ultimo_pagto TEXT,
  alvo_pct_carteira REAL DEFAULT 1.76,
  ativo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

A configuração inicial da versão deve passar a ser:

```sql
INSERT OR IGNORE INTO config (chave, valor)
VALUES ('versao_schema', '1.2');
```

### Migração de bancos existentes

Para bancos na versão `1.1`, executar uma única vez:

```sql
BEGIN IMMEDIATE;

ALTER TABLE ativos ADD COLUMN dy_medio_5a REAL;
ALTER TABLE ativos ADD COLUMN rentabilidade_nominal_1a REAL;
ALTER TABLE ativos ADD COLUMN rentabilidade_nominal_2a REAL;
ALTER TABLE ativos ADD COLUMN rentabilidade_nominal_5a REAL;
ALTER TABLE ativos ADD COLUMN rentabilidade_real_1a REAL;
ALTER TABLE ativos ADD COLUMN rentabilidade_real_2a REAL;
ALTER TABLE ativos ADD COLUMN rentabilidade_real_5a REAL;

INSERT INTO config (chave, valor)
VALUES ('versao_schema', '1.2')
ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor;

COMMIT;
```

### Regras de execução da migração

- O runner deve executar o bloco somente quando a versão registrada for anterior a `1.2`.
- Como SQLite não oferece `ALTER TABLE ADD COLUMN IF NOT EXISTS` de forma compatível com todas as versões relevantes, o runner deve verificar `PRAGMA table_info(ativos)` antes de recuperar uma migração parcialmente aplicada.
- Os novos campos dos registros existentes permanecerão `NULL`.
- Não haverá backfill usando `dy_12m`, proventos ou qualquer fórmula aproximada.
- A primeira execução posterior de "Enriquecer com dados fundamentalistas" será responsável por popular os novos campos.
- A migração não deve alterar `updated_at` dos registros existentes.
- O schema inline de fallback em `/home/cristian/byeINSS/src/server/db.js` deve ser atualizado junto com `/home/cristian/byeINSS/db/init.sql`.

## 6. APIs / Endpoints

### Novos endpoints HTTP

| Método | Rota | Request | Response de sucesso | Erros |
|---|---|---|---|---|
| `GET` | `/api/fiis/indicadores` | Query opcional: `ativo_only=1`; `status=CONSISTENTE,ATENCAO,CRITICO,SEM_DADOS`; `sort=dy_vs_5a_pct`; `order=asc\|desc` | `200` com totais de cobertura e lista dos FIIs | `400` para filtro ou ordenação inválidos; `500` para erro local de banco |
| `GET` | `/api/fiis/indicadores/:ticker` | Parâmetro `ticker`, normalizado para maiúsculas | `200` com os sete campos, `dy_12m`, classificação e `updated_at` | `400` para ticker inválido; `404` se não existir ou não for FII; `500` para erro local de banco |
| `GET` | `/api/dashboard/alertas-dy-historico` | Sem body; considera apenas posições abertas de FIIs | `200` com alerta consolidado ou `alerta: null`, cobertura e itens afetados | `500` para erro local de banco |

### Exemplo de resposta da lista

```json
{
  "total": 17,
  "avaliados": 14,
  "sem_dados": 3,
  "items": [
    {
      "id": 1,
      "ticker": "HGLG11",
      "dy_12m": 9.2,
      "dy_medio_5a": 9.8,
      "dy_vs_5a_pct": 93.8775510204,
      "status_dy_historico": "ATENCAO",
      "rentabilidade_nominal_1a": 12.4,
      "rentabilidade_nominal_2a": 21.7,
      "rentabilidade_nominal_5a": 62.1,
      "rentabilidade_real_1a": 7.6,
      "rentabilidade_real_2a": 10.8,
      "rentabilidade_real_5a": 18.9,
      "updated_at": "2026-07-19 14:30:00"
    }
  ]
}
```

### Exemplo de resposta individual

```json
{
  "id": 1,
  "ticker": "HGLG11",
  "tipo": "FII",
  "dy_12m": 9.2,
  "dy_medio_5a": 9.8,
  "dy_vs_5a_pct": 93.8775510204,
  "status_dy_historico": "ATENCAO",
  "rentabilidade_nominal_1a": 12.4,
  "rentabilidade_nominal_2a": 21.7,
  "rentabilidade_nominal_5a": 62.1,
  "rentabilidade_real_1a": 7.6,
  "rentabilidade_real_2a": 10.8,
  "rentabilidade_real_5a": 18.9,
  "updated_at": "2026-07-19 14:30:00"
}
```

### Exemplo de resposta do alerta global

```json
{
  "alerta": {
    "tipo": "DY_HISTORICO_GLOBAL",
    "nivel": "CRITICO",
    "total_afetados": 4,
    "total_criticos": 1,
    "mensagem": "4 FIIs estão com DY 12M abaixo de 95% da média de 5 anos; 1 está abaixo de 80%."
  },
  "total_posicoes_fii": 17,
  "avaliados": 14,
  "sem_dados": 3,
  "itens": [
    {
      "ticker": "ABCD11",
      "dy_12m": 7.1,
      "dy_medio_5a": 9.4,
      "dy_vs_5a_pct": 75.5319148936,
      "status_dy_historico": "CRITICO"
    }
  ]
}
```

Quando não houver desvio:

```json
{
  "alerta": null,
  "total_posicoes_fii": 17,
  "avaliados": 17,
  "sem_dados": 0,
  "itens": []
}
```

### Compatibilidade com endpoints e IPC existentes

- `GET /api/ativos` continuará retornando os campos brutos por usar `SELECT a.*`, mas a tela Posições deverá consumir `/api/fiis/indicadores` para obter a classificação derivada.
- `GET /api/dashboard/alertas` deverá incorporar o objeto global `DY_HISTORICO_GLOBAL`, preservando os alertas já existentes. O endpoint dedicado fornecerá o detalhamento para filtro e drill-down.
- O canal IPC existente `scraper:enriquecer-todos` será ampliado, não substituído. Seu retorno continuará contendo `total`, `sucessos` e `resultados`, com os sete novos campos dentro de `resultados[].dados`.
- Erros de IPC como janela do scraper fechada, timeout ou sessão inválida devem manter mensagens legíveis, sem expor stack trace na UI.

## 7. UI / UX

### Frame 1 — Dashboard com alerta global

```text
+---------------------------------------------------------------------+
| Dashboard                                      Última carga: 14:30  |
+----------------+----------------+----------------+-------------------+
| Patrimônio     | Investido      | Proventos 12M | DY Carteira 12M   |
| R$ 480.000,00  | R$ 420.000,00  | R$ 42.500,00  | 8,85%             |
+----------------+----------------+----------------+-------------------+

+---------------------------------------------------------------------+
| [!] DY histórico da carteira                         CRÍTICO         |
| 4 FIIs estão com DY 12M abaixo de 95% da média de 5 anos.           |
| 1 está abaixo de 80%. 14 avaliados; 3 sem dados.                    |
|                                              [ Ver FIIs afetados ]   |
+---------------------------------------------------------------------+

+--------------------------------+------------------------------------+
| Evolução patrimonial           | Alertas existentes                 |
| [conteúdo atual, sem mudança]   | [concentração, preço, outros]      |
+--------------------------------+------------------------------------+
```

### Frame 2 — Posições com as novas colunas

```text
+--------------------------------------------------------------------------------------+
| Posições                                              17 FIIs na carteira            |
| Filtro DY: [Todos] [Consistente] [Atenção] [Crítico] [Sem dados]                    |
+--------------------------------------------------------------------------------------+
| Ticker | Segmento | Qtd | Atual    | P/VP | DY 12M vs 5a          | Rent. real 1a |
|--------|----------|-----|----------|------|------------------------|----------------|
| HGLG11 | Logístico| 120 | R$ 158,00| 0,93 | [Consistente] 102,2%  | +7,60% [det.]  |
| KNCR11 | Papel    | 200 | R$ 104,10| 1,01 | [Atenção]      91,4%  | +5,20% [det.]  |
| ABCD11 | Tijolo   |  80 | R$  88,00| 0,76 | [Crítico]      75,5%  | -3,10% [det.]  |
| NOVO11 | Misto    |  35 | R$  94,20| 0,95 | [Sem dados]       —   |       —        |
+--------------------------------------------------------------------------------------+
```

O conteúdo acessível da célula de DY deve informar também os valores-base, por exemplo: "Atenção. DY 12 meses 8,96%; DY médio de 5 anos 9,80%; relação 91,4%".

### Frame 3 — Detalhe de rentabilidade da posição

```text
+--------------------------------------------------+
| Rentabilidade de KNCR11                     [X]  |
+---------------+----------------+-----------------+
| Período       | Nominal        | Real            |
| 1 ano         | +10,30%        | +5,20%          |
| 2 anos        | +23,40%        | +11,80%         |
| 5 anos        | +68,10%        | +24,60%         |
+---------------+----------------+-----------------+
| Fonte: Investidor10                              |
| Valores acumulados informados pela fonte.        |
| Última atualização do registro: 19/07/2026 14:30 |
+--------------------------------------------------+
```

O detalhe deve abrir por clique, Enter ou Espaço e não depender exclusivamente de hover.

### Frame 4 — Atualização de indicadores

```text
+---------------------------------------------------------------------+
| Importar dados                                                      |
+---------------------------------------------------------------------+
| Enriquecer com dados fundamentalistas                               |
|                                                                     |
| Atualizando FIIs...                                                  |
| [======================------------------] 9 de 17                   |
| Em processamento: HGLG11                                            |
|                                                                     |
| A tabela continua mostrando os últimos valores válidos armazenados. |
+---------------------------------------------------------------------+

Após conclusão parcial:

| 15 de 17 FIIs atualizados.                                          |
| Falhas: NOVO11 — tabela de rentabilidade não encontrada             |
|         TEST11 — timeout ao carregar a página                        |
|                                      [ Tentar novamente ]            |
+---------------------------------------------------------------------+
```

A contagem de progresso é desejável quando o IPC permitir eventos intermediários; na ausência deles, deve ser usado um indicador indeterminado com a mensagem "A atualização pode levar até 2 minutos".

### Estados da interface

- **Loading inicial:** skeleton ou mensagem "Carregando indicadores" nas novas colunas.
- **Atualização em andamento:** manter valores anteriores visíveis e desabilitar nova execução simultânea.
- **Success completo:** informar quantidade de FIIs atualizados e atualizar Posições e Dashboard.
- **Success parcial:** informar sucessos e falhas por ticker, sem descartar resultados válidos.
- **Empty carteira:** mostrar "Nenhum FII com posição aberta".
- **Sem dados por FII:** exibir `—` e rótulo `Sem dados`, com ação para atualizar indicadores.
- **Sem cobertura global:** mostrar aviso informativo de que os indicadores ainda não foram importados.
- **Erro da API local:** preservar a estrutura da página e oferecer "Tentar novamente".
- **Erro da fonte:** informar timeout, sessão expirada ou estrutura não reconhecida sem apagar valores anteriores.
- **Offline com cache:** exibir dados locais existentes; somente a ação de atualização deve ficar indisponível.
- **Success sem alertas:** mostrar "Nenhum desvio de DY histórico entre os FIIs avaliados", acompanhado da cobertura.

### Acessibilidade

- Utilizar tabela semântica com `<caption>`, `<thead>`, `<th scope="col">` e cabeçalhos compreensíveis.
- Não usar somente verde, amarelo ou vermelho: cada chip deve conter `Consistente`, `Atenção`, `Crítico` ou `Sem dados`.
- Garantir contraste mínimo WCAG 2.1 AA para texto, chips, foco e alertas.
- Controles de detalhe devem ser alcançáveis por teclado e operáveis com Enter e Espaço; Escape deve fechar o painel.
- O painel de detalhes deve manter foco preso enquanto estiver aberto e devolver o foco ao elemento acionador ao fechar.
- Mensagens de atualização devem usar uma região `aria-live="polite"`.
- O alerta persistente do Dashboard não deve ser anunciado repetidamente como alerta urgente a cada renderização; usar região de status com título e severidade textuais.
- Valores negativos devem conter o sinal de menos no texto, e não somente uma cor.
- Tooltips devem possuir conteúdo equivalente em `aria-describedby` ou no painel de detalhes.
- A rolagem horizontal não deve remover o acesso por teclado; a coluna Ticker deve permanecer identificável durante a navegação.

## 8. Casos de Borda

1. **FII listado há menos de 5 anos:** `dy_medio_5a` e rentabilidade de 5 anos podem ser `NULL`; não calcular a comparação nem gerar alerta.
2. **Apenas alguns períodos disponíveis:** persistir individualmente os campos válidos e manter os demais como `NULL`.
3. **`dy_medio_5a` igual a zero:** classificar como `SEM_DADOS` e impedir divisão por zero.
4. **`dy_12m` ausente:** não usar proventos locais como substituição automática; classificar como `SEM_DADOS`.
5. **Rentabilidade negativa:** preservar o sinal e exibir, por exemplo, `-3,20%`.
6. **Rentabilidade exatamente zero:** persistir `0` e exibir `0,00%`, sem converter para `NULL`.
7. **Valores brasileiros com separadores:** interpretar corretamente exemplos como `1.234,56%`, `12,30%` e `-4,10%`.
8. **Colunas Nominal e Real invertidas na fonte:** identificar pelo cabeçalho, e não pelo índice fixo da célula.
9. **Variação de rótulos:** reconhecer mudanças de caixa, acentuação, espaços e abreviações sem confundir 1 ano com 1 mês.
10. **Página parcialmente carregada ou conteúdo lazy-loaded:** aguardar especificamente a tabela ou o box necessário até o timeout definido.
11. **Sessão expirada, captcha ou bloqueio da fonte:** registrar falha legível por ticker e preservar os valores anteriores.
12. **Falha no meio do lote:** continuar com os próximos FIIs e retornar resultado parcial ao usuário.
13. **Ativo marcado como aberto, mas sem quantidade:** não incluí-lo no alerta global da carteira.
14. **Ticker inexistente ou ativo de outro tipo:** retornar `400` para formato inválido ou `404` quando não for um FII cadastrado.
15. **Limites exatos:** uma relação de `95,00%` deve ser `CONSISTENTE`; uma relação de `80,00%` deve ser `ATENCAO`; somente valores inferiores a `80,00%` devem ser `CRITICO`.

## 9. Dependências

- Fluxo existente de abertura e autenticação do scraper Electron em `/home/cristian/byeINSS/src/main/scraper.js`.
- Canal IPC `scraper:enriquecer-todos` registrado em `/home/cristian/byeINSS/src/main/main.js` e exposto em `/home/cristian/byeINSS/src/preload/preload.js`.
- Campo `dy_12m` já existente e populado para permitir a comparação histórica.
- Tabela `ativos` e inicialização de banco em `/home/cristian/byeINSS/db/init.sql` e `/home/cristian/byeINSS/src/server/db.js`.
- Servidor Express local em `/home/cristian/byeINSS/src/server/index.js`.
- Alertas atuais em `/home/cristian/byeINSS/src/server/routes/dashboard.js`.
- Tela Posições e Dashboard em `/home/cristian/byeINSS/src/renderer/js/pages.js`.
- Disponibilidade e estabilidade mínima da página pública `/fiis/{ticker}/` do Investidor10.
- Existência de FIIs cadastrados com tickers válidos e lançamentos que consolidem quantidade maior que zero.

Não há dependência do histórico completo de dividendos da seção 2.1, do radar de DY acima do histórico da seção 2.9 ou de qualquer nova versão do Chart.js.

## 10. Esforço Estimado

**Estimativa total: 5 dias úteis para uma pessoa desenvolvedora full-stack familiarizada com o projeto.**

| Área | Atividades | Estimativa |
|---|---|---:|
| Banco de dados | Schema novo, migração `1.1 → 1.2`, fallback inline e testes de preservação | 0,5 dia |
| Scraper e persistência | Parser do DY médio, tabela Nominal/Real, normalização, atualização em lote e tratamento parcial | 1,25 dia |
| Backend/API | Router de indicadores, cálculo derivado, endpoint de alerta e integração com alertas existentes | 0,75 dia |
| Frontend | Colunas em Posições, filtros, detalhe dos períodos, alerta no Dashboard e estados de atualização | 1 dia |
| Testes e QA | Fixtures de DOM, limites de classificação, migração, fluxo Electron, acessibilidade e regressão | 1 dia |
| Contingência | Ajustes por variações reais do DOM ou carregamento da fonte | 0,5 dia |
| **Total** |  | **5 dias** |

Premissas da estimativa:

- Não será necessário contornar captcha ou mecanismo anti-bot.
- Os indicadores continuam disponíveis no HTML renderizado da página.
- Não haverá redesign geral de Posições ou Dashboard.
- Não haverá agendamento automático de atualização em segundo plano.

## 11. Riscos &amp; Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Alteração do DOM ou dos rótulos no Investidor10 | O scraper deixa de encontrar um ou mais indicadores | Usar parsing por semântica, normalização de rótulos, fixtures representativas, falha por campo e logs sem dados sensíveis |
| Bloqueio, timeout ou captcha durante o lote | Atualização incompleta da carteira | Processamento sequencial, timeout controlado, uma tentativa adicional para falhas transitórias, resultados parciais e preservação do cache |
| Semântica da rentabilidade real variar na fonte | Usuário interpretar o valor como cálculo próprio do byeINSS | Identificar claramente a fonte, não recalcular IPCA e exibir "valor acumulado informado pela fonte" |
| Migração aplicada parcialmente ou mais de uma vez | Falha de inicialização do app | Transação, versionamento `1.2`, inspeção de `PRAGMA table_info(ativos)` e testes com cópia de banco existente |
| Alerta ser interpretado como recomendação de venda | Decisão inadequada baseada em um único indicador | Usar texto factual "DY 12M abaixo da média", apresentar os valores-base e informar que o sinal exige análise; não usar linguagem de recomendação |

## 12. Out of Scope

- Captura ou persistência das rentabilidades de 1 mês e 3 meses.
- Cálculo próprio de rentabilidade nominal ou real pelo byeINSS.
- Download, armazenamento ou atualização de séries históricas do IPCA.
- Histórico mensal completo de dividendos ou detecção de cortes consecutivos.
- Alerta de DY acima de 125% ou 150% da média histórica, previsto separadamente no radar de DY.
- Notificações do sistema operacional, e-mail, push ou integração com mensageria.
- Agendamento automático ou atualização em segundo plano.
- Novos gráficos de rentabilidade ou DY.
- Comparação com IFIX, CDI, IPCA ou outros benchmarks.
- Alteração dos thresholds de 80% e 95% pelo usuário nesta versão.
- Edição manual dos sete indicadores históricos.
- Recomendação automática de compra, venda ou rebalanceamento.
- Aplicação da feature a ações, ETFs, Tesouro Direto, criptoativos ou outros tipos de ativo.
- Nova tela independente de análise fundamentalista; a entrega ficará concentrada em Posições, Dashboard e no fluxo atual de Importar dados.
