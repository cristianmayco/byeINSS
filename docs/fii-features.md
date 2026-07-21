# byeINSS — Funcionalidades Aprofundadas para FIIs

> **Escopo:** análise de funcionalidades **exclusivamente para Fundos Imobiliários (FIIs)** da B3, com base nos dados que o Investidor10 expõe publicamente e nas lacunas atuais do app.

## Contexto

O usuário definiu que o foco do projeto é FIIs. O app já tem base sólida (carteira, transações, proventos, preço-teto, simulador, FIRE, cenários) e um scraper que captura ~13 sinais fundamentalistas. O I10, porém, expõe **~30 sinais** relevantes para FIIs por ativo, dos quais ~17 não são capturados ou sequer modelados no schema atual.

Este documento aprofunda as features prioritárias para um investidor de FIIs no Brasil, mapeando:

- O que cada feature resolve na prática
- De onde virá o dado (página específica do I10)
- Mudanças de schema necessárias (mínimas)
- Fórmulas de cálculo quando o I10 não fornece pronto
- Modelo de UI proposto
- Casos de borda
- Esforço estimado

---

## 1. Dados disponíveis no I10 relevantes para FIIs

### 1.1. Páginas de detalhe de FII (`investidor10.com.br/fiis/{ticker}/`)

Já identificadas via WebFetch no I10 (GTWR11 usado como exemplo). O scraper atual (`src/main/scraper.js`) já acessa essa página em `extractFIIDetalhes`.

**Já capturados** (ver `db/init.sql` e `extractFIIDetalhes`):
- Cotação atual, DY 12M, DY 24M
- P/VP, valor patrimonial por cota, vacância
- Quantidade de imóveis
- Taxa de administração
- Gestor, segmento, último dividendo, último pagamento

**Não capturados mas disponíveis publicamente:**

| Dado | Onde aparece | Importância |
|---|---|---|
| `dy_medio_5anos` | Box "Rendimento" ao lado do DY 12M | Crítica |
| `rentabilidade_real` (1m, 3m, 1a, 2a, 5a) | Tabela "Rentabilidade" coluna "Real" | Crítica |
| `rentabilidade_nominal` (mesmas janelas) | Tabela "Rentabilidade" coluna "Nominal" | Alta |
| `liquidez_diaria_media` (R$) | Box "Liquidez" no header | Alta |
| `numero_cotistas` | Box "Indicadores" do FII | Alta |
| `valor_mercado_estimado` | Box "Valor de Mercado" | Média |
| `numero_cotas_emitidas` | Box "Dados do Fundo" | Média |
| `razao_social`, `cnpj` | Página "Sobre" | Baixa (formulário) |
| `mandato` (Renda/Growth) | Página "Sobre" | Média |
| `tipo_detalhe` (Tijolo/Papel/Misto/FI-Infra/Desenvolvimento/Outro) | Página "Sobre" | Alta |
| `gestao` (Ativa/Passiva) | Página "Sobre" | Média |
| `segmento_detalhe` (ex: Lajes Corporativas, Logístico) | Página "Sobre" | Alta (já tem `segmento` genérico) |
| `area_bruta_locavel` (m²) | Box "Portfólio" | Média |
| `localizacao` | Box "Portfólio" | Baixa |
| `razao_social_principal_inquilino` | Comentários / descrição | Variável |
| Histórico pagOS de dividendos por mês | Tabela "Dividendos" na aba | Crítica |
| Vencimento médio contratos | Às vezes nos "Comunicados" | Variável |
| Reajuste aluguel (IGPM/IPCA) | Às vezes na seção "Sobre" | Variável |
| Magic Number embutido | Widget lateral | Média |
| Comparação vs médias do segmento | Box "Média Tipo/Segmento" | Crítica |
| FIIs do mesmo segmento | Box "Relacionados" | Baixa |
| Checklist Buy & Hold (6+ sinais) | Aba "Checklist" | Alta |
| Média P/VP do segmento | Box "Média Tipo/Segmento" | Alta |
| Média DY do segmento | Box "Média Tipo/Segmento" | Alta |

### 1.2. Outras páginas

- **`/fiis/`** (índice ordenado por PL) — expõe ranking customizável com PL, P/VP, DY atual, DY 5y, Liquidez, Tipo, Variações 12m/24m/5a, Segmento. Essencial para **screening** de FIIs.
- **`/fiis/dividendos/`** — agenda mes/mes. Colunas: Ticker, Data Com, Data Pagamento, Tipo (DIVIDENDO | AMORTIZACAO), Valor. Filtros: meus ativos / favoritos / lista customizada.
- **`/acoes/`**, etc. — irrelevantes (foco é FIIs).

---

## 2. Features Aprofundadas

### 2.1. [CRÍTICA] Histórico completo de dividendos

**Problema que resolve.** O sinal mais importante da vida de um cotista FII é o **corte (ou aumento) de dividendo**. Hoje o app só guarda o "último dividendo" e proventos já pagOS; não há superfície para visualizar tendência. I10 mostra histórico desde 2019 em cada FII.

**Fonte de dados.**
- Endpoint interno já existente: a tabela `proventos` no SQLite, **se for populada retroativamente** com dados históricos da página do FII.
- Hoje: `extractAgendaDividendos` (`scraper.js:349`) só lê a agenda atual. Faltaria um `extractDividendosHistorico(ticker)` que raspa a aba "Dividendos" da página `/fiis/{ticker}/`. Heurística do DOM: linhas com mês/ano + valor, sem data-com/data-pagto (é histórico, não agenda).

**Mudança de schema.** Nenhuma obrigatória. Mas a coluna `tipo` em `proventos` deve ganhar `AMORTIZACAO` (ver 2.3) — historicamente amortizações são comuns (MXRF11, BTLG11, etc.).

**Cálculo/uso.**
- DY atual "anualizado" é a soma dos últimos 12 dividendos da série histórica.
- DY sustentável estimado: média móvel dos últimos **24 ou 36 dividendos**.
- **Detecção de corte:** comparar dividendo atual vs média 12 anteriores. Se queda > 15% por 2 meses consecutivos → alerta "Corte em andamento".
- **Detecção de aumento:** divisor subindo acima de média + tendência.
- **Visualização:** gráfico de linha (Chart.js) com dividendo por mês no eixo Y, tempo no X, segmentado por FII ou empilhado pela carteira.

**UI proposta.**
- Nova aba/slide na página de detalhe de cada ativo: "Histórico de dividendos" → linha do tempo + tabela paginada.
- Gráfico global em "Posições" opcional: dividendo médio da carteira nos últimos 12/24/36 meses.

**Casos de borda.**
- IPOs recentes (< 12 meses de histórico): mostrar N dividido, não anualizar.
- Amortizações grandes e raras: distinguir visualmente do dividendo recorrente (cor/forma).
- FIIs que só pagam semestralmente/trimestralmente: anualizar com janela ≥ 18 meses.
- Falta de dado: NÃO inventar — mostrar "—" + tooltip "última atualização: DATA".

**Esforço.** Médio. ~30 linhas no scraper + endpoint `/api/proventos/historico/:ticker` + UI Chart.js.

---

### 2.2. [CRÍTICA] DY médio 5 anos + rentabilidade real (IPCA-ajustada) ✅ **ENTREGUE (PRD 02, schema 1.3)**

**Status:** 3 sub-PRs commitados (`bc5d561`, `c40fe48`, `be61df9`). 330/330 vitest + 64/64 smoke verde. Gates `schema-reviewer` APPROVE + `electron-security-reviewer` APPROVED.

**Problema.** DY atual em FII pode ser "armadilha sustentável" — alto porque o preço caiu, não porque a distribuição subiu. O cruzamento DY atual vs DY 5y revela isso. Da mesma forma, "Meu FII rendeu 15% no ano!" pode ser ilusão se inflação foi 8%.

**Fonte de dados.** Página `/fiis/{ticker}/`. Hoje o scraper (`extractFIIDetalhes`) não captura esses campos.

**Mudança de schema.** Adicionar colunas em `ativos`:
```sql
ALTER TABLE ativos ADD COLUMN dy_medio_5a REAL;
ALTER TABLE ativos ADD COLUMN rentab_nominal_1a REAL;
ALTER TABLE ativos ADD COLUMN rentab_nominal_2a REAL;
ALTER TABLE ativos ADD COLUMN rentab_nominal_5a REAL;
ALTER TABLE ativos ADD COLUMN rentab_real_1a REAL;
ALTER TABLE ativos ADD COLUMN rentab_real_2a REAL;
ALTER TABLE ativos ADD COLUMN rentab_real_5a REAL;
ALTER TABLE ativos ADD COLUMN liquidez_diaria REAL;
ALTER TABLE ativos ADD COLUMN numero_cotistas INTEGER;
ALTER TABLE ativos ADD COLUMN tipo_detalhe TEXT;  -- Tijolo/Papel/Misto/FI-Infra/Desenvolvimento
ALTER TABLE ativos ADD COLUMN mandato TEXT;       -- Renda/Growth
ALTER TABLE ativos ADD COLUMN gestao TEXT;        -- Ativa/Passiva
ALTER TABLE ativos ADD COLUMN area_bruta_locavel REAL;
ALTER TABLE ativos ADD COLUMN localizacao TEXT;
ALTER TABLE ativos ADD COLUMN razao_social TEXT;
ALTER TABLE ativos ADD COLUMN cnpj TEXT;
```

**Cálculo/uso.**
- Coluna nova "DY atual vs DY 5y" na tabela de Posições:
  - Verde: DY atual ≥ 95% do DY 5y (sinal de "dividendo consistente")
  - Amarelo: 80% ≤ DY atual < 95% (possível início de corte)
  - Vermelho: DY atual < 80% do DY 5y (corte provável)
- Coluna "Rentab real 1a" mostra o ganho real.
- Alerta global em "Dashboard": "X FIIs da carteira estão pagando menos que a média histórica de 5 anos."

**UI proposta.** Tabela "Posições" ganha duas colunas extras:
- `DY vs 5y` (chip com cor)
- `Rent. real 12M` (percentual)

**Casos de borda.**
- FII listado há < 5 anos: não mostrar ratio, marcar "— (listado em YYYY)".
- DY 5y ausente em IPOs muito novos: tratar como null, não como 0.

**Esforço.** Baixo (schema + 1 scraper enrichment + 2 colunas no front).

---

### 2.3. [ALTA] Tipo `AMORTIZACAO` em proventos

**Problema.** Em FIIs, parte do "dividendo" pode ser **amortização** (devolução de capital), que **não é tributável** e **reduz a cota**. Hoje o schema só tem `DIVIDENDO`, `RENDIMENTO`, `BONIFICACAO` — não distingue. Sem essa distinção, o cálculo de DY distribuível fica errado e a projeção de receita futura vira superstição.

**Fonte de dados.** Agenda de dividendos do I10 (`/fiis/dividendos/`): a coluna "Tipo" traz "Dividendos" e "Amortização". O scraper `extractAgendaDividendos` hoje faz parse de linha mas ignora o tipo.

**Mudança de schema.**
```sql
-- Atualizar CHECK constraint e default
CREATE TABLE proventos_new (...);
-- Ou em SQLite que não suporta CHECK alter:
--   Workaround: nova tabela, copiar dados, renomear
```
Nova enum: `'DIVIDENDO' | 'RENDIMENTO' | 'BONIFICACAO' | 'AMORTIZACAO' | 'JCP'` (JCP para futuro, se houver ações).

**Cálculo/uso.**
- Na tela Proventos, gráfico empilhado: barra por mês, segmentado por tipo.
- Total do ano expõe "Total distribuível" (só dividendos + rendimentos) vs "Total amortizado" (separado).
- Na página FIRE/proventos: projeção anual usa **só dividendos**, não amortização (que some após o capital ser devolvido).

**UI proposta.** Página Proventos: gráfico de barras empilhadas com legenda dos tipos + filtros por tipo.

**Casos de borda.**
- FII que paga "R$ 1,00 dividido em R$ 0,80 dividendo + R$ 0,20 amortização" — manter granularidade.
- Bonificação em ações: raríssimo em FII, manter como categoria à parte.

**Esforço.** Baixo. ~10 linhas no schema/check + 5 no parser + 5 na UI.

---

### 2.4. [CRÍTICA] Comparador vs média do segmento

**Problema.** Comprar FII olhando só seu P/VP atual esconde se ele está caro/barato em relação ao **segmento**. HGLG11 com P/VP 0,89 pode ser excelente se média de Logístico é 0,95, mas péssimo se média é 0,80. I10 expõe essa média em "Média Tipo/Segmento" na página do FII.

**Fonte de dados.** Página `/fiis/{ticker}/` → box lateral "Média Tipo/Segmento" com:
- P/VP: valor do FII vs média
- DY 12M: valor vs média
- Valor Patrimonial: R$ do FII vs R$ médio
- VPA (valor patrimonial por cota): R$ vs R$ médio

**Mudança de schema.**
```sql
ALTER TABLE ativos ADD COLUMN pvp_medio_segmento REAL;
ALTER TABLE ativos ADD COLUMN dy_medio_segmento REAL;
ALTER TABLE ativos ADD COLUMN pl_medio_segmento REAL;  -- patrimônio líquido médio
ALTER TABLE ativos ADD COLUMN vpa_medio_segmento REAL;
```

**Cálculo/uso.**
- Coluna nova "Pos vs Peer" em Posições: chip com desvio % entre o P/VP do FII e a média do segmento.
- Verde: mais barato que peer (P/VP_FII < P/VP_média_setor)
- Vermelho: mais caro
- Usado na **tela Preço-teto** também: rebalanceamento sugerido deve considerar isso.

**UI proposta.** Posições: nova coluna com desvio. Tooltip explica "P/VP deste FII vs média do segmento XX".

**Casos de borda.**
- Segmentos com 1 FII só (não tem média válida): N/A.
- Critério de "mesmo segmento" precisa ser definido (ex: usar `segmento_detalhe` que o I10 usa, ou agrupar como "Logístico geral"?).

**Esforço.** Médio. Scraper precisa de novo parser para o box "Média Tipo/Segmento" + schema + endpoint + UI.

---

### 2.5. [ALTA] Score Buy & Hold calculado pela app

**Problema.** I10 tem checklist na aba "Checklist" (6+ checks): tempo listado > 5 anos, DY 5y > 8%, liq > 700k, cotistas > 20k, PL > 1 bi, vacância < 10%, imóveis ≥ 5. **Dá pra reproduzir tudo via dados já disponíveis**, sem depender de scraping adicional. Vantagem: o app pode **recalcular** sempre que dados mudarem (não é cópia desatualizada).

**Fonte de dados.** 100% derivada de dados já existentes no schema + uma viagem ao scraper pra puxar os faltantes (DY 5y, liq, cotistas — ver 2.2).

**Mudança de schema.** Nenhuma se 2.2 for implementado. Caso contrário, criar tabela opcional:
```sql
CREATE TABLE IF NOT EXISTS fii_indicadores_cache (
  ativo_id INTEGER PRIMARY KEY,
  score_buy_hold INTEGER, -- 0-7 (quantos checks passam)
  calculo_em TEXT,
  FOREIGN KEY (ativo_id) REFERENCES ativos(id)
);
```

**Cálculo/uso.** Lógica determinística:
```
score = 0
if (data_listagem OR created_at) < (now - 5y): score++
if dy_medio_5a ≥ 8: score++
if liquidez_diaria ≥ 700000: score++
if numero_cotistas ≥ 20000: score++
if patrimonio_liquido ≥ 1e9: score++
if vacancia < 10: score++
if num_imoveis ≥ 5: score++
return score, total=7
```

**UI proposta.** Na tabela de Posições, coluna "B&H" com chips 0–7. Tooltip mostra quais checks passam/falham em texto.

**Casos de borda.**
- FII listado há exatamente 5 anos: regra precisa definir `<` ou `≤`. Usar `< (now - 5y)` (data exata pode ser parcial).
- Liq variável: usar média dos últimos X dias, não valor pontual.

**Esforço.** Médio. Lógica pura em SQL/JS, sem scraping novo (se 2.2 estiver pronto).

---

### 2.6. [ALTA] Cap rate (yield ÷ vacância implícita)

**Problema.** Cap rate é o yield da propriedade em si, descontando vacância: `cap_rate = receita_líquida_imóvel / valor_imóvel`. **I10 não calcula**, mas a fórmula é derivável de dados que o scraper já coleta (P/VP, Receita, Vacância). Serve pra responder: "Esse FII está pagando yield alto porque o imóvel vale pouco, ou porque o ativo é barato?"

**Fonte de dados.**
- Dados existentes: `vp_cota` (R$ X por cota), `num_imoveis` (N imóveis), `p_vp` (preço/VP), `vacancia` (% vacância).
- Faltam: receita por imóvel, valor por imóvel. **Precisaria de uma viagem ao site do FII (não automatizável fácil).**
- Alternativa simplificada (proxy): `cap_rate_estimado = dy_12m × (1 − vacancia/100)`. Útil mesmo sem o cálculo perfeito.

**Mudança de schema.**
```sql
ALTER TABLE ativos ADD COLUMN cap_rate_estimado REAL;
```

**Cálculo/uso.**
```js
// Proxy simples (sem precisar de receita por imóvel):
const cap_rate_estimado = dy_12m * (1 - vacancia / 100);

// Quanto mais perto do DY, menor é o impacto da vacância.
// Se cap_rate_estimado << DY do fundo: vacância está "comendo" yield.
```

**UI proposta.** Posições: coluna "Cap rate (est.)" ao lado do DY.

**Casos de borda.**
- Cap rate proxy é aproximado: documentar como tal na tooltip.
- FIIs de Papel não têm imóveis — não tem cap rate. Marcar N/A.

**Esforço.** Baixo (cálculo trivial em JS) + nova coluna.

---

### 2.7. [MÉDIA] Filtros práticos do investidor FII

**Problema.** Hoje as listas (Posições, Preço-teto) mostram todos os FIIs sem filtros compostos. Filtros clássicos: "Tijolo", "Liquidez > R$ 1M", "Vacância < 10%", "DY entre 8% e 12%", "Cotistas > 20k". Combináveis.

**Mudança de schema.** Nenhuma. É só UI.

**Cálculo/uso.** Filtros no front, estado em `URL hash` pra deep link.

**UI proposta.** Acima das tabelas de FIIs, barra de filtros com chips toggleáveis. Estilo "faceted search" do I10.

**Esforço.** Baixo. ~1 dia de UI.

---

### 2.8. [MÉDIA] Watchlist / favoritos

**Problema.** Hoje só existe "carteira" (ativos com posição) e nada para "FIIs que estou de olho". I10 tem essa funcionalidade.

**Mudança de schema.**
```sql
CREATE TABLE IF NOT EXISTS watchlist (
  ticker TEXT PRIMARY KEY,
  adicionado_em TEXT DEFAULT (datetime('now')),
  nota TEXT  -- opcional, ex: "aguardando DY < R$10"
);
```

**Cálculo/uso.** Watchlist é separada da carteira. Aparece numa aba/seção. Pode-se ativar alertas por watchlist item.

**UI proposta.** Aba lateral "Watchlist" ou menu. Tabela similar à de Posições mas com colunas extras (preço-teto, DY atual, "desde que adicionei: variação").

**Esforço.** Baixo. CRUD pequeno + UI.

---

### 2.9. [ALTA] Radar de DY muito acima do histórico (alerta de corte)

**Problema.** Quando DY atual está muito acima da média histórica, é **forte sinal de corte iminente** (preço caiu, "yield" disparou — ou a gestão cortou, e quem não viu perdeu). Atualmente o app não monitora isso.

**Fonte de dados.** `dy_12m` (existente) + `dy_medio_5a` (item 2.2) + histórico de dividendos (item 2.1).

**Mudança de schema.** Nenhuma nova. Depende de 2.1 e 2.2.

**Cálculo.**
```js
const ratio = dy_12m / dy_medio_5a;
if (ratio > 1.25) return { nivel: 'AMARELO', msg: 'DY atual 25% acima da média 5y — possível armadilha' };
if (ratio > 1.50) return { nivel: 'VERMELHO', msg: 'DY atual 50% acima — corte provável, reveja posição' };
```

**UI proposta.** Alerta global em Dashboard + badge em cada FII da tabela de Posições.

**Esforço.** Baixo se 2.1 e 2.2 estiverem prontos.

---

### 2.10. [MÉDIA] Concentração por tipo_detalhe (Tijolo/Papel/Misto/FI-Infra/Desenvolvimento/Híbrido)

**Problema.** Hoje a composição é mostrada por `tipo` (FII/Ação/TD). Investidor FII quer saber: "estou X% em Tijolo, Y% em Papel, Z% em FI-Infra". Exposição concentrada num tipo é sinal de risco.

**Mudança de schema.** Depende do `tipo_detalhe` (item 2.2).

**UI proposta.** Novo painel no Dashboard: pizza/donut por `tipo_detalhe`, com alerta se > 70% num único tipo.

**Esforço.** Baixo.

---

### 2.11. [NICE] Magic Number embutido

**Problema.** "Quantas cotas preciso para R$ X/mês desse FII?" — I10 já responde. App pode embutir.

**Fórmula.**
```js
const cotas_para_renda = (renda_mensal_desejada * 12) / (dy_anual_medio * preco_atual);
// ou:
// const cotas_para_renda = renda_mensal_desejada / ultimo_dividendo;
```

**UI proposta.** Widget lateral em cada FII + uma calculadora global: "preciso de R$ X/mês da minha carteira de FIIs, quantas cotas somam isso?"

**Esforço.** Baixo.

---

### 2.12. [MÉDIA] Vencimento médio de contratos + reajuste

**Problema.** Em FIIs de Tijolo, quanto antes o vencimento médio dos contratos, maior o risco de pressão no aluguel. FII com vencimento médio de 2 anos pode ter problema sério em 2027-2028.

**Fonte de dados.** I10 às vezes mostra em "Comunicados" e na página individual. Scrape frágil.

**Mudança de schema.**
```sql
ALTER TABLE ativos ADD COLUMN vencimento_medio_contratos DATE; -- ou numero de meses
ALTER TABLE ativos ADD COLUMN tipo_reajuste TEXT;               -- 'IGPM' | 'IPCA' | 'Fixo X%'
```

**UI proposta.** Tooltip/lateral.

**Esforço.** Alto (parsing instável). Nice-to-have.

---

## 3. Mudanças de schema consolidadas

Se implementado o **pacote 2.1–2.6**, o schema ganha:

```sql
-- Novos campos em 'ativos':
ALTER TABLE ativos ADD COLUMN dy_medio_5a REAL;
ALTER TABLE ativos ADD COLUMN rentab_nominal_1a REAL;
ALTER TABLE ativos ADD COLUMN rentab_nominal_2a REAL;
ALTER TABLE ativos ADD COLUMN rentab_nominal_5a REAL;
ALTER TABLE ativos ADD COLUMN rentab_real_1a REAL;
ALTER TABLE ativos ADD COLUMN rentab_real_2a REAL;
ALTER TABLE ativos ADD COLUMN rentab_real_5a REAL;
ALTER TABLE ativos ADD COLUMN liquidez_diaria REAL;
ALTER TABLE ativos ADD COLUMN numero_cotistas INTEGER;
ALTER TABLE ativos ADD COLUMN tipo_detalhe TEXT;
ALTER TABLE ativos ADD COLUMN mandato TEXT;
ALTER TABLE ativos ADD COLUMN gestao TEXT;
ALTER TABLE ativos ADD COLUMN area_bruta_locavel REAL;
ALTER TABLE ativos ADD COLUMN localizacao TEXT;
ALTER TABLE ativos ADD COLUMN razao_social TEXT;
ALTER TABLE ativos ADD COLUMN cnpj TEXT;
ALTER TABLE ativos ADD COLUMN pvp_medio_segmento REAL;
ALTER TABLE ativos ADD COLUMN dy_medio_segmento REAL;
ALTER TABLE ativos ADD COLUMN cap_rate_estimado REAL;

-- Atualização do enum em 'proventos.tipo':
-- De: 'DIVIDENDO' | 'RENDIMENTO' | 'BONIFICACAO'
-- Para: 'DIVIDENDO' | 'RENDIMENTO' | 'BONIFICACAO' | 'AMORTIZACAO' | 'JCP'
-- SQLite não suporta ALTER CHECK; recriar tabela.

-- Nova tabela 'watchlist':
CREATE TABLE IF NOT EXISTS watchlist (
  ticker TEXT PRIMARY KEY,
  adicionado_em TEXT DEFAULT (datetime('now')),
  nota TEXT
);

-- Cache opcional:
CREATE TABLE IF NOT EXISTS fii_indicadores_cache (
  ativo_id INTEGER PRIMARY KEY,
  score_buy_hold INTEGER,
  calculo_em TEXT,
  FOREIGN KEY (ativo_id) REFERENCES ativos(id)
);
```

---

## 4. Mudanças no scraper

### 4.1. `extractFIIDetalhes` — ampliar para trazer mais campos

Hoje busca: gestor, segmento, vp_cota, p_vp, vacancia, num_imoveis, dy_12m, dy_24m, taxa_adm, ultimo_dividendo, ultimo_pagto.

Acrescentar:
- `dy_medio_5a` (do box "Rendimento" → "DY médio 5 anos")
- `liquidez_diaria` (R$)
- `numero_cotistas`
- `valor_mercado`, `numero_cotas_emitidas` (do box "Valor de Mercado")
- `rentabilidade_*` (tabela Rentabilidade, colunas Nominal/Real × 1m/3m/1a/2a/5a)
- `pvp_medio_segmento`, `dy_medio_segmento` (box "Média Tipo/Segmento")
- `razao_social`, `cnpj` (página Sobre)
- `mandato` (Renda/Growth), `gestao` (Ativa/Passiva)
- `tipo_detalhe` (Tijolo/Papel/Misto/FI-Infra/Desenvolvimento/Outro)
- `segmento_detalhe` (Lajes Corporativas, Logístico, etc.) — substituir `segmento` ou coexistir?
- `area_bruta_locavel` (m²), `localizacao` (UF/Cidade)

### 4.2. Novo: `extractDividendosHistorico(ticker)`

Acessa `/fiis/{ticker}/`, aba "Dividendos". Coleta:
- Lista de `[{mes_ano, valor_por_cota, tipo: 'DIVIDENDO'|'AMORTIZACAO'}]`

Persiste na tabela `proventos` com dedup por (ativo_id, data_pagto).

### 4.3. Atualizar `extractAgendaDividendos`

Já lê a agenda do mês. Atualizar para:
- Capturar coluna `Tipo` (Dividendo vs Amortização) — já tem `tipo` no schema.
- Resolver ticker → `ativo_id` corretamente (já faz).

---

## 5. Novas rotas da API

| Método | Rota | Função |
|---|---|---|
| GET | `/api/fiis/indicadores` | Lista FIIs com TODOS os indicadores (para tela Análise Fundamentalista) |
| GET | `/api/fiis/indicadores/:ticker` | Detalhe completo de um FII |
| GET | `/api/fiis/scoring/buy-hold` | Calcula score Buy & Hold para todos os FIIs |
| GET | `/api/proventos/historico/:ticker` | Histórico pagOS por FII |
| GET | `/api/watchlist` | Lista watchlist |
| POST | `/api/watchlist` | Adiciona |
| DELETE | `/api/watchlist/:ticker` | Remove |

---

## 6. Novas páginas na UI

| Rota (hash) | Conteúdo |
|---|---|
| `#fii-analise` | Tabela comparativa de todos os FIIs com 20+ indicadores + filtro por segmento (essencialmente o índice do I10, mas com seus dados) |
| `#fii-watchlist` | Watchlist (própria carteira de "olho") |
| `#fii-historico/:ticker` | Linha do tempo de dividendos de um FII + gráfico de DY vs meses |

---

## 7. Roadmap sugerido (em fases incrementais)

### Fase 1 — Fundamentos baratos (1–2 dias)
- Schema: novas colunas em `ativos`
- Scraper: ampliar `extractFIIDetalhes` com `dy_medio_5a`, `liquidez`, `cotistas`, `rentabilidade_*`, `pvp_medio_segmento`, `dy_medio_segmento`, `tipo_detalhe`
- UI: 2 colunas novas em Posições (DY vs 5y, Rent. real 12M)

### Fase 2 — Histórico de dividendos (2–3 dias)
- Novo scraper `extractDividendosHistorico`
- Atualizar `extractAgendaDividendos` para usar `AMORTIZACAO`
- Migration de schema em `proventos`
- Endpoint `/api/proventos/historico/:ticker`
- UI: página/aba de histórico por FII + gráfico

### Fase 3 — Score Buy & Hold + Cap rate (1 dia)
- Função determinística no backend
- Tabela `fii_indicadores_cache`
- UI: coluna "B&H" (0–7) em Posições + cap rate estimado

### Fase 4 — Watchlist + Radar DY (1–2 dias)
- Migration `watchlist`
- Endpoints CRUD
- UI: aba Watchlist + alerta "DY atual > 1.25 × DY 5y"

### Fase 5 — Análise Fundamentalista + Filtros (2–3 dias)
- Endpoint `/api/fiis/indicadores`
- Página `#fii-analise` (tabela comparável com faceted filters)

---

## 8. Itens explicitamente **fora** do escopo FII-only

Pra manter o foco:

- ❌ Suporte a ações (BBAS3, P/L, ROE, Bazin, Graham)
- ❌ Cripto, BDR, ETFs, Stocks, Tesouro Direto — funcionalidades dedicadas
- ❌ Cálculo de IR de venda de ações
- ❌ JCP (juros sobre capital próprio, exclusivo de ações)
- ❌ DARF, declaração anual IR (ações)

Esses ficam **apenas** com a captura existente ou futura do I10, sem features dedicadas no app.

---

## 9. Referências

- Schema atual: `db/init.sql`
- Scraper atual: `src/main/scraper.js` (funções `extractInvestidor10`, `extractFIIDetalhes`, `extractAgendaDividendos`)
- Routes existentes: `src/server/routes/*.js`
- Páginas existentes: `src/renderer/js/pages.js` (renderDashboard, renderPosicoes, etc.)
- Análise feita via WebFetch em:
  - `/fiis/{ticker}/` (ex: GTWR11)
  - `/fiis/` (índice)
  - `/fiis/dividendos/` (agenda)
  - `/acoes/` (relevância apenas metodológica, não de features)
