// ===================================================================
//  OptiCraft - Puente seguro (contextBridge) entre main y renderer
// ===================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opti', {
  // ---- Ajustes ----
  store: {
    get: (k) => ipcRenderer.invoke('store:get', k),
    set: (k, v) => ipcRenderer.invoke('store:set', k, v),
    all: () => ipcRenderer.invoke('store:all')
  },
  // ---- Cuentas ----
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    addOffline: (name) => ipcRenderer.invoke('accounts:addOffline', name),
    addElyby: (cred) => ipcRenderer.invoke('accounts:addElyby', cred),
    startMicrosoft: () => ipcRenderer.invoke('accounts:startMicrosoft'),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    select: (id) => ipcRenderer.invoke('accounts:select', id),
    active: () => ipcRenderer.invoke('accounts:active')
  },
  // ---- Skins ----
  skins: {
    list: () => ipcRenderer.invoke('skins:list'),
    import: () => ipcRenderer.invoke('skins:import'),
    apply: (id) => ipcRenderer.invoke('skins:apply', id),
    remove: (id) => ipcRenderer.invoke('skins:remove', id),
    current: () => ipcRenderer.invoke('skins:current')
  },
  // ---- Java ----
  java: {
    versions: (f) => ipcRenderer.invoke('java:versions', f),
    installedVersions: () => ipcRenderer.invoke('java:installedVersions'),
    installations: () => ipcRenderer.invoke('java:installations'),
    saveInstallation: (i) => ipcRenderer.invoke('java:saveInstallation', i),
    removeInstallation: (id) => ipcRenderer.invoke('java:removeInstallation', id),
    launch: (id) => ipcRenderer.invoke('java:launch', id),
    pickDir: () => ipcRenderer.invoke('java:pickDir')
  },
  // ---- Bedrock ----
  bedrock: {
    detect: () => ipcRenderer.invoke('bedrock:detect'),
    launch: () => ipcRenderer.invoke('bedrock:launch')
  },
  // ---- Mods (Modrinth) ----
  mods: {
    search: (opts) => ipcRenderer.invoke('mods:search', opts),
    download: (opts) => ipcRenderer.invoke('mods:download', opts),
    installModpack: (opts) => ipcRenderer.invoke('mods:installModpack', opts)
  },
  // ---- Ventana / Motor de arranque ----
  win: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    hide: () => ipcRenderer.invoke('window:hide'),
    show: () => ipcRenderer.invoke('window:show'),
    freeMemory: () => ipcRenderer.invoke('app:freeMemory')
  },
  // ---- Eventos ----
  on: (channel, cb) => {
    const allowed = ['java:progress', 'ms:code', 'game:closed', 'app:memoryFreed', 'mods:progress'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (e, data) => cb(data));
    }
  }
});
