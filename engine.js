// 3D-просмотрщик построек: шаги, анимация появления блоков, грунт, срез по слоям, демо.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BLOCKS, ENTS, DIRS, FACES, mat, tex, maskGeo, label, setAniso, pistonExt } from './blocks.js';

const K = (x, y, z) => `${x},${y},${z}`;
const waterH = e => (e.p.src ? .875 : .72);
const TINT = new THREE.Color();
const M4 = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
// Углы граней клетки (против часовой снаружи) и их UV: +x, −x, +y, −y, +z, −z
const QUAD = [
  [[1, 0, 1, 0, 0], [1, 0, 0, 1, 0], [1, 1, 0, 1, 1], [1, 1, 1, 0, 1]],
  [[0, 0, 0, 0, 0], [0, 0, 1, 1, 0], [0, 1, 1, 1, 1], [0, 1, 0, 0, 1]],
  [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [1, 1, 0, 1, 1], [0, 1, 0, 0, 1]],
  [[0, 0, 0, 0, 0], [1, 0, 0, 1, 0], [1, 0, 1, 1, 1], [0, 0, 1, 0, 1]],
  [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [1, 1, 1, 1, 1], [0, 1, 1, 0, 1]],
  [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [0, 1, 0, 1, 1], [1, 1, 0, 0, 1]],
];
// «Уменьшить движение» читаем каждый раз: настройку могут поменять, не перезагружая страницу
const RM = matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => RM.matches;

export function expandPut(e) {
  const t = e[0];
  const nums = e.slice(1);
  let p = {};
  if (nums.length && typeof nums[nums.length - 1] === 'object') p = nums.pop();
  if (!BLOCKS[t]) throw new Error('Неизвестный блок: ' + t);
  if (nums.length === 3) return [{ t, x: nums[0], y: nums[1], z: nums[2], p }];
  if (nums.length === 6) {
    const [a, b, c, d, f, g] = nums, out = [];
    for (let x = Math.min(a, d); x <= Math.max(a, d); x++)
      for (let y = Math.min(b, f); y <= Math.max(b, f); y++)
        for (let z = Math.min(c, g); z <= Math.max(c, g); z++) out.push({ t, x, y, z, p });
    return out;
  }
  throw new Error('Плохая запись блока: ' + JSON.stringify(e));
}
export function boxCells(b) {
  const [a, c, d, e, f, g] = b.length === 3 ? [...b, ...b] : b, out = [];
  for (let x = Math.min(a, e); x <= Math.max(a, e); x++)
    for (let y = Math.min(c, f); y <= Math.max(c, f); y++)
      for (let z = Math.min(d, g); z <= Math.max(d, g); z++) out.push([x, y, z]);
  return out;
}
function cellsOf(en) {
  const def = BLOCKS[en.t];
  const rel = def.cells ? def.cells(en) : [[0, 0, 0]];
  return rel.map(([dx, dy, dz]) => [en.x + dx, en.y + dy, en.z + dz]);
}

/* ---------- кривые анимаций ---------- */
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const outCubic = t => 1 - (1 - t) ** 3;
const inOutCubic = t => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const outBack = (t, s = 1.7) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
const smooth = t => t * t * (3 - 2 * t);
// затухающая пружина: 1 в момент удара, к концу ~0
const wobble = (b, k = 4.5, f = 2.5) => Math.exp(-k * b) * Math.cos(b * Math.PI * f);

// как блок появляется: плоское и мелкое выпрыгивает, жидкость наливается, остальное падает сверху
const POP = new Set(['torch', 'sign', 'ladder', 'dust', 'lever', 'rail', 'powered_rail', 'sugar_cane', 'bamboo_shoot', 'melon_stem', 'pumpkin_stem', 'birch_sapling', 'button', 'repeater', 'comparator', 'rtorch', 'mark', 'iron_door']);
const FILL = new Set(['water', 'lava']);
const DUR = { drop: .5, pop: .38, fill: .55, out: .3, entIn: .75, entOut: .35 };
const LAND = { drop: .5, pop: .45, fill: .6, entIn: .42 }; // доля времени, когда «приземлился»: пыль и рамка
const LEAVE = new Set(['out', 'entOut']);
// Пыль соединяется с пылью рядом, ступенькой вверх (если над собой пусто) и вниз (если над нижней пусто) —
// поэтому под цельным блоком провод проходит, не касаясь провода сверху («мостик»).
const SOFT = new Set(['dust', 'air', 'lever', 'button', 'rtorch', 'torch', 'repeater', 'comparator', 'water', 'lava', 'rail', 'powered_rail', 'sign', 'ladder', 'mark', 'sugar_cane', 'bamboo_shoot', 'melon_stem', 'pumpkin_stem', 'birch_sapling']);
const solidAt = (fa, x, y, z) => { const e = fa.get(K(x, y, z)); return !!e && !SOFT.has(e.t); };
function dustStep(fa, x, y, z, dx, dz) {
  if (fa.get(K(x + dx, y, z + dz))?.t === 'dust') return [x + dx, y, z + dz];
  if (solidAt(fa, x + dx, y, z + dz) && !solidAt(fa, x, y + 1, z) && fa.get(K(x + dx, y + 1, z + dz))?.t === 'dust') return [x + dx, y + 1, z + dz];
  if (!solidAt(fa, x + dx, y, z + dz) && fa.get(K(x + dx, y - 1, z + dz))?.t === 'dust') return [x + dx, y - 1, z + dz];
  return null;
}
const kindOf = en => (FILL.has(en.t) ? 'fill' : POP.has(en.t) ? 'pop' : 'drop');

// Трещины при копании: 6 стадий, рисуем сами пиксельными ломаными из центра (не игровая текстура)
const CRACK_T = .42; // сколько секунд блок трескается до того, как лопнуть
function crackMats() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const px = [], seen = new Set();
  const put = (x, y) => { const k = x + ',' + y; if (x < 0 || y < 0 || x > 15 || y > 15 || seen.has(k)) return; seen.add(k); px.push([x, y]); };
  // несколько веток от центра, каждая петляет к краю
  const arms = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1]];
  const heads = arms.map(d => ({ x: 7 + (d[0] > 0), y: 7 + (d[1] > 0), d }));
  for (let step = 0; step < 9; step++) for (const h of heads) {
    put(h.x, h.y);
    if (rnd() < .4) h.x += rnd() < .5 ? 1 : -1; else h.x += h.d[0] || (rnd() < .5 ? 1 : -1) * (rnd() < .3);
    if (rnd() < .4) h.y += rnd() < .5 ? 1 : -1; else h.y += h.d[1] || (rnd() < .5 ? 1 : -1) * (rnd() < .3);
  }
  const geo = new THREE.BoxGeometry(1.012, 1.012, 1.012);
  const mats = [];
  for (let s = 1; s <= 6; s++) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const g = cv.getContext('2d');
    px.slice(0, Math.round(px.length * s / 6)).forEach(([x, y], i) => {
      g.fillStyle = i % 5 === 0 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.62)';
      g.fillRect(x, y, 1, 1);
    });
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    mats.push(new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  }
  return { geo, mats };
}
// материалы грунта: у дёрна верх травяной, низ земляной; в «прозрачном» режиме они полупрозрачные
const GLASS_GROUND = { transparent: true, opacity: .5, depthWrite: false };
function groundMats(kind, glass) {
  const o = glass ? GLASS_GROUND : {};
  if (kind !== 'grass') return mat(kind, o);
  const s = mat('grass_side', o);
  return [s, s, mat('grass_top', o), mat('dirt', o), s, s];
}

export class Viewer {
  constructor(host, cb = {}) {
    this.host = host; this.cb = cb;
    // на экранах с плотными пикселями сглаживание почти незаметно, а стоит дорого
    const hiDpi = (devicePixelRatio || 1) >= 2, coarse = matchMedia('(pointer: coarse)').matches;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: !hiDpi, alpha: true, powerPreference: 'high-performance' });
    // чёткость подстраивается под телефон: если кадры не успевают, движок сам снизит её (см. adapt)
    this.dprMax = this.dpr = Math.min(devicePixelRatio || 1, 2); this.slow = 0;
    r.setPixelRatio(this.dpr);
    setAniso(coarse ? Math.min(4, r.capabilities.getMaxAnisotropy()) : r.capabilities.getMaxAnisotropy());
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(r.domElement);
    r.domElement.setAttribute('aria-label', '3D-схема постройки: тяни, чтобы вращать, колесо — приблизить');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = .09; c.screenSpacePanning = true; c.maxPolarAngle = Math.PI * .96;
    // тянешь сцену — перелёт камеры уступает руке
    c.addEventListener('start', () => { c.autoRotate = false; this.userMoved = true; this.tween = null; });
    c.addEventListener('change', () => { this.dirty = true; });
    // ламп нет: каждая грань затеняется по своему направлению (см. shadeHook в blocks.js)
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.blockRoot = new THREE.Group(); this.entRoot = new THREE.Group(); this.fxRoot = new THREE.Group(); this.actorRoot = new THREE.Group();
    this.root.add(this.blockRoot, this.entRoot, this.fxRoot, this.actorRoot);
    this.groundRoot = new THREE.Group(); this.root.add(this.groundRoot);
    this.edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.hlMat = new THREE.LineBasicMaterial({ color: 0xffc94d, transparent: true, opacity: .95 });
    this.digMat = new THREE.LineBasicMaterial({ color: 0xff6a4d, transparent: true, opacity: .9 });
    this.digCellMat = new THREE.LineBasicMaterial({ color: 0xff8a6a, transparent: true, opacity: .55 });
    this.digFill = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: .16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.boxMat = new THREE.LineBasicMaterial({ color: 0xcdbf9f, transparent: true, opacity: .22, depthWrite: false });
    // кольцо под новым мобом или лодкой — та же золотая «новинка», что рамки у блоков
    this.ringGeo = new THREE.RingGeometry(.4, .5, 28); this.ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide });
    this.pGeo = new THREE.BoxGeometry(.15, .15, .15);
    this.digGeo = new THREE.BoxGeometry(1, 1, 1);
    this.crack = crackMats();
    this.dustMat = new THREE.MeshBasicMaterial({ color: 0xd9d2c3, transparent: true, opacity: .55, depthWrite: false });
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .7, depthWrite: false });
    this.digRoot = new THREE.Group(); this.root.add(this.digRoot);
    this.anims = []; this.parts = []; this.pool = []; this.hlAnims = []; this.pending = new Set(); this.digs = [];
    // своё время анимаций: идёт, только пока сцену рисуют (вкладка шпаргалок, скрытый браузер — пауза)
    this.at = 0; this.demoT0 = 0;
    this.animEnd = 0; this.dirty = true; this.isOn = true; this.onScreen = true; this.lastDraw = 0;
    this.opt = { ground: 'glass', highlight: true, onlyNew: false, demo: true, cut: null, layer: false, solo: false };
    // «по слоям»: всё ниже текущего слоя — бледный призрак одним общим материалом (без лишних шейдеров)
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0xa9bcc6, transparent: true, opacity: .13, depthWrite: false });
    this.gridMat = new THREE.LineBasicMaterial({ color: 0xffc94d, transparent: true, opacity: .28, depthWrite: false });
    this.clock = new THREE.Clock();
    this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2(); this.lastPick = 0;
    r.domElement.addEventListener('pointermove', e => this.onMove(e));
    r.domElement.addEventListener('pointerleave', () => cb.onHover && cb.onHover(null));
    r.domElement.addEventListener('pointerdown', e => { this.down = [e.clientX, e.clientY]; });
    r.domElement.addEventListener('click', e => { if (this.down && Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) < 6) this.onClick(e); });
    new ResizeObserver(() => this.resize()).observe(host);
    // сцена ушла за край экрана (на телефоне прокрутили к шагам) — не рисуем
    if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { this.onScreen = en.isIntersecting; if (this.onScreen) this.dirty = true; }).observe(host);
    this.resize();
    this.warmFx();
    this.loop = () => this.frame();
    r.setAnimationLoop(this.loop);
  }
  // 3D скрыт (вкладка шпаргалок) — не рисуем вообще
  setActive(on) {
    if (this.isOn === on) return;
    this.isOn = on;
    this.renderer.setAnimationLoop(on ? this.loop : null);
    if (on) { this.dirty = true; this.lastT = undefined; }
  }
  halfFov() {
    // узкий портретный экран: вписываем по горизонтали, а не по вертикали
    const v = THREE.MathUtils.degToRad(this.camera.fov / 2);
    return Math.min(v, Math.atan(Math.tan(v) * this.camera.aspect));
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    if (w === this.w && h === this.h && this.dpr === this.sizedDpr) return;
    this.w = w; this.h = h; this.sizedDpr = this.dpr;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.dirty = true;
  }
  // шейдеры эффектов собираем заранее: иначе первый удар киркой или первая пыль дают рывок
  warmFx() {
    const g = new THREE.Group();
    for (const m of [...this.crack.mats, this.dustMat, this.flashMat, this.ringMat, this.digFill]) g.add(new THREE.Mesh(this.pGeo, m));
    for (const k of ['grass', 'dirt', 'stone']) for (const glass of [false, true]) {
      g.add(new THREE.Mesh(this.digGeo, groundMats(k, glass)));
      g.add(new THREE.InstancedMesh(this.digGeo, groundMats(k, glass), 1));
    }
    for (const m of [this.hlMat, this.digMat, this.digCellMat, this.boxMat]) g.add(new THREE.LineSegments(this.edgeGeo, m));
    this.scene.add(g); this.renderer.compile(this.scene, this.camera); this.scene.remove(g);
  }

  /* ---------- загрузка фермы ---------- */
  setFarm(farm) {
    this.disposeActors();
    this.clearDig();
    for (const g of [this.blockRoot, this.entRoot, this.fxRoot, this.actorRoot, this.digRoot]) g.clear();
    this.dropGroundCache();
    // состояние прошлой фермы не должно дожить до новой (иначе buildHighlights читает шаг 0)
    this.anims = []; this.hlAnims = []; this.pending = new Set(); this.tween = null; this.active = null; this.seq = null; this.sub = null;
    this.cutReset = false; this.cutAuto = false; this.animEnd = 0; this.demoT0 = this.at;
    if (this.cur) this.cur.visible = false;
    this.farm = farm; this.meshes = new Map(); this.entMeshes = new Map(); this.actors = null; this.pistons = []; this.powerCells = null; this.litCells = null;
    this.entries = []; this.hist = new Map(); this.dig = new Map(); this.ents = [];
    farm.steps.forEach((s, i) => {
      const step = i + 1;
      for (const b of s.dig || []) for (const [x, y, z] of boxCells(b)) { const k = K(x, y, z); if (!this.dig.has(k)) this.dig.set(k, step); }
      for (const p of s.put || []) for (const en of expandPut(p)) {
        en.step = step; en.id = this.entries.length; en.cells = cellsOf(en); this.entries.push(en);
        for (const [x, y, z] of en.cells) { const k = K(x, y, z); if (!this.hist.has(k)) this.hist.set(k, []); this.hist.get(k).push(en.id); }
      }
      for (const e of s.ents || []) this.ents.push({ ...e, step, id: e.id || ('e' + this.ents.length) });
    });
    // итоговое состояние — для связей пыли и макушек бамбука
    this.finalAt = new Map();
    for (const [k, ids] of this.hist) { const top = this.entries[ids[ids.length - 1]]; if (top.t !== 'air') this.finalAt.set(k, top); }
    this.N = farm.steps.length;
    this.k = 0;
    this.prepGround();
    // все модели строим сразу и прогреваем шейдеры: потом шаги листаются без рывков
    for (const en of this.entries) if (en.t !== 'air') this.meshFor(en).visible = false;
    for (const e of this.ents) this.entFor(e).visible = false;
    if (farm.demo) { this.buildActors(); this.actors.forEach(x => (x.obj.visible = false)); }
    this.renderer.compile(this.scene, this.camera);
    this.fit();
    this.dirty = true;
  }
  disposeActors() {
    for (const { mats } of this.actors || []) for (const m of mats) { if (m.isSpriteMaterial && m.map) m.map.dispose(); m.dispose(); }
    this.actors = null;
  }
  groundFate(x, y, z) {
    // когда природный блок исчезает: копаешь или ставишь на его место блок
    const key = K(x, y, z), d = this.dig.get(key), ids = this.hist.get(key), p = ids ? this.entries[ids[0]].step : undefined;
    if (d === undefined && p === undefined) return null;
    return d !== undefined && (p === undefined || d <= p) ? { step: d, dig: true } : { step: p, dig: false };
  }
  world() {
    const fa = this.finalAt;
    return {
      isType: (x, y, z, t) => fa.get(K(x, y, z))?.t === t,
      at: (x, y, z) => fa.get(K(x, y, z)),
      // где провод забирается на соседний блок — по его стенке рисуется полоска вверх
      dustUp: e => ['n', 's', 'e', 'w'].filter(d => { const [dx, , dz] = DIRS[d], c = dustStep(fa, e.x, e.y, e.z, dx, dz); return c && c[1] === e.y + 1; }),
      dustConn: e => ['n', 's', 'e', 'w'].filter(d => {
        const [dx, , dz] = DIRS[d]; const nb = fa.get(K(e.x + dx, e.y, e.z + dz));
        if (dustStep(fa, e.x, e.y, e.z, dx, dz)) return true; // соседняя пыль: рядом, ступенькой вверх или вниз
        if (!nb) return false;
        if (nb.t === 'comparator') return true; // к компаратору пыль липнет с любой стороны
        if (nb.t === 'observer') { const [fx, , fz] = DIRS[nb.p.f || 'u']; return fx === dx && fz === dz; }
        if (nb.t === 'lever' || nb.t === 'button' || nb.t === 'rtorch') return true;
        if (nb.t === 'repeater') { const [fx, , fz] = DIRS[nb.p.f || 'n']; return (fx !== 0 && dx !== 0) || (fz !== 0 && dz !== 0); } // только с концов, по оси повторителя
        return false;
      }),
    };
  }
  activeAt(k) {
    // для каждой клетки — последняя запись с шагом <= k
    const act = new Set();
    for (const ids of this.hist.values()) {
      let cur = null;
      for (const id of ids) if (this.entries[id].step <= k) cur = id;
      if (cur !== null && this.entries[cur].t !== 'air') act.add(cur);
    }
    return act;
  }
  meshFor(en) {
    if (this.meshes.has(en.id)) return this.meshes.get(en.id);
    // модель строится в клетке 0..1, обёртка ставит её в нужный угол сетки
    const obj = new THREE.Group();
    obj.add(BLOCKS[en.t].build(en, this.world()));
    obj.position.set(en.x, en.y, en.z);
    obj.userData = { en, base: obj.position.clone() };
    obj.traverse(o => { o.userData.en = en; if (o.userData.cull) obj.userData.cm = o; if (o.userData.pistonHead) obj.userData.head = o; if (o.userData.setLit) { obj.userData.setLit = o.userData.setLit; obj.userData.setLitT = o.userData.setLitT; obj.userData.litDef = o.userData.litDef; } });
    if (obj.userData.head) this.pistons.push(obj);
    if (en.t === 'dust') {
      // у каждой клетки пыли свои материалы: демо зажигает её по силе сигнала
      const dm = [];
      obj.traverse(o => { if (!o.material) return; const c = o.material.clone(); c.onBeforeCompile = o.material.onBeforeCompile; c.userData.c0 = c.color.clone(); o.material = c; dm.push(c); });
      obj.userData.dm = dm;
    }
    this.blockRoot.add(obj); this.meshes.set(en.id, obj);
    return obj;
  }
  entFor(e) {
    if (this.entMeshes.has(e.id)) return this.entMeshes.get(e.id);
    const obj = ENTS[e.e].build(e.o || {});
    obj.position.set(e.x, e.y, e.z); obj.rotation.y = e.yaw || 0;
    obj.traverse(o => { o.userData.ent = e; });
    // у моба точка опоры — середина низа, у блока — угол клетки
    // радиус кольца «новое» — по габаритам: у лодки оно шире, чем у фишки жителя
    const sz = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    Object.assign(obj.userData, { ent: e, isEnt: true, base: obj.position.clone(), yaw: e.yaw || 0, rad: Math.max(sz.x, sz.z) / 2 + .12 });
    this.entRoot.add(obj); this.entMeshes.set(e.id, obj);
    return obj;
  }
  entOn(e, k) { return e.step <= k && (!e.until || k < e.until); }

  /* ---------- шаги ---------- */
  goto(k, { animate = true, replay = false } = {}) {
    k = Math.max(1, Math.min(this.N, k));
    this.paused = false;
    // тот же шаг (стрелка у края, клик по блоку этого шага) — ничего не перестраиваем
    if (k === this.k && !replay && this.active) { this.cb.onStep && this.cb.onStep(k); return; }
    const prev = this.k; this.k = k;
    const reduced = RM.matches;
    this.fitCut(k);
    this.finishAnims();
    this.active = this.activeAt(k);
    const fwd = animate && !reduced && (k === prev + 1 || replay);
    // шаг назад: то, что поставили в отменённом шаге, разлетается, а не исчезает молча
    const back = !reduced && k === prev - 1;
    const fresh = [], leaving = [], entsIn = [], entsOut = [];
    for (const en of this.entries) {
      if (en.t === 'air') continue;
      const m = this.meshFor(en), was = m.visible;
      this.poseReset(m); m.userData.demoHidden = false;
      if (!this.active.has(en.id)) { m.visible = false; if (back && was) leaving.push(m); continue; }
      m.visible = true;
      if (fwd && en.step === k) fresh.push(m);
    }
    for (const e of this.ents) {
      const m = this.entFor(e), was = m.visible, on = this.entOn(e, k);
      this.poseReset(m);
      if (on && fwd && e.step === k) entsIn.push(m);
      // лодку ломают, моба уводят: шаг, где он пропадает, и шаг назад — с анимацией
      else if (!on && was && (back || (fwd && e.until === k))) entsOut.push(m);
    }
    this.anims = []; this.sub = null; this.pending = new Set();
    this.clearDig();
    this.buildGround();
    // сначала по одному ломаются блоки грунта, потом по одному появляются новые, потом прибегают мобы
    const now = this.at;
    const digEnd = fwd ? this.startDig(k, now + (replay ? .15 : .35)) : 0;
    let end = digEnd;
    if (fresh.length) {
      // волна: блоки одного слоя и одной диагонали падают почти вместе, снизу вверх
      const key = m => m.userData.en.y * 100 + m.userData.en.x + m.userData.en.z;
      fresh.sort((a, b) => key(a) - key(b));
      const gap = Math.min(.08, 1.6 / fresh.length), t0 = digEnd ? digEnd + .1 : now + .05;
      // пыль при установке: у больших шагов не у каждого блока, чтобы не рябило
      const every = Math.max(1, Math.ceil(fresh.length / 18));
      fresh.forEach((m, i) => { const kind = kindOf(m.userData.en); this.addAnim(m, kind, t0 + i * gap, { dust: kind === 'drop' && i % every === 0 }); });
      end = t0 + (fresh.length - 1) * gap + DUR.fill;
    }
    if (entsIn.length) {
      const t0 = fresh.length ? end - .2 : digEnd ? digEnd + .1 : now + .1;
      entsIn.forEach((m, i) => this.addAnim(m, 'entIn', t0 + i * .2, { dust: true }));
      end = t0 + (entsIn.length - 1) * .2 + DUR.entIn;
    }
    this.animEnd = end;
    // демо последнего шага начинается с начала цикла и только когда постройка встала
    this.demoT0 = Math.max(now, end) + (fwd ? .35 : 0);
    this.refreshVisibility();
    // уходящие блоки и мобы: сверху вниз, быстро, параллельно с камерой
    leaving.sort((a, b) => b.userData.en.y - a.userData.en.y);
    const lg = Math.min(.03, .5 / Math.max(1, leaving.length));
    leaving.forEach((m, i) => { m.visible = true; this.addAnim(m, 'out', now + i * lg); });
    entsOut.forEach(m => { m.visible = true; this.addAnim(m, 'entOut', now); });
    this.buildHighlights();
    if (prev && prev !== k) { const sb = this.stepBounds(k); if (sb && k !== this.N) this.focusOn(sb); else this.fit('keep'); }
    this.cb.onStep && this.cb.onStep(k);
  }
  // срез сам подстраивается под шаг: поднимается, если новое выше, и опускается в «сплошном» грунте,
  // если всё новое закопано (подвал фермы железа). Свой автосрез снимаем, когда он больше не нужен.
  fitCut(k) {
    const sb = this.stepBounds(k), G = this.farm.ground;
    this.cutReset = false;
    if (this.opt.layer) { this.cutAuto = false; return; } // по слоям срез ведёт только сам игрок
    if (this.cutAuto) { this.opt.cut = null; this.cutAuto = false; }
    if (this.opt.cut !== null && sb && sb.max.y - 1 > this.opt.cut) { this.opt.cut = null; this.cutReset = true; }
    if (this.opt.cut === null && G && sb && this.opt.ground === 'solid' && sb.max.y - 1 < G.top) { this.opt.cut = sb.max.y - 1; this.cutAuto = true; }
  }
  addAnim(m, kind, t0, o = {}) {
    const a = { m, kind, t0, dur: DUR[kind], land: LAND[kind] ?? 2, ...o };
    const id = m.userData.isEnt ? 'e:' + m.userData.ent.id : m.userData.en.id;
    if (a.land <= 1) { a.id = id; this.pending.add(id); }
    this.anims.push(a);
    this.pose(a, (this.at - t0) / a.dur);
    this.dirty = true;
  }
  // мгновенно довести все анимации до конца: перед новым шагом, «по одному блоку», сменой фермы
  finishAnims() {
    for (const a of this.anims) this.endAnim(a);
    for (const id of this.pending) this.hlBy?.get(id)?.forEach(o => (o.visible = true));
    this.anims = []; this.pending = new Set();
    for (const h of this.hlAnims) h.objs.forEach(o => o.scale.setScalar(h.s));
    this.hlAnims = [];
  }
  endAnim(a) {
    this.poseReset(a.m);
    if (LEAVE.has(a.kind)) a.m.visible = false;
    else if (a.m.userData.wait) { a.m.userData.wait = false; a.m.visible = this.shown(a.m); }
  }
  poseReset(m) {
    const d = m.userData;
    m.position.copy(d.base); m.scale.setScalar(1);
    if (d.isEnt) m.rotation.y = d.yaw;
  }
  // должна ли модель быть видна по шагу, срезу и «только новое» (без учёта анимаций)
  // «один слой»: виден только ряд y = срез — блоки, мобы и полоска грунта с вырезами, как план этажа
  solo() { return this.opt.solo && this.opt.layer && this.opt.cut !== null; }
  shown(m) {
    const d = m.userData, cut = this.opt.cut;
    if (d.isEnt) return this.entVisible(d.ent);
    return !!this.active?.has(d.en.id) && !(cut !== null && d.en.y > cut) && !(this.solo() && d.en.y < cut) && !(this.opt.onlyNew && d.en.step !== this.k);
  }
  // поза модели: масштаб от середины низа клетки (у мобов — от их опоры), подъём dy
  place(m, sx, sy, sz, dy, cy = 0) {
    const b = m.userData.base, c = m.userData.isEnt ? 0 : .5;
    m.scale.set(sx, sy, sz);
    m.position.set(b.x + c * (1 - sx), b.y + dy + cy * (1 - sy), b.z + c * (1 - sz));
  }
  pose(a, u) {
    const m = a.m, d = m.userData;
    if (!LEAVE.has(a.kind)) {
      // ещё не время — модели нет совсем (и вызова отрисовки на неё тоже)
      if (u <= 0) { if (!d.wait) { d.wait = true; m.visible = false; } return; }
      if (d.wait) { d.wait = false; m.visible = this.shown(m); }
    }
    const v = clamp01(u);
    switch (a.kind) {
      case 'drop': {
        // падает с ускорением, чуть вытянутый; удар — сплющивается и пружинит
        if (v < LAND.drop) { const q = v / LAND.drop; this.place(m, 1 - .06 * q, 1 + .12 * q, 1 - .06 * q, 1.6 * (1 - q * q)); }
        else { const w = wobble((v - LAND.drop) / (1 - LAND.drop)); this.place(m, 1 + .14 * w, 1 - .26 * w, 1 + .14 * w, 0); }
        break;
      }
      case 'pop': { const s = Math.max(1e-4, outBack(v, 2.6)); this.place(m, s, s, s, 0, .5); break; }
      case 'fill': { const s = .04 + .96 * outCubic(v); this.place(m, 1, s, 1, 0); break; }
      case 'out': { const s = Math.max(1e-4, 1 - v * v); this.place(m, s, s, s, .7 * outCubic(v), .5); break; }
      case 'entIn': {
        // моб падает, крутясь, отскакивает и чуть подпрыгивает ещё раз
        const L = LAND.entIn;
        if (v < L) { const q = v / L; this.place(m, .9, 1.14, .9, 2.2 * (1 - q * q)); }
        else {
          const b = (v - L) / (1 - L), w = wobble(b, 5, 3);
          this.place(m, 1 + .12 * w, 1 - .2 * w, 1 + .12 * w, .3 * Math.abs(Math.sin(b * Math.PI * 1.6)) * (1 - b) ** 2);
        }
        m.rotation.y = d.yaw + 1.3 * (1 - outCubic(Math.min(1, v / L)));
        break;
      }
      case 'entOut': { const s = Math.max(1e-4, 1 - v * v); this.place(m, s, s, s, .5 * Math.sin(v * Math.PI)); m.rotation.y = d.yaw - 2 * v * v; break; }
    }
  }
  // приземлился: пыль из-под блока и рамка «новое» щёлкает на место
  landed(a) {
    this.pending.delete(a.id);
    if (a.dust && a.m.visible) this.dustFx(a.m);
    const objs = this.hlBy?.get(a.id);
    if (objs) { objs.forEach(o => (o.visible = true)); this.hlAnims.push({ objs, t0: this.at, s: objs[0].userData.s }); }
  }
  stepBounds(k) {
    const s = this.farm.steps[k - 1], b = new THREE.Box3(); let n = 0;
    const add = (x, y, z) => { b.expandByPoint(new THREE.Vector3(x, y, z)); b.expandByPoint(new THREE.Vector3(x + 1, y + 1, z + 1)); n++; };
    for (const d of s.dig || []) for (const [x, y, z] of boxCells(d)) add(x, y, z);
    for (const en of this.entries) if (en.step === k && !(en.t === 'water' && !en.p.src)) for (const [x, y, z] of en.cells) add(x, y, z);
    for (const e of this.ents) if (e.step === k) add(e.x - .5, e.y, e.z - .5);
    if (s.focus) { b.makeEmpty(); add(...s.focus.slice(0, 3)); add(...s.focus.slice(3)); }
    return n ? b : null;
  }
  focusOn(b) {
    const c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
    const r = Math.max(size.length() / 2, 3.4);
    const dist = r / Math.sin(this.halfFov()) * 1.08;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < .25) { dir.y = .5; dir.normalize(); }
    this.flyTo(c.clone().add(dir.multiplyScalar(dist)), c, .85);
  }
  flyTo(pos, target, dur) {
    if (!dur || RM.matches) { this.camera.position.copy(pos); this.controls.target.copy(target); this.tween = null; }
    else this.tween = { from: this.camera.position.clone(), to: pos, tf: this.controls.target.clone(), tt: target, t0: this.at, dur };
    this.dirty = true;
  }

  /* ---------- копание ---------- */
  groundAt(x, y, z, k) {
    const G = this.farm.ground; if (!G) return false;
    const [x1, y1, z1, x2, , z2] = G.box;
    return x >= x1 && x <= x2 && y >= y1 && y <= G.top && z >= z1 && z <= z2 && this.natural(x, y, z, k);
  }
  digCells(k) {
    // клетки, где в этом шаге пропадает грунт: выкопанные и те, что заменяются новым блоком
    const s = this.farm.steps[k - 1], G = this.farm.ground; if (!G || this.opt.ground === 'off') return [];
    const cut = this.opt.cut, seen = new Set(), cells = [];
    const take = (x, y, z, ord) => {
      const key = K(x, y, z); if (seen.has(key)) return; seen.add(key);
      if (cut !== null && y > cut) return;
      if (this.groundAt(x, y, z, k - 1) && !this.groundAt(x, y, z, k)) cells.push([x, y, z, ord]);
    };
    (s.dig || []).forEach((b, i) => boxCells(b).forEach(([x, y, z]) => take(x, y, z, i)));
    for (const en of this.entries) if (en.step === k) en.cells.forEach(([x, y, z]) => take(x, y, z, 99));
    return cells.sort((a, b) => b[1] - a[1] || a[3] - b[3] || a[0] - b[0] || a[2] - b[2]); // сверху вниз, как копаешь
  }
  startDig(k, t0) {
    const G = this.farm.ground, cells = this.digCells(k);
    if (!cells.length) return 0;
    // мало блоков — копаем почти по одному, много — быстрее, чтобы шаг не тянулся
    const gap = Math.min(.18, Math.max(.04, 3 / cells.length)), glass = this.opt.ground === 'glass';
    const byKind = {};
    this.digs = cells.map(([x, y, z], i) => {
      const kind = y === G.top ? 'grass' : y >= G.top - (G.dirt ?? 3) ? 'dirt' : 'stone';
      const d = { x, y, z, i, kind, tb: t0 + CRACK_T + i * gap, st: -1, hit: 0, seed: i * 1.7, broken: false, obj: null };
      (byKind[kind] ||= []).push(d);
      return d;
    });
    // ждущие своей очереди клетки — одной пачкой на вид грунта: пара вызовов отрисовки вместо сотен
    for (const kind in byKind) {
      const list = byKind[kind], inst = new THREE.InstancedMesh(this.digGeo, groundMats(kind, glass), list.length);
      list.forEach((d, j) => { d.inst = inst; d.slot = j; inst.setMatrixAt(j, M4.makeTranslation(d.x + .5, d.y + .5, d.z + .5)); });
      inst.renderOrder = glass ? 1 : 0;
      this.digRoot.add(inst);
    }
    // сетка клеток — одна линия на весь шаг; у сломанной клетки её отрезки схлопываются в точку
    const src = this.edgeGeo.attributes.position.array, n = src.length, pos = new Float32Array(n * cells.length);
    this.digs.forEach((d, i) => { for (let j = 0; j < n; j += 3) { pos[i * n + j] = d.x + .5 + src[j] * 1.01; pos[i * n + j + 1] = d.y + .5 + src[j + 1] * 1.01; pos[i * n + j + 2] = d.z + .5 + src[j + 2] * 1.01; } });
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.digEdges = new THREE.LineSegments(eg, this.digCellMat); this.digEdges.userData.src = pos.slice(); this.digEdges.userData.n = n;
    this.digRoot.add(this.digEdges);
    return t0 + CRACK_T + (cells.length - 1) * gap + .25;
  }
  // показать или убрать клетку грунта в пачке (и её рамку)
  digCell(d, on) {
    d.inst.setMatrixAt(d.slot, on ? M4.makeTranslation(d.x + .5, d.y + .5, d.z + .5) : ZERO); d.inst.instanceMatrix.needsUpdate = true;
    const e = this.digEdges, n = e.userData.n, p = e.geometry.attributes.position, s = e.userData.src;
    for (let j = 0; j < n; j++) p.array[d.i * n + j] = on ? s[d.i * n + j] : s[d.i * n + j % 3];
    p.needsUpdate = true;
  }
  // клетку начали бить: из пачки её вынимаем в отдельный куб, который трясётся и трескается
  digOpen(d) {
    d.inst.setMatrixAt(d.slot, ZERO); d.inst.instanceMatrix.needsUpdate = true;
    const obj = new THREE.Group(), cube = new THREE.Mesh(this.digGeo, groundMats(d.kind, this.opt.ground === 'glass'));
    const crack = new THREE.Mesh(this.crack.geo, this.crack.mats[0]); crack.visible = false;
    cube.position.set(.5, .5, .5); crack.position.set(.5, .5, .5); cube.renderOrder = d.inst.renderOrder;
    obj.add(cube, crack); obj.position.set(d.x, d.y, d.z);
    d.obj = obj; d.cube = cube; d.crack = crack;
    this.digRoot.add(obj);
  }
  digBreak(d, fx) {
    d.broken = true;
    if (d.obj) { this.digRoot.remove(d.obj); d.obj = null; }
    this.digCell(d, false);
    if (fx) this.breakFx(d);
  }
  clearDig() {
    this.seq = null; if (this.cur) this.cur.visible = false;
    for (const o of this.digRoot.children) { if (o.isInstancedMesh) o.dispose(); if (o === this.digEdges) o.geometry.dispose(); }
    this.digRoot.clear(); this.digs = []; this.digEdges = null;
    this.clearParts();
    this.sub = null; this.dirty = true;
  }

  /* ---------- частицы: меши берём из пула, чтобы не мусорить памятью ---------- */
  spawn(geo, material) {
    const m = this.pool.pop() || new THREE.Mesh();
    m.geometry = geo; m.material = material; m.visible = true;
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.setScalar(1);
    this.fxRoot.add(m);
    return m;
  }
  freePart(p) {
    this.fxRoot.remove(p.m);
    if (p.ownMat) p.m.material.dispose();
    this.pool.push(p.m);
  }
  clearParts() { for (const p of this.parts) this.freePart(p); this.parts = []; }
  // крошки из клетки c = {x, y, z, kind}: летят, кувыркаются, отскакивают от пола
  chips(c, n, power, life) {
    if (this.parts.length > 320) return; // лавина крошек на большом шаге — лишние не нужны
    const t = this.at;
    for (let i = 0; i < n; i++) {
      // крошки и дёрна, и земли: у травы часть крошек земляная, как у настоящего дёрна
      const m = this.spawn(this.pGeo, mat(c.kind === 'grass' ? (i % 3 ? 'dirt' : 'grass_top') : c.kind));
      m.position.set(c.x + .2 + Math.random() * .6, c.y + .3 + Math.random() * .6, c.z + .2 + Math.random() * .6);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const a = Math.random() * Math.PI * 2, sp = (.8 + Math.random()) * power;
      this.parts.push({ m, s0: .6 + Math.random() * .6, life: life + Math.random() * .25, g: 12, floor: c.floor ?? c.y, t0: t,
        spin: new THREE.Vector3((Math.random() - .5) * 12, (Math.random() - .5) * 12, (Math.random() - .5) * 12),
        v: new THREE.Vector3(Math.cos(a) * sp, (1.8 + Math.random() * 2) * power, Math.sin(a) * sp) });
    }
  }
  breakFx(c) {
    this.chips(c, 12, 1, .7);
    // короткая белая вспышка на месте блока
    const m = this.spawn(this.digGeo, this.flashMat.clone());
    m.position.set(c.x + .5, c.y + .5, c.z + .5);
    this.parts.push({ m, flash: true, ownMat: true, life: .18, t0: this.at });
  }
  // мягкая пыль кольцом из-под только что поставленного блока или моба
  dustFx(m) {
    if (this.parts.length > 320) return;
    const t = this.at, b = m.userData.base, c = m.userData.isEnt ? 0 : .5, n = m.userData.isEnt ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n + Math.random() * .1) * Math.PI * 2, p = this.spawn(this.pGeo, this.dustMat);
      p.position.set(b.x + c + Math.cos(a) * .45, b.y + .05, b.z + c + Math.sin(a) * .45);
      this.parts.push({ m: p, s0: .9 + Math.random() * .5, grow: true, life: .5, g: -.4, drag: 3.2, t0: t, spin: new THREE.Vector3(0, 3, 0),
        v: new THREE.Vector3(Math.cos(a) * 1.8, .25 + Math.random() * .3, Math.sin(a) * 1.8) });
    }
  }

  /* ---------- по одному блоку ---------- */
  putMeshes() {
    const blocks = this.entries.filter(en => en.step === this.k && this.active.has(en.id)).map(en => this.meshFor(en))
      .sort((a, b) => (a.userData.en.y - b.userData.en.y) || (a.userData.en.x + a.userData.en.z - b.userData.en.x - b.userData.en.z));
    // мобы и лодка этого шага — тоже «блоки» ползунка, после построек
    const ents = this.ents.filter(e => e.step === this.k && this.entVisible(e)).map(e => this.entFor(e));
    return [...blocks, ...ents];
  }
  seqLen() { return this.digCells(this.k).length + this.putMeshes().length; }
  // сколько «блоков» шага уже на месте прямо сейчас (посреди анимации тоже): с этого места листает «по одному блоку»
  progress() {
    if (this.seq) return this.sub ?? this.seq.dig.length + this.seq.put.length;
    const dig = this.digs.length ? this.digs.filter(d => d.broken).length : this.digCells(this.k).length;
    return dig + this.putMeshes().filter(m => !m.userData.wait).length;
  }
  scrub(i) {
    this.paused = false;
    if (!this.seq) {
      this.finishAnims();
      this.clearDig(); this.startDig(this.k, Infinity);
      this.seq = { dig: this.digs, put: this.putMeshes() };
    }
    const { dig, put } = this.seq, prev = this.sub ?? dig.length + put.length;
    let last = null;
    dig.forEach((d, j) => {
      const gone = j < i;
      if (gone !== d.broken) { if (gone) this.digBreak(d, i > prev && !RM.matches); else { d.broken = false; this.digCell(d, true); } }
      if (j === i - 1) last = d;
    });
    put.forEach((m, j) => {
      const on = j < i - dig.length, d = m.userData;
      if (!on) {
        // блок убрали ползунком — его недоигранное появление тоже отменяем, иначе он вылезет обратно
        if (d.wait || this.anims.some(a => a.m === m)) { this.anims = this.anims.filter(a => a.m !== m); d.wait = false; this.pending.delete(d.isEnt ? 'e:' + d.ent.id : d.en.id); }
        this.poseReset(m); m.visible = false;
      }
      else if (!m.visible && !d.wait && this.shown(m)) {
        // только что поставленный блок шлёпается на место, а не просто появляется
        this.poseReset(m); m.visible = this.shown(m);
        if (i > prev && !RM.matches) { const kind = d.isEnt ? 'entIn' : kindOf(d.en); this.addAnim(m, kind, this.at, { dust: kind === 'drop' || kind === 'entIn' }); }
      }
      if (j === i - 1 - dig.length) last = d.isEnt ? { x: d.base.x - .5, y: d.base.y, z: d.base.z - .5 } : d.base;
    });
    this.sub = i;
    if (!this.cur) { this.cur = new THREE.LineSegments(this.edgeGeo, new THREE.LineBasicMaterial({ color: 0xfff1a8 })); this.root.add(this.cur); }
    this.cur.visible = !!last && i < dig.length + put.length;
    if (last) { this.cur.position.set(last.x + .5, last.y + .5, last.z + .5); this.curT = this.at; }
    this.dirty = true;
  }
  animLeft() { return Math.max(0, this.animEnd - this.at); }
  // пауза «Собрать с нуля»: своё время стоит, всё замирает на месте; вращать сцену можно
  pause(on) { this.paused = on; this.dirty = true; }
  // стоп: недоигранное в шаге встаёт на место сразу, без анимаций
  halt() {
    this.paused = false;
    this.finishAnims(); this.clearDig(); this.animEnd = 0;
    this.refreshVisibility(); this.buildHighlights();
  }
  replay() { this.goto(this.k, { replay: true }); }
  refreshVisibility() {
    this.lavaOn = false;
    for (const m of this.meshes.values()) {
      m.userData.demoHidden = false; // демо спрячет заново в следующем кадре, если надо
      const v = this.shown(m);
      m.visible = v && !m.userData.wait;
      this.ghost(m, v && this.opt.layer && this.opt.cut !== null && m.userData.en.y < this.opt.cut);
      if (v && m.userData.en.t === 'lava') this.lavaOn = true;
    }
    // как в игре: стык двух стёкол (и двух клеток воды) не рисуется
    const vis = new Map();
    for (const [id, m] of this.meshes) if (this.shown(m)) for (const [x, y, z] of this.entries[id].cells) vis.set(K(x, y, z), this.entries[id]);
    for (const [id, m] of this.meshes) {
      const cm = m.userData.cm; if (!cm || !this.shown(m)) continue;
      const en = this.entries[id], kind = cm.userData.cull; let mask = 0;
      FACES.forEach(([dx, dy, dz], i) => {
        const nb = vis.get(K(en.x + dx, en.y + dy, en.z + dz)); if (!nb || nb.t !== kind) return;
        if (kind === 'glass' || dy !== 0 || waterH(nb) >= waterH(en)) mask |= 1 << i;
      });
      if (cm.userData.mask !== mask) { cm.userData.mask = mask; cm.geometry = maskGeo(...cm.userData.dims, mask); }
    }
    for (const m of this.entMeshes.values()) m.visible = this.shown(m) && !m.userData.wait;
    // уходящие блоки доигрывают свой уход, даже если вид поменяли посреди анимации
    for (const a of this.anims) if (LEAVE.has(a.kind)) a.m.visible = true;
    this.groundRoot.visible = this.opt.ground !== 'off';
    this.dirty = true;
  }
  entVisible(e) {
    const cut = this.opt.cut;
    return this.entOn(e, this.k) && !(cut !== null && e.y > cut + .2) && !(this.solo() && e.y < cut - .5) && !(this.opt.onlyNew && e.step !== this.k);
  }
  buildHighlights() {
    if (this.hl) { this.root.remove(this.hl); this.hl.traverse(o => o.userData.own && o.geometry.dispose()); }
    this.hl = new THREE.Group(); this.root.add(this.hl); this.dirty = true;
    this.hlBy = new Map(); this.hlAnims = [];
    if (!this.opt.highlight || !this.active || !this.k) return;
    const step = this.farm.steps[this.k - 1];
    // «копать»: одна общая фигура — контур по внешним рёбрам и лёгкая красная заливка, без каши из рамок
    const dug = new Set();
    for (const b of step.dig || []) for (const [x, y, z] of boxCells(b)) if (this.opt.cut === null || (this.solo() ? y === this.opt.cut : y <= this.opt.cut)) dug.add(K(x, y, z));
    if (dug.size) this.hl.add(...this.shell(dug));
    // рамка нового блока прячется, пока блок не приземлился (см. landed)
    const keep = (id, objs, s) => { objs.forEach(o => { o.userData.s = s; o.visible = !this.pending.has(id); this.hl.add(o); }); this.hlBy.set(id, objs); };
    for (const id of this.active) {
      const en = this.entries[id];
      // без рамки: текущая вода и то, что вырастает само (free — крона, стволы), иначе сотни рамок в кашу
      if (en.step !== this.k || en.t === 'water' && !en.p.src || en.p.free) continue;
      if (this.opt.cut !== null && (en.y > this.opt.cut || this.solo() && en.y < this.opt.cut)) continue;
      keep(id, en.cells.map(([x, y, z]) => { const l = new THREE.LineSegments(this.edgeGeo, this.hlMat); l.position.set(x + .5, y + .5, z + .5); l.scale.setScalar(1.04); return l; }), 1.04);
    }
    for (const e of this.ents) {
      if (e.step !== this.k || !this.entVisible(e)) continue;
      const ring = new THREE.Mesh(this.ringGeo, this.ringMat), s = Math.max(1, this.entFor(e).userData.rad / .5);
      ring.position.set(e.x, e.y + .03, e.z); ring.renderOrder = 4; ring.scale.setScalar(s);
      keep('e:' + e.id, [ring], s);
    }
  }

  shell(set) {
    const has = (x, y, z) => set.has(K(x, y, z));
    const crease = (a, b, c, d) => { const n = a + b + c + d; return n === 1 || n === 3 || (n === 2 && a === d); };
    const L = [], seen = new Set(), P = [], I = [];
    const edge = (id, a, b, c, d, seg) => { if (seen.has(id)) return; seen.add(id); if (crease(a, b, c, d)) L.push(...seg); };
    for (const key of set) {
      const [x, y, z] = key.split(',').map(Number);
      for (const [p, q] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        let Y = y + p, Z = z + q;
        edge(`x${x},${Y},${Z}`, has(x, Y - 1, Z - 1), has(x, Y, Z - 1), has(x, Y - 1, Z), has(x, Y, Z), [x, Y, Z, x + 1, Y, Z]);
        let X = x + p; Z = z + q;
        edge(`y${X},${y},${Z}`, has(X - 1, y, Z - 1), has(X, y, Z - 1), has(X - 1, y, Z), has(X, y, Z), [X, y, Z, X, y + 1, Z]);
        X = x + p; Y = y + q;
        edge(`z${X},${Y},${z}`, has(X - 1, Y - 1, z), has(X, Y - 1, z), has(X - 1, Y, z), has(X, Y, z), [X, Y, z, X, Y, z + 1]);
      }
      FACES.forEach(([dx, dy, dz], f) => {
        if (has(x + dx, y + dy, z + dz)) return;
        const b = P.length / 3; for (const [qx, qy, qz] of QUAD[f]) P.push(x + qx, y + qy, z + qz);
        I.push(b, b + 1, b + 2, b, b + 2, b + 3);
      });
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(L, 3));
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); fg.setIndex(I);
    const lines = new THREE.LineSegments(lg, this.digMat), fill = new THREE.Mesh(fg, this.digFill);
    lines.userData.own = fill.userData.own = true; fill.renderOrder = 2;
    return [fill, lines];
  }

  /* ---------- грунт ---------- */
  natural(x, y, z, k) {
    const key = K(x, y, z);
    const d = this.dig.get(key); if (d !== undefined && d <= k) return false;
    const ids = this.hist.get(key); if (ids && this.entries[ids[0]].step <= k) return false;
    return true;
  }
  // Сетка грунта: для каждой клетки — шаг, на котором она перестаёт быть природной (копают или ставят блок).
  // Грунт меняется только на таких шагах, поэтому готовые меши кэшируем по «сколько таких шагов прошло».
  prepGround() {
    const G = this.farm.ground; this.gGone = null; if (!G) return;
    const [x1, y1, z1, x2, y2, z2] = G.box, nx = x2 - x1 + 1, ny = y2 - y1 + 1, nz = z2 - z1 + 1;
    const gone = new Uint16Array(nx * ny * nz).fill(65535), steps = new Set();
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) {
      const key = K(x, y, z), d = this.dig.get(key), ids = this.hist.get(key), p = ids ? this.entries[ids[0]].step : undefined;
      const s = Math.min(d ?? 65535, p ?? 65535);
      gone[((x - x1) * ny + (y - y1)) * nz + (z - z1)] = s;
      if (s < 65535) steps.add(s);
    }
    this.gGone = gone; this.gDim = [nx, ny, nz]; this.gSteps = [...steps].sort((a, b) => a - b);
  }
  dropGroundCache() {
    for (const g of (this.gCache || new Map()).values()) g.traverse(o => o.userData.ground && o.geometry.dispose());
    this.gCache = new Map(); this.groundRoot.clear();
  }
  buildGround() {
    // Грунт — кусок мира-«диорама»: рисуются только наружные грани (поверхность, стенки ям, срез).
    this.dirty = true;
    const G = this.farm.ground;
    this.groundRoot.clear();
    if (!G) return;
    const solo = this.solo();
    // в одном слое полоска грунта всегда сплошная: на ней видно вырезы — что копать на этой высоте
    const k = this.k, cut = this.opt.cut, glass = this.opt.ground === 'glass' && !solo;
    const key = `${this.gSteps.filter(s => s <= k).length}|${cut}|${glass}|${solo}`;
    let g = this.gCache.get(key);
    if (!g) {
      g = this.groundMesh(k, cut, glass, solo);
      // кэш небольшой: срез ползунком даёт много вариантов, старые выкидываем
      if (this.gCache.size >= 24) { const [old, og] = this.gCache.entries().next().value; og.traverse(o => o.userData.ground && o.geometry.dispose()); this.gCache.delete(old); }
      this.gCache.set(key, g);
    }
    this.groundRoot.add(g);
  }
  groundMesh(k, cut, glass, solo) {
    const G = this.farm.ground, out = new THREE.Group();
    const [x1, y1, z1, x2, y2, z2] = G.box, top = G.top, dirt = G.dirt ?? 3, [, ny, nz] = this.gDim, gone = this.gGone;
    const yTop = Math.min(y2, top, cut === null ? Infinity : cut);
    if (yTop < y1) return out;
    const yLo = solo ? Math.max(y1, yTop) : y1; // один слой — полоска грунта толщиной в блок, вырезы в ней = что копать
    const solid = (x, y, z) => x >= x1 && x <= x2 && y >= yLo && y <= yTop && z >= z1 && z <= z2 && gone[((x - x1) * ny + (y - y1)) * nz + (z - z1)] > k;
    const buf = {}, B = key => (buf[key] ||= { p: [], n: [], uv: [], i: [] });
    for (let x = x1; x <= x2; x++) for (let y = yLo; y <= yTop; y++) for (let z = z1; z <= z2; z++) {
      if (!solid(x, y, z)) continue;
      const kind = y === top ? 'grass' : y >= top - dirt ? 'dirt' : 'stone';
      FACES.forEach(([dx, dy, dz], f) => {
        if (solid(x + dx, y + dy, z + dz)) return;
        const key = kind !== 'grass' ? kind : f === 2 ? 'grass_top' : f === 3 ? 'dirt' : 'grass_side';
        const b = B(key), base = b.p.length / 3;
        for (const [qx, qy, qz, u, v] of QUAD[f]) { b.p.push(x + qx, y + qy, z + qz); b.n.push(dx, dy, dz); b.uv.push(u, v); }
        b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
    }
    const o = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...(glass ? { transparent: true, opacity: .13, depthWrite: false } : {}) };
    for (const key in buf) {
      const b = buf[key], g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setIndex(b.i);
      const m = new THREE.Mesh(g, mat(key, o)); m.userData.ground = true; m.renderOrder = glass ? 1 : 0;
      out.add(m);
    }
    if (glass) {
      const box = new THREE.LineSegments(this.edgeGeo, this.boxMat);
      box.scale.set(x2 - x1 + 1, yTop - yLo + 1, z2 - z1 + 1); box.position.set((x1 + x2 + 1) / 2, (yLo + yTop + 1) / 2, (z1 + z2 + 1) / 2);
      out.add(box);
    }
    return out;
  }

  /* ---------- настройки ---------- */
  set(opt) {
    const was = this.opt.cut;
    Object.assign(this.opt, opt);
    if ('cut' in opt) this.cutAuto = false;
    // «по одному блоку» сбрасываем к целому шагу; копание посреди шага не трогаем,
    // а если поменяли срез или грунт — доводим шаг до конца, иначе стройка зависнет в пустоте
    if (this.seq) this.clearDig();
    else if (('cut' in opt || 'ground' in opt) && (this.anims.length || this.digs.length)) { this.finishAnims(); this.clearDig(); this.animEnd = 0; }
    if ('ground' in opt || 'cut' in opt || 'solo' in opt || 'layer' in opt) this.buildGround();
    this.refreshVisibility();
    if ('cut' in opt || 'layer' in opt) this.buildGrid();
    // по слоям поднялись на ряд выше — блоки нового ряда ставятся лесенкой, как в игре
    if (this.opt.layer && 'cut' in opt && this.opt.cut !== null && was !== null && this.opt.cut === was + 1 && !RM.matches) {
      const row = [...this.meshes.values()].filter(m => m.visible && m.userData.en.y === this.opt.cut)
        .sort((a, b) => (a.userData.en.x + a.userData.en.z) - (b.userData.en.x + b.userData.en.z));
      const gap = Math.min(.04, .45 / Math.max(1, row.length));
      row.forEach((m, i) => this.addAnim(m, kindOf(m.userData.en), this.at + i * gap));
      if (row.length) this.animEnd = Math.max(this.animEnd, this.at + row.length * gap + .6);
    }
    this.buildHighlights();
    if ('demo' in opt) { this.demoT0 = this.at; if (!opt.demo) this.resetDemo(); }
  }
  bounds() {
    const b = new THREE.Box3();
    for (const en of this.entries) for (const [x, y, z] of en.cells) { b.expandByPoint(new THREE.Vector3(x, y, z)); b.expandByPoint(new THREE.Vector3(x + 1, y + 1, z + 1)); }
    for (const e of this.ents) b.expandByPoint(new THREE.Vector3(e.x, e.y + 1, e.z));
    return b;
  }
  // сетка клеток на полу текущего слоя: удобно считать блоки
  buildGrid() {
    if (this.grid) { this.root.remove(this.grid); this.grid.geometry.dispose(); this.grid = null; }
    const c = this.opt.cut;
    if (!this.opt.layer || c === null || !this.entries?.length) { this.dirty = true; return; }
    const b = this.bounds(), x0 = Math.floor(b.min.x) - 1, x1 = Math.ceil(b.max.x) + 1, z0 = Math.floor(b.min.z) - 1, z1 = Math.ceil(b.max.z) + 1, y = c + .01;
    const P = [];
    for (let x = x0; x <= x1; x++) P.push(x, y, z0, x, y, z1);
    for (let z = z0; z <= z1; z++) P.push(x0, y, z, x1, y, z);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    this.grid = new THREE.LineSegments(g, this.gridMat); this.grid.renderOrder = 3;
    this.root.add(this.grid); this.dirty = true;
  }
  // сколько блоков стоит в ряду y на текущем шаге (для подписи среза)
  layerCount(y) {
    let n = 0;
    for (const id of this.active || []) { const en = this.entries[id]; if (en.y === y && en.t !== 'air' && !(en.t === 'water' && !en.p.src)) n++; }
    return n;
  }
  ghost(m, on) {
    if (!!m.userData.ghost === on) return;
    m.userData.ghost = on;
    m.traverse(o => {
      if (!o.isMesh) return;
      if (on) { o.userData.mat0 = o.material; o.material = this.ghostMat; }
      else if (o.userData.mat0) { o.material = o.userData.mat0; o.userData.mat0 = null; }
    });
  }
  levels() {
    const b = this.bounds(); const lo = Math.floor(b.min.y), hi = Math.ceil(b.max.y) - 1;
    const G = this.farm.ground; return { lo: G ? Math.min(lo, G.box[1]) : lo, hi: G ? Math.max(hi, G.top) : hi };
  }
  fit(mode = 'iso') {
    const b = this.bounds(); const c = b.getCenter(new THREE.Vector3()); const s = b.getSize(new THREE.Vector3());
    const r = Math.max(s.length() / 2, 3);
    const f = this.farm.view || {};
    const dist = r / Math.sin(this.halfFov()) * (f.zoom || .82);
    let dir = new THREE.Vector3(...(f.dir || [.95, .78, 1.15])).normalize();
    if (mode === 'keep' && this.k) dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (mode === 'top') dir = new THREE.Vector3(0.0001, 1, 0.12).normalize();
    if (mode === 'front') dir = new THREE.Vector3(0, .25, 1).normalize();
    if (f.center) c.set(...f.center);
    this.flyTo(c.clone().add(dir.multiplyScalar(dist)), c, this.farm && this.k ? .75 : 0);
    this.camera.near = .1; this.camera.far = dist * 6; this.camera.updateProjectionMatrix();
  }

  /* ---------- демо ---------- */
  buildActors() {
    const D = this.farm.demo; this.actors = [];
    if (!D) return;
    for (const a of D.actors || []) {
      let obj;
      if (a.label) obj = label(a.label, a.color);
      else if (a.b) { obj = new THREE.Group(); obj.add(BLOCKS[a.b].build({ t: a.b, x: 0, y: 0, z: 0, p: a.p || {} }, { isType: () => false, dustConn: () => [] })); }
      else obj = ENTS[a.e].build(a.o || {});
      const mats = [];
      obj.traverse(o => {
        if (!o.material) return;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        const cl = list.map(m => {
          const c = m.clone(); c.transparent = true; c.onBeforeCompile = m.onBeforeCompile;
          if (c.color) c.userData.c0 = c.color.clone();
          mats.push(c); return c;
        });
        o.material = Array.isArray(o.material) ? cl : cl[0];
      });
      obj.visible = false; obj.rotation.y = a.yaw || 0;
      this.actorRoot.add(obj); this.actors.push({ a, obj, mats });
    }
    // ячейки, которые демо прячет, — один раз, а не в каждом кадре
    this.demoHide = (D.hide || []).map(([x, y, z, q, w]) => [this.hist.get(K(x, y, z)) || [], q, w]);
    this.demoHidden = new Set();
  }
  // Сигнал по пыли в демо. power: [{ at: [x,y,z], lvl: 15, on: [[t0, t1], …] }] — источник в клетке пыли.
  // Сила падает на 1 с каждым блоком; бежит по проводу с маленькой задержкой (в игре — мгновенно, это для глаза).
  powerPrep() {
    const cells = new Map();
    for (const m of this.meshes.values()) if (m.userData.dm) cells.set(K(m.userData.en.x, m.userData.en.y, m.userData.en.z), m);
    this.powerSrc = (this.farm.demo.power || []).map(src => {
      const dist = new Map(), start = K(...src.at), q = [src.at];
      if (!cells.has(start)) return null;
      dist.set(start, 0);
      while (q.length) {
        const [x, y, z] = q.shift(), d = dist.get(K(x, y, z));
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = dustStep(this.finalAt, x, y, z, dx, dz), k = c && K(...c);
          if (c && cells.has(k) && !dist.has(k)) { dist.set(k, d + 1); q.push(c); }
        }
      }
      return { ...src, lvl: src.lvl ?? 15, dist };
    }).filter(Boolean);
    this.powerCells = cells;
  }
  powerFrame(T) {
    if (!this.powerCells) this.powerPrep();
    const DT = .035;
    for (const [k, m] of this.powerCells) {
      let L = 0;
      for (const s of this.powerSrc) {
        const d = s.dist.get(k); if (d === undefined) continue;
        if (s.on.some(([a, b]) => T >= a + d * DT && T < b + d * DT)) L = Math.max(L, s.lvl - d);
      }
      // без сигнала пыль тёмная, на 15 — яркая; между ними плавно
      const f = L > 0 ? .38 + .62 * L / 15 : .2;
      if (m.userData.pf === f) continue;
      m.userData.pf = f;
      for (const c of m.userData.dm) c.color.copy(c.userData.c0).multiplyScalar(f);
    }
  }
  powerOff() {
    if (!this.powerCells) return;
    for (const m of this.powerCells.values()) { m.userData.pf = undefined; for (const c of m.userData.dm) c.color.copy(c.userData.c0); }
  }
  resetDemo() {
    this.powerOff();
    for (const [m] of this.litCells || []) { m.userData.litNow = undefined; m.userData.setLit(m.userData.litDef); m.userData.setLitT?.(m.userData.litDef ? 1 : 0, m.userData.litDef, 9); }
    if (this.actors) this.actors.forEach(x => (x.obj.visible = false));
    for (const p of this.pistons) pistonExt(p.userData.head, 0);
    this.lastDemoT = undefined;
    this.refreshVisibility();
  }
  // значение по ключам [время, ...числа]: движение разгоняется и тормозит там, где начинается и кончается путь
  static sample(ks, T) {
    if (T < ks[0][0] || T > ks[ks.length - 1][0]) return null;
    if (ks.length === 1) return ks[0].slice(1);
    let i = 0; while (i < ks.length - 2 && T > ks[i + 1][0]) i++;
    const [t0, ...p0] = ks[i], [t1, ...p1] = ks[i + 1];
    const u = t1 > t0 ? clamp01((T - t0) / (t1 - t0)) : 1;
    const same = (a, b) => a.slice(1, 4).every((v, j) => v === b[j + 1]);
    // разгон, если до этого стояли; торможение, если дальше стоим
    const easeIn = i === 0 || same(ks[i - 1], ks[i]), easeOut = i + 2 >= ks.length || same(ks[i + 1], ks[i + 2]);
    const up = easeIn && easeOut ? smooth(u) : easeIn ? u * u : easeOut ? 1 - (1 - u) ** 2 : u;
    return p0.map((a, j) => a + ((p1[j] ?? a) - a) * (j < 3 ? up : smooth(u)));
  }
  // фишка «ты»: плавный поворот, шаги при движении, взмах топором с замахом и наклоном корпуса
  animPerson(a, obj, T, x, z) {
    const ud = obj.userData, ease = v => v * v * (3 - 2 * v);
    if (a.yaws) {
      let i = -1; a.yaws.forEach(([q], j) => { if (T >= q) i = j; });
      const cur = i < 0 ? (a.yaw || 0) : a.yaws[i][1], prev = i < 1 ? (a.yaw || 0) : a.yaws[i - 1][1];
      let d = cur - prev; d = Math.atan2(Math.sin(d), Math.cos(d));
      const u = i < 0 ? 1 : ease(Math.min(1, (T - a.yaws[i][0]) / .22));
      obj.rotation.y = prev + d * u;
    }
    const back = Viewer.sample(a.keys, T - .06);
    const sp = back ? Math.hypot(x - back[0], z - back[2]) / .06 : 0;
    const w = Math.min(1, sp / 1.2), ph = T * 11;
    ud.legs[0].rotation.x = Math.sin(ph) * .75 * w; ud.legs[1].rotation.x = -Math.sin(ph) * .75 * w;
    ud.armL.rotation.x = -Math.sin(ph) * .55 * w;
    ud.body.position.y = Math.abs(Math.sin(ph)) * .05 * w + Math.sin(T * 2.1) * .008;
    const on = a.swing && a.swing.find(([q, e]) => T >= q && T <= e);
    let arm = .25 + Math.sin(ph) * .5 * w, lean = 0;
    if (on) {
      const p = ((T - on[0]) / (on[2] || .32)) % 1;
      if (p < .45) arm = .6 + 2.1 * (1 - (1 - p / .45) ** 2);                          // замах: быстро и с торможением вверху
      else if (p < .62) { const u = (p - .45) / .17; arm = 2.7 - 1.75 * u * u; lean = -.14 * u; } // удар: разгон вниз
      else { const u = ease((p - .62) / .38); arm = .95 - .35 * u; lean = -.14 * (1 - u); }   // возврат
    }
    ud.swing.rotation.x = arm; ud.body.rotation.x = lean;
  }
  demoFrame(T) {
    const D = this.farm.demo; if (!D) return;
    if (!this.actors) this.buildActors();
    for (const { a, obj, mats } of this.actors) {
      const st = Viewer.sample(a.keys, T);
      if (!st) { obj.visible = false; continue; }
      let [x, y, z, s = 1, o = 1] = st;
      if (a.label) {
        // подпись выпрыгивает с перелётом, чуть покачивается и гаснет в конце
        const t0 = a.keys[0][0], t1 = a.keys[a.keys.length - 1][0];
        s *= Math.max(.01, outBack(clamp01((T - t0) / .32), 2.2)); o *= clamp01((t1 - T) / .25);
        y += .06 * Math.sin((T - t0) * 3);
      }
      obj.visible = s > .01 && o > .01 && (a.label || this.opt.cut === null || y < this.opt.cut + 1);
      let sx = 0; if (a.shake && a.shake.some(([q, w]) => T >= q && T <= w)) sx = Math.sin(T * 45) * .05;
      obj.position.set(x + sx, y, z);
      const bs = obj.userData.baseScale;
      if (bs) obj.scale.set(bs.x * s, bs.y * s, 1); else if (a.sy) obj.scale.set(1, s, 1); else obj.scale.setScalar(s);
      if (obj.userData.legs) this.animPerson(a, obj, T, x, z);
      // предмет на земле крутится и чуть подпрыгивает, как в игре
      if (!a.label && a.e && ENTS[a.e].drop) { obj.rotation.y = T * 2.4 + x * 1.7; obj.position.y += .035 * (1 + Math.sin(T * 4.2 + z * 2)); }
      const fl = a.flash && a.flash.some(([q, w]) => T >= q && T <= w);
      for (const m of mats) {
        m.opacity = o;
        if (m.userData.c0) { m.color.copy(m.userData.c0); if (fl) m.color.multiply(TINT.setRGB(1.6 + .4 * Math.sin(T * 14), .66, .46)); }
      }
    }
    // поршни: голова резко выстреливает и медленнее уходит назад
    if ((D.pistons || D.pistonsAt) && this.pistons.length) {
      // pistonsAt: { 'x,y,z': ключи } — свой ход у отдельных поршней (часы на воронке), остальные — по pistons
      const all = D.pistons ? Viewer.sample(D.pistons, T) : null;
      for (const p of this.pistons) {
        const e = p.userData.en, own = D.pistonsAt?.[`${e.x},${e.y},${e.z}`];
        const st = own ? Viewer.sample(own, T) : all;
        pistonExt(p.userData.head, st ? st[0] : 0);
      }
    }
    if (D.power) this.powerFrame(T);
    // lit: { 'x,y,z': [[t0, t1], …] } — рычаг включён, красный факел горит, лампа светит
    if (D.lit) {
      if (!this.litCells) { this.litCells = []; for (const m of this.meshes.values()) { const e = m.userData.en, iv = m.userData.setLit && D.lit[`${e.x},${e.y},${e.z}`]; if (iv) this.litCells.push([m, iv]); } }
      for (const [m, iv] of this.litCells) {
        // сколько прошло с последнего щелчка: от этого — пружинящий переход (рычаг с перелётом, кнопка вдавливается)
        let on = false, since = 9;
        for (const [a, b] of iv) if (T >= a && T < b) { on = true; since = T - a; }
        if (!on) { let last = -1; for (const [, b] of iv) if (b <= T && b > last) last = b; if (last >= 0) since = T - last; }
        const sp = since >= 1 ? 1 : 1 - Math.exp(-since * 15) * Math.cos(since * 21);
        if (m.userData.litNow !== on) {
          const was = m.userData.litNow; m.userData.litNow = on; m.userData.setLit(on);
          // красный факел зажёгся — пара красных частиц, как в игре (лампа просто загорается, без искр)
          const e = m.userData.en;
          if (on && was === false && e.t === 'rtorch') this.chips({ x: e.x, y: e.y + .5, z: e.z, kind: '#ff5a3a', floor: e.y }, 3, .25, .3);
        }
        m.userData.setLitT?.(on ? sp : 1 - sp, on, since); // после щелчка: пружина поверх конечного положения
      }
    }
    // разлёт крошек в нужный момент цикла: срезанный бамбук, голем в лаве
    const pT = this.lastDemoT;
    if (pT !== undefined) for (const [bt, x, y, z, kind, n = 8, floor = y] of D.bursts || []) {
      if ((pT < bt && T >= bt) || (pT > T && (bt > pT || bt <= T))) this.chips({ x, y, z, kind, floor }, n, .7, .5);
    }
    this.lastDemoT = T;
    const hidden = this.demoHidden; hidden.clear();
    for (const [ids, q, w] of this.demoHide) if (T >= q && T <= w) ids.forEach(id => hidden.add(id));
    for (const [id, m] of this.meshes) {
      const h = hidden.has(id);
      if (h && m.visible) { m.visible = false; m.userData.demoHidden = true; }
      else if (!h && m.userData.demoHidden) { m.userData.demoHidden = false; m.visible = this.shown(m); }
    }
    for (const [id, q, w] of D.hideEnt || []) {
      const m = this.entMeshes.get(id);
      if (m) m.visible = this.shown(m) && !(T >= q && T <= w);
    }
  }

  /* ---------- кадр ---------- */
  frame() {
    // рисуем только когда что-то меняется: на телефоне статичная сцена не жжёт батарею
    const real = this.clock.getElapsedTime();
    const dt = Math.min(.05, real - (this.lastT ?? real)); this.lastT = real;
    if (!this.onScreen) return;
    if (this.paused) {
      this.controls.update();
      if (this.dirty) { this.dirty = false; this.renderer.render(this.scene, this.camera); }
      return;
    }
    const t = this.at += dt;
    let busy = false;
    if (this.tween) {
      const u = Math.min(1, (t - this.tween.t0) / this.tween.dur), e = inOutCubic(u);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, e); this.controls.target.lerpVectors(this.tween.tf, this.tween.tt, e);
      if (u >= 1) this.tween = null;
      busy = true;
    }
    if (this.anims.length) {
      busy = true;
      let w = 0;
      for (const a of this.anims) {
        const u = (t - a.t0) / a.dur;
        this.pose(a, u);
        if (a.id !== undefined && u >= a.land && this.pending.has(a.id)) this.landed(a);
        if (u >= 1) this.endAnim(a); else this.anims[w++] = a;
      }
      this.anims.length = w;
    }
    // рамка «новое» щёлкает: чуть крупнее и сжимается на место
    if (this.hlAnims.length) {
      busy = true;
      for (const h of this.hlAnims) {
        const u = clamp01((t - h.t0) / .3);
        h.objs.forEach(o => o.scale.setScalar(h.s * (1 + .3 * (1 - outCubic(u)))));
        h.done = u >= 1;
      }
      this.hlAnims = this.hlAnims.filter(h => !h.done);
    }
    // курсор «по одному блоку» отскакивает к новой клетке
    if (this.cur?.visible && this.curT !== undefined) {
      const u = clamp01((t - this.curT) / .25);
      this.cur.scale.setScalar(1.1 + .25 * (1 - outBack(u, 2)));
      if (u < 1) busy = true;
    }
    // копание: по блоку бьют киркой — трещина растёт, блок вздрагивает от ударов, потом лопается крошками
    for (const d of this.digs) {
      if (d.broken) continue;
      // если кадры долго не шли, просроченные клетки просто исчезают, без лавины крошек
      if (t >= d.tb) { this.digBreak(d, t - d.tb < .3); busy = true; continue; }
      if (t < d.tb - CRACK_T) continue;
      if (!d.obj) this.digOpen(d);
      const st = Math.min(5, Math.floor((t - d.tb + CRACK_T) / CRACK_T * 6));
      if (st !== d.st) { d.st = st; d.crack.material = this.crack.mats[st]; d.crack.visible = true; d.hit = t; if (st % 2) this.chips(d, 2, .45, .35); }
      // удар: блок вжимается и чуть наклоняется, к концу дрожит сильнее
      const k = Math.max(0, 1 - (t - d.hit) / .09), s = 1 - .1 * k * k;
      const j = st >= 3 ? .012 * (st - 2) : 0, w = t * 70 + d.seed, tilt = .06 * k * (d.i % 2 ? 1 : -1);
      d.cube.scale.setScalar(s); d.crack.scale.setScalar(s); d.cube.rotation.z = d.crack.rotation.z = tilt;
      d.cube.position.set(.5 + Math.sin(w) * j, .5 + Math.sin(w * 1.3) * j, .5 + Math.cos(w * .9) * j); // куб стоит центром в .5
      d.crack.position.copy(d.cube.position);
      busy = true;
    }
    if (this.parts.length) {
      busy = true;
      let w = 0;
      for (const p of this.parts) {
        const u = (t - p.t0) / p.life;
        if (p.flash) { p.m.material.opacity = .7 * (1 - Math.min(1, u)) ** 2; p.m.scale.setScalar(1.02 + .35 * outCubic(Math.min(1, u))); }
        else {
          if (p.drag) p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
          p.v.y -= p.g * dt; p.m.position.addScaledVector(p.v, dt);
          // крошки отскакивают от пола ямы и катятся
          if (p.floor !== undefined && p.m.position.y < p.floor + .07) { p.m.position.y = p.floor + .07; p.v.y = Math.abs(p.v.y) * .35; p.v.x *= .6; p.v.z *= .6; p.spin.multiplyScalar(.6); }
          if (p.spin) { p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt; }
          const k = Math.min(1, u);
          p.m.scale.setScalar(Math.max(.01, p.s0 * (p.grow ? (1 + .8 * k) * (1 - k * k * k) : 1 - k * k * k)));
        }
        if (u >= 1) this.freePart(p); else this.parts[w++] = p;
      }
      this.parts.length = w;
    }
    const demoOn = this.opt.demo && this.farm && this.k === this.N && !RM.matches && t >= this.demoT0;
    if (this.lavaOn || demoOn) {
      // лава пиксельная: текстура сдвигается на пиксель раз в 1,25 с — рисуем только тогда
      const lava = mat('lava', { glow: true }), q = (Math.floor(t * .8) / 16) % 1;
      if (lava.map && lava.map.offset.y !== q) { lava.map.offset.y = q; busy = true; }
    }
    if (demoOn) {
      this.demoFrame((t - this.demoT0) % this.farm.demo.period); this.demoRunning = true; busy = true;
      // пока идёт демо, вода течёт, лава переливается
      tex('water').offset.y = (t * .12) % 1; tex('lava').offset.set((t * .03) % 1, (t * .05) % 1);
    }
    // демо остановилось — всё возвращаем: актёров, головы поршней, счётчик для крошек
    else if (this.demoRunning) { this.demoRunning = false; this.resetDemo(); busy = true; }
    this.controls.update();
    if (!busy && !this.dirty) return;
    this.dirty = false; this.lastDraw = t;
    const r0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    if (busy) this.adapt(performance.now() - r0);
  }
  // не тянет телефон — снижаем чёткость ступеньками (не ниже 1), а когда снова легко — возвращаем.
  // Смотрим на время самой отрисовки, а не на частоту кадров: экономный режим телефона даёт 30 к/с и при лёгкой сцене.
  adapt(ms) {
    this.slow = ms > 12 ? this.slow + 1 : Math.max(-120, this.slow - 1);
    let d = this.dpr;
    if (this.slow > 30 && d > 1) d = Math.max(1, d - .25);
    else if (this.slow <= -120 && d < this.dprMax) d = Math.min(this.dprMax, d + .25);
    else return;
    this.slow = 0; this.dpr = d;
    this.renderer.setPixelRatio(d); this.resize();
  }

  /* ---------- наведение ---------- */
  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    const objs = [...this.blockRoot.children.filter(o => o.visible), ...this.entRoot.children.filter(o => o.visible)];
    // прозрачный грунт не мешает наводиться на блоки внутри
    if (this.groundRoot.visible && this.opt.ground !== 'glass') this.groundRoot.traverse(o => o.userData.ground && objs.push(o));
    const hits = this.ray.intersectObjects(objs, true);
    for (const h of hits) {
      let o = h.object, ok = true;
      for (let p = o; p; p = p.parent) if (p.visible === false) { ok = false; break; }
      if (!ok) continue;
      if (o.userData.en) return { en: o.userData.en };
      if (o.userData.ent) return { ent: o.userData.ent };
      if (o.userData.ground) { const n = h.face.normal, q = h.point; return { ground: [Math.floor(q.x - n.x * .5), Math.floor(q.y - n.y * .5), Math.floor(q.z - n.z * .5)] }; }
    }
    return null;
  }
  onMove(e) {
    if (!this.cb.onHover) return;
    // пальцем или с зажатой кнопкой — это вращение, подсказка только мешает
    if (e.pointerType === 'touch' || e.buttons) { this.cb.onHover(null); return; }
    const now = performance.now(); if (now - this.lastPick < 45) return; this.lastPick = now;
    this.cb.onHover(this.pick(e), e);
  }
  onClick(e) { const p = this.pick(e); if (p && this.cb.onPick) this.cb.onPick(p); }
}
