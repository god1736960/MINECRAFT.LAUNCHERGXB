// ===================================================================
//  OptiCraft - Gestión de cuentas y skins
//  Tipos: Offline, Ely.by y Microsoft (un perfil por tipo).
//  Las cuentas y skins PERSISTEN en el store.
// ===================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const store = require('./store');

// --- Device code flow de Microsoft (Azure app pública del launcher) ---
// Si tienes tu propio Client ID de Azure, ponlo aquí:
const MS_CLIENT_ID = process.env.OPTICRAFT_MS_CLIENT_ID || '00000000-0000-0000-0000-000000000000';

function offlineUUID(name) {
  // UUID offline determinista (estilo OfflinePlayer:)
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.toString('hex');
  return `${h.substr(0,8)}-${h.substr(8,4)}-${h.substr(12,4)}-${h.substr(16,4)}-${h.substr(20,12)}`;
}

function list() { return store.get('accounts') || []; }
function active() {
  const id = store.get('activeAccount');
  return list().find(a => a.id === id) || null;
}
function select(id) { store.set('activeAccount', id); return active(); }

function upsert(acc) {
  const accounts = list();
  // Un único perfil por tipo
  const idx = accounts.findIndex(a => a.type === acc.type);
  if (idx >= 0) accounts[idx] = { ...accounts[idx], ...acc };
  else accounts.push(acc);
  store.set('accounts', accounts);
  store.set('activeAccount', acc.id);
  return acc;
}

function remove(id) {
  let accounts = list().filter(a => a.id !== id);
  store.set('accounts', accounts);
  if (store.get('activeAccount') === id) {
    store.set('activeAccount', accounts.length ? accounts[0].id : null);
  }
  return accounts;
}

// ---------------------- Offline ----------------------
function addOffline(name) {
  name = (name || 'Player').trim().slice(0, 16) || 'Player';
  const acc = {
    id: 'offline', type: 'offline', name,
    uuid: offlineUUID(name), accessToken: '0'
  };
  return upsert(acc);
}

// ---------------------- Ely.by ----------------------
function postJson(host, pathName, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      host, path: pathName, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': 'OptiCraft/1.0' }
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function addElyby(cred) {
  // Autenticación contra authserver.ely.by (protocolo Yggdrasil)
  const r = await postJson('authserver.ely.by', '/auth/authenticate', {
    username: cred.username, password: cred.password,
    clientToken: crypto.randomUUID(), requestUser: true,
    agent: { name: 'Minecraft', version: 1 }
  });
  if (!r.accessToken) throw new Error(r.errorMessage || 'Credenciales de Ely.by incorrectas');
  const prof = r.selectedProfile || {};
  const acc = {
    id: 'elyby', type: 'elyby', name: prof.name || cred.username,
    uuid: prof.id || offlineUUID(prof.name || cred.username),
    accessToken: r.accessToken, skinServer: 'ely.by'
  };
  return upsert(acc);
}

// ---------------------- Microsoft (device code) ----------------------
function form(host, pathName, params) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(params).toString();
    const req = https.request({
      host, path: pathName, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} }); });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function startMicrosoft(onCode) {
  if (MS_CLIENT_ID === '00000000-0000-0000-0000-000000000000') {
    throw new Error('Para cuentas Microsoft, configura tu Client ID de Azure (variable OPTICRAFT_MS_CLIENT_ID). Mientras tanto, puedes usar una cuenta Offline o Ely.by.');
  }
  const dc = await form('login.microsoftonline.com', '/consumers/oauth2/v2.0/devicecode', {
    client_id: MS_CLIENT_ID, scope: 'XboxLive.signin offline_access'
  });
  onCode && onCode({ userCode: dc.user_code, url: dc.verification_uri, message: dc.message });
  // Polling
  const interval = (dc.interval || 5) * 1000;
  const deadline = Date.now() + (dc.expires_in || 900) * 1000;
  let tok = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    const t = await form('login.microsoftonline.com', '/consumers/oauth2/v2.0/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: MS_CLIENT_ID, device_code: dc.device_code
    });
    if (t.access_token) { tok = t; break; }
    if (t.error && t.error !== 'authorization_pending' && t.error !== 'slow_down') throw new Error(t.error_description || t.error);
  }
  if (!tok) throw new Error('Tiempo de espera agotado para la autenticación de Microsoft.');
  // Xbox Live -> XSTS -> Minecraft
  const xbl = await postJson('user.auth.xboxlive.com', '/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + tok.access_token },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
  });
  const xsts = await postJson('xsts.auth.xboxlive.com', '/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT'
  });
  const uhs = xsts.DisplayClaims.xui[0].uhs;
  const mc = await postJson('api.minecraftservices.com', '/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.Token}`
  });
  // Perfil
  const prof = await getJsonAuth('api.minecraftservices.com', '/minecraft/profile', mc.access_token);
  const acc = {
    id: 'microsoft', type: 'microsoft', name: prof.name,
    uuid: prof.id, accessToken: mc.access_token
  };
  return upsert(acc);
}

function getJsonAuth(host, pathName, token) {
  return new Promise((resolve, reject) => {
    https.get({ host, path: pathName, headers: { Authorization: 'Bearer ' + token } }, (res) => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} });
    }).on('error', reject);
  });
}

// ========================= Skins =========================
function listSkins() { return store.get('skins') || []; }
function currentSkin() {
  const id = store.get('activeSkin');
  return listSkins().find(s => s.id === id) || null;
}

function importSkin(srcPath) {
  const dir = store.skinsDir();
  const id = 'skin_' + Date.now();
  const dest = path.join(dir, id + '.png');
  fs.copyFileSync(srcPath, dest);
  const skins = listSkins();
  const entry = { id, name: path.basename(srcPath), file: dest, model: 'classic', added: Date.now() };
  skins.push(entry);
  store.set('skins', skins);
  return entry;
}

function applySkin(id) {
  store.set('activeSkin', id);
  return currentSkin();
}

function removeSkin(id) {
  let skins = listSkins();
  const s = skins.find(x => x.id === id);
  if (s && fs.existsSync(s.file)) { try { fs.unlinkSync(s.file); } catch (_) {} }
  skins = skins.filter(x => x.id !== id);
  store.set('skins', skins);
  if (store.get('activeSkin') === id) store.set('activeSkin', skins.length ? skins[0].id : null);
  return skins;
}

module.exports = {
  list, active, select, remove,
  addOffline, addElyby, startMicrosoft,
  listSkins, importSkin, applySkin, removeSkin, currentSkin
};
