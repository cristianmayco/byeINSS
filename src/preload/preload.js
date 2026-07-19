const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPort: () => ipcRenderer.invoke('app:get-port'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  // Scraper
  scraperOpen: (url) => ipcRenderer.invoke('scraper:open', url),
  scraperCheck: () => ipcRenderer.invoke('scraper:check'),
  scraperExtract: () => ipcRenderer.invoke('scraper:extract'),
  scraperExtractAndImport: () => ipcRenderer.invoke('scraper:extract-and-import'),
  scraperClose: () => ipcRenderer.invoke('scraper:close'),
  scraperEnriquecerFII: (ticker) => ipcRenderer.invoke('scraper:enriquecer-fii', ticker),
  scraperEnriquecerTodos: () => ipcRenderer.invoke('scraper:enriquecer-todos'),
  scraperAgendaDividendos: () => ipcRenderer.invoke('scraper:agenda-dividendos')
});
