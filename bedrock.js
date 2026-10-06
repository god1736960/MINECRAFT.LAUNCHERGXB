// ===================================================================
//  OptiCraft - Motor Bedrock Edition (independiente)
//  Detecta la versión REAL instalada (no hardcodeada) y la lanza.
//  Bedrock es DRM/UWP: no admite multi-versión ni authlib.
// ===================================================================
const { exec, spawn } = require('child_process');

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      resolve(err ? '' : (stdout || ''));
    });
  });
}

// Detecta la versión instalada mediante Get-AppxPackage.
// Obtiene también el PackageFamilyName REAL (no hardcodeado) para
// poder lanzar la app directamente con shell:AppsFolder.
async function detectPkg(id) {
  const ps = `powershell -NoProfile -Command "$p = Get-AppxPackage ${id} | Select-Object -First 1; if ($p) { Write-Output ($p.Version + '|' + $p.PackageFamilyName) }"`;
  const out = (await run(ps)).trim();
  if (!out) return null;
  const line = out.split(/\r?\n/)[0].trim();
  const [version, pfn] = line.split('|');
  return { version: (version || '').trim(), pfn: (pfn || '').trim() };
}

async function detect() {
  if (process.platform !== 'win32') {
    return { installed: false, reason: 'Bedrock solo está disponible en Windows.' };
  }
  const stable = await detectPkg('Microsoft.MinecraftUWP');
  const prev = await detectPkg('Microsoft.MinecraftWindowsBeta');
  const previewVersion = (prev && prev.version) ? prev.version : null;
  if (stable && stable.version) {
    return { installed: true, version: stable.version, pfn: stable.pfn,
             edition: 'Minecraft for Windows (Bedrock)', previewVersion };
  }
  if (previewVersion) {
    return { installed: true, version: prev.version, pfn: prev.pfn,
             edition: 'Minecraft Preview (Bedrock)', previewVersion: null };
  }
  return { installed: false, reason: 'No se encontró Minecraft Bedrock instalado en este equipo.' };
}

// Lanza Bedrock con su propio motor (UWP) directamente por su
// PackageFamilyName real. Esto evita que Windows abra OneDrive u
// otra app asociada al protocolo minecraft://.
async function launch(opts) {
  if (process.platform !== 'win32') throw new Error('Bedrock solo se puede lanzar en Windows.');
  const info = await detect();
  if (!info.installed) throw new Error(info.reason);
  const pfn = info.pfn || 'Microsoft.MinecraftUWP_8wekyb3d8bbwe';
  // Lanzamiento directo de la app UWP (método fiable).
  const cmd = `explorer.exe shell:AppsFolder\\${pfn}!App`;
  const child = spawn('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true, detached: true });
  child.on('close', () => opts && opts.onClose && opts.onClose());
  // Fallback vía protocolo si lo anterior no abriera el juego.
  setTimeout(() => { run('cmd /c start "" minecraft://'); }, 2500);
  return { ok: true, version: info.version };
}

module.exports = { detect, launch };
