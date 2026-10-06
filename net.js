// ===================================================================
//  OptiCraft - Utilidades de red (descargas con reintentos y validación)
// ===================================================================
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function getJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'OptiCraft/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return getJson(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' ' + url)); res.resume(); return; }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// Descarga a un archivo temporal, VALIDA el resultado y sólo entonces lo
// renombra al destino final. Así nunca queda un archivo a medias o vacío.
//   opts.minSize  -> tamaño mínimo esperado en bytes (por defecto 1)
//   opts.zip      -> si true, exige cabecera ZIP/JAR 'PK'
function download(url, dest, opts) {
  opts = opts || {};
  const retries = opts.retries == null ? 3 : opts.retries;
  const minSize = opts.minSize == null ? 1 : opts.minSize;
  const tmp = dest + '.part';

  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const lib = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(tmp);

    const fail = (err) => {
      try { file.close(); } catch (_) {}
      fs.unlink(tmp, () => {});
      if (retries > 0) {
        return setTimeout(() => download(url, dest, Object.assign({}, opts, { retries: retries - 1 })).then(resolve, reject), 900);
      }
      reject(err);
    };

    const req = lib.get(url, { headers: { 'User-Agent': 'OptiCraft/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try { file.close(); } catch (_) {}
        fs.unlink(tmp, () => {});
        return download(res.headers.location, dest, opts).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return fail(new Error('HTTP ' + res.statusCode + ' ' + url));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          // --- Validación del archivo descargado ---
          try {
            const st = fs.statSync(tmp);
            if (st.size < minSize) return fail(new Error('Descarga incompleta (0 bytes): ' + url));
            if (opts.zip) {
              const fd = fs.openSync(tmp, 'r');
              const buf = Buffer.alloc(2);
              fs.readSync(fd, buf, 0, 2, 0);
              fs.closeSync(fd);
              if (!(buf[0] === 0x50 && buf[1] === 0x4b)) { // 'PK'
                return fail(new Error('El archivo no es un ZIP/JAR válido: ' + url));
              }
            }
          } catch (e) { return fail(e); }
          try { fs.renameSync(tmp, dest); }
          catch (e) { try { fs.copyFileSync(tmp, dest); fs.unlinkSync(tmp); } catch (e2) { return fail(e2); } }
          resolve();
        });
      });
    });
    req.on('error', fail);
  });
}

module.exports = { getJson, download, downloadAll };

// Descarga MUCHOS archivos en paralelo (pool de conexiones) para acelerar.
//   tasks: [{ url, dest, opts }]
//   opts.concurrency -> nº de descargas simultáneas (por defecto 16)
//   opts.onEach(done,total) -> progreso REAL por archivo terminado
//   opts.ignoreErrors -> no abortar todo si una falla
function downloadAll(tasks, opts) {
  opts = opts || {};
  const concurrency = Math.max(1, opts.concurrency || 16);
  const total = tasks.length;
  let next = 0, done = 0;
  async function worker() {
    while (next < tasks.length) {
      const t = tasks[next++];
      try { await download(t.url, t.dest, t.opts || {}); }
      catch (e) { if (!opts.ignoreErrors) throw e; }
      done++;
      if (opts.onEach) opts.onEach(done, total);
    }
  }
  const n = Math.min(concurrency, tasks.length || 1);
  return Promise.all(Array.from({ length: n }, worker));
}
