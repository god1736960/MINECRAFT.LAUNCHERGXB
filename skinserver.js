// ===================================================================
//  OptiCraft - Lanzador del servidor local de skins.
//  IMPORTANTE: el servidor NO corre dentro del launcher. Se lanza como
//  un proceso INDEPENDIENTE (detached) con Electron en modo Node, para
//  que siga vivo aunque el launcher se cierre al pulsar Jugar
//  (closeOnPlay). Antes, al cerrarse el launcher se mataba el servidor
//  y la skin Offline nunca cargaba.
// ===================================================================
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let child = null;
let pidFilePath = null;

function gameDirSafe() {
  try { return require('./store').gameDir(); } catch (_) { return os.tmpdir(); }
}

function start(opts) {
  return new Promise((resolve) => {
    // Cerrar cualquier instancia previa.
    stop();

    const gameDir = gameDirSafe();
    try { fs.mkdirSync(gameDir, { recursive: true }); } catch (_) {}
    pidFilePath = path.join(gameDir, 'skinserver.pid');

    const config = {
      skinFile: opts.skinFile || null,
      model: opts.model || 'classic',
      name: opts.name || 'Player',
      uuid: opts.uuid || '00000000000000000000000000000000',
      pidFile: pidFilePath
    };

    const procScript = path.join(__dirname, 'skinserver-proc.js');
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    try {
      child = spawn(process.execPath, [procScript], {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: Object.assign({}, process.env, {
          ELECTRON_RUN_AS_NODE: '1',
          SKINSERVER_CONFIG: JSON.stringify(config)
        })
      });
    } catch (e) {
      return done(null);
    }

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/PORT:(\d+)/);
      if (m) {
        const port = parseInt(m[1], 10);
        // Desvincular: el servidor sobrevive al cierre del launcher.
        try { child.unref(); } catch (_) {}
        done({ port, baseUrl: `http://127.0.0.1:${port}` });
      } else if (/ERROR:/.test(buf)) {
        done(null);
      }
    });
    child.on('error', () => done(null));
    child.on('exit', () => done(null));

    // Tope de seguridad: no bloquear el lanzamiento del juego.
    setTimeout(() => done(null), 8000);
  });
}

function stop() {
  // Matar la instancia lanzada en esta sesión.
  if (child && child.pid) {
    try { process.kill(child.pid); } catch (_) {}
    child = null;
  }
  // Matar una instancia previa registrada en el pid file.
  try {
    const gameDir = gameDirSafe();
    const pf = path.join(gameDir, 'skinserver.pid');
    if (fs.existsSync(pf)) {
      const raw = fs.readFileSync(pf, 'utf8').trim();
      const pid = parseInt(raw.split(':')[0], 10);
      if (pid) { try { process.kill(pid); } catch (_) {} }
      try { fs.unlinkSync(pf); } catch (_) {}
    }
  } catch (_) {}
}

module.exports = { start, stop };
