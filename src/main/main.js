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

// IPC: app info
ipcMain.handle('app:get-port', () => getServerPort());
ipcMain.handle('app:get-version', () => app.getVersion());
