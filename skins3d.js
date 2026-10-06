// ===================================================================
//  OptiCraft - Visor de skins 3D (vestuario)
//  Usa skinview3d si está disponible; si no, dibuja un visor 2D.
// ===================================================================
(function () {
  const DEFAULT_SKIN =
    // Skin Steve por defecto embebida (base64 64x64) para cuando no hay skin importada
    null;

  let viewer = null;      // instancia skinview3d
  let fallback = null;    // estado del visor 2D
  let currentCanvas = null;

  function toFileUrl(p) {
    if (!p) return null;
    if (p.startsWith('file://') || p.startsWith('data:') || p.startsWith('http')) return p;
    return 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  // ---------------- Visor 3D principal ----------------
  function initViewer(canvas) {
    currentCanvas = canvas;
    if (window.skinview3d && !viewer) {
      try {
        viewer = new skinview3d.SkinViewer({
          canvas,
          width: canvas.clientWidth || 420,
          height: canvas.clientHeight || 520
        });
        viewer.autoRotate = false;
        viewer.zoom = 0.9;
        if (viewer.controls) viewer.controls.enableZoom = true;
        return true;
      } catch (e) {
        console.warn('skinview3d no disponible, usando visor 2D', e);
        viewer = null;
      }
    }
    return viewer != null;
  }

  function loadSkin(canvas, filePath, slim) {
    if (!viewer) initViewer(canvas);
    const url = toFileUrl(filePath);
    if (viewer && url) {
      viewer.loadSkin(url, { model: slim ? 'slim' : 'default' }).catch(err => {
        console.warn('Error cargando skin 3D:', err);
        draw2D(canvas, filePath);
      });
    } else {
      draw2D(canvas, filePath);
    }
  }

  function setRotate(on) {
    if (viewer) viewer.autoRotate = on;
  }
  function setWalk(on) {
    if (viewer && window.skinview3d) {
      viewer.animation = on ? new skinview3d.WalkingAnimation() : null;
    }
  }
  function setSlim(canvas, filePath, slim) {
    loadSkin(canvas, filePath, slim);
  }

  // ---------------- Visor 2D de respaldo ----------------
  // Dibuja la vista frontal del personaje a partir del PNG de skin (64x64 o 64x32).
  function draw2D(canvas, filePath) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth || 420;
    const h = canvas.height = canvas.clientHeight || 520;
    ctx.clearRect(0, 0, w, h);
    if (!filePath) { placeholder(ctx, w, h); return; }
    const img = new Image();
    img.onload = () => {
      ctx.imageSmoothingEnabled = false;
      const S = Math.min(w, h) / 40;      // escala del píxel
      const ox = w / 2 - 8 * S / 2 * 2;    // centrado aprox.
      const oy = h / 2 - 20 * S;
      const px = (sx, sy, sw, sh, dx, dy) => ctx.drawImage(img, sx, sy, sw, sh, ox + dx * S, oy + dy * S, sw * S, sh * S);
      // Cabeza (8x8 en 8,8), torso (8x12 en 20,20), brazos y piernas
      px(8, 8, 8, 8, 8, 0);        // head
      px(20, 20, 8, 12, 8, 8);     // body
      px(44, 20, 4, 12, 4, 8);     // right arm
      px(44, 20, 4, 12, 16, 8);    // left arm (espejo simplificado)
      px(4, 20, 4, 12, 8, 20);     // right leg
      px(4, 20, 4, 12, 12, 20);    // left leg
    };
    img.onerror = () => placeholder(ctx, w, h);
    img.src = toFileUrl(filePath);
  }

  function placeholder(ctx, w, h) {
    ctx.fillStyle = '#777';
    ctx.font = '14px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('Importa una skin .png para previsualizar', w / 2, h / 2);
  }

  // Miniatura para la biblioteca
  function thumbnail(canvas, filePath) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = 120, h = canvas.height = 90;
    const img = new Image();
    img.onload = () => {
      ctx.imageSmoothingEnabled = false;
      const S = 7, ox = w/2 - 8*S/2, oy = 6;
      const px=(sx,sy,sw,sh,dx,dy)=>ctx.drawImage(img,sx,sy,sw,sh,ox+dx*S,oy+dy*S,sw*S,sh*S);
      px(8,8,8,8,0,0); px(20,20,8,12,0,8); px(4,20,4,12,0,20); px(4,20,4,12,4,20);
    };
    img.src = toFileUrl(filePath);
  }

  window.Skins3D = { initViewer, loadSkin, setRotate, setWalk, setSlim, thumbnail };
})();
