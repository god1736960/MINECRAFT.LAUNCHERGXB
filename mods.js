// ===================================================================
//  OptiCraft - Gestor de mods (Modrinth): mods sueltos y modpacks.
//  Separación ESTRICTA por versión: cada instalación tiene su propia
//  carpeta de mods; lo que se descarga para una versión NUNCA se mezcla
//  con otra. Los modpacks crean su instalación y aparecen en el selector.
// ===================================================================
const path = require('path');
const fs = require('fs');
const { getJson, download, downloadAll } = require('./net');
const store = require('./store');
const java = require('./java');

const API = 'https://api.modrinth.com/v2';

function q(params) {
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => k + '=' + encodeURIComponent(params[k]))
    .join('&');
}

// --------------------------- Búsqueda ---------------------------
// type: 'mod' | 'modpack' | 'shader' | 'resourcepack'
async function search({ query, loader, gameVersion, type, limit }) {
  const facets = [];
  facets.push([`project_type:${type || 'mod'}`]);
  if (loader && type !== 'resourcepack' && type !== 'shader') facets.push([`categories:${loader}`]);
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  const url = `${API}/search?` + q({
    query: query || '',
    limit: limit || 30,
    index: 'relevance',
    facets: JSON.stringify(facets)
  });
  const r = await getJson(url);
  return (r.hits || []).map(h => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    icon: h.icon_url,
    downloads: h.downloads,
    author: h.author,
    type: h.project_type
  }));
}

// Lista los archivos (versiones) de un proyecto compatibles
async function projectVersions({ projectId, loader, gameVersion }) {
  const url = `${API}/project/${projectId}/version?` + q({
    loaders: loader ? JSON.stringify([loader]) : undefined,
    game_versions: gameVersion ? JSON.stringify([gameVersion]) : undefined
  });
  return getJson(url);
}

function pickFile(ver) {
  if (!ver || !ver.files || !ver.files.length) return null;
  return ver.files.find(f => f.primary) || ver.files[0];
}

// --------------------------- Mods sueltos ---------------------------
// Descarga el mod a la carpeta de mods PROPIA de esa instalación/versión.
async function downloadMod({ projectId, instId, loader, gameVersion }) {
  const inst = (store.get('installations') || []).find(i => i.id === instId);
  if (!inst) throw new Error('Elige primero una instalación (versión) de destino.');
  const useLoader = loader || inst.loader || 'fabric';
  const versions = await projectVersions({ projectId, loader: useLoader, gameVersion: inst.version });
  const ver = versions && versions[0];
  const file = pickFile(ver);
  if (!file) throw new Error('No hay una versión de ese mod compatible con ' + inst.version + ' (' + useLoader + ').');
  const modsDir = java.modsDir(inst);
  fs.mkdirSync(modsDir, { recursive: true });
  await download(file.url, path.join(modsDir, file.filename), { zip: true });
  return { ok: true, filename: file.filename, dir: modsDir, version: inst.version };
}

// --------------------------- Modpacks (.mrpack) ---------------------------
function tryRequireAdmZip() { try { return require('adm-zip'); } catch (_) { return null; } }

async function installModpack({ projectId, onProgress }) {
  const AdmZip = tryRequireAdmZip();
  if (!AdmZip) throw new Error('Falta la librería adm-zip para instalar modpacks.');
  onProgress && onProgress({ msg: 'Buscando el modpack…', percent: 5 });
  const versions = await projectVersions({ projectId });
  const ver = versions && versions[0];
  const file = pickFile(ver);
  if (!file) throw new Error('El modpack no tiene archivos descargables.');

  const tmpDir = path.join(store.gameDir(), 'modpack-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const packPath = path.join(tmpDir, 'pack.mrpack');
  onProgress && onProgress({ msg: 'Descargando modpack…', percent: 15 });
  await download(file.url, packPath, { zip: true });

  const zip = new AdmZip(packPath);
  const idxEntry = zip.getEntry('modrinth.index.json');
  if (!idxEntry) throw new Error('El modpack no tiene modrinth.index.json (formato no soportado).');
  const index = JSON.parse(zip.readAsText(idxEntry));

  // Determinar versión de Minecraft y cargador
  const deps = index.dependencies || {};
  const mc = deps.minecraft;
  let loader = 'fabric';
  let loaderVersion = null;
  if (deps['forge']) { loader = 'forge'; loaderVersion = deps['forge']; }
  else if (deps['neoforge']) { loader = 'neoforge'; loaderVersion = deps['neoforge']; }
  else if (deps['quilt-loader']) { loader = 'quilt'; loaderVersion = deps['quilt-loader']; }
  else if (deps['fabric-loader']) { loader = 'fabric'; loaderVersion = deps['fabric-loader']; }
  if (!mc) throw new Error('El modpack no especifica la versión de Minecraft.');

  // Crear instalación AISLADA para el modpack
  const inst = {
    id: 'inst_' + Date.now(),
    name: (index.name || 'Modpack') + ' ' + mc,
    version: mc,
    loader,
    loaderVersion,
    isolated: true,
    created: Date.now(),
    lastPlayed: 0
  };
  java.saveInstallation(inst);
  const gameFolder = java.gameFolderFor(inst);
  const modsDir = path.join(gameFolder, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  // Descargar los archivos listados en el índice (en PARALELO = mucho más rápido)
  const files = index.files || [];
  const tasks = [];
  for (const f of files) {
    const url = (f.downloads && f.downloads[0]) || null;
    if (!url) continue;
    // Saltar archivos marcados como no soportados en cliente
    if (f.env && f.env.client === 'unsupported') continue;
    tasks.push({ url, dest: path.join(gameFolder, f.path), opts: { minSize: 1 } });
  }
  if (tasks.length) {
    await downloadAll(tasks, {
      concurrency: 10, ignoreErrors: true,
      onEach: (d, t) => onProgress && onProgress({ msg: `Descargando mods del pack (${d}/${t})…`, percent: 20 + Math.floor((d / t) * 60) })
    });
  }

  // Aplicar overrides (configs, etc.)
  onProgress && onProgress({ msg: 'Aplicando configuración del pack…', percent: 85 });
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    if (name.startsWith('overrides/') && !entry.isDirectory) {
      const rel = name.substring('overrides/'.length);
      const dest = path.join(gameFolder, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try { fs.writeFileSync(dest, entry.getData()); } catch (_) {}
    }
  }

  try { fs.unlinkSync(packPath); } catch (_) {}
  onProgress && onProgress({ msg: '¡Modpack instalado!', percent: 100, done: true });
  return { ok: true, installation: inst };
}

module.exports = { search, projectVersions, downloadMod, installModpack };
