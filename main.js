// ===================================================================
//  OptiCraft - Proceso principal de Electron
//  Launcher de Minecraft Java & Bedrock
// ===================================================================
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./store');
const java = require('./java');
const bedrock = require('./bedrock');
const accounts = require('./accounts');
const mods = require('./mods');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    frame: true,
    backgroundColor: '#1d1d1d',
    title: 'OptiCraft',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Enlaces externos se abren en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  store.init();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Reenvía eventos de progreso al renderer
function sendProgress(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ===================== IPC: Ajustes / Store =====================
ipcMain.handle('store:get', (e, key) => store.get(key));
ipcMain.handle('store:set', (e, key, val) => { store.set(key, val); return true; });
ipcMain.handle('store:all', () => store.all());

// ===================== IPC: Cuentas =====================
ipcMain.handle('accounts:list', () => accounts.list());
ipcMain.handle('accounts:addOffline', (e, name) => accounts.addOffline(name));
ipcMain.handle('accounts:addElyby', (e, cred) => accounts.addElyby(cred));
ipcMain.handle('accounts:startMicrosoft', () => accounts.startMicrosoft(d => sendProgress('ms:code', d)));
ipcMain.handle('accounts:remove', (e, id) => accounts.remove(id));
ipcMain.handle('accounts:select', (e, id) => accounts.select(id));
ipcMain.handle('accounts:active', () => accounts.active());

// ===================== IPC: Skins =====================
ipcMain.handle('skins:list', () => accounts.listSkins());
ipcMain.handle('skins:import', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar skin',
    properties: ['openFile'],
    filters: [{ name: 'Skins PNG', extensions: ['png'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  return accounts.importSkin(r.filePaths[0]);
});
ipcMain.handle('skins:apply', (e, id) => accounts.applySkin(id));
ipcMain.handle('skins:remove', (e, id) => accounts.removeSkin(id));
ipcMain.handle('skins:current', () => accounts.currentSkin());

// ===================== IPC: Java =====================
ipcMain.handle('java:versions', (e, filters) => java.listVersions(filters));
ipcMain.handle('java:installedVersions', () => java.installedVersions());
ipcMain.handle('java:installations', () => store.get('installations') || []);
ipcMain.handle('java:saveInstallation', (e, inst) => java.saveInstallation(inst));
ipcMain.handle('java:removeInstallation', (e, id) => java.removeInstallation(id));
ipcMain.handle('java:launch', (e, instId) =>
  java.launch(instId, {
    account: accounts.active(),
    onProgress: d => sendProgress('java:progress', d),
    onClose: () => sendProgress('game:closed', { edition: 'java' })
  }));
ipcMain.handle('java:pickDir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
});

// ===================== IPC: Bedrock =====================
ipcMain.handle('bedrock:detect', () => bedrock.detect());
ipcMain.handle('bedrock:launch', () =>
  bedrock.launch({ onClose: () => sendProgress('game:closed', { edition: 'bedrock' }) }));

// ===================== IPC: Mods (Modrinth) =====================
ipcMain.handle('mods:search', (e, opts) => mods.search(opts || {}));
ipcMain.handle('mods:download', (e, opts) => mods.downloadMod(opts || {}));
ipcMain.handle('mods:installModpack', (e, opts) =>
  mods.installModpack(Object.assign({}, opts, {
    onProgress: d => sendProgress('mods:progress', d)
  })));

// ===================== IPC: Ventana / Motor de arranque =====================
ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:hide', () => { if (mainWindow) mainWindow.hide(); });
ipcMain.handle('window:show', () => { if (mainWindow) mainWindow.show(); });
ipcMain.handle('app:freeMemory', () => {
  // Libera memoria del lanzador mientras se juega
  try { if (global.gc) global.gc(); } catch (_) {}
  mainWindow && mainWindow.webContents.send('app:memoryFreed', true);
  return true;
});
