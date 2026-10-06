// ===================================================================
//  OptiCraft - Almacenamiento persistente (JSON en userData)
//  Guarda ajustes, instalaciones, cuentas y skins. NUNCA borra datos
//  salvo petición explícita del usuario.
// ===================================================================
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let dataDir = null;
let filePath = null;
let cache = {};

const DEFAULTS = {
  closeOnPlay: false,     // Motor de arranque: minimiza al jugar por defecto
  minimizeOnPlay: true,
  freeMemoryOnPlay: true,
  maxRam: 2048,           // MB para Java
  installations: [],      // instalaciones Java (persisten)
  accounts: [],           // cuentas (persisten)
  activeAccount: null,
  skins: [],              // biblioteca de skins (persiste)
  activeSkin: null
};

function init() {
  dataDir = path.join(app.getPath('userData'), 'opticraft');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  filePath = path.join(dataDir, 'config.json');
  if (fs.existsSync(filePath)) {
    try { cache = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch (_) { cache = {}; }
  }
  // Rellena solo las claves que falten (no sobrescribe lo existente)
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in cache)) cache[k] = DEFAULTS[k];
  }
  persist();
}

function persist() {
  try { fs.writeFileSync(filePath, JSON.stringify(cache, null, 2)); }
  catch (e) { console.error('No se pudo guardar config:', e); }
}

function get(key) { return cache[key]; }
function set(key, val) { cache[key] = val; persist(); }
function all() { return cache; }

function gameDir() {
  const d = path.join(dataDir, 'minecraft');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}
function skinsDir() {
  const d = path.join(dataDir, 'skins');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = { init, get, set, all, gameDir, skinsDir, dataPath: () => dataDir };
