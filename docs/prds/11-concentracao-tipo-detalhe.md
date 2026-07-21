# PRD: Alocação de FIIs por Tipo Detalhado

## 1. Visão Geral

O Dashboard do byeINSS passará a exibir a composição da carteira de FIIs por `tipo_detalhe`, usando as categorias Tijolo, Papel, Misto, FO-Infra, Desenvolvimento, FOF e Híbrido. A distribuição será apresentada em um gráfico donut baseado no valor de mercado atual das posições abertas.

Quando uma categoria representar mais de 70% do valor avaliado da carteira de FIIs, o sistema exibirá um alerta de concentração. A funcionalidade informa exposição, mas não classifica automaticamente a carteira como adequada ou inadequada e não constitui recomendação de investimento.

### Problemas que resolve

1. **Baixa visibilidade sobre a diversificação real entre FIIs:** a composição atual por `tipo` agrupa todos os fundos como FII e não revela a exposição econômica dentro dessa classe.
2. **Risco de concentração não percebido:** o investidor pode manter vários tickers, mas continuar exposto predominantemente ao mesmo tipo de fundo e aos mesmos fatores de risco.
3. **Dificuldade para orientar aportes e revisões:** sem uma visão agregada, o investidor precisa classificar e somar manualmente suas posições para descobrir o tipo dominante.

### Personas e casos de uso

#### Persona 1 — Investidor de renda de longo prazo

Mantém uma carteira de FIIs para geração de renda mensal e quer evitar dependência excessiva de juros, vacância ou valorização imobiliária.

**Casos de uso:**
- Consultar rapidamente a participação de Tijolo e Papel.
- Identificar se um novo aporte aumentará uma concentração já elevada.
- Revisar a carteira quando o Dashboard sinalizar mais de 70% em um tipo.

#### Persona 2 — Alocador avançado de FIIs

Acompanha diferentes estratégias, como recebíveis, imóveis físicos, infraestrutura e desenvolvimento, e deseja uma leitura consolidada da exposição.

**Casos de uso:**
- Comparar o valor financeiro alocado em cada tipo.
- Identificar quais tickers formam a categoria dominante.
- Analisar, em uma evolução posterior, os segmentos dentro de um tipo selecionado.

#### Persona 3 — Investidor iniciante focado em FIIs

Possui vários fundos, mas ainda não domina as diferenças de risco entre os tipos.

**Casos de uso:**
- Entender visualmente como a carteira está distribuída.
- Receber uma explicação simples sobre o motivo do alerta.
- Identificar ativos ainda não classificados e corrigir a qualidade dos dados.

---

## 2. Objetivos &amp; Métricas de Sucesso

### Objetivos mensuráveis

1. Permitir que o usuário identifique o maior tipo de FII e sua participação em até 10 segundos após abrir o Dashboard.
2. Detectar corretamente 100% dos casos em que uma categoria representa mais de 70% da carteira de FIIs avaliada.
3. Atingir pelo menos 95% de cobertura de classificação por valor de mercado após a execução bem-sucedida do enriquecimento previsto no item 2.2 do roadmap.
4. Entregar a agregação da carteira em até 150 ms no percentil 95 para uma base local com até 500 posições abertas.
5. Garantir que 100% das informações do gráfico também estejam disponíveis em formato textual ou tabular acessível.

### KPIs

| KPI | Definição | Meta inicial | Medição |
|---|---|---:|---|
| Cobertura de classificação | Valor de mercado dos FIIs com `tipo_detalhe` canônico dividido pelo valor de mercado total dos FIIs avaliados | &gt;= 95% | Cálculo local retornado pela API |
| Acurácia da alocação | Correspondência entre percentuais calculados e fixtures de referência | 100% | Testes automatizados |
| Acurácia do alerta | Casos de fronteira e concentrações corretamente identificados | 100% | Testes unitários e de integração |
| Tempo da API | Latência do cálculo no ambiente local, com até 500 posições | p95 &lt;= 150 ms | Benchmark automatizado |
| Tempo de renderização | Tempo entre a resposta da API e gráfico/legenda utilizáveis | p95 &lt;= 300 ms | Teste de interface |
| Compreensão da visualização | Participantes que identificam o maior tipo e o alerta sem ajuda | &gt;= 90% | Teste de usabilidade com pelo menos 5 participantes |
| Cobertura acessível | Categorias disponíveis fora do canvas, com nome, valor e percentual | 100% | Auditoria automatizada e manual |

O MVP não exige telemetria externa. Métricas de uso, se futuramente adotadas, deverão ser locais ou explicitamente opt-in.

---

## 3. Requisitos Funcionais

1. **RF-001 — Novo painel:** o Dashboard deverá apresentar um card denominado **“Composição dos FIIs por tipo”**, contendo um gráfico donut, legenda e informações de cobertura dos dados.

2. **RF-002 — Universo da análise:** o cálculo deverá considerar somente ativos com `tipo = 'FII'`, posição líquida positiva e `ativo = 1`. Ações, Tesouro Direto, ETFs e outros tipos não deverão entrar no denominador.

3. **RF-003 — Critério financeiro:** a participação deverá ser calculada pelo valor de mercado atual de cada posição, usando `quantidade_líquida × última_cotação_disponível`. O custo histórico e o preço médio não deverão ser usados na composição.

4. **RF-004 — Quantidade líquida:** a quantidade de cada ativo deverá corresponder à soma de compras menos a soma de vendas. Posições zeradas ou negativas não deverão ser exibidas no gráfico.

5. **RF-005 — Taxonomia canônica:** o produto deverá reconhecer Tijolo, Papel, Misto, FO-Infra, Desenvolvimento, FOF e Híbrido como categorias válidas. Os rótulos deverão manter identidade e ordem visual fixas, mesmo quando a participação ou a posição relativa mudar.

6. **RF-006 — Normalização:** diferenças de caixa, espaços e variantes conhecidas deverão ser normalizadas antes da agregação. O rótulo `FI-Infra`, presente no roadmap, deverá ser mapeado para o valor canônico `FO-Infra` adotado por este PRD.

7. **RF-007 — Sem inferência silenciosa:** o sistema não deverá inferir `tipo_detalhe` a partir do ticker, gestor ou segmento. Valores nulos, vazios, `Outro` ou desconhecidos deverão ser agrupados em **“Não classificado”**.

8. **RF-008 — Percentuais:** cada percentual deverá ser calculado sobre o valor total de mercado dos FIIs avaliados, incluindo a categoria “Não classificado” no denominador. A comparação com o limite deverá usar a precisão integral do cálculo, sem arredondamento prévio.

9. **RF-009 — Apresentação do donut:** o gráfico deverá mostrar apenas categorias com valor positivo. O centro do donut deverá exibir o valor total dos FIIs avaliados ou, quando houver uma categoria selecionada, seu nome e percentual.

10. **RF-010 — Legenda:** cada item da legenda deverá apresentar nome da categoria, percentual, valor em reais e quantidade de FIIs. A legenda deverá seguir a ordem canônica, e não uma ordenação dinâmica por tamanho.

11. **RF-011 — Tooltip:** ao passar o ponteiro, tocar ou focar uma categoria, o sistema deverá mostrar tipo, valor de mercado, percentual e quantidade de posições incluídas. O tooltip não deverá conter apenas informação por cor.

12. **RF-012 — Regra de concentração:** deverá existir alerta quando uma categoria canônica representar **mais de 70%** do valor de mercado avaliado dos FIIs. Uma participação exatamente igual a 70% não deverá gerar alerta.

13. **RF-013 — Categoria desconhecida:** “Não classificado” não deverá gerar o alerta de concentração por tipo, mesmo que supere 70%. Nesse caso, o sistema deverá emitir um aviso separado de qualidade dos dados.

14. **RF-014 — Conteúdo do alerta:** o alerta deverá informar categoria, percentual calculado, limite de 70% e uma explicação curta sobre exposição a riscos comuns. O texto não deverá indicar compra, venda ou rebalanceamento obrigatório.

15. **RF-015 — Integração com alertas:** o alerta deverá aparecer no painel global de Alertas do Dashboard com o identificador `CONCENTRACAO_TIPO_DETALHE`. Um indicador compacto também poderá ser exibido no cabeçalho do card, utilizando o mesmo objeto de alerta.

16. **RF-016 — Dados incompletos:** o card deverá informar a cobertura de classificação e o número de posições sem cotação. Se os dados estiverem incompletos, a interface não deverá afirmar que a carteira está “sem risco” ou “diversificada”.

17. **RF-017 — Posição sem cotação:** uma posição sem cotação positiva não deverá receber valor financeiro estimado. Ela deverá ser excluída do denominador, contabilizada em `posicoes_sem_cotacao` e gerar indicação de análise parcial.

18. **RF-018 — Detalhes dos ativos:** ao selecionar uma categoria, a interface deverá permitir visualizar os tickers que compõem aquela fatia, com valor e percentual dentro da categoria. Essa lista poderá ser exibida no próprio card, sem exigir uma nova página.

19. **RF-019 — Atualização:** o gráfico e o alerta deverão ser recalculados sempre que o Dashboard for carregado e após alterações relevantes em lançamentos, cotações, estado ativo ou `tipo_detalhe`.

20. **RF-020 — Compatibilidade da API:** os campos atuais de `/api/dashboard/resumo`, incluindo `por_tipo`, deverão ser preservados. A funcionalidade será adicionada sem alterar o significado dos contratos existentes.

21. **RF-021 — Tabela acessível:** o usuário deverá poder alternar ou expandir uma visualização tabular equivalente ao donut. A tabela deverá apresentar os mesmos valores e percentuais usados no gráfico e no alerta.

22. **RF-022 — Sub-gráfico por segmento, P1 opcional:** ao selecionar um tipo, uma evolução posterior poderá apresentar a composição por `segmento` ou `segmento_detalhe` em barras horizontais. O sub-gráfico deverá exibir até sete segmentos e agrupar os demais em “Outros”.

23. **RF-023 — Sem dependência de rede no Dashboard:** o carregamento do painel deverá usar apenas os dados já persistidos localmente. O Dashboard não deverá iniciar scraping ou chamadas externas para completar classificações ou cotações.

---

## 4. Requisitos Não-Funcionais

### Performance

- O cálculo do endpoint deverá responder em até 150 ms no percentil 95 para até 500 posições abertas em hardware compatível com o aplicativo.
- O gráfico deverá ficar utilizável em até 300 ms após o recebimento dos dados.
- A agregação deverá ser realizada em uma consulta consolidada ou serviço compartilhado, evitando uma consulta adicional por ativo.
- Animações deverão ser curtas e desativadas quando `prefers-reduced-motion` estiver habilitado.

### Privacidade

- Dados de carteira, posições, valores, classificações e alertas deverão permanecer no ambiente local.
- A funcionalidade não deverá transmitir tickers, patrimônio ou percentuais a serviços de terceiros.
- Eventual telemetria futura deverá ser anonimizada, agregada e opt-in.

### Compatibilidade

- A funcionalidade deverá operar no Electron e no servidor Express local já utilizados pelo byeINSS.
- Deverá ser compatível com o SQLite existente e com bancos criados antes da introdução de `tipo_detalhe`.
- O gráfico deverá usar a versão do Chart.js já adotada pelo projeto, sem exigir uma segunda biblioteca de visualização.
- O layout deverá funcionar nos tamanhos de janela suportados pelo aplicativo, com reorganização responsiva em larguras estreitas.

### Confiabilidade e consistência

- O gráfico, a legenda, a tabela e o alerta deverão usar a mesma agregação de origem.
- Valores monetários deverão ser calculados numericamente e formatados em BRL somente na camada de apresentação.
- A regra de 70% deverá possuir testes para abaixo, exatamente no limite e acima do limite.
- Ausência de dados deverá resultar em estado vazio ou parcial, nunca em valores inventados.

### Acessibilidade

- A implementação deverá atender ao WCAG 2.2 nível AA nos fluxos aplicáveis.
- Categorias e estados não poderão depender exclusivamente de cor.
- O gráfico deverá possuir alternativa textual e tabela equivalente.
- A paleta categórica deverá ser validada para o tema visual suportado e para deficiências de visão de cores.

### Segurança

- Rótulos provenientes do banco deverão ser normalizados e escapados antes de serem inseridos na interface.
- Valores inesperados de `tipo_detalhe` deverão ser direcionados para “Não classificado”, e não renderizados como HTML.
- Os endpoints permanecerão expostos apenas no servidor local já iniciado em `127.0.0.1`.

### Manutenibilidade

- A taxonomia e a associação entre categoria e identidade visual deverão estar centralizadas.
- O cálculo de alocação deverá ser compartilhado entre o resumo e os alertas, evitando regras divergentes.
- A categoria deverá preservar sua identidade visual quando outras categorias forem adicionadas, removidas ou filtradas.

---

## 5. Modelo de Dados

### Resposta curta sobre a dependência

O **MVP da classificação** depende do campo `ativos.tipo_detalhe`, previsto no item 2.2 do roadmap, e não exige uma nova tabela. Entretanto, o cálculo financeiro também utiliza dados já existentes: lançamentos para a quantidade líquida, cotações para o valor atual, `ativos.tipo` para restringir a FIIs e `ativos.ativo` para considerar apenas ativos habilitados.

O sub-gráfico opcional por segmento não depende apenas de `tipo_detalhe`: ele requer também `segmento` ou, preferencialmente, `segmento_detalhe`.

### Campo persistido

| Tabela | Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|---|
| `ativos` | `tipo_detalhe` | `TEXT` | Não | Classificação proveniente do enriquecimento do item 2.2 |
| `ativos` | `tipo` | `TEXT` | Sim | Somente `FII` participa desta composição |
| `ativos` | `ativo` | `INTEGER` | Sim | Deve ser `1` para entrar no cálculo |
| `ativos` | `segmento` | `TEXT` | Não | Usado apenas pelo sub-gráfico opcional |
| `ativos` | `segmento_detalhe` | `TEXT` | Não | Preferível para o sub-gráfico quando disponível |

### Valores canônicos de `tipo_detalhe`

- `Tijolo`
- `Papel`
- `Misto`
- `FO-Infra`
- `Desenvolvimento`
- `FOF`
- `Híbrido`

“Não classificado” será uma categoria derivada de apresentação e não precisará ser persistida como valor no banco.

### Regras de normalização

| Entrada | Saída canônica |
|---|---|
| `tijolo`, `TIJOLO`, espaços adicionais | `Tijolo` |
| `papel`, `PAPEL` | `Papel` |
| `misto` | `Misto` |
| `FI-Infra`, `FII-Infra`, `FO Infra` | `FO-Infra` |
| `desenvolvimento` | `Desenvolvimento` |
| `fundo de fundos`, `fundo de fundo`, `FOF` | `FOF` |
| `hibrido`, `híbrido` | `Híbrido` |
| Nulo, vazio, `Outro` ou valor inesperado | `Não classificado` |

A diferença conceitual entre Misto e Híbrido deverá respeitar a classificação da fonte. O sistema não deverá converter uma categoria na outra por heurística.

### Dados derivados

Para cada FII elegível `i`:

```text
quantidade_liquida_i =
  soma(quantidades de COMPRA) - soma(quantidades de VENDA)

valor_mercado_i =
  quantidade_liquida_i * ultima_cotacao_positiva_i

valor_total_fiis_avaliados =
  soma(valor_mercado_i)

valor_categoria_c =
  soma(valor_mercado_i em que tipo_detalhe_i = c)

percentual_categoria_c =
  valor_categoria_c / valor_total_fiis_avaliados * 100

cobertura_classificacao_pct =
  valor dos FIIs com categoria canônica /
  valor_total_fiis_avaliados * 100

concentracao_alta_c =
  percentual_categoria_c &gt; 70
```

As posições sem cotação positiva não entram em `valor_total_fiis_avaliados`. Sua quantidade deverá ser retornada separadamente para que a interface indique análise parcial.

### Persistência adicional

Não será criada tabela de cache no MVP. O resultado será calculado a partir da base local a cada carregamento do Dashboard, salvo evidência posterior de problema de performance.

---

## 6. APIs / Endpoints

Não é necessário criar uma nova rota para o MVP. Os contratos existentes de resumo e alertas serão estendidos de forma retrocompatível.

| Método | Rota | Request | Response relevante | Erros |
|---|---|---|---|---|
| `GET` | `/api/dashboard/resumo` | Sem body ou query obrigatória | Mantém os campos atuais e adiciona `alocacao_fii_tipo_detalhe` | `500` se a consulta ou agregação falhar |
| `GET` | `/api/dashboard/alertas` | Sem body ou query obrigatória | Mantém o array atual e inclui alerta `CONCENTRACAO_TIPO_DETALHE` quando aplicável | `500` se os alertas não puderem ser calculados |
| `GET` | `/api/dashboard/alocacao-fii/segmentos?tipo_detalhe=&lt;tipo&gt;` | P1 opcional; `tipo_detalhe` canônico obrigatório | Lista de segmentos, valores e percentuais dentro do tipo | `400` para tipo ausente/inválido; `500` em falha interna |

### Extensão de `GET /api/dashboard/resumo`

Exemplo de resposta parcial:

```json
{
  "patrimonio": 500000,
  "por_tipo": {
    "FII": 475000,
    "TD": 25000
  },
  "alocacao_fii_tipo_detalhe": {
    "criterio": "VALOR_MERCADO_ATUAL",
    "limite_alerta_pct": 70,
    "valor_total_avaliado": 475000,
    "cobertura_classificacao_pct": 94.2,
    "posicoes_avaliadas": 14,
    "posicoes_sem_cotacao": 1,
    "dados_completos": false,
    "categorias": [
      {
        "tipo_detalhe": "Tijolo",
        "valor": 343900,
        "percentual": 72.4,
        "quantidade_fiis": 6
      },
      {
        "tipo_detalhe": "Papel",
        "valor": 103550,
        "percentual": 21.8,
        "quantidade_fiis": 5
      },
      {
        "tipo_detalhe": "Não classificado",
        "valor": 27550,
        "percentual": 5.8,
        "quantidade_fiis": 2
      }
    ],
    "maior_categoria": {
      "tipo_detalhe": "Tijolo",
      "percentual": 72.4,
      "excede_limite": true
    },
    "calculado_em": "2026-07-19T14:30:00.000Z"
  }
}
```

As categorias deverão ser retornadas na ordem canônica. Categorias sem valor poderão ser omitidas da lista, desde que a camada de apresentação mantenha a identidade visual fixa.

### Extensão de `GET /api/dashboard/alertas`

Exemplo de novo item no array:

```json
{
  "tipo": "CONCENTRACAO_TIPO_DETALHE",
  "ticker": null,
  "tipo_detalhe": "Tijolo",
  "valor": 72.4,
  "limite": 70,
  "dados_completos": false,
  "msg": "Tijolo representa 72,4% dos FIIs avaliados, acima do limite de 70%. Os dados estão parciais porque existe 1 posição sem cotação."
}
```

### Comportamento de erro e ausência de dados

- Carteira sem FIIs não é erro: a API deverá retornar `valor_total_avaliado: 0`, `categorias: []` e `maior_categoria: null`.
- FIIs sem cotação não são erro: deverão ser contabilizados em `posicoes_sem_cotacao`.
- `tipo_detalhe` ausente não é erro: o valor deverá ser agrupado em “Não classificado”.
- Em erro interno, a API deverá responder com JSON, por exemplo:

```json
{
  "error": "Falha ao calcular a alocação por tipo detalhado."
}
```

---

## 7. UI / UX

### Princípios de visualização

- O gráfico principal será um donut, adequado à leitura de participação no total.
- As categorias terão identidade visual fixa; uma categoria não mudará de cor por ter subido ou descido no ranking.
- A cor de alerta será reservada ao estado de concentração e não será reutilizada como cor categórica.
- A legenda será sempre exibida quando houver duas ou mais categorias.
- O valor e o percentual estarão disponíveis em texto, sem depender do tamanho da fatia.
- A categoria “Não classificado” usará aparência neutra.
- O eventual sub-gráfico por segmento usará barras horizontais, e não um segundo donut, para facilitar a comparação entre vários segmentos.

### Frame 1 — Dashboard com concentração

```text
+----------------------------------------------+----------------------------+
| Composição dos FIIs por tipo    [ATENÇÃO]    | Alertas                    |
|                                              |                            |
|       +----------------+   Tijolo             | [!] Concentração por tipo  |
|      /                  \  72,4%  R$ 343.900  |                            |
|     |    R$ 475.000      | Papel              | Tijolo representa 72,4%   |
|     |   FIIs avaliados   | 21,8%  R$ 103.550  | dos FIIs avaliados.        |
|      \                  /  Não classificado   | Limite: 70%.               |
|       +----------------+    5,8%  R$ 27.550   |                            |
|                                              | [Ver composição]           |
| Cobertura: 94,2% | 1 posição sem cotação     |                            |
| [Ver dados em tabela]                        |                            |
+----------------------------------------------+----------------------------+
```

### Frame 2 — Categoria selecionada e detalhes

```text
+--------------------------------------------------------------------------+
| Composição dos FIIs por tipo                                             |
|                                                                          |
| Categoria selecionada: Tijolo                                            |
| 72,4% dos FIIs avaliados | R$ 343.900 | 6 fundos                         |
|                                                                          |
| Tickers incluídos                                                        |
| HGLG11     R$ 92.000     26,8% da categoria                              |
| KNRI11     R$ 78.500     22,8% da categoria                              |
| BTLG11     R$ 66.400     19,3% da categoria                              |
| Outros      R$ 107.000    31,1% da categoria                             |
|                                                                          |
| [Voltar ao resumo]  [Exibir tabela completa]                             |
+--------------------------------------------------------------------------+
```

### Frame 3 — Dados parciais ou sem classificação

```text
+--------------------------------------------------------------------------+
| Composição dos FIIs por tipo                                             |
|                                                                          |
| Não foi possível concluir a análise de concentração.                     |
|                                                                          |
| 4 de 10 posições ainda não possuem tipo detalhado.                       |
| 1 posição não possui cotação atual.                                      |
|                                                                          |
| Cobertura por valor avaliado: 58,0%                                      |
|                                                                          |
| [Ver ativos não classificados]  [Tentar novamente]                       |
+--------------------------------------------------------------------------+
```

### Frame 4 — Janela estreita

```text
+----------------------------------+
| Composição dos FIIs por tipo     |
| [ATENÇÃO: Tijolo 72,4%]          |
|                                  |
|          +------------+          |
|         / R$ 475.000   \         |
|         \              /         |
|          +------------+          |
|                                  |
| Tijolo             72,4%         |
| R$ 343.900 | 6 fundos            |
|                                  |
| Papel              21,8%         |
| R$ 103.550 | 5 fundos            |
|                                  |
| Não classificado    5,8%         |
| R$ 27.550 | 2 fundos             |
|                                  |
| Cobertura: 94,2%                 |
| [Ver tabela]                     |
+----------------------------------+
```

### Estados da interface

#### Loading

- Exibir skeleton para o donut, a legenda e a linha de cobertura.
- Manter o título do card visível.
- Não exibir “0%” enquanto o cálculo não for concluído.

#### Empty — sem posições de FII

- Mensagem: **“Não há posições abertas de FIIs para analisar.”**
- Ação: **“Adicionar FII”** ou link para a tela de Posições.
- Não renderizar donut vazio.

#### Empty — posições sem valor calculável

- Mensagem: **“Não há cotações disponíveis para calcular a composição dos FIIs.”**
- Informar quantas posições foram encontradas.
- Oferecer ação para atualizar ou cadastrar cotações.

#### Dados parciais

- Renderizar as categorias que puderem ser avaliadas.
- Exibir “Não classificado” quando aplicável.
- Mostrar cobertura e número de posições sem cotação.
- Se houver alerta, qualificá-lo como baseado na parcela avaliada.
- Se não houver alerta, não usar texto como “carteira diversificada”.

#### Error

- Mensagem: **“Não foi possível calcular a composição dos FIIs.”**
- Exibir botão **“Tentar novamente”**.
- Registrar detalhes técnicos somente no log local, sem expor stack trace na UI.

#### Success sem concentração

- Exibir donut, legenda, total e cobertura.
- Não exibir indicador verde de “baixo risco”; apenas omitir o alerta de concentração.
- Se os dados estiverem completos, poderá ser exibido o texto neutro **“Nenhum tipo supera 70%.”**

#### Success com concentração

- Exibir indicador textual **“Concentração acima de 70%”**.
- Incluir a ocorrência no painel global de Alertas.
- Permitir selecionar a categoria para consultar os ativos que formam a concentração.

### Acessibilidade

- O canvas deverá possuir `role="img"` e um `aria-label` que resuma a maior categoria, o percentual, o total avaliado e a existência de alerta.
- A legenda deverá ser uma lista HTML real, com nome, percentual, valor e quantidade de FIIs.
- Itens interativos da legenda deverão ser alcançáveis por teclado e ativáveis com Enter ou Espaço.
- A seleção de uma categoria deverá possuir foco visível e estado `aria-pressed` ou semântica equivalente.
- Alterações no alerta após atualização deverão ser anunciadas por uma região `aria-live="polite"`, sem repetir a mesma mensagem.
- O gráfico deverá possuir tabela alternativa acessível por botão.
- Percentuais e valores deverão usar texto com contraste mínimo compatível com WCAG AA.
- O alerta deverá combinar texto, ícone textual e estilo visual; cor isolada não será suficiente.
- A paleta categórica deverá ser validada para visão normal e deficiências de visão de cores no tema suportado.
- Em modo de alto contraste ou impressão, categorias deverão poder usar contornos ou padrões adicionais.
- Animações deverão respeitar `prefers-reduced-motion`.
- Alvos interativos deverão ter área mínima adequada para uso por mouse e toque.

---

## 8. Casos de Borda

1. **Carteira sem FIIs:** retornar estado vazio, sem gráfico e sem alerta.

2. **Apenas um tipo com 100%:** renderizar uma única categoria, dispensar legenda em caixa se o rótulo estiver diretamente visível e gerar o alerta de concentração.

3. **Participação exatamente igual a 70%:** não gerar alerta, pois a regra é estritamente maior que 70%.

4. **Participação calculada como 70,0001%:** gerar alerta, ainda que a interface formate o valor como 70,0%. O texto poderá apresentar uma casa adicional quando necessário para explicar o disparo.

5. **Arredondamento somando 99,9% ou 100,1%:** o backend deverá manter valores de precisão integral; a interface poderá ajustar apenas a exibição pelo método de maior resto para totalizar 100,0%.

6. **`tipo_detalhe` nulo ou desconhecido:** agrupar em “Não classificado”, incluir seu valor no denominador e mostrar aviso de cobertura.

7. **“Não classificado” acima de 70%:** não gerar alerta de concentração por tipo; gerar aviso prioritário de classificação insuficiente.

8. **Posição positiva sem cotação:** excluir do total avaliado, contabilizar em `posicoes_sem_cotacao` e indicar que o resultado é parcial.

9. **Cotação zero, negativa ou não numérica:** tratar como cotação indisponível; não usar no cálculo.

10. **Cotação antiga:** usar a última cotação local disponível, mas informar a data de referência. Se houver política de defasagem configurada, marcar os dados como parciais.

11. **Compra e venda que zeram a posição:** não incluir o ativo, mesmo que esteja marcado como ativo no cadastro.

12. **Quantidade líquida negativa:** não incluir no donut e registrar advertência técnica local, pois a visualização não cobre posições vendidas.

13. **Variações de taxonomia:** normalizar valores conhecidos, como `FI-Infra`, sem alterar silenciosamente conceitos como Misto e Híbrido.

14. **Ticker reclassificado:** o próximo carregamento do Dashboard deverá remover o valor da categoria anterior e adicioná-lo à nova, sem manter cache obsoleto.

15. **Várias posições com o mesmo tipo e segmento:** somar os valores corretamente e contar tickers distintos na quantidade de FIIs.

16. **Mais de sete segmentos no sub-gráfico opcional:** exibir os sete maiores e agregar os restantes em “Outros”, preservando acesso aos detalhes na tabela.

---

## 9. Dependências

### Dependências obrigatórias

1. **Item 2.2 do roadmap FII:** criação e preenchimento de `ativos.tipo_detalhe`.
2. **Migração do SQLite:** bancos existentes e instalações novas deverão possuir a coluna sem perda de dados.
3. **Enriquecimento do scraper/importador:** o processo que consulta os dados do I10 deverá normalizar e persistir a classificação.
4. **Lançamentos da carteira:** necessários para calcular a quantidade líquida.
5. **Cotações locais:** necessárias para calcular o valor de mercado atual.
6. **Dashboard atual:** uso dos endpoints `/api/dashboard/resumo` e `/api/dashboard/alertas`.
7. **Chart.js:** reutilização da biblioteca de gráficos já presente no renderer.
8. **Contrato de taxonomia:** definição central dos sete valores canônicos e de seus aliases.

### Dependências não bloqueantes

- O sub-gráfico por segmento pode usar o campo `segmento` já existente.
- `segmento_detalhe` melhora a granularidade, mas não bloqueia o donut principal.
- Os filtros compostos do item 2.7 podem melhorar a navegação para os ativos da categoria, mas não são necessários para o MVP.

---

## 10. Esforço Estimado

### MVP, assumindo `tipo_detalhe` já disponível

| Área | Atividade | Estimativa |
|---|---|---:|
| Produto e dados | Fechar taxonomia, regra de denominador, cobertura e mensagens | 0,5 dia |
| Backend | Agregação por valor de mercado e extensão do resumo | 0,75–1 dia |
| Backend | Integração do alerta e compartilhamento da regra de cálculo | 0,5 dia |
| Frontend | Card, donut, legenda, tooltips e detalhes por categoria | 1–1,5 dia |
| Frontend | Estados loading, vazio, parcial e erro | 0,5 dia |
| Acessibilidade e responsividade | Tabela alternativa, teclado, leitor de tela e janela estreita | 0,5–0,75 dia |
| Testes | Unidade, integração, fronteiras de 70% e regressão do Dashboard | 0,75–1 dia |
| QA e empacotamento | Validação em Electron com banco novo e banco migrado | 0,5 dia |

**Total estimado do MVP:** **5–6,25 dias úteis**.

### Incrementos opcionais

| Incremento | Estimativa adicional |
|---|---:|
| Sub-gráfico por segmento com barras horizontais | 1–1,5 dia |
| Deep link para Posições filtradas pelo tipo | 0,5–1 dia |
| Implementar apenas a parte de `tipo_detalhe` do item 2.2, caso ainda não esteja pronta | 1,5–2,5 dias |
| Validação ampliada de paleta, alto contraste e impressão | 0,5 dia |

**Total com sub-gráfico e dependência 2.2 ainda pendente:** aproximadamente **8–10 dias úteis**.

---

## 11. Riscos &amp; Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Cobertura baixa de `tipo_detalhe` | Gráfico incompleto e falsa percepção de diversificação | Exibir “Não classificado”, cobertura por valor e aviso de dados parciais |
| Inconsistência entre `FI-Infra` e `FO-Infra` ou novos rótulos da fonte | Fragmentação de uma mesma categoria | Taxonomia e aliases centralizados; valores desconhecidos seguem para “Não classificado” |
| Cotações ausentes ou defasadas | Percentuais incorretos ou incompletos | Usar somente última cotação positiva, informar posições excluídas e data de referência |
| Donut pouco acessível para usuários com baixa visão ou daltonismo | Parte dos usuários não consegue interpretar a composição | Legenda textual, tabela equivalente, contraste validado, foco e padrões alternativos |
| Limite de 70% interpretado como recomendação universal | Decisões de investimento inadequadas | Linguagem informativa, explicação de que é um indicador de exposição e ausência de comandos de compra/venda |
| Duplicidade com alerta atual de concentração por ticker | Confusão entre concentração em ativo e concentração em tipo | Usar identificador e texto específicos: `CONCENTRACAO` para ticker e `CONCENTRACAO_TIPO_DETALHE` para categoria |
| Misto e Híbrido usados de forma inconsistente pela fonte | Comparações conceitualmente frágeis | Respeitar o dado de origem, não inferir conversões e documentar a classificação na ajuda |
| Excesso de informação no Dashboard | Redução da legibilidade dos KPIs e alertas existentes | Card responsivo, legenda compacta, detalhes sob demanda e sub-gráfico fora do MVP |

---

## 12. Out of Scope

- Recomendar automaticamente compra, venda ou percentual ideal por tipo.
- Executar rebalanceamento ou criar ordens de investimento.
- Permitir personalização do limite de 70% no MVP.
- Calcular concentração histórica por tipo ao longo do tempo.
- Projetar como um novo aporte alterará os percentuais.
- Calcular correlação estatística entre tipos, segmentos ou tickers.
- Realizar testes de estresse para juros, inflação, vacância ou crédito.
- Avaliar risco individual dos ativos dentro de cada categoria.
- Fazer look-through das carteiras internas de FOFs.
- Reclassificar automaticamente Misto como Híbrido ou vice-versa.
- Consultar o I10 ou outra fonte externa durante o carregamento do Dashboard.
- Substituir ou remover o gráfico atual de composição por `tipo`; essa decisão exige avaliação separada.
- Entregar o sub-gráfico por segmento no MVP; ele permanece como incremento P1 opcional.
- Criar edição manual de `tipo_detalhe` dentro do próprio gráfico.
- Alterar o alerta existente de concentração por ticker ou seu limite configurável.
