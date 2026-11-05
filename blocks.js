// Блоки и мобы: пиксельные текстуры рисуются кодом, без картинок.
import * as THREE from 'three';

/* ---------- текстуры ---------- */
function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
const pick = (r, a) => a[(r() * a.length) | 0];
const CUTOUT = new Set(['glass', 'dust', 'flow_arrow', 'src_ring', 'ladder', 'rail', 'bamboo_leaves', 'shoot', 'iron_bars']);

const PAL = {
  stone: ['#7e7e7e', '#888888', '#737373', '#959595', '#6b6b6b'],
  dirt: ['#86593a', '#79502f', '#93654a', '#6a4428', '#9b6c48'],
  grass: ['#5c9a33', '#68a83b', '#528d2d', '#77b649', '#4b822a'],
  mud: ['#3b3735', '#44403d', '#33302e', '#4d4743', '#3d3836'],
  oak: ['#b08b55', '#a5814d', '#b9955d', '#9f7b47'],
  iron: ['#d6d6d6', '#cfcfcf', '#dddddd', '#c6c6c6'],
  gray: ['#6b6b6b', '#636363', '#727272', '#5d5d5d'],
};

const D = {};
const noise = (P, r, pal, x0 = 0, y0 = 0, w = 16, h = 16) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) P(x, y, pick(r, pal));
};
const frame = (g, c, w = 16, h = 16) => { g.fillStyle = c; g.fillRect(0, 0, w, 1); g.fillRect(0, h - 1, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(w - 1, 0, 1, h); };

D.missing = g => { g.fillStyle = '#ff00ff'; g.fillRect(0, 0, 16, 16); };
D.stone = (g, r, P) => noise(P, r, PAL.stone);
D.dirt = (g, r, P) => noise(P, r, PAL.dirt);
D.grass_top = (g, r, P) => noise(P, r, PAL.grass);
D.grass_side = (g, r, P) => {
  noise(P, r, PAL.dirt);
  for (let x = 0; x < 16; x++) { const d = 2 + (r() < .55) + (r() < .25); for (let y = 0; y < d; y++) P(x, y, pick(r, PAL.grass)); }
};
D.mud = (g, r, P) => { noise(P, r, PAL.mud); for (let i = 0; i < 7; i++) P((r() * 16) | 0, (r() * 16) | 0, '#5a524c'); };
D.cobble = (g, r, P) => {
  const pts = Array.from({ length: 10 }, () => [r() * 16, r() * 16, pick(r, ['#8a8a8a', '#7b7b7b', '#969696', '#6f6f6f', '#838383'])]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let d1 = 99, d2 = 99, c = '#808080';
    for (const [px, py, col] of pts) {
      let dx = Math.abs(x + .5 - px), dy = Math.abs(y + .5 - py);
      dx = Math.min(dx, 16 - dx); dy = Math.min(dy, 16 - dy);
      const d = Math.hypot(dx, dy);
      if (d < d1) { d2 = d1; d1 = d; c = col; } else if (d < d2) d2 = d;
    }
    P(x, y, d2 - d1 < 1.15 ? '#585858' : (r() < .2 ? shade(c, .92) : c));
  }
};
D.planks = (g, r, P) => {
  for (let b = 0; b < 4; b++) {
    const t = PAL.oak[b];
    for (let y = b * 4; y < b * 4 + 4; y++) for (let x = 0; x < 16; x++) P(x, y, r() < .18 ? shade(t, .9) : t);
    for (let x = 0; x < 16; x++) P(x, b * 4 + 3, '#7a5b34');
    const sx = (r() * 16) | 0; for (let y = b * 4; y < b * 4 + 3; y++) P(sx, y, '#7a5b34');
  }
};
D.dark_planks = (g, r, P) => {
  for (let b = 0; b < 4; b++) {
    const t = ['#6e4f2e', '#654829', '#775633', '#5e4326'][b];
    for (let y = b * 4; y < b * 4 + 4; y++) for (let x = 0; x < 16; x++) P(x, y, r() < .18 ? shade(t, .88) : t);
    for (let x = 0; x < 16; x++) P(x, b * 4 + 3, '#3f2c17');
  }
};
D.glass = (g, r, P) => {
  for (let i = 0; i < 16; i++) { const c = i % 4 === 1 ? '#bcd8de' : '#e3f1f4'; P(i, 0, c); P(i, 15, c); P(0, i, c); P(15, i, c); }
  [[3, 2], [2, 3], [4, 3], [3, 4], [5, 4], [4, 5], [11, 10], [10, 11], [12, 11], [11, 12]].forEach(([x, y]) => P(x, y, '#d9ecf0'));
};
D.hopper_side = (g, r, P) => {
  noise(P, r, ['#4b4b50', '#424247', '#55555b', '#3b3b40']);
  g.fillStyle = '#6a6a70'; g.fillRect(0, 0, 16, 1); g.fillRect(0, 0, 1, 16);
  g.fillStyle = '#2e2e32'; g.fillRect(0, 15, 16, 1); g.fillRect(15, 0, 1, 16);
};
D.hopper_top = (g, r, P) => {
  noise(P, r, ['#5a5a60', '#4f4f55']);
  g.fillStyle = '#232327'; g.fillRect(2, 2, 12, 12); g.fillStyle = '#303035'; g.fillRect(5, 5, 6, 6);
};
D.chest_side = (g, r, P) => {
  noise(P, r, ['#a86f2c', '#9c6527', '#b27833']);
  frame(g, '#3d2610'); g.fillRect(0, 5, 16, 1);
};
D.chest_front = (g, r, P) => { D.chest_side(g, r, P); g.fillStyle = '#d8d8d8'; g.fillRect(7, 3, 2, 4); g.fillStyle = '#7a7a7a'; g.fillRect(7, 6, 2, 1); };
D.chest_top = (g, r, P) => { noise(P, r, ['#a86f2c', '#9c6527', '#b27833']); frame(g, '#3d2610'); };
D.barrel_side = (g, r, P) => {
  for (let x = 0; x < 16; x++) {
    const t = ['#8d6236', '#7f5830', '#99693b'][((x / 4) | 0) % 3];
    for (let y = 0; y < 16; y++) P(x, y, x % 4 === 3 ? '#5c3f20' : (r() < .15 ? shade(t, .88) : t));
  }
  for (const y of [1, 2, 13, 14]) for (let x = 0; x < 16; x++) P(x, y, '#4d4d4d');
};
D.barrel_top = (g, r, P) => {
  D.planks(g, r, P);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d > 6.2) P(x, y, '#4d4d4d'); }
  g.fillStyle = '#4a3219'; g.fillRect(6, 6, 4, 4);
};
D.composter_side = (g, r, P) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) P(x, y, y % 4 === 3 ? '#5d4224' : pick(r, ['#9b7446', '#8e6a3f', '#a67d4c']));
  g.fillStyle = '#5d4224'; g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16);
};
D.composter_top = (g, r, P) => { D.composter_side(g, r, P); noise(P, r, ['#4a3a20', '#3b2a17', '#56442a', '#5e7a2a'], 2, 2, 12, 12); };
D.bed_head = (g, r, P) => { noise(P, r, ['#b2302f', '#a52a29', '#bd3836']); g.fillStyle = '#ece9e2'; g.fillRect(2, 1, 12, 6); g.fillStyle = '#cfcac0'; g.fillRect(2, 6, 12, 1); };
D.bed_foot = (g, r, P) => { noise(P, r, ['#b2302f', '#a52a29', '#bd3836']); g.fillStyle = '#8e2120'; g.fillRect(0, 13, 16, 3); };
D.bed_side = (g, r, P) => { noise(P, r, ['#b2302f', '#a52a29']); g.fillStyle = '#8a6a3f'; g.fillRect(0, 9, 16, 7); g.fillStyle = '#6b4f2c'; g.fillRect(0, 9, 16, 1); };
D.piston_side = (g, r, P) => {
  noise(P, r, PAL.oak, 0, 0, 16, 4);
  noise(P, r, ['#7c7c7c', '#858585', '#707070'], 0, 4, 16, 12);
  g.fillStyle = '#5f5f5f'; g.fillRect(0, 4, 16, 1); g.fillRect(6, 5, 4, 11);
  g.fillStyle = '#9a9a9a'; g.fillRect(7, 5, 2, 11);
};
D.piston_front = (g, r, P) => { D.planks(g, r, P); frame(g, '#6f6f6f'); };
D.piston_back = (g, r, P) => { noise(P, r, ['#7c7c7c', '#858585', '#707070']); g.fillStyle = '#585858'; g.fillRect(5, 5, 6, 6); g.fillStyle = '#464646'; g.fillRect(6, 6, 4, 4); frame(g, '#5f5f5f'); };
// верх корпуса под головой: видно, только когда поршень выдвинут
D.piston_inner = (g, r, P) => { noise(P, r, ['#7c7c7c', '#858585', '#707070']); frame(g, '#5f5f5f'); g.fillStyle = '#3a3a3a'; g.fillRect(5, 5, 6, 6); g.fillStyle = '#262626'; g.fillRect(6, 6, 4, 4); };
D.piston_arm = (g, r, P) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) P(x, y, x % 4 === 3 ? '#7a5b34' : pick(r, PAL.oak)); };
D.observer_front = (g, r, P) => {
  noise(P, r, PAL.gray); frame(g, '#3f3f3f');
  g.fillStyle = '#262626'; g.fillRect(4, 4, 8, 8);
  g.fillStyle = '#41606e'; g.fillRect(6, 6, 4, 4);
  g.fillStyle = '#a9d2e0'; g.fillRect(6, 6, 1, 1);
};
D.observer_back = (g, r, P) => { noise(P, r, PAL.gray); frame(g, '#3f3f3f'); g.fillStyle = '#353535'; g.fillRect(5, 5, 6, 6); g.fillStyle = '#c42a1e'; g.fillRect(6, 6, 4, 4); };
D.observer_side = (g, r, P) => {
  noise(P, r, PAL.gray); frame(g, '#3f3f3f');
  g.fillStyle = '#333333';
  for (let i = 0; i < 4; i++) g.fillRect(7 - i, 3 + i, 2 + i * 2, 1);
  g.fillRect(7, 6, 2, 7);
};
D.dust = (g, r, P) => { for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) if (r() < .85) P(x, y, pick(r, ['#c81e1e', '#a51616', '#e03030'])); };
D.water = (g, r, P) => noise(P, r, ['#3467d6', '#2f5ec6', '#3c72e2', '#2b56b8', '#4a7fe8']);
D.lava = (g, r, P) => noise(P, r, ['#d4570a', '#ee7412', '#ffab2c', '#c4420a', '#ff9a1f', '#ffcf4a']);
D.flow_arrow = g => {
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillRect(7, 6, 2, 7);
  for (let i = 0; i < 4; i++) g.fillRect(7 - i, 3 + i, 2 + i * 2, 1);
};
D.src_ring = (g, r, P) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d > 3.6 && d < 5.4) P(x, y, 'rgba(255,255,255,0.95)'); }
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillRect(7, 7, 2, 2);
};
D.bamboo = (g, r, P) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) P(x, y, x % 4 === 1 ? '#86b844' : pick(r, ['#5f8f2b', '#6a9c30', '#578526']));
  g.fillStyle = '#3d6419'; g.fillRect(0, 4, 16, 1); g.fillRect(0, 12, 16, 1);
};
D.bamboo_leaves = (g, r, P) => {
  for (let i = 0; i < 5; i++) {
    const x0 = (r() * 12) | 0, y0 = (r() * 12) | 0, dx = r() < .5 ? 1 : -1;
    for (let k = 0; k < 6; k++) { const x = x0 + (k * dx) / 2, y = y0 + k / 2; if (x >= 0 && x < 16 && y < 16) { P(x | 0, y | 0, pick(r, ['#4f8a22', '#5f9c2b', '#6fae36'])); P((x | 0) + 1 > 15 ? 15 : (x | 0) + 1, y | 0, '#4f8a22'); } }
  }
};
D.shoot = (g, r, P) => {
  g.fillStyle = '#5f8f2b'; g.fillRect(7, 6, 2, 10);
  g.fillStyle = '#6fae36'; g.fillRect(4, 4, 3, 2); g.fillRect(9, 2, 3, 2); g.fillRect(5, 1, 2, 2);
};
D.iron_door = (g, r, P, w, h) => {
  noise(P, r, PAL.iron, 0, 0, 16, 32); frame(g, '#8a8a8a', 16, 32);
  g.fillStyle = '#3e4750'; g.fillRect(3, 3, 4, 6); g.fillRect(9, 3, 4, 6);
  g.fillStyle = '#9b9b9b'; g.fillRect(2, 12, 12, 1); g.fillRect(2, 21, 12, 1); g.fillRect(2, 29, 12, 1);
  g.fillStyle = '#6d6d6d'; g.fillRect(12, 16, 2, 2);
};
D.ladder = (g, r, P) => {
  g.fillStyle = '#7a5630'; g.fillRect(2, 0, 2, 16); g.fillRect(12, 0, 2, 16);
  g.fillStyle = '#9e7545'; for (const y of [1, 5, 9, 13]) g.fillRect(2, y, 12, 2);
};
D.rail = (g, r, P) => {
  g.fillStyle = '#6b4a2b'; for (const y of [1, 5, 9, 13]) g.fillRect(1, y, 14, 2);
  g.fillStyle = '#a8a8a8'; g.fillRect(3, 0, 1, 16); g.fillRect(12, 0, 1, 16);
  g.fillStyle = '#7d7d7d'; g.fillRect(4, 0, 1, 16); g.fillRect(11, 0, 1, 16);
};
D.lectern_side = (g, r, P) => { D.dark_planks(g, r, P); frame(g, '#3f2c17'); };
D.lectern_top = (g, r, P) => { D.dark_planks(g, r, P); g.fillStyle = '#e9e2cf'; g.fillRect(3, 4, 10, 8); g.fillStyle = '#8c2a22'; g.fillRect(7, 4, 2, 8); };
D.blast_front = (g, r, P) => {
  noise(P, r, ['#5c5c5c', '#666666', '#535353']); frame(g, '#3d3d3d');
  g.fillStyle = '#242424'; g.fillRect(3, 6, 10, 7);
  g.fillStyle = '#8a8a8a'; for (const x of [5, 8, 11]) g.fillRect(x - 1, 6, 1, 7);
  g.fillStyle = '#e07a2a'; g.fillRect(4, 11, 8, 1);
};
D.blast_side = (g, r, P) => { noise(P, r, ['#8f8f8f', '#9a9a9a', '#868686']); frame(g, '#5e5e5e'); g.fillStyle = '#6e6e6e'; g.fillRect(0, 7, 16, 1); };
D.blast_top = (g, r, P) => { noise(P, r, ['#8f8f8f', '#9a9a9a']); frame(g, '#5e5e5e'); g.fillStyle = '#3d3d3d'; g.fillRect(4, 4, 8, 8); };
D.tok_cloth = (g, r, P) => { noise(P, r, ['#b98a56', '#ad7f4d', '#c4955f', '#a6784a']); for (let x = 1; x < 16; x += 4) for (let y = 0; y < 16; y++) if (r() < .45) P(x, y, '#98693d'); };
D.tok_ivory = (g, r, P) => noise(P, r, ['#e3c49c', '#dcbb92', '#e8cca6', '#d6b48a']);
D.tok_rot = (g, r, P) => { noise(P, r, ['#4f8a3c', '#5a9a45', '#457a34', '#3e6e2e']); for (let i = 0; i < 10; i++) P((r() * 16) | 0, (r() * 16) | 0, '#2f5524'); };
D.tok_rags = (g, r, P) => {
  // рваная тёмная тряпка с заплатками — чтобы фишка зомби не была сплошь зелёной
  noise(P, r, ['#4a4552', '#3f3a47', '#544e5c', '#39343f']);
  for (let i = 0; i < 3; i++) { const x0 = (r() * 12) | 0, y0 = (r() * 12) | 0; noise(P, r, ['#6b5a44', '#5e4f3c'], x0, y0, 4, 3); }
  for (let x = 0; x < 16; x++) if (r() < .35) P(x, 15, '#2a2630');
};
D.tok_rot_head = (g, r, P) => noise(P, r, ['#6cae55', '#62a04c', '#77ba60', '#5b9646']);
D.tok_iron = (g, r, P) => {
  noise(P, r, ['#cfccc5', '#c6c3bc', '#d8d5ce', '#bfbcb5']);
  g.fillStyle = '#9a978f'; g.fillRect(0, 7, 16, 1); g.fillRect(7, 0, 1, 7); g.fillRect(15, 8, 1, 8);
  g.fillStyle = '#7c7973'; for (const [x, y] of [[2, 2], [12, 2], [2, 11], [12, 11]]) g.fillRect(x, y, 1, 1);
};
D.tok_dark = (g, r, P) => noise(P, r, ['#4a4a50', '#424248', '#55555b', '#3d3d42']);
D.tok_wood = (g, r, P) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) P(x, y, y % 4 === 3 ? '#4d3620' : pick(r, ['#6e4f2e', '#654829', '#775633'])); };
D.tok_gem = (g, r, P) => { noise(P, r, ['#2fbf6a', '#23a65a', '#46d982']); for (let i = 3; i < 7; i++) P(i, 3, '#b8ffd6'); };
D.iron_bars = (g, r, P) => { g.fillStyle = '#9d9d9d'; for (const x of [1, 5, 9, 13]) g.fillRect(x, 0, 2, 16); g.fillRect(0, 1, 16, 1); g.fillRect(0, 14, 16, 1); };

const TEX = new Map();
let ANISO = 1;
export const setAniso = n => { ANISO = Math.max(1, Math.min(8, n || 1)); }; // резче текстуры под углом
export function tex(key) {
  if (TEX.has(key)) return TEX.get(key);
  const w = 16, h = key === 'iron_door' ? 32 : 16;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const r = rand(hash(key));
  const P = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  (D[key] || D.missing)(g, r, P, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  if (CUTOUT.has(key)) { t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  else t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  if (key === 'lava' || key === 'water' || key.startsWith('tok_')) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  TEX.set(key, t);
  return t;
}

/* ---------- материалы и геометрия ---------- */
// Свет «как в воксельных играх»: верх самый светлый, низ тёмный, бока между ними.
// Считается по нормали в мире, поэтому повёрнутые блоки тоже затеняются верно.
export function shadeHook(s) {
  s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vShade;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      mat3 nm = mat3(modelMatrix);
      #ifdef USE_INSTANCING
        nm = nm * mat3(instanceMatrix);
      #endif
      vec3 wn = normalize(nm * normal), q = wn * wn;
      vShade = pow(q.x * 0.72 + q.z * 0.86 + q.y * (wn.y > 0.0 ? 1.0 : 0.56), 2.2);`);
  s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vShade;')
    .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vShade;');
}
const MAT = new Map();
export function mat(key, opt = {}) {
  const id = key + '|' + JSON.stringify(opt);
  if (MAT.has(id)) return MAT.get(id);
  const { glow, ...o } = opt;
  const m = key.startsWith('#') || key.startsWith('rgb') ? new THREE.MeshBasicMaterial({ color: new THREE.Color(key), ...o })
    : new THREE.MeshBasicMaterial({ map: tex(key), ...o });
  if (CUTOUT.has(key)) { m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
  if (key === 'glass') m.side = THREE.FrontSide; // рамки непрозрачные, середина пустая; стыки стёкол убирает движок
  if (!glow) m.onBeforeCompile = shadeHook;   // светящееся (лава, огонь, редстоун) — без тени
  MAT.set(id, m);
  return m;
}
const GEO = new Map();
function geo(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!GEO.has(k)) GEO.set(k, new THREE.BoxGeometry(w, h, d));
  return GEO.get(k);
}
// Грани куба в порядке BoxGeometry: +x, −x, +y, −y, +z, −z
export const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const MG = new Map();
export function maskGeo(w, h, d, mask) {
  // тот же куб без граней из маски (общие стенки соседних стёкол и воды); материал у таких кубов один,
  // поэтому лишние грани просто выкидываем из индекса
  if (!mask) return geo(w, h, d);
  const k = `${w}|${h}|${d}|${mask}`;
  if (MG.has(k)) return MG.get(k);
  const b = geo(w, h, d), g = new THREE.BufferGeometry(), src = b.index.array, idx = [];
  for (const n in b.attributes) g.setAttribute(n, b.attributes[n]);
  b.groups.forEach((gr, i) => { if (!((mask >> i) & 1)) for (let j = gr.start; j < gr.start + gr.count; j++) idx.push(src[j]); });
  g.setIndex(idx);
  MG.set(k, g);
  return g;
}
function cullable(mesh, kind, dims) { mesh.userData.cull = kind; mesh.userData.dims = dims; mesh.userData.mask = 0; return mesh; }
const PLANE = new THREE.PlaneGeometry(1, 1);
// Меш куба с материалами граней. Одинаковые материалы склеиваем: грани с одним материалом
// идут одной группой, поэтому «верх-бока-низ» — 3 вызова отрисовки, а сплошной куб — 1, а не 6.
const PK = new Map();
function boxMesh(base, m) {
  if (Array.isArray(m) && m.every(q => q === m[0])) m = m[0];
  if (!Array.isArray(m)) return new THREE.Mesh(base, m);
  const uniq = [...new Set(m)], slot = m.map(q => uniq.indexOf(q)), k = base.uuid + '|' + slot.join('');
  if (!PK.has(k)) {
    const g = new THREE.BufferGeometry(), src = base.index.array, idx = [];
    for (const n in base.attributes) g.setAttribute(n, base.attributes[n]);
    uniq.forEach((_, s) => {
      const start = idx.length;
      for (const gr of base.groups) if (slot[gr.materialIndex] === s) for (let j = gr.start; j < gr.start + gr.count; j++) idx.push(src[j]);
      g.addGroup(start, idx.length - start, s);
    });
    g.setIndex(idx); PK.set(k, g);
  }
  return new THREE.Mesh(PK.get(k), uniq);
}
function bx(w, h, d, x, y, z, m) { const o = boxMesh(geo(w, h, d), m); o.position.set(x, y, z); return o; }
const six = (top, side, bottom = top) => [side, side, top, bottom, side, side];
function cube(top, side = top, bottom = top) { return bx(1, 1, 1, .5, .5, .5, six(mat(top), mat(side), mat(bottom))); }

const ROT = { u: [0, 0, 0], d: [Math.PI, 0, 0], n: [-Math.PI / 2, 0, 0], s: [Math.PI / 2, 0, 0], e: [0, 0, -Math.PI / 2], w: [0, 0, Math.PI / 2] };
const YROT = { n: 0, e: -Math.PI / 2, s: Math.PI, w: Math.PI / 2 };
export const DIRS = { n: [0, 0, -1], s: [0, 0, 1], e: [1, 0, 0], w: [-1, 0, 0], u: [0, 1, 0], d: [0, -1, 0] };

function pivot(child, rx = 0, ry = 0, rz = 0) {
  // поворот вокруг центра клетки
  const outer = new THREE.Group(), inner = new THREE.Group();
  inner.position.set(.5, .5, .5); inner.rotation.set(rx, ry, rz);
  child.position.sub(new THREE.Vector3(.5, .5, .5));
  inner.add(child); outer.add(inner); return outer;
}
function grp(...items) { const g = new THREE.Group(); items.forEach(i => g.add(i)); return g; }
function facingUp(front, back, side) {
  // куб "лицом вверх": верх = front, низ = back, бока = side (верх текстуры смотрит к лицу)
  return bx(1, 1, 1, .5, .5, .5, six(mat(front), mat(side), mat(back)));
}
function oriented(front, back, side, f) { const r = ROT[f || 'u']; return pivot(facingUp(front, back, side), r[0], r[1], r[2]); }
function frontFaced(front, side, top, f) {
  // лицо на север, потом поворот вокруг Y
  const m = bx(1, 1, 1, .5, .5, .5, [mat(side), mat(side), mat(top), mat(top), mat(side), mat(front)]);
  return pivot(m, 0, YROT[f || 'n'], 0);
}
function onWall(obj, side) { return pivot(obj, 0, YROT[side || 'n'], 0); }

/* ---------- форма блоков ---------- */
// Поршень из двух частей: корпус 12/16 и голова 4/16; между ними шток. Выдвигает движок через pistonExt().
let PIST;
function pistonModel(f) {
  if (!PIST) {
    // боковая текстура общая: деревянная полоса сверху — голове, камень — корпусу
    const crop = (h, v0, v1) => {
      const g = new THREE.BoxGeometry(1, h, 1), uv = g.attributes.uv;
      for (const fc of [0, 1, 4, 5]) for (let i = 0; i < 4; i++) { const j = fc * 4 + i; uv.setY(j, v0 + uv.getY(j) * (v1 - v0)); }
      return g;
    };
    PIST = { base: crop(.75, 0, .75), plate: crop(.25, .75, 1), arm: new THREE.BoxGeometry(.25, 1, .25) };
  }
  const side = mat('piston_side'), face = mat('piston_front');
  const base = boxMesh(PIST.base, six(mat('piston_inner'), side, mat('piston_back'))); base.position.set(.5, .375, .5);
  const plate = boxMesh(PIST.plate, six(face, side, face)); plate.position.set(.5, .875, .5);
  const arm = new THREE.Mesh(PIST.arm, mat('piston_arm')); arm.position.set(.5, .75, .5); arm.visible = false;
  const head = grp(plate); head.userData.pistonHead = true; head.userData.arm = arm;
  const r = ROT[f || 'u'];
  return pivot(grp(base, arm, head), r[0], r[1], r[2]);
}
// выдвинуть голову поршня на ext блока (0..1): шток растягивается от корпуса до головы
export function pistonExt(head, ext) {
  const a = head.userData.arm;
  head.position.y = ext;
  a.visible = ext > .01; a.scale.y = Math.max(.01, ext); a.position.y = .75 + ext / 2;
}
function hopper(f) {
  const s = mat('hopper_side'), t = mat('hopper_top');
  const g = grp(
    bx(1, .375, 1, .5, .8125, .5, six(t, s, s)),
    bx(.5, .375, .5, .5, .4375, .5, s),
  );
  if (!f || f === 'd') g.add(bx(.25, .25, .25, .5, .125, .5, s));
  else { const [dx, , dz] = DIRS[f]; g.add(bx(.25, .25, .25, .5 + dx * .375, .375, .5 + dz * .375, s)); }
  return g;
}
function bedModel(f) {
  const side = mat('bed_side');
  const head = bx(1, .5625, 1, .5, .28, .5, [side, side, mat('bed_head'), mat('#6b4f2c'), side, side]);
  const foot = bx(1, .5625, 1, .5, .28, 1.5, [side, side, mat('bed_foot'), mat('#6b4f2c'), side, side]);
  const g = grp(head, foot);
  const outer = new THREE.Group(), inner = new THREE.Group();
  inner.position.set(.5, 0, .5); inner.rotation.y = YROT[f || 'n'];
  g.position.set(-.5, 0, -.5); inner.add(g); outer.add(inner);
  return outer;
}
function dustModel(conn) {
  const g = new THREE.Group();
  const dot = new THREE.Mesh(PLANE, mat('dust')); dot.rotation.x = -Math.PI / 2; dot.position.set(.5, .02, .5); g.add(dot);
  const red = mat('#c41e1e', { glow: true });
  for (const d of conn) {
    const [dx, , dz] = DIRS[d];
    const arm = bx(dx ? .5 : .16, .02, dz ? .5 : .16, .5 + dx * .25, .015, .5 + dz * .25, red);
    g.add(arm);
  }
  if (!conn.length) g.add(bx(.16, .02, .16, .5, .015, .5, red));
  return g;
}
function fluid(kind, p) {
  const h = p.src || kind === 'lava' ? .875 : .72;
  const m = kind === 'lava'
    ? mat('lava', { glow: true })
    : mat('water', { transparent: true, opacity: .62, depthWrite: false });
  const box = bx(1, h, 1, .5, h / 2, .5, [m, m, m, m, m, m]);
  if (kind === 'water') cullable(box, 'water', [1, h, 1]);
  const g = grp(box);
  if (kind === 'water' && (p.src || p.flow)) {
    const ov = new THREE.Mesh(PLANE, mat(p.src ? 'src_ring' : 'flow_arrow', { transparent: true, depthWrite: false }));
    ov.rotation.x = -Math.PI / 2;
    if (!p.src) {
      const ang = { n: 0, w: Math.PI / 2, s: Math.PI, e: -Math.PI / 2, ne: -Math.PI / 4, nw: Math.PI / 4, se: -3 * Math.PI / 4, sw: 3 * Math.PI / 4 }[p.flow] ?? 0;
      ov.rotation.z = ang;
    }
    ov.position.set(.5, h + .006, .5); ov.renderOrder = 3;
    g.add(ov);
  }
  return g;
}
function bambooModel(top) {
  const ox = .5, oz = .5;
  const g = grp(bx(.1875, 1, .1875, ox, .5, oz, mat('bamboo')));
  if (top) {
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const l = new THREE.Mesh(PLANE, mat('bamboo_leaves')); l.scale.set(1, .7, 1); l.rotation.y = a; l.position.set(ox, .72, oz); g.add(l);
    }
  }
  return g;
}
function shootModel() {
  const g = new THREE.Group();
  for (const a of [Math.PI / 4, -Math.PI / 4]) { const l = new THREE.Mesh(PLANE, mat('shoot')); l.scale.set(.7, .7, 1); l.rotation.y = a; l.position.set(.5, .35, .5); g.add(l); }
  return g;
}
function signModel(side) {
  const w = mat('planks');
  return onWall(grp(bx(.875, .5, .0833, .5, .55, .042, w)), side);
}
function torchModel(side) {
  const stick = mat('#7a5a33'), flame = mat('#ffd35a', { glow: true });
  if (!side) return grp(bx(.125, .6, .125, .5, .3, .5, stick), bx(.14, .14, .14, .5, .66, .5, flame));
  const t = grp(bx(.125, .6, .125, 0, .3, 0, stick), bx(.14, .14, .14, 0, .66, 0, flame));
  t.rotation.x = .38; t.position.set(.5, .2, .1);
  return onWall(grp(t), side);
}
function ladderModel(side) {
  const p = new THREE.Mesh(PLANE, mat('ladder')); p.position.set(.5, .5, .03);
  return onWall(grp(p), side);
}
function doorModel(side) {
  const m = mat('iron_door');
  const d = bx(1, 2, .1875, .5, 1, .094, [mat('#9a9a9a'), mat('#9a9a9a'), mat('#9a9a9a'), mat('#9a9a9a'), m, m]);
  return onWall(grp(d), side);
}
function leverModel(side) {
  const base = bx(.375, .5, .1875, .5, .5, .094, mat('cobble'));
  const h = bx(.1, .5, .1, 0, .22, 0, mat('#7a5a33')); h.rotation.x = .6;
  const hg = grp(h); hg.position.set(.5, .5, .19);
  return onWall(grp(base, hg), side);
}
function railModel(axis) {
  const p = new THREE.Mesh(PLANE, mat('rail')); p.rotation.x = -Math.PI / 2; p.position.set(.5, .012, .5);
  if (axis === 'x') p.rotation.z = Math.PI / 2;
  return grp(p);
}
function chestModel(f) {
  const s = mat('chest_side'), t = mat('chest_top');
  const m = bx(.875, .875, .875, .5, .4375, .5, [s, s, t, t, s, mat('chest_front')]);
  return pivot(m, 0, YROT[f || 'n'], 0);
}
function markerModel(color) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .28, depthWrite: false });
  return grp(bx(.96, .96, .96, .5, .5, .5, m));
}

/* ---------- реестр блоков ---------- */
// n — имя по-русски, cat — раздел в списке материалов
export const BLOCKS = {
  stone: { n: 'Камень', cat: 'b', build: () => cube('stone') },
  cobble: { n: 'Булыжник (или любой блок)', cat: 'b', build: () => cube('cobble') },
  dirt: { n: 'Земля', cat: 'b', build: () => cube('dirt') },
  grass: { n: 'Дёрн', cat: 'b', build: () => cube('grass_top', 'grass_side', 'dirt') },
  mud: { n: 'Грязь (земля + бутылка воды)', cat: 'b', build: () => cube('mud') },
  planks: { n: 'Доски', cat: 'b', build: () => cube('planks') },
  glass: { n: 'Стекло', cat: 'b', build: () => cullable(cube('glass'), 'glass', [1, 1, 1]) },
  hopper: { n: 'Воронка', cat: 'm', build: e => hopper(e.p.f) },
  chest: { n: 'Сундук', cat: 'm', build: e => chestModel(e.p.f) },
  barrel: { n: 'Бочка', cat: 'm', build: () => cube('barrel_top', 'barrel_side') },
  composter: { n: 'Компостер', cat: 'm', build: () => bx(1, 1, 1, .5, .5, .5, six(mat('composter_top'), mat('composter_side'), mat('composter_side'))) },
  lectern: { n: 'Кафедра', cat: 'm', build: () => bx(1, .9, 1, .5, .45, .5, six(mat('lectern_top'), mat('lectern_side'), mat('lectern_side'))) },
  blast_furnace: { n: 'Плавильная печь', cat: 'm', build: e => frontFaced('blast_front', 'blast_side', 'blast_top', e.p.f) },
  bed: { n: 'Кровать', cat: 'm', cells: e => [[0, 0, 0], footOff(e.p.f)], build: e => bedModel(e.p.f) },
  piston: { n: 'Поршень', cat: 'r', build: e => pistonModel(e.p.f) },
  observer: { n: 'Наблюдатель', cat: 'r', build: e => oriented('observer_front', 'observer_back', 'observer_side', e.p.f) },
  dust: { n: 'Редстоун', cat: 'r', build: (e, w) => dustModel(w.dustConn(e)) },
  lever: { n: 'Рычаг', cat: 'r', build: e => leverModel(e.p.side) },
  iron_door: { n: 'Железная дверь', cat: 'm', cells: () => [[0, 0, 0], [0, 1, 0]], build: e => doorModel(e.p.side) },
  water: { n: 'Вода: клетки-источники (с кружком)', cat: 'f', build: e => fluid('water', e.p), count: e => (e.p.src ? 1 : 0) },
  lava: { n: 'Ведро лавы', cat: 'f', build: e => fluid('lava', e.p) },
  bamboo: { n: 'Бамбук', cat: 'b', build: (e, w) => bambooModel(!w.isType(e.x, e.y + 1, e.z, 'bamboo')) },
  bamboo_shoot: { n: 'Бамбук (посадить)', cat: 'b', build: () => shootModel() },
  sign: { n: 'Табличка', cat: 'm', build: e => signModel(e.p.side) },
  torch: { n: 'Факел', cat: 'm', build: e => torchModel(e.p.side) },
  ladder: { n: 'Лестница', cat: 'm', build: e => ladderModel(e.p.side) },
  rail: { n: 'Рельсы', cat: 'm', build: e => railModel(e.p.axis) },
  iron_bars: { n: 'Железная решётка', cat: 'b', build: () => cube('iron_bars') },
  mark: { n: 'Метка', cat: 'x', build: e => markerModel(e.p.c || '#ff4d3d') },
  air: { n: 'Пусто', cat: 'x' },
};
function footOff(f) { const d = DIRS[f || 'n']; return [-d[0], 0, -d[2]]; }

/* ---------- мобы и предметы ---------- */
function body(parts) {
  const g = new THREE.Group();
  for (const [w, h, d, x, y, z, c, rx] of parts) { const m = bx(w, h, d, x, y, z, mat(c)); if (rx) m.rotation.x = rx; g.add(m); }
  return g;
}
// Мобы — свои воксельные фигурки (не игровые): фишка-житель, фишка-зомби, башня-голем.
// Текстуры тайлятся по размеру грани: 16 пикселей на блок, как у блоков, поэтому без «мыла».
const TGEO = new Map();
function tgeo(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (TGEO.has(k)) return TGEO.get(k);
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const sz = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const j = f * 4 + i; uv.setXY(j, uv.getX(j) * sz[f][0], uv.getY(j) * sz[f][1]); }
  TGEO.set(k, g);
  return g;
}
const tb = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(tgeo(w, h, d), m); o.position.set(x, y, z); return o; };
function ball(s, m) {
  // «скруглённый» воксельный куб: три бруска крестом (чуть разной толщины, чтобы грани не мерцали)
  const c = s * .72;
  return grp(tb(s, c, c, 0, 0, 0, m), tb(c - .004, s, c - .004, 0, 0, 0, m), tb(c - .008, c - .008, s, 0, 0, 0, m));
}
function token(kind) {
  const sick = kind !== 'villager';
  const body = mat(kind === 'zombie' ? 'tok_rags' : 'tok_cloth'), rim = mat(kind === 'zombie' ? 'tok_dark' : 'tok_wood');
  const g = grp(
    tb(.62, .12, .62, 0, .06, 0, rim), tb(.52, .08, .52, 0, .16, 0, rim),
    tb(.48, .5, .48, 0, .45, 0, body), tb(.42, .46, .42, 0, .93, 0, body),
    tb(.3, .1, .3, 0, 1.21, 0, body), tb(.5, .08, .5, 0, 1.3, 0, rim),
  );
  const hm = mat(sick ? 'tok_rot_head' : 'tok_ivory'), hd = ball(.5, hm);
  hd.add(tb(.18, .1, .18, 0, .29, 0, hm));
  const eye = sick ? mat('#ff5a3c', { glow: true }) : mat('#2b2b2b');
  for (const x of [-.1, .1]) hd.add(tb(.07, .07, .02, x, .03, -.257, eye));
  hd.position.y = 1.59;
  if (sick) hd.rotation.set(.08, 0, kind === 'zombie' ? .24 : .15);
  g.add(hd);
  if (kind !== 'zombie') g.add(tb(.14, .14, .02, 0, .96, -.22, mat('tok_gem')));
  if (sick) {
    // руки вытянуты вперёд — главный признак зомби, у фишки жителя их нет
    const skin = mat('tok_rot_head'), sleeve = kind === 'zombie' ? body : mat('tok_cloth');
    for (const x of [-.29, .29]) {
      g.add(tb(.15, .15, .2, x, 1.1, -.12, sleeve));
      g.add(tb(.13, .13, .3, x, 1.1, -.37, skin));
    }
  }
  return g;
}
function tower() {
  const iron = mat('tok_iron'), dark = mat('tok_dark');
  const g = grp(
    tb(1.2, .14, 1.2, 0, .07, 0, dark), tb(1.06, .1, 1.06, 0, .19, 0, dark),
    tb(.96, 1.7, .96, 0, 1.09, 0, iron), tb(1.02, .14, 1.02, 0, 1.0, 0, dark),
    tb(1.08, .5, 1.08, 0, 2.19, 0, iron),
  );
  for (const x of [-.42, 0, .42]) for (const z of [-.42, 0, .42]) if (x || z) g.add(tb(.24, .26, .24, x, 2.57, z, iron));
  g.add(tb(.6, .09, .02, 0, 2.21, -.545, mat('#ffb347', { glow: true })));
  return g;
}
function boat() {
  const w = mat('#a5814d'), d = mat('#7a5b34');
  return grp(
    bx(1.375, .12, 1.25, 0, .06, 0, d),
    bx(1.375, .38, .12, 0, .3, -.565, w), bx(1.375, .38, .12, 0, .3, .565, w),
    bx(.12, .38, 1.25, -.63, .3, 0, w), bx(.12, .38, 1.25, .63, .3, 0, w),
    bx(.18, .05, 1.0, .3, .5, 0, d),
  );
}
function minecart() {
  const m = mat('#6f7478'), k = mat('#4a4f53');
  return grp(bx(.98, .1, .9, 0, .12, 0, k), bx(.98, .5, .08, 0, .4, -.41, m), bx(.98, .5, .08, 0, .4, .41, m), bx(.08, .5, .9, -.45, .4, 0, m), bx(.08, .5, .9, .45, .4, 0, m));
}
const ITEM = c => () => body([[.32, .08, .16, 0, .04, 0, c]]);
export function label(text, color = '#ffd36b') {
  const cv = document.createElement('canvas'); const g = cv.getContext('2d');
  const fs = 48, F = `400 ${fs}px Tiny5, "Golos Text", system-ui, sans-serif`; g.font = F;
  const w = Math.ceil(g.measureText(text).width) + 36; cv.width = w; cv.height = fs + 24;
  g.font = F;
  g.fillStyle = 'rgba(18,22,26,0.86)'; const r = 14;
  g.beginPath(); g.roundRect(0, 0, w, cv.height, r); g.fill();
  g.strokeStyle = color; g.lineWidth = 4; g.beginPath(); g.roundRect(2, 2, w - 4, cv.height - 4, r - 2); g.stroke();
  g.fillStyle = '#f3efe4'; g.textBaseline = 'middle'; g.fillText(text, 18, cv.height / 2 + 2);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  const k = .04; s.scale.set(k * w / cv.height, k, 1); s.renderOrder = 10;
  s.userData.baseScale = s.scale.clone();
  return s;
}

export const ENTS = {
  villager: { n: 'Житель', build: () => token('villager') },
  zvillager: { n: 'Зомби-житель', build: () => token('zvillager') },
  zombie: { n: 'Зомби', build: () => token('zombie') },
  golem: { n: 'Железный голем', build: () => tower() },
  boat: { n: 'Лодка', item: true, build: () => boat() },
  minecart: { n: 'Вагонетка', item: true, build: () => minecart() },
  iron: { n: 'Железный слиток', build: ITEM('#dedede') },
  bamboo_item: { n: 'Бамбук', build: () => body([[.1, .45, .1, 0, .22, 0, '#6a9c30']]) },
  potion: { n: 'Взрывное зелье слабости', build: () => body([[.22, .26, .22, 0, .13, 0, '#5a5f6e'], [.09, .1, .09, 0, .31, 0, '#c9d2da']]) },
  gapple: { n: 'Золотое яблоко', build: () => body([[.28, .26, .28, 0, .13, 0, '#f0c53d'], [.04, .1, .04, 0, .3, 0, '#6b4a2b']]) },
};
