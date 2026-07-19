// Scraper embarcado: abre um BrowserWindow com a URL do Investidor10 (ou outra),
// permite o usuário logar, e extrai os dados via executeJavaScript.
//
// Credenciais e cookies ficam APENAS no perfil isolado do Electron — nunca
// são enviados para lugar nenhum.

const { BrowserWindow } = require('electron');
const path = require('path');
const { importFromI10 } = require('../server/services/import-i10.js');

let scraperWindow = null;
let getDb = null;

function setDbGetter(fn) { getDb = fn; }

async function openScraper(url = 'https://investidor10.com.br/wallet/my-wallet/pro') {
  if (scraperWindow && !scraperWindow.isDestroyed()) {
    scraperWindow.focus();
    return { alreadyOpen: true };
  }

  scraperWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'byeINSS — Conectar ao Investidor10',
    backgroundColor: '#0f1419',
    parent: BrowserWindow.getFocusedWindow() || undefined,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Persiste sessão do usuário num perfil dedicado dentro do userData
      partition: 'persist:investidor10',
      // Bloita navegação para fora do domínio I10 (anti-phishing)
    }
  });

  // Segurança: navegação externa abre no browser padrão
  scraperWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    require('electron').shell.openExternal(u);
    return { action: 'deny' };
  });
  scraperWindow.webContents.on('will-navigate', (event, u) => {
    const allowed = ['investidor10.com.br', 'localhost', '127.0.0.1'];
    if (!allowed.some(d => u.includes(d))) {
      event.preventDefault();
      require('electron').shell.openExternal(u);
    }
  });

  await scraperWindow.loadURL(url);
  return { alreadyOpen: false };
}

async function checkReady() {
  if (!scraperWindow || scraperWindow.isDestroyed()) throw new Error('Janela do scraper não está aberta');
  const url = scraperWindow.webContents.getURL();
  // Pronto se estiver na carteira (logado) OU na página de preços (público)
  return { url, isWallet: url.includes('/my-wallet') };
}

async function extractInvestidor10() {
  if (!scraperWindow || scraperWindow.isDestroyed()) throw new Error('Janela do scraper não está aberta');
  const url = scraperWindow.webContents.getURL();
  if (!url.includes('/my-wallet') && !url.includes('/fiis/') && !url.includes('/acoes/')) {
    throw new Error('Faça login no Investidor10 e abra a carteira antes de extrair');
  }

  // Espera até a tabela de FIIs renderizar
  await scraperWindow.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const root = document.querySelector('main, [role="main"], body');
        const temFIIs = [...document.querySelectorAll('a')].some(a => /[A-Z]{4}11$/.test(a.textContent?.trim() || ''));
        if (temFIIs) return resolve(true);
        if (Date.now() - t0 > 15000) return reject(new Error('Timeout: carteira não carregou em 15s'));
        setTimeout(tick, 200);
      };
      tick();
    });
  `);

  // Extrai os dados de TODAS as seções (Ações, FIIs, ETFs, TD)
  const data = await scraperWindow.webContents.executeJavaScript(`
    (() => {
      const out = { ativos: [], cotacoes: [], meta: { extraidoEm: new Date().toISOString(), url: location.href } };

      // Helper: número BR → float
      const brnum = (s) => {
        if (!s) return null;
        const t = String(s).replace(/[^\\d,\\-.]/g, '');
        return Number(t.replace(/\\./g, '').replace(',', '.')) || null;
      };
      const brpct = (s) => {
        if (!s) return null;
        const t = String(s).replace(/[^\\d,\\-.]/g, '');
        return Number(t.replace(/\\./g, '').replace(',', '.')) || null;
      };

      // Encontra todos os botões de seção expandível
      const secoes = document.querySelectorAll('button[aria-expanded], [role="region"]');
      const tiposMap = { 'Ações':'ACAO', 'FIIs':'FII', 'ETFs':'ETF', 'Tesouro Direto':'TD', 'Fundos':'FII' };

      // Para cada seção, encontra a tabela interna
      const tabelas = document.querySelectorAll('table');
      tabelas.forEach(tab => {
        // Detecta o tipo olhando a primeira linha + contexto
        const caption = tab.querySelector('caption')?.textContent || '';
        let tipo = 'FII';
        if (caption.includes('Carteira') || caption.includes('Ativos')) return; // pula gráficos
        // Heurística: FIIs tem coluna "Yield On Cost", Ações tem "Nota", TD tem "Rentab"
        const headers = [...tab.querySelectorAll('th')].map(h => h.textContent.trim());
        if (headers.includes('Yield On Cost') || headers.includes('Yield On\nCost')) tipo = 'FII';
        else if (headers.includes('Variação') && headers.includes('Rentabilidade') && !headers.includes('Yield On')) tipo = 'ACAO';
        else if (headers.includes('Rentabilidade') && !headers.includes('Variação')) tipo = 'TD';
        else if (headers.includes('Nota') && !headers.includes('Yield')) tipo = 'ACAO';

        // Lê cada linha de dados
        const rows = tab.querySelectorAll('tbody tr');
        rows.forEach(row => {
          const cells = [...row.querySelectorAll('td')].map(c => c.textContent.trim());
          if (cells.length < 5) return;
          // Acha o ticker (sempre um link)
          const link = row.querySelector('a[href*="/fiis/"], a[href*="/acoes/"]');
          const ticker = link?.textContent?.trim();
          if (!ticker || !/^[A-Z]{4}\\d{1,2}$/.test(ticker)) return;

          // Parse por posição baseado nos headers
          const obj = { ticker, tipo };
          headers.forEach((h, i) => {
            const v = cells[i];
            if (!v) return;
            const hh = h.replace(/\\s+/g, ' ').toLowerCase();
            if (hh.includes('quant')) obj.quantidade = brnum(v);
            else if (hh.includes('preço médio') || hh.includes('preco medio')) obj.preco_medio = brnum(v);
            else if (hh.includes('preço atual') || hh.includes('preco atual')) obj.preco_atual = brnum(v);
            else if (hh.includes('saldo')) obj.saldo = brnum(v);
            else if (hh.includes('variação') || hh.includes('variacao')) obj.variacao = brpct(v);
            else if (hh.includes('rentabilidade')) obj.rentabilidade = brpct(v);
            else if (hh.includes('yield on cost')) obj.yoc = brpct(v);
            else if (hh.includes('dividend yield') || hh === 'dy') obj.dy = brpct(v);
            else if (hh.includes('% carteira') || hh === '%cart') obj.pct_carteira = brpct(v);
            else if (hh.includes('% ideal') || hh === '%ideal') obj.pct_ideal = brpct(v);
            else if (hh === 'nota') obj.nota = brnum(v);
          });
          if (obj.quantidade && obj.preco_medio) out.ativos.push(obj);
        });
      });

      // Snapshot de cotações (data atual)
      const hoje = new Date().toISOString().slice(0,10);
      out.ativos.forEach(a => {
        if (a.preco_atual) out.cotacoes.push({ ticker: a.ticker, data: hoje, preco: a.preco_atual });
      });

      return out;
    })()
  `);

  return data;
}

async function extractAndImport() {
  const data = await extractInvestidor10();
  if (!getDb) throw new Error('DB não inicializado');
  const db = getDb();
  // Converte para o formato que o importador espera
  const payload = {
    ativos: data.ativos.map(a => ({
      ticker: a.ticker,
      tipo: a.tipo,
      quantidade: a.quantidade,
      preco_medio: a.preco_medio,
      preco_atual: a.preco_atual,
      dy: a.dy,
      nota: a.nota,
      pct_carteira: a.pct_carteira,
      pct_ideal: a.pct_ideal
    })),
    cotacoes: data.cotacoes.reduce((acc, c) => {
      acc[c.ticker] = (acc[c.ticker] || []).concat([{ data: c.data, preco: c.preco }]);
      return acc;
    }, {}),
    proventos: []
  };
  const result = importFromI10(db, payload);
  return { extraido: data.ativos.length, importados: result };
}

function closeScraper() {
  if (scraperWindow && !scraperWindow.isDestroyed()) {
    scraperWindow.close();
  }
  scraperWindow = null;
}

// Navega para a página individual de um FII e extrai dados fundamentalistas
async function extractFIIDetalhes(ticker) {
  if (!scraperWindow || scraperWindow.isDestroyed()) {
    throw new Error('Janela do scraper não está aberta');
  }
  const url = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
  await scraperWindow.loadURL(url);
  // Espera a página carregar
  await scraperWindow.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        if (document.querySelector('h1, .ticker-header')) return resolve(true);
        if (Date.now() - t0 > 15000) return reject(new Error('timeout'));
        setTimeout(tick, 200);
      };
      tick();
    });
  `);

  // Extrai dados fundamentalistas da página
  const dados = await scraperWindow.webContents.executeJavaScript(`
    (() => {
      const brnum = (s) => {
        if (!s) return null;
        const t = String(s).replace(/[^\\d,\\-.]/g, '');
        return Number(t.replace(/\\./g, '').replace(',', '.')) || null;
      };
      const brpct = (s) => {
        if (!s) return null;
        const t = String(s).replace(/[^\\d,\\-.]/g, '');
        return Number(t.replace(/\\./g, '').replace(',', '.')) || null;
      };

      // Helpers: acha o valor dado um label próximo
      const get = (label) => {
        const els = [...document.querySelectorAll('div, span, td, th, p, label')];
        for (const el of els) {
          if (el.children.length === 0 && el.textContent.toLowerCase().includes(label.toLowerCase())) {
            // Próximo sibling ou parent
            const next = el.nextElementSibling;
            if (next && next.children.length === 0) return next.textContent.trim();
            // ou valor no parent próximo
            const parent = el.parentElement;
            if (parent) {
              const all = [...parent.children];
              for (const c of all) {
                if (c !== el && c.children.length === 0 && c.textContent.trim() && !c.textContent.toLowerCase().includes(label.toLowerCase())) {
                  return c.textContent.trim();
                }
              }
            }
          }
        }
        return null;
      };

      // Tabela de "Indicadores" - padrão do I10
      const linhas = [...document.querySelectorAll('tr, .row')];
      const dados = {};
      for (const row of linhas) {
        const cells = [...row.querySelectorAll('td, th, div')];
        if (cells.length >= 2) {
          const label = cells[0].textContent.trim().toLowerCase();
          const value = cells[1].textContent.trim();
          if (label && value) dados[label] = value;
        }
      }

      // Pega valor patrimonial por cota, P/VP, vacância, etc. dos dados brutos
      const vpCota = brnum(dados['valor patrimonial por cota'] || dados['vp/cota'] || dados['vpa']);
      const pvp = brnum(dados['p/vp'] || dados['p/vpa']);
      const vacancia = brpct(dados['vacância'] || dados['vacancia']);
      const numImoveis = parseInt(dados['quantidade de imóveis'] || dados['número de imóveis'] || dados['qtd imóveis']);
      const dy12m = brpct(dados['dividend yield 12m'] || dados['dy 12m'] || dados['dy últ. 12 meses']);
      const dy24m = brpct(dados['dividend yield 24m'] || dados['dy 24m'] || dados['dy últ. 24 meses']);
      const taxaAdm = brpct(dados['taxa de administração'] || dados['taxa adm']);
      const gestor = dados['gestor'] || dados['gestão'] || null;
      const segmento = dados['segmento'] || dados['tipo de fundo'] || null;

      // Último dividendo: procura por "Último Rendimento" ou "Último Dividendo"
      let ultimoDividendo = null, ultimoPagto = null;
      const divLabels = [...document.querySelectorAll('*')].filter(el => {
        const t = el.textContent.toLowerCase();
        return el.children.length === 0 && (t.includes('último rendimento') || t.includes('último dividendo'));
      });
      if (divLabels.length) {
        const parent = divLabels[0].closest('div, td, tr');
        if (parent) {
          const text = parent.textContent;
          const m = text.match(/R\\$\\s*([\\d,]+)/);
          if (m) ultimoDividendo = brnum(m[1]);
          const d = text.match(/(\\d{2}\\/\\d{2}\\/\\d{4})/);
          if (d) {
            const [dd, mm, yyyy] = d[1].split('/');
            ultimoPagto = yyyy + '-' + mm + '-' + dd;
          }
        }
      }

      return {
        ticker: '${ticker.toUpperCase()}',
        gestor, segmento,
        vp_cota: vpCota, p_vp: pvp,
        vacancia, num_imoveis: numImoveis,
        dy_12m: dy12m, dy_24m: dy24m,
        taxa_adm: taxaAdm,
        ultimo_dividendo: ultimoDividendo,
        ultimo_pagto: ultimoPagto
      };
    })()
  `);
  return dados;
}

// Itera sobre todos os FIIs da carteira, visita cada um e extrai detalhes
async function extractAllFIIDetalhes(db) {
  const fiiList = db.prepare("SELECT id, ticker FROM ativos WHERE tipo='FII' AND ativo=1").all();
  const resultados = [];
  for (const fii of fiiList) {
    try {
      const dados = await extractFIIDetalhes(fii.ticker);
      // Atualiza DB
      db.prepare(`UPDATE ativos SET
        gestor = COALESCE(?, gestor),
        segmento = COALESCE(?, segmento),
        vp_cota = COALESCE(?, vp_cota),
        p_vp = COALESCE(?, p_vp),
        vacancia = COALESCE(?, vacancia),
        num_imoveis = COALESCE(?, num_imoveis),
        dy_12m = COALESCE(?, dy_12m),
        dy_24m = COALESCE(?, dy_24m),
        taxa_adm = COALESCE(?, taxa_adm),
        ultimo_dividendo = COALESCE(?, ultimo_dividendo),
        ultimo_pagto = COALESCE(?, ultimo_pagto),
        updated_at = datetime('now')
        WHERE id = ?`).run(
        dados.gestor, dados.segmento, dados.vp_cota, dados.p_vp,
        dados.vacancia, dados.num_imoveis, dados.dy_12m, dados.dy_24m,
        dados.taxa_adm, dados.ultimo_dividendo, dados.ultimo_pagto,
        fii.id
      );
      resultados.push({ ticker: fii.ticker, ok: true, dados });
    } catch (e) {
      resultados.push({ ticker: fii.ticker, ok: false, erro: e.message });
    }
  }
  return { total: fiiList.length, sucessos: resultados.filter(r => r.ok).length, resultados };
}

// Lê a agenda de dividendos do I10 e retorna lista de dividendos futuros
async function extractAgendaDividendos() {
  if (!scraperWindow || scraperWindow.isDestroyed()) {
    throw new Error('Janela do scraper não está aberta');
  }
  await scraperWindow.loadURL('https://investidor10.com.br/fiis/dividendos/');
  await scraperWindow.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const tem = [...document.querySelectorAll('a, td')].some(e => /[A-Z]{4}11/.test(e.textContent));
        if (tem) return resolve(true);
        if (Date.now() - t0 > 15000) return reject(new Error('timeout'));
        setTimeout(tick, 200);
      };
      tick();
    });
  `);

  const dividendos = await scraperWindow.webContents.executeJavaScript(`
    (() => {
      const brnum = (s) => {
        if (!s) return null;
        const t = String(s).replace(/[^\\d,\\-.]/g, '');
        return Number(t.replace(/\\./g, '').replace(',', '.')) || null;
      };
      const brdate = (s) => {
        if (!s) return null;
        const m = String(s).match(/(\\d{2})\\/(\\d{2})\\/(\\d{4})/);
        if (m) return m[3] + '-' + m[2] + '-' + m[1];
        return null;
      };
      const out = [];
      // Procura linhas com padrão: ticker + data-com + data-pagto + valor
      const linhas = [...document.querySelectorAll('tr, .row, .linha')];
      for (const row of linhas) {
        const text = row.textContent;
        const tickerMatch = text.match(/\\b([A-Z]{4}11)\\b/);
        if (!tickerMatch) continue;
        const valorMatch = text.match(/R\\$\\s*([\\d,]+)/);
        if (!valorMatch) continue;
        // Pega todas as datas
        const datas = [...text.matchAll(/(\\d{2}\\/\\d{2}\\/\\d{4})/g)].map(m => brdate(m[1]));
        out.push({
          ticker: tickerMatch[1],
          valor_por_cota: brnum(valorMatch[1]),
          data_com: datas[0] || null,
          data_pagto: datas[1] || datas[0] || null
        });
      }
      return out;
    })()
  `);

  // Persiste no DB (apenas para ativos existentes, não duplica)
  if (getDb && dividendos.length) {
    const findAtivo = getDb().prepare('SELECT id FROM ativos WHERE ticker = ?');
    const findProv = getDb().prepare('SELECT id FROM proventos WHERE ativo_id=? AND data_pagto=?');
    const ins = getDb().prepare('INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo) VALUES (?,?,?,?,?)');
    let inseridos = 0, ignorados = 0;
    const trx = getDb().transaction(() => {
      for (const d of dividendos) {
        const a = findAtivo.get(d.ticker);
        if (!a || !d.data_pagto || !d.valor_por_cota) { ignorados++; continue; }
        const dup = findProv.get(a.id, d.data_pagto);
        if (dup) { ignorados++; continue; }
        ins.run(a.id, d.data_com, d.data_pagto, d.valor_por_cota, 'DIVIDENDO');
        inseridos++;
      }
    });
    trx();
    return { total: dividendos.length, inseridos, ignorados, dividendos };
  }
  return { total: dividendos.length, inseridos: 0, ignorados: dividendos.length, dividendos };
}

module.exports = { openScraper, checkReady, extractInvestidor10, extractAndImport, closeScraper, setDbGetter, extractFIIDetalhes, extractAllFIIDetalhes, extractAgendaDividendos };
