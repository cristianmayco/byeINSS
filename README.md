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
| **Proventos** | Dividendos por mês/ativo, total 12M, gráfico de renda passiva, **atualização em lote** |
| **Preço-teto** | Sinais: muito barato / no teto / caro. **Thresholds configuráveis** em % do preço-teto |
| **Simulador** | Juros compostos: aporte inicial + mensal + meses + taxa + **reajuste anual** → projeção |
| **FIRE** | Patrimônio necessário para renda desejada (taxa de retirada) |
| **Cenários** | Salvar múltiplos planos (FIRE, patrimônio, aposentadoria) e comparar lado a lado |
| **Configurações** | Thresholds de preço, reajuste anual, alertas de concentração/DY |
| **Importar** | Login embutido no I10 (browser isolado) + **enriquecer com P/VP/vacância** + **agenda de dividendos** |
| **Vencimento de contratos** *(PRD 12, schema 1.2, backend only)* | Vencimento médio de contratos + tipo de reajuste (IGPM/IPCA/FIXO/MISTO/OUTRO) por FII. Alerta via `GET /api/dashboard/alertas-vencimento` quando vencimento < janela (default 24m, configurável). Endpoints REST prontos (`GET/PUT /api/fiis/contratos/:ticker`); UI de detalhe/bloco de alerta e scraper I10 em sub-PRs seguintes |

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
- **Vencimento de contratos** (PRD 12): alerta de FIIs de Tijolo com vencimento médio < janela configurável (default 24m). Endpoint `/api/dashboard/alertas-vencimento` lista os FIIs com pressão de renegociação se aproximando.

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
