// ===================================================================
//  OptiCraft - Cargadores (mod loaders)
//  Descarga e instala automáticamente desde sitios OFICIALES:
//    - Fabric  (meta.fabricmc.net)
//    - Quilt   (meta.quiltmc.org)
//    - Forge   (BMCLAPI, mirror oficial usado por launchers)
//    - OptiFine(sobre Fabric + OptiFabric de Modrinth)
//  Devuelve el ID de versión que debe lanzarse.
// ===================================================================
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const FABRIC = 'https://meta.fabricmc.net/v2';
const QUILT = 'https://meta.quiltmc.org/v3';
const BMCL = 'https://bmclapi2.bangbang93.com';
const NEOFORGE_META = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const MODRINTH = 'https://api.modrinth.com/v2';

function versionsDir(gameDir) { return path.join(gameDir, 'versions'); }

// Devuelve el «minor» de una versión 1.X(.Y). Ej: 1.8.9 -> 8, 1.16.5 -> 16.
function mcMinor(mc) {
  const m = /^1\.(\d+)/.exec(String(mc || ''));
  return m ? parseInt(m[1], 10) : 999;
}

function saveProfile(gameDir, profile) {
  const dir = path.join(versionsDir(gameDir), profile.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, profile.id + '.json'), JSON.stringify(profile, null, 2));
  return profile.id;
}

// --------------------------- Fabric ---------------------------
async function prepareFabric(mc, gameDir, h) {
  const list = await h.getJson(`${FABRIC}/versions/loader/${mc}`);
  if (!list.length) throw new Error('Fabric no soporta la versión ' + mc);
  // Si el modpack pide una versión concreta del loader, respetarla.
  let loaderVer = (h && h.loaderVersion) || null;
  if (!loaderVer || !list.find(x => x.loader && x.loader.version === loaderVer)) {
    const stable = list.find(x => x.loader && x.loader.stable) || list[0];
    loaderVer = stable.loader.version;
  }
  const profile = await h.getJson(`${FABRIC}/versions/loader/${mc}/${loaderVer}/profile/json`);
  return saveProfile(gameDir, profile);
}

// --------------------------- Quilt ---------------------------
async function prepareQuilt(mc, gameDir, h) {
  const list = await h.getJson(`${QUILT}/versions/loader/${mc}`);
  if (!list.length) throw new Error('Quilt no soporta la versión ' + mc);
  let loaderVer = (h && h.loaderVersion) || null;
  if (!loaderVer || !list.find(x => x.loader && x.loader.version === loaderVer)) {
    loaderVer = (list.find(x => x.loader) || list[0]).loader.version;
  }
  const profile = await h.getJson(`${QUILT}/versions/loader/${mc}/${loaderVer}/profile/json`);
  return saveProfile(gameDir, profile);
}

// --------------------------- Forge ---------------------------
async function prepareForge(mc, gameDir, h) {
  h.onProgress && h.onProgress({ phase: 'loader', msg: 'Buscando Forge para ' + mc + '…', percent: 3 });
  const builds = await h.getJson(`${BMCL}/forge/minecraft/${mc}`);
  if (!builds || !builds.length) throw new Error('No hay Forge disponible para ' + mc);
  // Elegir el build más reciente
  builds.sort((a, b) => (b.build || 0) - (a.build || 0));
  const forgeVer = builds[0].version;
  const expectedId = `${mc}-forge-${forgeVer}`;
  const already = path.join(versionsDir(gameDir), expectedId, expectedId + '.json');
  if (fs.existsSync(already)) return expectedId;

  // Descargar instalador oficial (mirror BMCLAPI)
  const installer = path.join(gameDir, 'forge-installer-' + forgeVer + '.jar');
  const url = `${BMCL}/forge/download?mcversion=${encodeURIComponent(mc)}&version=${encodeURIComponent(forgeVer)}&category=installer&format=jar`;
  h.onProgress && h.onProgress({ phase: 'loader', msg: 'Descargando instalador de Forge…', percent: 4 });
  await h.download(url, installer, { zip: true, minSize: 1024, retries: 4 });

  // launcher_profiles.json requerido por el instalador
  const lp = path.join(gameDir, 'launcher_profiles.json');
  if (!fs.existsSync(lp)) fs.writeFileSync(lp, JSON.stringify({ profiles: {}, selectedProfile: '', clientToken: 'opticraft' }));

  h.onProgress && h.onProgress({ phase: 'loader', msg: 'Instalando Forge (puede tardar)…', percent: 5 });
  await runJar(h.findJava(), ['-jar', installer, '--installClient', gameDir], gameDir);

  // Buscar la carpeta de versión generada
  const vd = versionsDir(gameDir);
  const match = fs.existsSync(vd) ? fs.readdirSync(vd).find(n => n.includes('forge') && n.includes(mc)) : null;
  if (!match) throw new Error('Forge se descargó pero no se pudo detectar la versión instalada.');
  return match;
}

// --------------------------- OptiFine (sobre Fabric) ---------------------------
async function prepareOptiFine(mc, gameDir, h) {
  // Fabric NO existe para versiones anteriores a 1.14 (por eso daba el error
  // HTTP 400 con 1.8). Para esas versiones antiguas usamos OptiFine en modo
  // «standalone» con launchwrapper, igual que hacen MultiMC/HMCL.
  if (mcMinor(mc) < 14) {
    return prepareOptiFineLegacy(mc, gameDir, h);
  }
  // 1) Fabric como base
  h.onProgress && h.onProgress({ phase: 'loader', msg: 'Preparando Fabric para OptiFine…', percent: 3 });
  const fabricId = await prepareFabric(mc, gameDir, h);
  const modsDir = h.modsDir || path.join(gameDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  // 2) OptiFabric (puente oficial, desde Modrinth)
  try {
    h.onProgress && h.onProgress({ phase: 'loader', msg: 'Descargando OptiFabric…', percent: 4 });
    const vers = await h.getJson(`${MODRINTH}/project/optifabric/version?loaders=["fabric"]&game_versions=["${mc}"]`);
    if (vers && vers.length && vers[0].files && vers[0].files.length) {
      const file = vers[0].files.find(f => f.primary) || vers[0].files[0];
      await h.download(file.url, path.join(modsDir, file.filename), { zip: true });
    }
  } catch (_) {}

  // 3) OptiFine (mirror BMCLAPI usado por launchers) con validación + reintento
  //    El fallo "Zip empty"/0 bytes venía de descargas corruptas del mirror:
  //    ahora validamos que sea un .jar/.zip real ('PK') y reintentamos.
  try {
    h.onProgress && h.onProgress({ phase: 'loader', msg: 'Descargando OptiFine…', percent: 5 });
    const ofs = await h.getJson(`${BMCL}/optifine/${mc}`);
    if (ofs && ofs.length) {
      const of = ofs[ofs.length - 1]; // última edición
      const dlUrl = `${BMCL}/optifine/${mc}/${of.type}/${of.patch}`;
      const fname = `OptiFine_${mc}_${of.type}_${of.patch}.jar`;
      await h.download(dlUrl, path.join(modsDir, fname), { zip: true, minSize: 1024, retries: 4 });
    }
  } catch (e) {
    h.onProgress && h.onProgress({ phase: 'warn', msg: 'No se pudo descargar OptiFine (seguirá con Fabric). ' + (e && e.message ? e.message : ''), percent: 6 });
  }

  return fabricId;
}

// --------------------------- OptiFine legacy (<1.14, standalone) ---------------------------
async function prepareOptiFineLegacy(mc, gameDir, h) {
  h.onProgress && h.onProgress({ phase: 'loader', msg: 'Preparando OptiFine para ' + mc + '…', percent: 3 });
  const ofs = await h.getJson(`${BMCL}/optifine/${mc}`);
  if (!ofs || !ofs.length) throw new Error('No hay OptiFine disponible para ' + mc);
  const of = ofs[ofs.length - 1]; // última edición
  const ofVer = `${mc}_${of.type}_${of.patch}`;
  const expectedId = mc + '-OptiFine_' + of.type + '_' + of.patch;
  const already = path.join(versionsDir(gameDir), expectedId, expectedId + '.json');

  // 1) Descargar el jar de OptiFine y colocarlo como librería (maven)
  const libRel = path.join('optifine', 'OptiFine', ofVer, 'OptiFine-' + ofVer + '.jar');
  const libPath = path.join(gameDir, 'libraries', libRel);
  if (!fs.existsSync(libPath) || fs.statSync(libPath).size < 1024) {
    h.onProgress && h.onProgress({ phase: 'loader', msg: 'Descargando OptiFine…', percent: 5 });
    const dlUrl = `${BMCL}/optifine/${mc}/${of.type}/${of.patch}`;
    await h.download(dlUrl, libPath, { zip: true, minSize: 1024, retries: 4 });
  }

  if (fs.existsSync(already)) return expectedId;

  // 2) Crear el perfil de versión con launchwrapper + el tweaker de OptiFine.
  //    minecraftArguments solo añade el --tweakClass: java.js lo CONCATENA a
  //    los argumentos completos de la versión base (no los reemplaza).
  const profile = {
    id: expectedId,
    inheritsFrom: mc,
    type: 'release',
    mainClass: 'net.minecraft.launchwrapper.Launch',
    minecraftArguments: '--tweakClass optifine.OptiFineTweaker',
    libraries: [
      { name: 'optifine:OptiFine:' + ofVer },
      { name: 'net.minecraft:launchwrapper:1.12' },
      { name: 'org.ow2.asm:asm-all:5.2', url: 'https://repo1.maven.org/maven2/' }
    ]
  };
  return saveProfile(gameDir, profile);
}

// --------------------------- NeoForge ---------------------------
async function prepareNeoForge(mc, gameDir, h) {
  h.onProgress && h.onProgress({ phase: 'loader', msg: 'Buscando NeoForge para ' + mc + '…', percent: 3 });
  // NeoForge versiona como <minor>.<patch>.x derivado de 1.MINOR.PATCH
  const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (!m) throw new Error('NeoForge solo soporta versiones 1.20.2+');
  const prefix = m[1] + '.' + (m[2] || '0') + '.';
  const meta = await h.getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
  const all = (meta && meta.versions) || [];
  const matches = all.filter(v => v.indexOf(prefix) === 0);
  if (!matches.length) throw new Error('No hay NeoForge disponible para ' + mc);
  const neoVer = matches[matches.length - 1];
  const expectedId = 'neoforge-' + neoVer;
  const already = path.join(versionsDir(gameDir), expectedId, expectedId + '.json');
  if (fs.existsSync(already)) return expectedId;

  const installer = path.join(gameDir, 'neoforge-installer-' + neoVer + '.jar');
  const url = `${NEOFORGE_META}/${neoVer}/neoforge-${neoVer}-installer.jar`;
  h.onProgress && h.onProgress({ phase: 'loader', msg: 'Descargando instalador de NeoForge…', percent: 4 });
  await h.download(url, installer, { zip: true, minSize: 1024, retries: 3 });

  const lp = path.join(gameDir, 'launcher_profiles.json');
  if (!fs.existsSync(lp)) fs.writeFileSync(lp, JSON.stringify({ profiles: {}, selectedProfile: '', clientToken: 'opticraft' }));

  h.onProgress && h.onProgress({ phase: 'loader', msg: 'Instalando NeoForge (puede tardar)…', percent: 5 });
  await runJar(h.findJava(), ['-jar', installer, '--installClient', gameDir], gameDir);

  const vd = versionsDir(gameDir);
  const match = fs.existsSync(vd) ? fs.readdirSync(vd).find(n => n.toLowerCase().includes('neoforge') && n.includes(neoVer)) : null;
  if (!match) throw new Error('NeoForge se descargó pero no se pudo detectar la versión instalada.');
  return match;
}

function runJar(javaBin, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(javaBin, args, { cwd });
    let err = '';
    p.stderr && p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error('El instalador terminó con código ' + code + '. ' + err.slice(0, 300))));
  });
}

async function prepare(loader, mc, gameDir, h) {
  switch (loader) {
    case 'fabric': return prepareFabric(mc, gameDir, h);
    case 'quilt': return prepareQuilt(mc, gameDir, h);
    case 'forge': return prepareForge(mc, gameDir, h);
    case 'neoforge': return prepareNeoForge(mc, gameDir, h);
    case 'optifine': return prepareOptiFine(mc, gameDir, h);
    default: return mc;
  }
}

module.exports = { prepare };
