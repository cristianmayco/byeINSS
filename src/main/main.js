const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { startServer, getServerPort } = require('../server/index.js');
const { getDb } = require('../server/db.js');
const scraper = require('./scraper.js');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'byeINSS — Controle de FIIs',
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Links externos abrem no browser do sistema, não no app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await startServer();
  scraper.setDbGetter(getDb);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: scraper
ipcMain.handle('scraper:open', async (_e, url) => scraper.openScraper(url));
ipcMain.handle('scraper:check', async () => scraper.checkReady());
ipcMain.handle('scraper:extract', async () => scraper.extractInvestidor10());
ipcMain.handle('scraper:extract-and-import', async () => scraper.extractAndImport());
ipcMain.handle('scraper:close', async () => { scraper.closeScraper(); return true; });
ipcMain.handle('scraper:enriquecer-fii', async (_e, ticker) => scraper.extractFIIDetalhes(ticker));
ipcMain.handle('scraper:enriquecer-todos', async () => scraper.extractAllFIIDetalhes(getDb()));
ipcMain.handle('scraper:agenda-dividendos', async () => scraper.extractAgendaDividendos());

const http = require('http');

// PRD 01: histórico de dividendos por FII. Scraping do histórico completo
// + persistência via /api/fii-historico/:ticker/importar.
async function scrapeAndImportHistorico(ticker) {
  const url = `https://investidor10.com.br/fiis/${String(ticker || '').toLowerCase()}/`;
  await scraper.openScraper(url);
  const rows = await scraper.extractHistoricoDividendos(ticker);
  if (!rows || !rows.length) {
    return { ticker, extraido: 0, persistido: { inseridos: 0, duplicados: 0, ignorados: 0 } };
  }
  const port = getServerPort();
  const payload = JSON.stringify({ rows });
  const result = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST',
      path: `/api/fii-historico/${encodeURIComponent(ticker)}/importar`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let body = ''; res.on('data', c => body += c); res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve({}); }
      });
    });
    req.on('error', reject); req.write(payload); req.end();
  });
  return { ticker, extraido: rows.length, persistido: result };
}

ipcMain.handle('scraper:dividendos-historico', async (_e, ticker) => scrapeAndImportHistorico(ticker));

ipcMain.handle('scraper:dividendos-historico-todos', async () => {
  // Sequencial por ticker — PRD 01 RF-002 (cancelável). Retorna resumo.
  const fiiList = getDb().prepare("SELECT id, ticker FROM ativos WHERE tipo='FII' AND ativo=1").all();
  const results = [];
  for (const fii of fiiList) {
    try {
      const r = await scrapeAndImportHistorico(fii.ticker);
      results.push({ ticker: fii.ticker, ok: true, ...r });
    } catch (e) {
      results.push({ ticker: fii.ticker, ok: false, erro: e.message });
    }
  }
  return {
    total: fiiList.length,
    sucessos: results.filter(r => r.ok).length,
    resultados: results
  };
});

// IPC: app info
ipcMain.handle('app:get-port', () => getServerPort());
ipcMain.handle('app:get-version', () => app.getVersion());
