// ===================================================================
//  OptiCraft - Proceso INDEPENDIENTE del servidor local de skins.
//  Se lanza con Electron en modo Node (ELECTRON_RUN_AS_NODE=1) y en
//  modo \"detached\" para que SOBREVIVA aunque el launcher se cierre al
//  pulsar Jugar (closeOnPlay). Así la skin Offline sigue sirviéndose
//  mientras el juego está abierto.
//  Lee la configuración de la variable de entorno SKINSERVER_CONFIG
//  (JSON) e imprime \"PORT:<n>\" en stdout cuando está escuchando.
// ===================================================================
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

let cfg = {};
try { cfg = JSON.parse(process.env.SKINSERVER_CONFIG || '{}'); } catch (_) { cfg = {}; }

const current = {
  skinFile: cfg.skinFile || null,
  model: cfg.model || 'classic',
  name: cfg.name || 'Player',
  uuid: cfg.uuid || '00000000000000000000000000000000'
};
const pidFile = cfg.pidFile || null;

const keyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

function noDashes(uuid) { return String(uuid || '').replace(/-/g, ''); }

function skinBytes() {
  try { if (current.skinFile && fs.existsSync(current.skinFile)) return fs.readFileSync(current.skinFile); }
  catch (_) {}
  return null;
}

function texturesValue(host) {
  const bytes = skinBytes();
  const payload = {
    timestamp: Date.now(),
    profileId: noDashes(current.uuid),
    profileName: current.name,
    textures: {}
  };
  if (bytes) {
    const tex = { url: `http://${host}/textures/skin` };
    if (current.model === 'slim') tex.metadata = { model: 'slim' };
    payload.textures.SKIN = tex;
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function signValue(value) {
  const s = crypto.createSign('RSA-SHA1');
  s.update(value); s.end();
  return s.sign(keyPair.privateKey, 'base64');
}

function profileResponse(host) {
  const value = texturesValue(host);
  return {
    id: noDashes(current.uuid),
    name: current.name,
    properties: [{ name: 'textures', value, signature: signValue(value) }]
  };
}

const server = http.createServer((req, res) => {
  const host = req.headers.host || '127.0.0.1';
  const url = (req.url || '').split('?')[0];
  res.setHeader('Content-Type', 'application/json');

  if (url === '/' || url === '') {
    return res.end(JSON.stringify({
      meta: {
        serverName: 'OptiCraft',
        implementationName: 'opticraft-skins',
        implementationVersion: '1.0',
        'feature.non_email_login': true
      },
      skinDomains: ['127.0.0.1', 'localhost'],
      signaturePublickey: keyPair.publicKey
    }));
  }
  if (url === '/textures/skin') {
    const bytes = skinBytes();
    if (!bytes) { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('Content-Type', 'image/png');
    return res.end(bytes);
  }
  if (url.startsWith('/sessionserver/session/minecraft/profile/')) {
    return res.end(JSON.stringify(profileResponse(host)));
  }
  if (url === '/sessionserver/session/minecraft/hasJoined') {
    return res.end(JSON.stringify(profileResponse(host)));
  }
  if (url === '/sessionserver/session/minecraft/join') {
    res.statusCode = 204; return res.end();
  }
  if (url === '/api/profiles/minecraft') {
    return res.end(JSON.stringify([{ id: noDashes(current.uuid), name: current.name }]));
  }
  if (url === '/authserver/authenticate') {
    return res.end(JSON.stringify({
      accessToken: 'opticraft',
      clientToken: 'opticraft',
      selectedProfile: { id: noDashes(current.uuid), name: current.name },
      availableProfiles: [{ id: noDashes(current.uuid), name: current.name }]
    }));
  }
  if (url === '/authserver/refresh') {
    return res.end(JSON.stringify({ accessToken: 'opticraft', clientToken: 'opticraft',
      selectedProfile: { id: noDashes(current.uuid), name: current.name } }));
  }
  if (url === '/authserver/validate' || url === '/authserver/signout' || url === '/authserver/invalidate') {
    res.statusCode = 204; return res.end();
  }
  res.statusCode = 404;
  res.end('{}');
});

server.on('error', (e) => {
  try { process.stdout.write('ERROR:' + (e && e.message) + '\n'); } catch (_) {}
  process.exit(1);
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  if (pidFile) { try { fs.writeFileSync(pidFile, String(process.pid) + ':' + port); } catch (_) {} }
  try { process.stdout.write('PORT:' + port + '\n'); } catch (_) {}
});

// Mantener vivo el proceso aunque el padre muera.
process.on('SIGHUP', () => {});
