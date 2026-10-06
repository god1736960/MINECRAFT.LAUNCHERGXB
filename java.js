// ===================================================================
//  OptiCraft - Motor Java Edition
//  Lista versiones, descarga cliente/librerías/assets, soporta
//  cargadores (Vanilla/Fabric/Quilt/Forge/OptiFine) y lanza el juego.
//  Las instalaciones PERSISTEN en el store.
// ===================================================================
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getJson, download, downloadAll } = require('./net');
const store = require('./store');
const loaders = require('./loaders');
const skinserver = require('./skinserver');

function tryRequireAdmZip() { try { return require('adm-zip'); } catch (_) { return null; } }
const AdmZip = tryRequireAdmZip();

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES = 'https://resources.download.minecraft.net';

let manifestCache = null;

// --------------------------- Versiones ---------------------------
async function listVersions(filters) {
  filters = filters || { release: true, snapshot: false };
  if (!manifestCache) manifestCache = await getJson(MANIFEST);
  return manifestCache.versions
    .filter(v => {
      if (v.type === 'release' && filters.release) return true;
      if (v.type === 'snapshot' && filters.snapshot) return true;
      if ((v.type === 'old_beta' || v.type === 'old_alpha') && filters.old) return true;
      return false;
    })
    .map(v => ({ id: v.id, type: v.type, url: v.url, releaseTime: v.releaseTime }));
}

async function vanillaJson(versionId) {
  if (!manifestCache) manifestCache = await getJson(MANIFEST);
  const entry = manifestCache.versions.find(v => v.id === versionId);
  if (!entry) throw new Error('Versión no encontrada: ' + versionId);
  return getJson(entry.url);
}

// Resuelve el JSON de una versión (de disco si existe, p.ej. cargadores)
// y fusiona con su versión padre si usa inheritsFrom.
async function resolveVersion(versionId) {
  const diskJson = path.join(store.gameDir(), 'versions', versionId, versionId + '.json');
  let vj;
  if (fs.existsSync(diskJson)) {
    vj = JSON.parse(fs.readFileSync(diskJson, 'utf8'));
  } else {
    vj = await vanillaJson(versionId);
  }
  if (vj.inheritsFrom) {
    const parent = await resolveVersion(vj.inheritsFrom);
    vj = mergeVersions(parent, vj);
  }
  return vj;
}

function mergeVersions(parent, child) {
  const merged = Object.assign({}, parent, child);
  merged.libraries = (child.libraries || []).concat(parent.libraries || []);
  merged.mainClass = child.mainClass || parent.mainClass;
  merged.assetIndex = parent.assetIndex || child.assetIndex;
  merged.assets = parent.assets || child.assets;
  merged.downloads = parent.downloads || child.downloads;
  // Argumentos (nuevos y antiguos)
  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [].concat((parent.arguments && parent.arguments.game) || [], (child.arguments && child.arguments.game) || []),
      jvm: [].concat((parent.arguments && parent.arguments.jvm) || [], (child.arguments && child.arguments.jvm) || [])
    };
  }
  if (child.minecraftArguments || parent.minecraftArguments) {
    // OptiFine legacy añade solo "--tweakClass ...": hay que CONCATENARlo a los
    // argumentos completos del padre, no reemplazarlos (si no, el juego no
    // recibe el nombre de usuario/versión y no arranca).
    if (child.minecraftArguments && parent.minecraftArguments &&
        /--tweakClass/.test(child.minecraftArguments) &&
        !/\$\{auth_player_name\}/.test(child.minecraftArguments)) {
      merged.minecraftArguments = parent.minecraftArguments + ' ' + child.minecraftArguments;
    } else {
      merged.minecraftArguments = child.minecraftArguments || parent.minecraftArguments;
    }
  }
  delete merged.inheritsFrom;
  return merged;
}

// Versiones VANILLA ya descargadas (existe el .jar del cliente)
function installedVersions() {
  const dir = path.join(store.gameDir(), 'versions');
  const result = [];
  try {
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const jar = path.join(dir, name, name + '.jar');
        if (fs.existsSync(jar)) result.push(name);
      }
    }
  } catch (_) {}
  return result;
}

// ----------------------- Instalaciones ---------------------------
function saveInstallation(inst) {
  const list = store.get('installations') || [];
  if (!inst.id) inst.id = 'inst_' + Date.now();
  if (!inst.created) inst.created = Date.now();
  if (!inst.loader) inst.loader = 'vanilla';
  // Aislamiento por versión por defecto: cada instalación tiene su propia
  // carpeta de mods/saves/config y nunca se mezcla con otras versiones.
  if (inst.isolated === undefined) inst.isolated = true;
  inst.lastPlayed = inst.lastPlayed || 0;
  const idx = list.findIndex(i => i.id === inst.id);
  if (idx >= 0) list[idx] = Object.assign({}, list[idx], inst);
  else list.push(inst);
  store.set('installations', list);
  return list;
}

function removeInstallation(id) {
  let list = store.get('installations') || [];
  list = list.filter(i => i.id !== id);
  store.set('installations', list);
  return list;
}

// --------------------------- Utilidades --------------------------
function rulesAllow(rules) {
  if (!rules) return true;
  let allow = false;
  for (const r of rules) {
    let match = true;
    if (r.os && r.os.name) {
      const map = { windows: 'win32', osx: 'darwin', linux: 'linux' };
      if (map[r.os.name] !== process.platform) match = false;
    }
    if (match) allow = (r.action === 'allow');
  }
  return allow;
}

function nativeKey() {
  if (process.platform === 'win32') return 'natives-windows';
  if (process.platform === 'darwin') return 'natives-macos';
  return 'natives-linux';
}

// group:artifact:version[:classifier] -> ruta maven
function mavenToPath(name) {
  const parts = name.split(':');
  const group = parts[0].replace(/\./g, '/');
  const artifact = parts[1];
  const version = parts[2];
  const classifier = parts[3];
  const file = artifact + '-' + version + (classifier ? '-' + classifier : '') + '.jar';
  return group + '/' + artifact + '/' + version + '/' + file;
}

function findJava() {
  if (process.env.JAVA_HOME) {
    const j = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javaw.exe' : 'java');
    if (fs.existsSync(j)) return j;
  }
  return process.platform === 'win32' ? 'javaw' : 'java';
}

// Busca un Java 8 instalado (necesario para versiones antiguas 1.7/1.8/1.12…
// que NO arrancan con Java 17+). Devuelve la ruta o null.
function findWindowsJava8() {
  if (process.platform !== 'win32') return null;
  const roots = [
    'C:\\Program Files\\Java',
    'C:\\Program Files (x86)\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Zulu',
    process.env.APPDATA ? path.join(process.env.APPDATA, '.minecraft', 'runtime') : null
  ].filter(Boolean);
  const hit = (dir) => {
    try {
      for (const name of fs.readdirSync(dir)) {
        const low = name.toLowerCase();
        if (low.includes('1.8') || low.includes('jre8') || low.includes('jdk8') ||
            low.includes('-8') || low.includes('8u') || low.includes('java-8') || low.includes('jre-1.8')) {
          const jw = path.join(dir, name, 'bin', 'javaw.exe');
          if (fs.existsSync(jw)) return jw;
          // runtime de Mojang: <name>/<os>/<name>/bin
          try {
            for (const sub of fs.readdirSync(path.join(dir, name))) {
              const jw2 = path.join(dir, name, sub, name, 'bin', 'javaw.exe');
              if (fs.existsSync(jw2)) return jw2;
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
    return null;
  };
  for (const r of roots) { const f = hit(r); if (f) return f; }
  return null;
}

function legacyMajorGuess(versionId) {
  const m = /^1\.(\d+)/.exec(versionId || '');
  if (!m) return 8;
  const minor = parseInt(m[1], 10);
  if (minor <= 16) return 8;   // 1.16 y anteriores -> Java 8
  if (minor === 17) return 16; // 1.17 -> Java 16
  return 17;                   // 1.18+ -> Java 17
}

// Elige el Java adecuado según la versión (ruta personalizada > Java 8 para
// versiones antiguas > Java del sistema).
function findJavaForVersion(inst, vj, baseVersionId, onProgress) {
  if (inst && inst.javaPath && fs.existsSync(inst.javaPath)) return inst.javaPath;
  const major = (vj && vj.javaVersion && vj.javaVersion.majorVersion) || legacyMajorGuess(baseVersionId);
  if (major <= 8) {
    const j8 = findWindowsJava8();
    if (j8) return j8;
    if (process.platform === 'win32') {
      onProgress && onProgress({ phase: 'warn', msg: 'Aviso: esta versión necesita Java 8. Si no arranca, instala Java 8 (jre1.8).', percent: 6 });
    }
  }
  return findJava();
}

// Carpeta de juego AISLADA por versión (estilo HMCL): mods/saves/config
// separados por instalación para que nunca se mezclen entre versiones.
function gameFolderFor(inst) {
  if (inst.gameDir && inst.gameDir !== '<default>') return inst.gameDir;
  if (inst.isolated !== false) {
    const d = path.join(store.gameDir(), 'instances', inst.id);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }
  return store.gameDir();
}

function modsDir(inst) {
  const d = path.join(gameFolderFor(inst), 'mods');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function getActiveSkin() {
  const skins = store.get('skins') || [];
  const id = store.get('activeSkin');
  return skins.find(s => s.id === id) || skins[0] || null;
}

// Descarga authlib-injector (una vez) para el servidor local de skins / Ely.by
async function ensureAuthlib(onProgress) {
  const dest = path.join(store.gameDir(), 'authlib-injector.jar');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest;
  onProgress && onProgress({ phase: 'skins', msg: 'Preparando servidor de skins…', percent: 4 });
  const meta = await getJson('https://authlib-injector.yushi.moe/artifact/latest.json');
  await download(meta.download_url, dest, { zip: true });
  return dest;
}

// --------------------------- Lanzar ------------------------------
async function launch(instId, opts) {
  const { account, onProgress, onClose } = opts;
  const list = store.get('installations') || [];
  const inst = list.find(i => i.id === instId);
  if (!inst) throw new Error('Instalación no encontrada');

  // --- Preparar cargador si aplica ---
  let launchVersionId = inst.version;
  if (inst.loader && inst.loader !== 'vanilla') {
    onProgress && onProgress({ phase: 'loader', msg: 'Preparando ' + inst.loader + '…', percent: 2 });
    launchVersionId = await loaders.prepare(inst.loader, inst.version, store.gameDir(), {
      getJson, download, findJava, mavenToPath, onProgress, modsDir: modsDir(inst),
      loaderVersion: inst.loaderVersion || null
    });
  }

  const root = gameFolderFor(inst);
  const libDir = path.join(store.gameDir(), 'libraries');
  const assetsDir = path.join(store.gameDir(), 'assets');
  const verDir = path.join(store.gameDir(), 'versions', launchVersionId);
  const nativesDir = path.join(verDir, 'natives');
  fs.mkdirSync(verDir, { recursive: true });
  fs.mkdirSync(nativesDir, { recursive: true });

  onProgress && onProgress({ phase: 'meta', msg: 'Obteniendo metadatos…', percent: 5 });
  const vj = await resolveVersion(launchVersionId);

  // --- Cliente (jar vanilla base) ---
  const baseJarId = inst.version; // el jar del cliente siempre es el vanilla
  const clientJar = path.join(store.gameDir(), 'versions', baseJarId, baseJarId + '.jar');
  if (!fs.existsSync(clientJar)) {
    onProgress && onProgress({ phase: 'client', msg: 'Descargando cliente…', percent: 8 });
    const base = await resolveVersion(baseJarId);
    await download(base.downloads.client.url, clientJar);
  }

  // --- Librerías + nativas (descarga en PARALELO para que sea rápido) ---
  let classpath = [clientJar];
  const seen = new Set();
  const libs = vj.libraries || [];
  const dlTasks = [];
  const nativeJobs = [];
  for (const lib of libs) {
    if (!rulesAllow(lib.rules)) continue;
    const dl = lib.downloads || {};
    if (dl.artifact && dl.artifact.path) {
      const p = path.join(libDir, dl.artifact.path);
      if (!fs.existsSync(p)) dlTasks.push({ url: dl.artifact.url, dest: p });
      if (!seen.has(p)) { classpath.push(p); seen.add(p); }
    } else if (lib.name && (lib.url || lib.downloads === undefined)) {
      // Librería estilo maven (Fabric/Quilt/Forge/OptiFine)
      const rel = mavenToPath(lib.name);
      const p = path.join(libDir, rel);
      const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
      if (!fs.existsSync(p)) dlTasks.push({ url: base + rel, dest: p, opts: { retries: 1 } });
      if (!seen.has(p)) { classpath.push(p); seen.add(p); }
    }
    // Nativas
    const natArt = (dl.classifiers || {})[nativeKey()];
    if (natArt && natArt.url) {
      const np = path.join(libDir, natArt.path);
      if (!fs.existsSync(np)) dlTasks.push({ url: natArt.url, dest: np });
      nativeJobs.push(np);
    }
  }
  if (dlTasks.length) {
    await downloadAll(dlTasks, {
      concurrency: 16, ignoreErrors: true,
      onEach: (d, t) => { if (d % 4 === 0 || d === t) onProgress && onProgress({ phase: 'libs', msg: 'Librerías ' + d + '/' + t, percent: 10 + Math.floor((d / t) * 46) }); }
    });
  }
  // Dejar en el classpath solo lo que realmente existe (una maven suelta pudo fallar)
  classpath = classpath.filter(p => fs.existsSync(p));
  // Extraer librerías nativas
  for (const np of nativeJobs) {
    if (AdmZip && fs.existsSync(np)) { try { new AdmZip(np).extractAllTo(nativesDir, true); } catch (_) {} }
  }

  // --- Asset index + assets (descarga en PARALELO) ---
  onProgress && onProgress({ phase: 'assets', msg: 'Descargando recursos…', percent: 58 });
  const ai = vj.assetIndex;
  const idxPath = path.join(assetsDir, 'indexes', ai.id + '.json');
  if (!fs.existsSync(idxPath)) await download(ai.url, idxPath);
  const assetIndex = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  const objects = assetIndex.objects || {};
  const keys = Object.keys(objects);
  const assetTasks = [];
  for (const k of keys) {
    const hash = objects[k].hash;
    const sub = hash.substring(0, 2);
    const dest = path.join(assetsDir, 'objects', sub, hash);
    if (!fs.existsSync(dest)) assetTasks.push({ url: `${RESOURCES}/${sub}/${hash}`, dest });
  }
  if (assetTasks.length) {
    await downloadAll(assetTasks, {
      concurrency: 24, ignoreErrors: true,
      onEach: (d, t) => { if (d % 20 === 0 || d === t) onProgress && onProgress({ phase: 'assets', msg: 'Recursos ' + d + '/' + t, percent: 58 + Math.floor((d / t) * 30) }); }
    });
  }

  // --- Assets "legacy"/"virtual" para versiones antiguas (1.7/1.8/pre-1.6) ---
  // Estas versiones leen los recursos desde una carpeta con nombres lógicos,
  // no desde objects/<hash>. Si no se copian, el juego crashea al arrancar.
  let assetsRootForGame = assetsDir;
  let gameAssetsDir = null;
  const isVirtual = !!assetIndex.virtual;
  const mapToResources = !!assetIndex.map_to_resources;
  if (isVirtual || mapToResources) {
    const targetDir = mapToResources ? path.join(root, 'resources')
                                     : path.join(assetsDir, 'virtual', ai.id);
    for (const k of keys) {
      const hash = objects[k].hash;
      const sub = hash.substring(0, 2);
      const src = path.join(assetsDir, 'objects', sub, hash);
      const dst = path.join(targetDir, k);
      if (!fs.existsSync(dst)) {
        try { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); } catch (_) {}
      }
    }
    if (isVirtual) assetsRootForGame = targetDir;
    if (mapToResources) gameAssetsDir = targetDir;
  }

  // --- Datos de la cuenta (se usan también para el servidor de skins) ---
  const uuid = (account && account.uuid) || '00000000-0000-0000-0000-000000000000';
  const uname = (account && account.name) || 'Player';

  // --- Skins: servidor local (Offline) o Ely.by vía authlib-injector ---
  let agentArg = null;
  if (account && (account.type === 'offline' || account.type === 'elyby')) {
    try {
      const agentJar = await ensureAuthlib(onProgress);
      if (account.type === 'elyby') {
        agentArg = '-javaagent:' + agentJar + '=ely.by';
      } else {
        const skin = getActiveSkin();
        const srv = await skinserver.start({
          skinFile: skin && skin.file, model: skin && skin.model,
          name: uname, uuid: uuid
        });
        if (srv && srv.baseUrl) agentArg = '-javaagent:' + agentJar + '=' + srv.baseUrl;
      }
    } catch (e) {
      onProgress && onProgress({ phase: 'warn', msg: 'No se pudo preparar el servidor de skins (se jugará sin skin personalizada).', percent: 94 });
    }
  }

  // --- Argumentos ---
  onProgress && onProgress({ phase: 'launch', msg: 'Iniciando el juego…', percent: 95 });
  const sep = process.platform === 'win32' ? ';' : ':';
  const maxRam = store.get('maxRam') || 2048;
  const token = (account && account.accessToken) || '0';
  const userType = (account && account.type === 'microsoft') ? 'msa' : 'legacy';

  const placeholders = {
    '${auth_player_name}': uname,
    '${version_name}': launchVersionId,
    '${game_directory}': root,
    '${assets_root}': assetsRootForGame,
    '${game_assets}': gameAssetsDir || assetsRootForGame,
    '${assets_index_name}': ai.id,
    '${auth_uuid}': uuid,
    '${auth_access_token}': token,
    '${auth_session}': 'token:' + token + ':' + uuid,
    '${user_properties}': '{}',
    '${clientid}': 'opticraft',
    '${auth_xuid}': '0',
    '${user_type}': userType,
    '${version_type}': vj.type || 'release',
    '${natives_directory}': nativesDir,
    '${launcher_name}': 'OptiCraft',
    '${launcher_version}': '1.0',
    '${classpath}': classpath.join(sep),
    '${library_directory}': libDir,
    '${classpath_separator}': sep
  };
  const subst = (s) => { for (const k in placeholders) s = s.split(k).join(placeholders[k]); return s; };

  const jvmArgs = ['-Xmx' + maxRam + 'M', '-Djava.library.path=' + nativesDir];
  // --- Modo Turbo: flags de optimización (estilo Aikar) para FPS estables
  //     y sin tirones. Mejora el recolector de basura (G1GC) y la memoria.
  const turbo = store.get('turboMode');
  if (turbo !== false) {
    const xms = Math.max(512, Math.floor(maxRam / 2));
    jvmArgs.push('-Xms' + xms + 'M');
    jvmArgs.push(
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:+AlwaysPreTouch',
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32',
      '-XX:+PerfDisableSharedMem',
      '-XX:MaxTenuringThreshold=1',
      '-Dsun.rmi.dgc.server.gcInterval=2147483646',
      '-Dfml.ignoreInvalidMinecraftCertificates=true',
      '-Dfml.ignorePatchDiscrepancies=true'
    );
  }
  if (agentArg) jvmArgs.push(agentArg);
  jvmArgs.push('-cp', classpath.join(sep));
  if (vj.arguments && vj.arguments.jvm) {
    for (const a of vj.arguments.jvm) {
      if (typeof a === 'string' && !a.includes('${classpath}') && a !== '-cp') jvmArgs.push(subst(a));
    }
  }
  const mainClass = vj.mainClass;
  let gameArgs = [];
  if (vj.arguments && vj.arguments.game) {
    for (const a of vj.arguments.game) if (typeof a === 'string') gameArgs.push(subst(a));
  } else if (vj.minecraftArguments) {
    gameArgs = vj.minecraftArguments.split(' ').map(subst);
  }

  const javaBin = findJavaForVersion(inst, vj, baseJarId, onProgress);
  const finalArgs = [...jvmArgs, mainClass, ...gameArgs];
  const child = spawn(javaBin, finalArgs, { cwd: root, detached: false });
  child.on('error', (err) => onProgress && onProgress({ phase: 'error', msg: 'No se pudo iniciar Java: ' + err.message, percent: 100, error: true }));
  child.stderr && child.stderr.on('data', () => {});
  child.on('close', () => { onClose && onClose(); });

  inst.lastPlayed = Date.now();
  saveInstallation(inst);
  onProgress && onProgress({ phase: 'done', msg: '¡Jugando!', percent: 100 });
  return { ok: true };
}

module.exports = { listVersions, installedVersions, saveInstallation, removeInstallation, launch, modsDir, gameFolderFor };
