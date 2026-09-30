// KATHEB Type 01 - full-apartment walkable tour, v4 viewer
//   v3.3 HQ4 bake (all 14 rooms + lift lobby, baked Cycles lighting, Riyadh view) in three builds:
//     full   92 MB JPEG atlases up to 8192 px  - desktop PCs with a real GPU
//     medium 47 MB KTX2 (ETC1S) atlases <= 4096 - laptops / tablets
//     mobile 26 MB KTX2 (ETC1S) atlases <= 2048 (hero/art 4096) - phones
//   The build is picked from the device (touch / UA / GPU / memory / texture limit) and can be forced with ?q=mobile|medium|full.
//   Touch: left-thumb joystick walks, drag looks around, tap on the floor teleports, room buttons are finger-sized.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');
if (SHOT) document.body.classList.add('shot');

const EYE = 1.6, RADIUS = 0.2;
// Blender (x, y) plan coordinates -> three.js (x, -y).  views.json: {name: {label, key, pos: [bx, by], look: [x, y, z]}}
const FALLBACK_VIEWS = {
  spawn: 'foyer', glb: 'assets/katheb_v3_apartment.glb',
  builds: { full: 'assets/katheb_v3_apartment.glb', medium: 'assets/katheb_v3_apartment_medium.glb', mobile: 'assets/katheb_v3_apartment_mobile.glb' },
  order: ['foyer', 'living', 'kitchen', 'hall', 'bedroom_01', 'bedroom_02', 'master_bedroom'],
  views: {
    foyer: { label: 'Foyer', key: '1', pos: [-1.15, 6.45], look: [0.6, 6.6, 1.3] },
    living: { label: 'Living', key: '2', pos: [0.45, 6.75], look: [2.3, 2.0, 1.1] },
    kitchen: { label: 'Kitchen', key: '3', pos: [3.25, 8.95], look: [0.3, 11.9, 1.05] },
    hall: { label: 'Hall', key: '4', pos: [4.78, 2.45], look: [4.85, 7.6, 1.2] },
    bedroom_01: { label: 'Bedroom 01', key: '5', pos: [6.4, 5.1], look: [8.6, 4.4, 1.0] },
    bedroom_02: { label: 'Bedroom 02', key: '6', pos: [6.45, 2.1], look: [8.6, 1.2, 1.0] },
    master_bedroom: { label: 'Master bedroom', key: '7', pos: [5.8, 8.3], look: [8.8, 9.6, 1.1] },
  },
  rooms: [], probes: {}, group_room: {}, credits: [],
};
let VIEWS = FALLBACK_VIEWS;

// ---------------------------------------------------------------- device -> build
const ua = navigator.userAgent || '';
const TOUCH = (navigator.maxTouchPoints || 0) > 1 || 'ontouchstart' in window;
const IPADOS = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;   // iPadOS reports a Mac UA
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Tablet/i.test(ua) || IPADOS;
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: SHOT }); }
catch (err) {
  document.getElementById('loadtxt').textContent = 'This browser cannot show the 3D tour (WebGL 2 is not available). Please try Chrome, Safari 16.4+ or Edge.';
  document.getElementById('barfill').style.background = '#a33'; throw err;
}
const gl = renderer.getContext();
const MAX_TEX = gl.getParameter(gl.MAX_TEXTURE_SIZE);
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const GPU = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
const MEM = navigator.deviceMemory;   // GB, Chrome only (capped at 8); undefined on Safari / Firefox
const MIN_SIDE = Math.min(screen.width, screen.height);
const PHONE = TOUCH && MOBILE_UA && MIN_SIDE < 600;            // phones / phablets (CSS px): mobile build, phone HUD
const TABLET = TOUCH && MOBILE_UA && !PHONE;                    // iPad / Android tablets: medium unless clearly weak
function pickQuality() {
  if (PHONE || MAX_TEX < 4096) return 'mobile';
  if (TABLET) return (MEM !== undefined && MEM <= 4) || MAX_TEX < 8192 ? 'mobile' : 'medium';
  // computers (touch-screen laptops included): full only with a desktop-class GPU, enough memory and a big screen
  const strong = /NVIDIA|GeForce|RTX|Quadro|Radeon (RX|Pro|VII)|Apple M\d+ (Pro|Max|Ultra)/i.test(GPU);
  if (strong && MAX_TEX >= 8192 && (MEM === undefined || MEM >= 8) && Math.max(screen.width, screen.height) >= 1400) return 'full';
  return 'medium';
}
const QUALITY = ['mobile', 'medium', 'full'].includes(params.get('q')) ? params.get('q') : pickQuality();
const PHONE_UI = PHONE;
if (TOUCH) document.body.classList.add('touch');
if (PHONE_UI) document.body.classList.add('phone');
document.body.dataset.quality = QUALITY;
window.__quality = QUALITY; window.__device = { ua, touch: TOUCH, mobileUA: MOBILE_UA, phone: PHONE, tablet: TABLET, maxTex: MAX_TEX, gpu: GPU, mem: MEM, screen: [screen.width, screen.height], dpr: devicePixelRatio };

renderer.setPixelRatio(Math.min(window.devicePixelRatio, PHONE_UI ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Lightmaps (and the Riyadh window view) were baked in Cycles and tone-mapped with the Blender view transform at bake
// time, so the viewer must NOT tone-map a second time.
renderer.toneMapping = THREE.NoToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9d4ca);   // only visible if the sky dome failed to load
const camera = new THREE.PerspectiveCamera(parseFloat(params.get('fov') || 60), innerWidth / innerHeight, 0.05, 120);
camera.rotation.order = 'YXZ';

// ---------------------------------------------------------------- collision grid
let grid = null;
function blockedCell(bx, by) {
  const i = Math.floor((bx - grid.x0) / grid.res), j = Math.floor((by - grid.y0) / grid.res);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return true;
  return grid.rows[j].charCodeAt(i) !== 48; // '0' = free
}
function blocked(x3, z3) {
  if (!grid) return false;
  const bx = x3, by = -z3;
  if (blockedCell(bx, by)) return true;
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2;
    if (blockedCell(bx + Math.cos(a) * RADIUS, by + Math.sin(a) * RADIUS)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- rooms / views
function roomAt(bx, by) {
  for (const r of VIEWS.rooms || []) if (bx >= r[1] && bx < r[2] && by >= r[3] && by < r[4]) return r;
  return null;
}
let currentView = null;
function setView(name) {
  const v = VIEWS.views[name]; if (!v) return;
  currentView = name;
  camera.position.set(v.pos[0], EYE, -v.pos[1]);
  const t = new THREE.Vector3(v.look[0], v.look[2], -v.look[1]);
  const d = t.clone().sub(camera.position).normalize();
  camera.rotation.set(Math.asin(d.y), Math.atan2(-d.x, -d.z), 0, 'YXZ');
  autoGain = targetGain();   // jump straight to the room's exposure on teleport
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  const on = document.querySelector('[data-view].on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
}
function cycleView(dir) {
  const o = VIEWS.order; const k = Math.max(0, o.indexOf(currentView));
  setView(o[(k + dir + o.length) % o.length]);
}
function buildHud() {
  const box = document.getElementById('spots'); box.innerHTML = '';
  for (const name of VIEWS.order) {
    const v = VIEWS.views[name]; if (!v) continue;
    const b = document.createElement('button'); b.dataset.view = name; b.type = 'button';
    b.innerHTML = (v.key && !PHONE_UI ? `<i>${v.key}</i>` : '') + v.label;
    b.addEventListener('click', e => { e.stopPropagation(); setView(name); });
    box.appendChild(b);
  }
  const c = document.getElementById('credits');
  c.innerHTML = '<b>Credits</b><br>' + (VIEWS.credits || []).map(s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
  const q = document.getElementById('quality');
  if (q) {
    const sizes = VIEWS.build_mb || {};
    const link = k => k === QUALITY ? `<b>${k}</b>` : `<a href="?q=${k}${params.get('view') ? '&view=' + params.get('view') : ''}">${k}</a>`;
    q.innerHTML = `Quality ${['mobile', 'medium', 'full'].map(link).join(' · ')}` + (sizes[QUALITY] ? ` <span>(${sizes[QUALITY]} MB)</span>` : '');
  }
}

// ---------------------------------------------------------------- exposure (manual [ ] x per-room eye adaptation)
let brightness = parseFloat(params.get('b') || 1.0);
let autoOn = !params.has('noauto');
let autoGain = 1.0, appliedGain = -1;
function targetGain() {
  if (!autoOn) return 1.0;
  const r = roomAt(camera.position.x, -camera.position.z);
  return r && r[6] ? r[6] : 1.0;
}
const tunables = [];
function applyBrightness() {
  const g = brightness * autoGain;
  if (Math.abs(g - appliedGain) < 1e-3) return;
  appliedGain = g;
  for (const m of tunables) {
    if (m.isMeshBasicMaterial) { if (m.userData.baseColor) m.color.copy(m.userData.baseColor).multiplyScalar(g); else m.color.setScalar(m.userData.base * g); }
    else if (m.isMeshStandardMaterial) m.emissiveIntensity = g;
  }
}

// ---------------------------------------------------------------- minimap
const mapCv = document.getElementById('minimap'), mapCtx = mapCv.getContext('2d');
let mapImg = null, mapScale = 1;
function buildMinimap() {
  const maxW = PHONE_UI ? 120 : 230, maxH = PHONE_UI ? 140 : 260;
  mapScale = Math.min(maxW / grid.nx, maxH / grid.ny);
  mapCv.width = Math.round(grid.nx * mapScale); mapCv.height = Math.round(grid.ny * mapScale);
  const off = document.createElement('canvas'); off.width = grid.nx; off.height = grid.ny;
  const ctx = off.getContext('2d'); const im = ctx.createImageData(grid.nx, grid.ny);
  for (let j = 0; j < grid.ny; j++) {
    const row = grid.rows[j], y = grid.ny - 1 - j;
    for (let i = 0; i < grid.nx; i++) {
      const c = row.charCodeAt(i), p = (y * grid.nx + i) * 4;
      const col = c === 48 ? [236, 231, 222, 235] : c === 49 ? [40, 38, 36, 235] : [150, 118, 88, 235];
      im.data[p] = col[0]; im.data[p + 1] = col[1]; im.data[p + 2] = col[2]; im.data[p + 3] = col[3];
    }
  }
  ctx.putImageData(im, 0, 0); mapImg = off;
}
function drawMinimap() {
  if (!mapImg || mapCv.style.display === 'none') return;
  mapCtx.imageSmoothingEnabled = false;
  mapCtx.clearRect(0, 0, mapCv.width, mapCv.height);
  mapCtx.drawImage(mapImg, 0, 0, mapCv.width, mapCv.height);
  const bx = camera.position.x, by = -camera.position.z;
  const x = (bx - grid.x0) / grid.res * mapScale, y = mapCv.height - (by - grid.y0) / grid.res * mapScale;
  const yaw = camera.rotation.y;   // 0 = looking north (+Y blender)
  const s = PHONE_UI ? 0.7 : 1;
  mapCtx.save(); mapCtx.translate(x, y); mapCtx.rotate(-yaw);
  mapCtx.fillStyle = '#d2462d'; mapCtx.beginPath(); mapCtx.moveTo(0, -8 * s); mapCtx.lineTo(5 * s, 5 * s); mapCtx.lineTo(-5 * s, 5 * s); mapCtx.closePath(); mapCtx.fill();
  mapCtx.restore();
}

// ---------------------------------------------------------------- load
const bar = document.getElementById('barfill'), ltxt = document.getElementById('loadtxt');
const draco = new DRACOLoader().setDecoderPath('./vendor/three/addons/libs/draco/gltf/');
const ktx2 = new KTX2Loader().setTranscoderPath('./vendor/three/addons/libs/basis/').detectSupport(renderer);
if (PHONE_UI || TABLET) { ktx2.setWorkerLimit(2); draco.setWorkerLimit(2); }
const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);
const floorMeshes = [];
const dynamicEnv = [];      // materials whose reflection probe follows the camera's room (floors)
let sky = null;
const probes = {};
const texSeen = new Set(); let texBytes = 0, texCount = 0, texCompressed = 0;
function countTex(t) {
  if (!t || texSeen.has(t.uuid)) return; texSeen.add(t.uuid); texCount++;
  if (t.isCompressedTexture) {
    texCompressed++;
    for (const m of t.mipmaps || []) texBytes += m.data ? m.data.byteLength : 0;
  } else if (t.image) {
    texBytes += (t.image.width || 0) * (t.image.height || 0) * 4 * (t.generateMipmaps ? 4 / 3 : 1);
  }
}
window.__texStats = () => ({ textures: texCount, compressed: texCompressed, gpu_mb_estimate: +(texBytes / 1e6).toFixed(1), quality: QUALITY });

const getJSON = (u, fb) => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : fb).catch(() => fb);
const T_LOAD0 = performance.now();
let loadStats = {};

getJSON('views.json', FALLBACK_VIEWS).then(v => {
  VIEWS = Object.assign({}, FALLBACK_VIEWS, v);
  buildHud();
  setView(params.get('view') || VIEWS.spawn || 'foyer');
  const builds = Object.assign({}, FALLBACK_VIEWS.builds, VIEWS.builds || {});
  const glb = params.get('glb') || builds[QUALITY] || VIEWS.glb;
  ltxt.textContent = `Loading ${QUALITY} build…`;
  const t0 = performance.now();
  return Promise.all([
    getJSON('collision.json', null),
    new Promise((res, rej) => loader.load(glb, g => { loadStats.fetch_parse_s = +((performance.now() - t0) / 1000).toFixed(2); loadStats.glb = glb; res(g); },
      e => { if (e.total) { bar.style.width = (100 * e.loaded / e.total).toFixed(0) + '%'; ltxt.textContent = `Loading ${QUALITY} build… ${(e.loaded / 1e6).toFixed(1)} / ${(e.total / 1e6).toFixed(1)} MB`; loadStats.bytes = e.total; } }, rej)),
  ]);
}).then(([g, gltf]) => {
  grid = g;
  if (grid) buildMinimap();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  // every texture: sRGB, trilinear + max anisotropic filtering (no shimmer / moire on marble, tiles, wood).
  // JPEG textures get a generated mip chain; KTX2 textures carry their own mip chain (generateMipmaps must stay off).
  const prepTex = t => {
    if (!t) return t;
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(maxAniso, 16);
    if (t.isCompressedTexture) { t.generateMipmaps = false; t.minFilter = (t.mipmaps && t.mipmaps.length > 1) ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; }
    else { t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
    t.magFilter = THREE.LinearFilter; t.needsUpdate = true; countTex(t); return t;
  };
  const ARCH = /^(floor|walls_w|walls_e|ceiling)/;
  const pending = [];
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const src = o.material;
    const name = src.name || '';
    if (name.startsWith('GLASS')) {
      const kind = name.includes('window') ? 'window' : name.includes('shower') ? 'shower' : 'misc';
      o.material = new THREE.MeshBasicMaterial({ color: kind === 'window' ? 0xf2f4f2 : 0xdfe6e4, transparent: true,
        opacity: { window: 0.05, shower: 0.12, misc: 0.06 }[kind], depthWrite: false, side: THREE.DoubleSide });
      o.renderOrder = 2;
      return;
    }
    if (name.startsWith('SKY')) {
      const tex = prepTex(src.emissiveMap || src.map);
      o.material = new THREE.MeshBasicMaterial({ map: tex || null, side: THREE.DoubleSide, depthWrite: false, fog: false });
      o.material.userData.base = 1.0;
      o.renderOrder = -10; o.frustumCulled = false;
      sky = o; tunables.push(o.material);
      return;
    }
    if (name.startsWith('LEAF')) {   // alpha-cutout foliage kept with its own CC0 texture (not lightmapped)
      const tex = prepTex(src.map);
      const m = new THREE.MeshBasicMaterial({ map: tex || null, alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
      if (tex) { m.userData.base = 0.78; m.color.setScalar(0.78); }
      else { m.color.copy(src.color).multiplyScalar(0.78); m.userData.base = 1.0; m.userData.baseColor = m.color.clone(); }
      o.material = m; tunables.push(m);
      return;
    }
    const tex = prepTex(src.emissiveMap || src.map);
    const cls = (name.split('__')[1] || 'matte');
    const group = (name.split('__')[0] || '').replace('BK_', '');
    let m;
    if (cls === 'matte' || !tex) {
      // furniture is double-sided: thin cloth (single-sided duvets / runners since HQ2), lamp shades, drapes never show holes
      m = new THREE.MeshBasicMaterial({ map: tex || null, color: tex ? 0xffffff : src.color, side: ARCH.test(group) ? THREE.FrontSide : THREE.DoubleSide });
      m.userData.base = 1.0; if (!tex) m.userData.baseColor = m.color.clone();
    } else {
      const metal = cls.startsWith('metal') || cls === 'mirror';
      const rough = { floor_oak: 0.42, floor_marble: 0.2, gloss: 0.32, blackglass: 0.08, mirror: 0.04 }[cls] ?? 0.34;
      m = new THREE.MeshStandardMaterial({
        color: metal ? src.color.clone() : new THREE.Color(0x000000),
        metalness: metal ? 1 : 0, roughness: rough,
        emissive: new THREE.Color(0xffffff), emissiveMap: tex,
      });
      m.userData.group = group;
      m.userData.envIntensity = metal ? (cls === 'mirror' ? 1.0 : 0.55) : (cls === 'floor_marble' ? 0.55 : cls === 'blackglass' ? 0.9 : 0.35);
      pending.push(m);
    }
    m.name = name; o.material = m; tunables.push(m);
    if (group.startsWith('floor')) floorMeshes.push(o);
    o.matrixAutoUpdate = false; o.updateMatrix();
    // the source material and its unused maps can go
    if (src.dispose) src.dispose();
  });
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);

  draco.dispose(); ktx2.dispose();   // decoder workers / wasm are not needed after the load
  // reflection probes rendered from the baked scene itself (PMREM), one per room (half size on phones: ~1.5 MB each instead of ~6)
  const pmrem = new THREE.PMREMGenerator(renderer);
  for (const [room, p] of Object.entries(VIEWS.probes || {})) {
    const pos = new THREE.Vector3(p[0], p[2] ?? 1.3, -p[1]);
    if (sky) { sky.position.copy(pos); sky.updateMatrixWorld(true); }
    probes[room] = pmrem.fromScene(scene, 0.03, 0.05, 60, { position: pos, size: PHONE_UI ? 128 : 256 }).texture;
  }
  pmrem.dispose();
  lastRoom = null;   // force the per-room probe assignment on the next frame (the spawn room was entered before the probes existed)
  const anyProbe = Object.values(probes)[0] || null;
  for (const m of pending) {
    const room = (VIEWS.group_room || {})[m.userData.group];
    if (room === '*') dynamicEnv.push(m);
    m.envMap = probes[room] || anyProbe; m.envMapIntensity = m.userData.envIntensity; m.needsUpdate = true;
  }

  document.getElementById('loading').style.display = 'none';
  renderer.compile(scene, camera);
  loadStats.ready_s = +((performance.now() - T_LOAD0) / 1000).toFixed(2);
  loadStats.tex = window.__texStats();
  window.__loadStats = loadStats;
  window.__ready = true; document.title = 'READY ' + document.title;
}).catch(err => { ltxt.textContent = 'Failed to load: ' + err; console.error(err); });

// ---------------------------------------------------------------- controls (mouse + keyboard)
const controls = new PointerLockControls(camera, document.body);
controls.pointerSpeed = 0.8;
renderer.domElement.addEventListener('pointerup', e => { if (!SHOT && e.pointerType === 'mouse' && e.button === 0) { try { controls.lock(); } catch (err) { /* no pointer lock on this device */ } } });
controls.addEventListener('lock', () => document.body.classList.add('locked'));
controls.addEventListener('unlock', () => document.body.classList.remove('locked'));

const toggle = id => { const h = document.getElementById(id); h.style.display = h.style.display === 'none' ? '' : 'none'; };
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyH') toggle('help');
  if (e.code === 'KeyM') toggle('minimap');
  if (e.code === 'KeyC') toggle('credits');
  if (e.code === 'KeyE') { autoOn = !autoOn; }
  if (e.code === 'KeyN') cycleView(1);
  if (e.code === 'KeyP') cycleView(-1);
  const dm = /^(Digit|Numpad)(\d)$/.exec(e.code);
  if (dm) for (const [name, v] of Object.entries(VIEWS.views)) if (v.key === dm[2]) setView(name);
  if (e.code === 'BracketLeft') brightness = Math.max(0.5, brightness - 0.08);
  if (e.code === 'BracketRight') brightness = Math.min(1.8, brightness + 0.08);
  if (e.code === 'KeyF') teleport(true);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
function teleport(center, ev) {
  if (!floorMeshes.length) return false;
  if (center || controls.isLocked) mouse.set(0, 0);
  else mouse.set(ev.clientX / innerWidth * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(scene.children, true).filter(h => h.object !== sky && !(h.object.material && h.object.material.transparent));
  const hit = hits[0];
  if (!hit || hit.point.y > 0.06) return false;   // floor, or something lying on it (rug, mat); the collision grid decides
  if (blocked(hit.point.x, hit.point.z)) return false;
  camera.position.set(hit.point.x, EYE, hit.point.z);
  return true;
}
renderer.domElement.addEventListener('contextmenu', e => { e.preventDefault(); teleport(false, e); });

// ---------------------------------------------------------------- touch: joystick (walk), drag (look), tap (teleport)
const stick = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0, r: 46 };
const look = { active: false, id: null, x: 0, y: 0, x0: 0, y0: 0, t0: 0, moved: 0 };
const stickEl = document.getElementById('stick'), knobEl = document.getElementById('knob');
function stickCenter() { const r = stickEl.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width / 2]; }
function setKnob(dx, dy) { knobEl.style.transform = `translate(${dx}px, ${dy}px)`; }
const LOOK_SPEED = 0.0042;    // rad per css px
const tp = ev => ev.touches ? [...ev.changedTouches] : [ev];
function onTouchStart(e) {
  if (!TOUCH) return;
  for (const t of e.changedTouches) {
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (el && el.closest && el.closest('#hud, #quality, #credits, #thelp, button, a')) continue;   // HUD taps stay normal clicks
    if (!stick.active && stickEl.style.display !== 'none' && el && (el === stickEl || el === knobEl)) {
      const [cx, cy, r] = stickCenter(); stick.active = true; stick.id = t.identifier; stick.cx = cx; stick.cy = cy; stick.r = r; stick.dx = 0; stick.dy = 0;
      e.preventDefault(); continue;
    }
    if (!look.active) {
      look.active = true; look.id = t.identifier; look.x = look.x0 = t.clientX; look.y = look.y0 = t.clientY; look.t0 = performance.now(); look.moved = 0;
      e.preventDefault();
    }
  }
}
function onTouchMove(e) {
  for (const t of e.changedTouches) {
    if (stick.active && t.identifier === stick.id) {
      let dx = t.clientX - stick.cx, dy = t.clientY - stick.cy; const L = Math.hypot(dx, dy);
      if (L > stick.r) { dx *= stick.r / L; dy *= stick.r / L; }
      stick.dx = dx / stick.r; stick.dy = dy / stick.r; setKnob(dx, dy); e.preventDefault();
    } else if (look.active && t.identifier === look.id) {
      const dx = t.clientX - look.x, dy = t.clientY - look.y; look.x = t.clientX; look.y = t.clientY;
      look.moved += Math.hypot(dx, dy);
      camera.rotation.y -= dx * LOOK_SPEED;
      camera.rotation.x = Math.max(-1.35, Math.min(1.35, camera.rotation.x - dy * LOOK_SPEED));
      e.preventDefault();
    }
  }
}
function onTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (stick.active && t.identifier === stick.id) { stick.active = false; stick.dx = stick.dy = 0; setKnob(0, 0); }
    else if (look.active && t.identifier === look.id) {
      const dt = performance.now() - look.t0;
      if (e.type === 'touchend' && dt < 350 && look.moved < 12) teleport(false, { clientX: t.clientX, clientY: t.clientY });   // tap on the floor = go there
      look.active = false;
    }
  }
}
function resetTouch() { stick.active = false; stick.dx = stick.dy = 0; setKnob(0, 0); look.active = false; }
addEventListener('blur', resetTouch);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetTouch(); });
document.addEventListener('touchstart', onTouchStart, { passive: false });
document.addEventListener('touchmove', onTouchMove, { passive: false });
document.addEventListener('touchend', onTouchEnd, { passive: false });
document.addEventListener('touchcancel', onTouchEnd, { passive: false });
if (!TOUCH) { stickEl.style.display = 'none'; const th = document.getElementById('thelp'); if (th) th.style.display = 'none'; }
else { const h = document.getElementById('help'); if (h) h.style.display = 'none'; }
document.getElementById('thelp')?.addEventListener('click', e => { e.currentTarget.style.display = 'none'; });

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), step = new THREE.Vector3();
let frames = 0, acc = 0; const fpsEl = document.getElementById('fps'), roomEl = document.getElementById('room');
let lastRoom = null;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const speed = (keys.ShiftLeft || keys.ShiftRight) ? 2.6 : 1.35;
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  right.crossVectors(fwd, camera.up).normalize();
  step.set(0, 0, 0);
  if (keys.KeyW || keys.ArrowUp) step.add(fwd);
  if (keys.KeyS || keys.ArrowDown) step.sub(fwd);
  if (keys.KeyD || keys.ArrowRight) step.add(right);
  if (keys.KeyA || keys.ArrowLeft) step.sub(right);
  let mag = 1;
  if (stick.active && (stick.dx || stick.dy)) {    // joystick: up = forward, right = strafe; magnitude = speed
    step.addScaledVector(fwd, -stick.dy).addScaledVector(right, stick.dx);
    mag = Math.min(1, Math.hypot(stick.dx, stick.dy)); mag = 0.35 + 0.65 * mag;
  }
  if (step.lengthSq() > 0) {
    step.normalize().multiplyScalar(speed * mag * dt);
    const p = camera.position;
    let moved = false;
    if (!blocked(p.x + step.x, p.z)) { p.x += step.x; moved = true; }
    if (!blocked(p.x, p.z + step.z)) { p.z += step.z; moved = true; }
    if (!moved) {   // both axes blocked (corner): slide along the obstacle by trying the step rotated +-25/50/75 deg
      for (const a of [0.44, -0.44, 0.87, -0.87, 1.31, -1.31]) {
        const c = Math.cos(a), s = Math.sin(a);
        const dx = (step.x * c - step.z * s) * c, dz = (step.x * s + step.z * c) * c;
        if (!blocked(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; break; }
      }
    }
  }
  camera.position.y = EYE;
  if (sky) { sky.position.copy(camera.position); sky.updateMatrixWorld(true); }
  const r = roomAt(camera.position.x, -camera.position.z);
  const rn = r ? r[0] : null;
  if (rn !== lastRoom) {
    lastRoom = rn; roomEl.textContent = r ? r[5] : '';
    if (rn && probes[rn]) for (const m of dynamicEnv) { m.envMap = probes[rn]; m.needsUpdate = true; }
  }
  autoGain += (targetGain() - autoGain) * Math.min(1, dt * 1.6);
  applyBrightness();
  renderer.render(scene, camera);
  drawMinimap();
  frames++; acc += dt; if (acc > 0.5) { fpsEl.textContent = Math.round(frames / acc) + ' fps'; frames = 0; acc = 0; }
  requestAnimationFrame(tick);
}
// test / automation hooks
window.__cam = camera; window.__setView = setView; window.__scene = scene; window.__THREE = THREE;   // test hooks (scale / raycast checks)
window.__blocked = (bx, by) => blocked(bx, -by);
window.__grid = () => grid; window.__views = () => VIEWS;
window.__roomAt = (bx, by) => { const r = roomAt(bx, by); return r ? r[0] : null; };
window.__teleportAt = (cx, cy) => teleport(false, { clientX: cx, clientY: cy });
window.__tapProbe = (cx, cy) => {   // what a tap at (cx, cy) would hit: for tests / debugging
  mouse.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(scene.children, true).filter(h => h.object !== sky && !(h.object.material && h.object.material.transparent));
  const h = hits[0]; if (!h) return { hit: null };
  return { hit: h.object.name || h.object.material.name, floor: floorMeshes.includes(h.object), y: +h.point.y.toFixed(3), point: [+h.point.x.toFixed(2), +(-h.point.z).toFixed(2)], dist: +h.distance.toFixed(2), blocked: blocked(h.point.x, h.point.z) };
};
window.__stick = stick; window.__renderer = renderer;
tick();
function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); resetTouch(); }
// GPU context lost (iOS Safari does this when graphics memory runs out): offer the lighter build instead of a frozen page
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  const l = document.getElementById('loading'); l.style.display = '';
  const lighter = QUALITY === 'full' ? 'medium' : 'mobile';
  ltxt.innerHTML = `The graphics driver stopped (out of memory?). <a href="?q=${lighter}" style="color:#e2c28f">Reload with the ${lighter} build</a>`;
});
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 250));
