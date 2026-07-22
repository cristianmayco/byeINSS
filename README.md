# byeINSS — Independência Financeira

Sistema desktop (Electron) para acompanhar investimentos, simular FIRE (independência financeira) e planejar aposentadoria. Extrai dados da sua carteira do **Investidor10** e da planilha **PRECO TETO**.

> "byeINSS" = "tchau INSS" — o objetivo é deixar de depender do INSS.

---

## ✨ Funcionalidades

| Módulo | O que faz |
|---|---|
| **Dashboard** | Patrimônio, % por classe, % por ativo vs ideal, DY mensal, projeção 12M |
| **Posições** | Lista editável (ticker, qtd, PM, atual, saldo, variação, DY, YoC, %cart, %ideal, **P/VP, vacância**) |
| **Lançamentos** | Cadastro de compras/vendas (gera posição média automaticamente) |
| **Proventos** | Dividendos vs amortizações separados por tipo (RF-016), KPIs `Distribuíveis 12M` / `Amortizações 12M` / `Projeção distribuível 12M`, gráfico mensal empilhado com 4 séries (DIVIDENDO/RENDIMENTO/AMORTIZACAO/BONIFICACAO), filtro por tipo via hash (`?tipos=DIVIDENDO,AMORTIZACAO`), quantidade elegível por linha, modal em lote com múltiplas parcelas (DIVIDENDO + AMORTIZACAO na mesma data) |
| **Preço-teto** | Sinais: muito barato / no teto / caro. **Thresholds configuráveis** em % do preço-teto |
| **Simulador** | Juros compostos: aporte inicial + mensal + meses + taxa + **reajuste anual** → projeção |
| **FIRE** | Patrimônio necessário para renda desejada (taxa de retirada) |
| **Cenários** | Salvar múltiplos planos (FIRE, patrimônio, aposentadoria) e comparar lado a lado |
| **Configurações** | Thresholds de preço, reajuste anual, alertas de concentração/DY |
| **Importar** | Login embutido no I10 (browser isolado) + **enriquecer com P/VP/vacância** + **agenda de dividendos** |
| **Vencimento de contratos** *(PRD 12, schema 1.2)* | Vencimento médio de contratos + tipo de reajuste (IGPM/IPCA/FIXO/MISTO/OUTRO) por FII. **Detalhe por FII** em `#fii/:ticker` com card "Contratos & Reajuste" + modal acessível de edição manual (`PUT /api/fiis/contratos/:ticker`), e **bloco de alerta no Dashboard** quando vencimento < janela (default 24m, ajustável em Configurações). Scraper I10 incluso com `POST /api/fiis/scraper/contratos/resync` |
| **Indicadores históricos FII** *(PRD 02, schema 1.3)* | DY médio 5 anos + rentabilidades nominal/real 1a/2a/5a por FII. Duas colunas novas em **Posições**: **DY vs 5y** (badge verde/amarelo/vermelho/cinza conforme desvio da média) e **Rent. real 12M**. **Bloco de alerta no Dashboard** quando DY 12M < média histórica de 5 anos. Endpoints `GET /api/fiis/indicadores` e `GET /api/fiis/indicadores/:ticker`; `POST /api/fiis/scraper/indicadores/resync` dispara enriquecimento em lote (com filtro opcional por tickers, falha de um não derruba o batch). Threshold `indicador_dy_vs_5a_abaixo_pct=95` configurável |
| **Amortizações separadas** *(PRD 03, schema 1.4)* | Distingue `AMORTIZACAO` de `DIVIDENDO`/`RENDIMENTO` no ciclo completo. Scraper I10 captura a coluna `Tipo` da agenda (sem depender de posição), parser puro localizado por HEADER (semântica, tolera colunas invertidas). DY distribuível, projeção anual e alertas do Dashboard agora **só** consideram distribuíveis — amortizações aparecem em campo separado e em KPIs próprios (RF-019/020). Atualização em lote permite múltiplas parcelas por FII (dividendo + amortização na mesma data) com tipo explícito por linha |
| **Histórico de Dividendos** *(PRD 01, schema 1.5)* | Tela dedicada `#fii-historico/:ticker` com série temporal completa de proventos do FII, KPIs (DY realizado 12M, DY sustentável com confiança ALTA/MEDIA/INDISPONIVEL, comparação vs DY médio 5 anos), detecção de cortes/aumentos recorrentes via sinal mensal consecutivos, cadência regular/irregular, badges de estado (ESTAVEL/EM_OBSERVACAO/CORTE_CONFIRMADO/AUMENTO_CONFIRMADO). Scraper I10 extrai histórico por FII (paginação "Carregar mais") com parser por HEADER semântico. Botão "Histórico" em Posições. Endpoints `GET/POST /api/fii-historico/:ticker` |

---

## 🚀 Instalação

```bash
cd byeinss
npm install
```

## ▶️ Executar

```bash
npm start
```

O app abre em uma janela desktop, com API local rodando em background.

## 📦 Buildar instaladores

```bash
# Linux (AppImage + .deb)
npm run build:linux
# → dist/byeINSS-1.0.0.AppImage
# → dist/byeinss_1.0.0_amd64.deb

# Windows (instalador NSIS + portable .exe)
npm run build:win
# → dist/byeINSS Setup 1.0.0.exe
# → dist/byeINSS 1.0.0.exe (portable)

# macOS (DMG para Intel e Apple Silicon)
npm run build:mac
# → dist/byeINSS-1.0.0.dmg
```

---

## 📥 Como popular o banco pela primeira vez

### 1) Do Investidor10 (carteira)

Já preparei um arquivo com 17 FIIs + 1 ação extraídos como exemplo:

1. Abra o app (`npm start`)
2. Vá em **Importar**
3. Copie o conteúdo de `scripts/preco_teto_seed.json` (sem o campo `_comment`)
4. Cole na textarea "Investidor10 (JSON manual)"
5. Clique em **Importar JSON**

### 2) Automático via Login embutido

1. Em **Importar** → **1. Abrir navegador de login**
2. Faça login no Investidor10 dentro do app
3. **3. Extrair e importar carteira** — popula o banco com seus ativos reais
4. **4. Enriquecer com dados fundamentalistas** — visita cada FII e pega P/VP, vacância, gestor
5. **5. Importar agenda de dividendos** — popula os próximos pagamentos

### 3) Da planilha PRECO TETO (sinais de compra)

A planilha tem colunas como `preco_teto`, `preco_muito_bom`, `dy`. Se você exportá-la para CSV (no Google Sheets: `Arquivo > Fazer download > CSV`), rode:

```bash
cat preco_teto.csv | node scripts/build-sheets-payload.js > sheets.json
```

Depois cole `sheets.json` na textarea "Planilha PREÇO-TETO" e importe.

---

## 🗂️ Estrutura

```
byeinss/
├── package.json
├── db/init.sql                  # schema SQLite
├── src/
│   ├── main/main.js             # Electron main
│   ├── preload/preload.js       # bridge IPC
│   ├── server/
│   │   ├── index.js             # Express + rotas
│   │   ├── db.js                # better-sqlite3
│   │   ├── routes/              # ativos, lancamentos, proventos, cotacoes, metas, dashboard, import, config, cenarios
│   │   └── services/            # import-i10, import-sheets
│   └── renderer/
│       ├── index.html
│       ├── css/styles.css       # tema dark
│       ├── js/app.js            # roteamento + API client
│       ├── js/pages.js          # todas as telas
│       └── vendor/chart.min.js  # Chart.js (local)
├── scripts/
│   ├── preco_teto_seed.json     # 17 FIIs + 1 ação prontos pra importar
│   ├── build-i10-payload.js     # template/validador JSON
│   └── build-sheets-payload.js  # CSV da planilha → JSON
└── assets/
```

---

## 🛠️ Tech stack

- **Electron 32** — desktop app
- **Node.js + Express 4** — API local (porta aleatória)
- **better-sqlite3** — banco SQLite (arquivo `byeinss.db` em `~/.config/byeinss/` no Linux)
- **Chart.js 4** — gráficos
- HTML/CSS/JS puro (sem build, sem React, sem webpack)

---

## 📊 Sua carteira

Após popular o banco, o app calcula em tempo real:

- **Patrimônio** consolidado (valor atual × quantidade)
- **Valor investido** e **lucro** (capital realizado + dividendos)
- **Rentabilidade** 12M e total
- **DY da carteira** ponderado
- **Composição** por classe (% FIIs, Ações, Tesouro, etc.)
- **Top posições** com % atual vs % ideal na carteira
- **Sinais de preço-teto**: oportunidades (abaixo do "muito bom"), no teto, caro
- **Alertas de concentração** (ativos muito acima do % ideal)
- **Vencimento de contratos** (PRD 12): alerta de FIIs de Tijolo com vencimento médio < janela configurável (default 24m, ajustável em Configurações). O Dashboard exibe o card com a lista; em **Posições**, o ticker do FII virou link para `#fii/:ticker`, abrindo o detalhe com data, meses até vencer, tipo de reajuste e modal de edição manual. Endpoint `/api/dashboard/alertas-vencimento` lista os FIIs com pressão de renegociação se aproximando.
- **Indicadores históricos FII** (PRD 02): duas colunas extras em **Posições** — **DY vs 5y** (badge verde/amarelo/vermelho conforme desvio do DY 12M em relação à média de 5 anos) e **Rent. real 12M**. O **Dashboard** mostra um bloco de alerta quando FIIs da carteira estão pagando DY 12M abaixo da média histórica de 5 anos (threshold `indicador_dy_vs_5a_abaixo_pct=95` configurável). Endpoints `GET /api/fiis/indicadores` e `GET /api/fiis/indicadores/:ticker`; `POST /api/fiis/scraper/indicadores/resync` para re-scraping em lote.
- **Amortizações separadas** (PRD 03, schema 1.4): tabela `proventos` aceita 4 tipos com `CHECK` constraint. Parser puro da agenda localizado por HEADER (semântica), reconcialiação opcional de legados. Tela de Proventos com KPIs `Distribuíveis 12M` / `Amortizações 12M` / `Projeção distribuível 12M` separados, gráfico mensal empilhado por tipo (4 séries), filtro por tipo via hash (`?tipos=AMORTIZACAO`), tabela de amortizações previstas vs projeção recorrente. Endpoints `GET/POST /api/proventos`, `GET /api/dashboard/proventos-mensais`, `GET /api/dashboard/projecao-proventos`.

> Os dados ficam 100% locais no seu SQLite — nada é enviado para lugar nenhum.

---

## 🪟 Importação automática do Investidor10

Ao usar o app instalado (Electron), em **Importar** aparece um card verde:

1. **Abrir navegador de login** — abre uma janela com a página de login do Investidor10 dentro do app
2. **Verificar se está logado** — confere se a URL é da carteira
3. **Extrair e importar carteira** — lê o DOM da carteira e popula o banco
4. **Enriquecer com dados fundamentalistas** — visita cada FII e extrai P/VP, vacância, gestor, último dividendo
5. **Importar agenda de dividendos** — popula a tabela de proventos com próximos pagamentos
6. **Fechar navegador**

Suas credenciais ficam isoladas no perfil do Electron — não vão para lugar nenhum. Ver [SECURITY.md](SECURITY.md) para detalhes.

> ⚠️ Esse recurso só funciona no app Electron desktop (não no modo dev/web).

---

## 📜 Licença

MIT
