// ===================================================================
//  OptiCraft - Lógica del renderer
// ===================================================================
const api = window.opti;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
// Enlace SEGURO: si el elemento no existe, no revienta el resto del script
// (antes un $() nulo en nivel superior cortaba TODOS los addEventListener,
//  dejando las cuentas sin funcionar).
function bind(sel, ev, fn) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (el) el.addEventListener(ev, fn);
}

let activeAccount = null;
let currentSkinPath = null;
let currentModType = 'mod';

// --------------------- Navegación (sidebar) ---------------------
function showSection(sec) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === sec));
  $$('.view').forEach(v => v.hidden = (v.dataset.view !== sec));
  if (sec === 'bedrock') detectBedrock();
  if (sec === 'settings') renderAccounts();
  if (sec === 'news') renderNews();
}
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
});

// --------------------- Pestañas ---------------------
$$('.tabs').forEach(tabs => {
  const group = tabs.dataset.tabs;
  $$('.tab', tabs).forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab', tabs).forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      $$(`.view[data-view="${group}"] .panel`).forEach(p => {
        p.classList.toggle('active', p.dataset.panel === `${group}-${name}`);
      });
      if (group === 'java' && name === 'installations') renderInstallations();
      if (group === 'java' && name === 'mods') openModsPanel();
      if (group === 'java' && name === 'skins') openWardrobe();
      if (group === 'java' && name === 'patch') renderJavaPatch();
      if (group === 'mods') { currentModType = name; runModsSearch(); }
      if (group === 'bedrock' && name === 'marketplace') renderMarket();
      if (group === 'bedrock' && name === 'patch') renderBedrockPatch();
      if (group === 'bedrock' && name === 'installations') renderBedrockInstallations();
    });
  });
});

// ===================================================================
//  JAVA
// ===================================================================
// El selector de PLAY muestra SOLO las versiones ya instaladas (listas para
// jugar al instante) + la opción “Instalar otra…” que abre el modal.
async function loadJavaVersions() {
  const installs = await api.java.installations().catch(() => []);
  fillVersionSelect($('#java-version-select'), installs);
  fillVersionSelect($('#news-version-select'), installs);
  updateVersionHint();
}

// Rellena un <select> con SOLO las versiones ya instaladas + “Instalar otra…”
function fillVersionSelect(sel, installs) {
  if (!sel) return;
  sel.innerHTML = '';
  (installs || []).slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).forEach(i => {
    const o = document.createElement('option');
    o.value = i.id;              // en Play el value es el ID de instalación
    const nm = (i.name || i.version || '').trim();
    const vr = (i.version || '').trim();
    let label = nm;
    if (vr && nm.indexOf(vr) === -1) label = nm + ' (' + vr + ')';
    o.textContent = '✔ ' + label;
    o.title = label;
    o.className = 'ver-installed';
    o.dataset.installed = '1';
    sel.appendChild(o);
  });
  const extra = document.createElement('option');
  extra.value = '__new__';
  extra.textContent = '➕ Instalar otra versión…';
  extra.className = 'ver-download';
  sel.appendChild(extra);
  if (!(installs && installs.length)) sel.selectedIndex = 0;
}

// Muestra bajo el selector si la versión elegida ya está instalada o se descargará
function updateVersionHint() {
  const sel = $('#java-version-select');
  const hint = $('#java-version-hint');
  if (!sel || !hint) return;
  const opt = sel.options[sel.selectedIndex];
  if (!opt) { hint.textContent = ''; return; }
  if (opt.value === '__new__') {
    hint.textContent = '➕ Elige esta opción para añadir e instalar otra versión.';
    hint.className = 'version-hint download';
  } else {
    hint.textContent = '✔ Instalada — se iniciará al instante.';
    hint.className = 'version-hint installed';
  }
}
bind('#java-version-select', 'change', () => {
  const sel = $('#java-version-select');
  if (sel && sel.value === '__new__') { openNewInstallModal(); loadJavaVersions(); }
  updateVersionHint();
});

// --------------------- NEWS: bloque césped + barra de JUGAR ---------------------
bind('#news-to-java', 'click', () => showSection('java'));
bind('#news-version-select', 'change', () => {
  const sel = $('#news-version-select');
  if (sel && sel.value === '__new__') { showSection('java'); openNewInstallModal(); loadJavaVersions(); }
});
bind('#news-play-btn', 'click', () => {
  const sel = $('#news-version-select');
  const val = sel ? sel.value : '';
  if (!val || val === '__new__') { showSection('java'); openNewInstallModal(); return; }
  if (!activeAccount) { alert('Añade o selecciona una cuenta en Ajustes primero.'); return; }
  showSection('java');            // mostrar el progreso en la pantalla de Java
  startLaunch(val);
});
// Buscador del periódico: filtra las tarjetas de novedades por texto
bind('#news-search', 'input', () => {
  const sel = $('#news-search');
  const q = (sel ? sel.value : '').trim().toLowerCase();
  document.querySelectorAll('#news-mini .pm-card, #news-big .pb-card').forEach((card) => {
    const txt = card.textContent.toLowerCase();
    card.style.display = (!q || txt.includes(q)) ? '' : 'none';
  });
});
bind('#news-filters', 'click', () => {
  const sel = $('#news-search');
  if (sel) { sel.value = ''; sel.dispatchEvent(new Event('input')); sel.focus(); }
});

// Garantiza que exista una instalación para la versión elegida en Play
async function ensureInstallation(version) {
  const list = await api.java.installations();
  let inst = list.find(i => i.version === version && i.quick);
  if (!inst) {
    const saved = await api.java.saveInstallation({ name: 'Latest ' + version, version, quick: true, gameDir: '<default>' });
    inst = saved.find(i => i.version === version && i.quick);
  }
  return inst;
}

bind('#java-play-btn', 'click', async () => {
  const sel = $('#java-version-select');
  const val = sel ? sel.value : '';
  if (!val || val === '__new__') { openNewInstallModal(); return; }
  if (!activeAccount) { alert('Añade o selecciona una cuenta en Ajustes primero.'); return; }
  // En Play el value ES el ID de la instalación
  startLaunch(val);
});

async function startLaunch(instId) {
  const prog = $('#java-progress');
  const fill = $('.progress-fill', prog);
  const msg = $('.progress-msg', prog);
  prog.classList.remove('hidden');
  $('#java-play-btn').disabled = true;
  try {
    await api.java.launch(instId);
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
    fill.style.background = '#c0392b';
    $('#java-play-btn').disabled = false;
  }
}

api.on('java:progress', (d) => {
  const prog = $('#java-progress');
  const fill = $('.progress-fill', prog);
  const msg = $('.progress-msg', prog);
  msg.textContent = d.msg;
  fill.style.width = (d.percent || 0) + '%';
  if (d.error) { fill.style.background = '#c0392b'; $('#java-play-btn').disabled = false; }
  if (d.phase === 'done') {
    // Refresca marcas de "instalada" ya que esta versión acaba de descargarse
    loadJavaVersions();
    // Motor de arranque: minimizar/cerrar y liberar memoria
    applyLaunchEngine();
    setTimeout(() => { prog.classList.add('hidden'); fill.style.width = '0%'; $('#java-play-btn').disabled = false; }, 2500);
  }
});

async function applyLaunchEngine() {
  const s = await api.store.all();
  if (s.freeMemoryOnPlay) api.win.freeMemory();
  if (s.closeOnPlay) { setTimeout(() => window.close(), 800); }
  else if (s.minimizeOnPlay) { api.win.minimize(); }
}

api.on('game:closed', () => { api.win.show(); });

// --------------------- Installations ---------------------
async function renderInstallations() {
  const list = await api.java.installations();
  const q = ($('#inst-search').value || '').toLowerCase();
  const box = $('#inst-list');
  const filtered = list.filter(i => !q || (i.name || '').toLowerCase().includes(q));
  if (!filtered.length) { box.innerHTML = '<div class="empty">No hay instalaciones todavía. Crea una con “New installation”.</div>'; return; }
  box.innerHTML = '';
  filtered.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).forEach(i => {
    const row = document.createElement('div');
    row.className = 'inst-row';
    row.innerHTML = `
      <img src="../assets/icons/java.webp" alt="" />
      <div class="meta"><b>${esc(i.name || i.version)}</b><small>${esc(i.version)}</small></div>
      <button class="play-mini">Play</button>
      <button class="del">Eliminar</button>`;
    row.querySelector('.play-mini').addEventListener('click', () => {
      if (!activeAccount) { alert('Selecciona una cuenta en Ajustes.'); return; }
      // volver a la pestaña Play para ver el progreso
      $('.tab[data-tab="play"]').click();
      startLaunch(i.id);
    });
    row.querySelector('.del').addEventListener('click', async () => {
      if (confirm('¿Eliminar esta instalación? (no borra los archivos del juego)')) {
        await api.java.removeInstallation(i.id);
        renderInstallations();
      }
    });
    box.appendChild(row);
  });
}
bind('#inst-search', 'input', renderInstallations);

// --------------------- Modal nueva instalación ---------------------
async function openNewInstallModal() {
  const sel = $('#ni-version');
  if (!sel) return;
  sel.innerHTML = '<option>Cargando…</option>';
  const relEl = $('#f-release'), snapEl = $('#f-snapshot');
  const relOnly = relEl ? relEl.checked : true, snap = snapEl ? snapEl.checked : false;
  try {
    const [vers, installed] = await Promise.all([
      api.java.versions({ release: relOnly || !snap, snapshot: snap }),
      api.java.installedVersions()
    ]);
    const inst = new Set(installed);
    sel.innerHTML = '';
    vers.slice(0, 80).forEach(v => {
      const o = document.createElement('option');
      o.value = v.id;
      const isInst = inst.has(v.id);
      o.textContent = (isInst ? '✔ ' : '⬇ ') + v.id + ` (${v.type})` + (isInst ? ' — instalada' : ' — se descargará');
      o.className = isInst ? 'ver-installed' : 'ver-download';
      sel.appendChild(o);
    });
  } catch (e) {
    sel.innerHTML = '<option>Sin conexión: no se pudo cargar la lista</option>';
  }
  if ($('#ni-name')) $('#ni-name').value = '';
  if ($('#ni-dir')) $('#ni-dir').value = '';
  if ($('#ni-loader')) $('#ni-loader').value = 'vanilla';
  $('#modal-inst').classList.remove('hidden');
}
bind('#new-inst-btn', 'click', openNewInstallModal);
bind('#modal-close', 'click', () => $('#modal-inst').classList.add('hidden'));
bind('#ni-cancel', 'click', () => $('#modal-inst').classList.add('hidden'));
bind('#ni-browse', 'click', async () => {
  const dir = await api.java.pickDir();
  if (dir) $('#ni-dir').value = dir;
});
bind('#ni-create', 'click', async () => {
  const version = $('#ni-version').value;
  const name = $('#ni-name').value.trim() || ('Instalación ' + version);
  const gameDir = $('#ni-dir').value || '<default>';
  const loader = $('#ni-loader') ? $('#ni-loader').value : 'vanilla';
  await api.java.saveInstallation({ name, version, gameDir, loader });
  $('#modal-inst').classList.add('hidden');
  renderInstallations();
  loadJavaVersions();
});

// ===================================================================
//  SKINS (vestuario)
// ===================================================================
async function openWardrobe() {
  const canvas = $('#skin-canvas');
  const cur = await api.skins.current();
  currentSkinPath = cur ? cur.file : null;
  window.Skins3D.initViewer(canvas);
  window.Skins3D.loadSkin(canvas, currentSkinPath, $('#skin-slim').checked);
  renderSkinLibrary();
}

async function renderSkinLibrary() {
  const grid = $('#skin-library');
  const skins = await api.skins.list();
  const cur = await api.skins.current();
  grid.innerHTML = '';
  if (!skins.length) { grid.innerHTML = '<div class="empty">Sin skins. Importa una .png.</div>'; return; }
  skins.forEach(s => {
    const card = document.createElement('div');
    card.className = 'skin-card' + (cur && cur.id === s.id ? ' active' : '');
    card.innerHTML = `<canvas></canvas><small>${esc(s.name)}</small><button class="x">✕</button>`;
    const cv = card.querySelector('canvas');
    window.Skins3D.thumbnail(cv, s.file);
    card.addEventListener('click', async (e) => {
      if (e.target.classList.contains('x')) return;
      await api.skins.apply(s.id);
      currentSkinPath = s.file;
      window.Skins3D.loadSkin($('#skin-canvas'), s.file, $('#skin-slim').checked);
      renderSkinLibrary();
    });
    card.querySelector('.x').addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.skins.remove(s.id);
      renderSkinLibrary();
    });
    grid.appendChild(card);
  });
}

bind('#skin-import', 'click', async () => {
  const entry = await api.skins.import();
  if (entry) {
    await api.skins.apply(entry.id);
    currentSkinPath = entry.file;
    window.Skins3D.loadSkin($('#skin-canvas'), entry.file, $('#skin-slim').checked);
    renderSkinLibrary();
  }
});
bind('#skin-save', 'click', async () => {
  const cur = await api.skins.current();
  if (cur) alert('Skin aplicada: ' + cur.name);
  else alert('Importa y selecciona una skin primero.');
});
bind('#skin-rotate', 'click', function () {
  this.classList.toggle('on');
  window.Skins3D.setRotate(this.classList.contains('on'));
});
bind('#skin-walk', 'click', function () {
  this.classList.toggle('on');
  window.Skins3D.setWalk(this.classList.contains('on'));
});
bind('#skin-slim', 'change', function () {
  window.Skins3D.setSlim($('#skin-canvas'), currentSkinPath, this.checked);
});

// ===================================================================
//  BEDROCK
// ===================================================================
async function detectBedrock() {
  const el = $('#bedrock-version');
  const stat = $('#bedrock-inst-status');
  const prevRow = $('#bedrock-preview-row');
  const prevEl = $('#bedrock-preview');
  el.textContent = 'Detectando…';
  if (prevRow) prevRow.hidden = true;
  const info = await api.bedrock.detect();
  if (info.installed) {
    el.textContent = info.version;
    if (prevRow && prevEl && info.previewVersion) { prevEl.textContent = info.previewVersion; prevRow.hidden = false; }
    if (stat) stat.textContent = '✅ Instalado: ' + info.edition + ' v' + info.version;
    $('#bedrock-play-btn').disabled = false;
  } else {
    el.textContent = 'No instalado';
    if (stat) stat.textContent = '❌ ' + info.reason;
    $('#bedrock-play-btn').disabled = true;
  }
}
bind('#bedrock-play-btn', 'click', async () => {
  try {
    await api.bedrock.launch();
    applyLaunchEngine();
  } catch (e) { alert(e.message); }
});

// Instalaciones de Bedrock (misma presentación que Java: icono, versión y botones)
async function renderBedrockInstallations() {
  const box = $('#bedrock-inst-list');
  if (!box) return;
  box.innerHTML = '<div class="empty">Detectando…</div>';
  const info = await api.bedrock.detect();
  if (!info.installed) {
    box.innerHTML = `<div class="empty">❌ ${esc(info.reason)}</div>`;
    return;
  }
  box.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'inst-row';
  row.innerHTML = `
    <img src="../assets/icons/bedrock.webp" alt="" />
    <div class="meta"><b>${esc(info.edition)}</b><small>Versión ${esc(info.version)}</small></div>
    <button class="play-mini">Jugar</button>
    <button class="del">Eliminar</button>`;
  row.querySelector('.play-mini').addEventListener('click', async () => {
    const playTab = $('.tabs[data-tabs="bedrock"] .tab[data-tab="play"]');
    if (playTab) playTab.click();
    try { await api.bedrock.launch(); applyLaunchEngine(); } catch (e) { alert(e.message); }
  });
  row.querySelector('.del').addEventListener('click', () => {
    alert('Minecraft Bedrock es una app de Windows (UWP). Para desinstalarla usa Configuración de Windows → Aplicaciones. OptiCraft no borra la instalación del sistema.');
  });
  box.appendChild(row);
}

// ===================================================================
//  MODS (Modrinth)
// ===================================================================
// Llena el desplegable de instalación destino y hace una búsqueda inicial.
async function openModsPanel() {
  const sel = $('#mods-inst');
  if (!sel) return;
  const list = await api.java.installations();
  const prev = sel.value;
  sel.innerHTML = '';
  if (!list.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Crea primero una instalación (pestaña Installations)';
    sel.appendChild(o);
  } else {
    list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).forEach(i => {
      const o = document.createElement('option');
      o.value = i.id;
      o.textContent = (i.name || i.version) + ' (' + i.version + ')';
      o.dataset.loader = i.loader || 'fabric';
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
    syncModsLoader();
  }
  runModsSearch();
}

// Ajusta el cargador al de la instalación elegida (si no es vanilla).
function syncModsLoader() {
  const sel = $('#mods-inst');
  const loaderSel = $('#mods-loader');
  if (!sel || !loaderSel) return;
  const opt = sel.options[sel.selectedIndex];
  const l = opt && opt.dataset.loader;
  if (l && l !== 'vanilla' && l !== 'optifine') loaderSel.value = l;
}
bind('#mods-inst', 'change', syncModsLoader);

async function runModsSearch() {
  const box = $('#mods-results');
  if (!box) return;
  const query = ($('#mods-search') && $('#mods-search').value || '').trim();
  const loaderSel = $('#mods-loader');
  const instSel = $('#mods-inst');
  const loader = loaderSel ? loaderSel.value : 'fabric';
  const instOpt = instSel && instSel.options[instSel.selectedIndex];
  const gameVersion = instOpt && instOpt.textContent ? (instOpt.textContent.match(/\(([^)]+)\)/) || [])[1] : undefined;
  box.innerHTML = '<div class="empty">Buscando…</div>';
  try {
    const results = await api.mods.search({
      query, loader, gameVersion, type: currentModType, limit: 30
    });
    renderModResults(results);
  } catch (e) {
    box.innerHTML = '<div class="empty">No se pudo buscar: ' + esc(e.message) + '</div>';
  }
}
bind('#mods-search-btn', 'click', runModsSearch);
bind('#mods-search', 'keydown', (e) => { if (e.key === 'Enter') runModsSearch(); });

function renderModResults(results) {
  const box = $('#mods-results');
  box.innerHTML = '';
  if (!results || !results.length) { box.innerHTML = '<div class="empty">Sin resultados.</div>'; return; }
  const isPack = currentModType === 'modpack';
  results.forEach(r => {
    const card = document.createElement('div');
    card.className = 'mod-card';
    const icon = r.icon ? `<img src="${esc(r.icon)}" alt="" />` : '<div class="mod-noicon">⬛</div>';
    card.innerHTML = `
      ${icon}
      <div class="mod-info">
        <b>${esc(r.title)}</b>
        <p>${esc(r.description || '')}</p>
        <small>por ${esc(r.author || '?')} · ⬇ ${(r.downloads || 0).toLocaleString()}</small>
      </div>
      <button class="green-btn mod-get">${isPack ? 'Instalar' : 'Descargar'}</button>`;
    card.querySelector('.mod-get').addEventListener('click', (e) => {
      e.target.disabled = true;
      if (isPack) installModpack(r, e.target);
      else downloadMod(r, e.target);
    });
    box.appendChild(card);
  });
}

async function downloadMod(r, btn) {
  const instSel = $('#mods-inst');
  const instId = instSel ? instSel.value : '';
  const loader = $('#mods-loader') ? $('#mods-loader').value : 'fabric';
  if (!instId) { alert('Elige una instalación destino (o crea una).'); btn.disabled = false; return; }
  btn.textContent = 'Descargando…';
  try {
    const res = await api.mods.download({ projectId: r.projectId, instId, loader });
    btn.textContent = '✔ ' + (res.filename || 'Descargado');
  } catch (e) {
    btn.textContent = 'Reintentar';
    btn.disabled = false;
    alert('No se pudo descargar: ' + e.message);
  }
}

async function installModpack(r, btn) {
  const prog = $('#mods-progress');
  if (prog) prog.classList.remove('hidden');
  btn.textContent = 'Instalando…';
  try {
    const res = await api.mods.installModpack({ projectId: r.projectId });
    btn.textContent = '✔ Instalado';
    loadJavaVersions();
    if (res && res.installation) alert('Modpack instalado como: ' + res.installation.name);
  } catch (e) {
    btn.textContent = 'Reintentar';
    btn.disabled = false;
    alert('No se pudo instalar el modpack: ' + e.message);
  } finally {
    setTimeout(() => { if (prog) { prog.classList.add('hidden'); const f = $('.progress-fill', prog); if (f) f.style.width = '0%'; } }, 2000);
  }
}

api.on('mods:progress', (d) => {
  const prog = $('#mods-progress');
  if (!prog) return;
  prog.classList.remove('hidden');
  const fill = $('.progress-fill', prog);
  const msg = $('.progress-msg', prog);
  if (msg) msg.textContent = d.msg || '…';
  if (fill) fill.style.width = (d.percent || 0) + '%';
});

// ===================================================================
//  NEWS / PATCH / MARKETPLACE (imágenes del usuario)
// ===================================================================
const NEWS = [
  ['news_wild.webp', 'The Wild Update', 'Mangles, ranas y lo profundo oscuro.'],
  ['news_nether.jpg', 'Nether Update', 'Nuevos biomas y mobs del Nether.'],
  ['news_trails.jpg', 'Trails & Tales', 'Arqueología, camellos y más.'],
  ['news_trial.jpg', 'Trial Chambers', 'Nuevas mazmorras y retos.'],
  ['news_caves.avif', 'Caves & Cliffs', 'Cuevas más profundas y montañas altas.'],
  ['news_legends.jpg', 'Minecraft Legends', 'Estrategia en el universo de Minecraft.'],
  ['news_desert.jpg', 'Desert Update', 'Novedades del desierto.'],
  ['news_vibrant.jpg', 'Vibrant Visuals', 'Nuevos efectos visuales.']
];
const MARKET = [
  ['mk1.jpg', 'DLC Marketplace', 'Contenido destacado.'],
  ['mk2.jpg', 'DLC Marketplace', 'Nuevos packs.'],
  ['mk3.jpg', 'DLC Marketplace', 'Ofertas.'],
  ['mk4.jpg', 'Ether Dimension', 'Add-on de dimensión.'],
  ['mk5.jpg', 'Morph Pack', 'Transfórmate en mobs.'],
  ['mk6.jpg', 'Parkour', 'Mapas de parkour.'],
  ['mk7.jpg', 'Realistic Biomes', 'Biomas realistas.'],
  ['mk8.jpg', 'Survival Expansion', 'Expande tu supervivencia.']
];
function cardGrid(container, items) {
  const box = $(container);
  box.innerHTML = '';
  items.forEach(([img, title, desc]) => {
    const c = document.createElement('div');
    c.className = 'news-card';
    c.innerHTML = `<img src="../assets/news/${img}" alt="" /><div class="nc-body"><b>${esc(title)}</b><p>${esc(desc)}</p></div>`;
    box.appendChild(c);
  });
}
function renderNews() {
  // Fecha estilo periódico
  const pd = $('#paper-date');
  if (pd) {
    try {
      pd.textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
    } catch (_) { pd.textContent = ''; }
  }
  // Tarjeta principal grande (hero)
  const hero = $('#news-hero');
  if (hero) {
    const [img, title, desc] = NEWS[0];
    hero.style.backgroundImage = `url('../assets/news/${img}')`;
    hero.innerHTML = `<div class="ph-overlay"><span class="ph-tag">NOVEDAD</span><b>${esc(title)}</b><p>${esc(desc)}</p><span class="ph-more">Leer más →</span></div>`;
  }
  // 4 tarjetas pequeñas
  const mini = $('#news-mini');
  if (mini) {
    mini.innerHTML = '';
    NEWS.slice(1, 5).forEach(([img, title, desc]) => {
      const c = document.createElement('div');
      c.className = 'pm-card';
      c.innerHTML = `<img src="../assets/news/${img}" alt="" /><div class="pm-body"><b>${esc(title)}</b></div>`;
      mini.appendChild(c);
    });
  }
  // 3 tarjetas grandes adicionales
  const big = $('#news-big');
  if (big) {
    big.innerHTML = '';
    NEWS.slice(5, 8).forEach(([img, title, desc]) => {
      const c = document.createElement('div');
      c.className = 'pb-card';
      c.innerHTML = `<img src="../assets/news/${img}" alt="" /><div class="pb-body"><b>${esc(title)}</b><p>${esc(desc)}</p></div>`;
      big.appendChild(c);
    });
  }
  // Asegura que la barra de JUGAR tenga las versiones instaladas
  loadJavaVersions();
}
function renderJavaPatch() { cardGrid('#java-patch-grid', NEWS.slice(0, 6)); }
function renderBedrockPatch() { cardGrid('#bedrock-patch-grid', NEWS.slice(2)); }
function renderMarket() { cardGrid('#bedrock-market-grid', MARKET); }

// ===================================================================
//  SETTINGS + CUENTAS
// ===================================================================
async function loadSettings() {
  const s = await api.store.all();
  $('#s-minimize').checked = !!s.minimizeOnPlay;
  $('#s-close').checked = !!s.closeOnPlay;
  $('#s-free').checked = !!s.freeMemoryOnPlay;
  $('#s-ram').value = s.maxRam || 2048;
  $('#s-ram-val').textContent = s.maxRam || 2048;
  if ($('#s-turbo')) $('#s-turbo').checked = s.turboMode !== false;
}
bind('#s-minimize', 'change', e => api.store.set('minimizeOnPlay', e.target.checked));
bind('#s-close', 'change', e => api.store.set('closeOnPlay', e.target.checked));
bind('#s-free', 'change', e => api.store.set('freeMemoryOnPlay', e.target.checked));
bind('#s-ram', 'input', e => { $('#s-ram-val').textContent = e.target.value; api.store.set('maxRam', parseInt(e.target.value, 10)); });
bind('#s-turbo', 'change', e => api.store.set('turboMode', e.target.checked));

async function renderAccounts() {
  const list = await api.accounts.list();
  const act = await api.accounts.active();
  activeAccount = act;
  const box = $('#accounts-list');
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="empty">Sin cuentas. Añade una abajo.</div>'; }
  list.forEach(a => {
    const row = document.createElement('div');
    row.className = 'acc-row' + (act && act.id === a.id ? ' active' : '');
    row.innerHTML = `<b>${esc(a.name)}</b><span class="tag">${a.type}</span><div class="spacer"></div>
      <button class="ghost-btn use">Usar</button><button class="del ghost-btn">Quitar</button>`;
    row.querySelector('.use').addEventListener('click', async () => { await api.accounts.select(a.id); renderAccounts(); updateAccountChip(); });
    row.querySelector('.del').addEventListener('click', async () => { await api.accounts.remove(a.id); renderAccounts(); updateAccountChip(); });
    box.appendChild(row);
  });
  updateAccountChip();
}

bind('#off-add', 'click', async () => {
  const name = $('#off-name').value.trim();
  if (!name) { alert('Escribe un nombre.'); return; }
  await api.accounts.addOffline(name);
  $('#off-name').value = '';
  renderAccounts();
});
bind('#ely-add', 'click', async () => {
  const username = $('#ely-user').value.trim(), password = $('#ely-pass').value;
  if (!username || !password) { alert('Completa usuario y contraseña.'); return; }
  try { await api.accounts.addElyby({ username, password }); $('#ely-pass').value = ''; renderAccounts(); }
  catch (e) { alert('Ely.by: ' + e.message); }
});
bind('#ms-add', 'click', async () => {
  const codeBox = $('#ms-code');
  codeBox.classList.remove('hidden');
  codeBox.innerHTML = 'Solicitando código…';
  try { await api.accounts.startMicrosoft(); renderAccounts(); codeBox.innerHTML = '✅ Sesión iniciada.'; }
  catch (e) { codeBox.innerHTML = '⚠️ ' + esc(e.message); }
});
api.on('ms:code', (d) => {
  const codeBox = $('#ms-code');
  codeBox.classList.remove('hidden');
  codeBox.innerHTML = `Ve a <b>${esc(d.url)}</b> e introduce el código:<br><b>${esc(d.userCode)}</b>`;
});

// --------------------- Chip de cuenta en Play ---------------------
async function updateAccountChip() {
  const act = await api.accounts.active();
  activeAccount = act;
  const label = act ? `${act.name} ▾` : 'Sin cuenta ▾';
  const jb = $('#java-account-btn'); if (jb) jb.textContent = label;
  const bb = $('#bedrock-account-btn'); if (bb) bb.textContent = label;
}
async function openAccountPopover(e) {
  const list = await api.accounts.list();
  const pop = $('#acc-popover');
  if (!list.length) { alert('Añade una cuenta en Ajustes.'); return; }
  pop.innerHTML = '';
  const act = await api.accounts.active();
  list.forEach(a => {
    const it = document.createElement('div');
    it.className = 'pop-item' + (act && act.id === a.id ? ' active' : '');
    it.textContent = `${a.name} (${a.type})`;
    it.addEventListener('click', async () => { await api.accounts.select(a.id); updateAccountChip(); pop.classList.add('hidden'); });
    pop.appendChild(it);
  });
  const r = e.currentTarget.getBoundingClientRect();
  pop.classList.remove('hidden');
  pop.style.left = (r.left) + 'px';
  pop.style.top = (r.top - pop.offsetHeight - 8) + 'px';
}
bind('#java-account-btn', 'click', openAccountPopover);
bind('#bedrock-account-btn', 'click', openAccountPopover);
document.addEventListener('click', (e) => {
  if (!e.target.closest('#acc-popover') && !e.target.closest('.account-chip')) $('#acc-popover').classList.add('hidden');
});

// --------------------- Util ---------------------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// --------------------- Arranque ---------------------
(async function init() {
  await loadSettings();
  await loadJavaVersions();
  await renderAccounts();
  await updateAccountChip();
})();
