// 3D-просмотрщик построек: шаги, анимация появления блоков, грунт, срез по слоям, демо.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BLOCKS, ENTS, DIRS, FACES, mat, maskGeo, label, setAniso } from './blocks.js';

const K = (x, y, z) => `${x},${y},${z}`;
const waterH = e => (e.p.src ? .875 : .72);
const TINT = new THREE.Color();
// Углы граней клетки (против часовой снаружи) и их UV: +x, −x, +y, −y, +z, −z
const QUAD = [
  [[1, 0, 1, 0, 0], [1, 0, 0, 1, 0], [1, 1, 0, 1, 1], [1, 1, 1, 0, 1]],
  [[0, 0, 0, 0, 0], [0, 0, 1, 1, 0], [0, 1, 1, 1, 1], [0, 1, 0, 0, 1]],
  [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [1, 1, 0, 1, 1], [0, 1, 0, 0, 1]],
  [[0, 0, 0, 0, 0], [1, 0, 0, 1, 0], [1, 0, 1, 1, 1], [0, 0, 1, 0, 1]],
  [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [1, 1, 1, 1, 1], [0, 1, 1, 0, 1]],
  [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [0, 1, 0, 1, 1], [1, 1, 0, 0, 1]],
];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
const ease = t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

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

export class Viewer {
  constructor(host, cb = {}) {
    this.host = host; this.cb = cb;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    setAniso(r.capabilities.getMaxAnisotropy());
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(r.domElement);
    r.domElement.setAttribute('aria-label', '3D-схема постройки: тяни, чтобы вращать, колесо — приблизить');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = .09; c.screenSpacePanning = true; c.maxPolarAngle = Math.PI * .96;
    c.addEventListener('start', () => { c.autoRotate = false; this.userMoved = true; });
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
    this.pGeo = new THREE.BoxGeometry(.15, .15, .15);
    this.crack = crackMats();
    this.dustMat = new THREE.MeshBasicMaterial({ color: 0xd9d2c3, transparent: true, opacity: .55, depthWrite: false });
    this.digRoot = new THREE.Group(); this.root.add(this.digRoot);
    this.anims = []; this.parts = []; this.animEnd = 0; this.dirty = true; this.isOn = true; this.lastDraw = 0;
    this.opt = { ground: 'glass', highlight: true, onlyNew: false, demo: true, cut: null };
    this.clock = new THREE.Clock();
    this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2(); this.lastPick = 0;
    r.domElement.addEventListener('pointermove', e => this.onMove(e));
    r.domElement.addEventListener('pointerleave', () => cb.onHover && cb.onHover(null));
    r.domElement.addEventListener('pointerdown', e => { this.down = [e.clientX, e.clientY]; });
    r.domElement.addEventListener('click', e => { if (this.down && Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) < 6) this.onClick(e); });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
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
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /* ---------- загрузка фермы ---------- */
  setFarm(farm) {
    this.disposeActors();
    for (const g of [this.blockRoot, this.entRoot, this.fxRoot, this.actorRoot, this.groundRoot, this.digRoot]) g.clear();
    // состояние прошлой фермы не должно дожить до новой (иначе buildHighlights читает шаг 0)
    this.parts = []; this.anims = []; this.tween = null; this.active = null; this.seq = null; this.sub = null; this.cutReset = false;
    if (this.cur) this.cur.visible = false;
    this.farm = farm; this.meshes = new Map(); this.entMeshes = new Map(); this.actors = null;
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
      dustConn: e => ['n', 's', 'e', 'w'].filter(d => {
        const [dx, , dz] = DIRS[d]; const nb = fa.get(K(e.x + dx, e.y, e.z + dz));
        if (!nb) return false;
        if (nb.t === 'dust') return true;
        if (nb.t === 'observer') { const [fx, , fz] = DIRS[nb.p.f || 'u']; return fx === dx && fz === dz; }
        if (nb.t === 'lever') return true;
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
    obj.traverse(o => { o.userData.en = en; if (o.userData.cull) obj.userData.cm = o; });
    this.blockRoot.add(obj); this.meshes.set(en.id, obj);
    return obj;
  }
  entFor(e) {
    if (this.entMeshes.has(e.id)) return this.entMeshes.get(e.id);
    const obj = ENTS[e.e].build(e.o || {});
    obj.position.set(e.x, e.y, e.z); obj.rotation.y = e.yaw || 0;
    obj.traverse(o => { o.userData.ent = e; });
    this.entRoot.add(obj); this.entMeshes.set(e.id, obj);
    return obj;
  }

  /* ---------- шаги ---------- */
  goto(k, { animate = true, replay = false } = {}) {
    k = Math.max(1, Math.min(this.N, k));
    const prev = this.k; this.k = k;
    // срез не должен прятать то, что ставится или копается в этом шаге
    this.cutReset = false;
    if (this.opt.cut !== null) { const sb = this.stepBounds(k); if (sb && sb.max.y - 1 > this.opt.cut) { this.opt.cut = null; this.cutReset = true; } }
    this.active = this.activeAt(k);
    const fwd = animate && !REDUCED && (k === prev + 1 || replay);
    const fresh = [];
    for (const en of this.entries) {
      const on = this.active.has(en.id);
      if (!on) { if (this.meshes.has(en.id)) this.meshes.get(en.id).visible = false; continue; }
      const m = this.meshFor(en);
      m.visible = true; m.userData.demoHidden = false; m.scale.setScalar(1); m.position.copy(m.userData.base);
      if (fwd && en.step === k) fresh.push(m);
    }
    this.anims = []; this.sub = null;
    this.clearDig();
    this.buildGround();
    // сначала по одному ломаются блоки грунта, потом по одному появляются новые
    const now = this.clock.getElapsedTime();
    const digEnd = fwd ? this.startDig(k, now + (replay ? .15 : .4)) : 0;
    this.animEnd = digEnd;
    if (fresh.length) {
      fresh.sort((a, b) => (a.userData.en.y - b.userData.en.y) || (a.userData.en.x + a.userData.en.z - b.userData.en.x - b.userData.en.z));
      const gap = Math.min(.07, 1.7 / fresh.length), t0 = digEnd ? digEnd + .2 : now;
      // пыль при установке: у больших шагов не у каждого блока, чтобы не рябило
      const every = Math.max(1, Math.ceil(fresh.length / 24));
      fresh.forEach((m, i) => { m.scale.setScalar(.001); this.anims.push({ m, t0: t0 + i * gap, dur: .3, dust: i % every === 0 && m.userData.en.t !== 'water' }); });
      this.animEnd = t0 + fresh.length * gap + .3;
    }
    this.refreshVisibility();
    this.buildHighlights();
    if (prev && prev !== k) { const sb = this.stepBounds(k); if (sb && k !== this.N) this.focusOn(sb); else this.fit('keep'); }
    this.cb.onStep && this.cb.onStep(k);
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
    this.tween = { from: this.camera.position.clone(), to: c.clone().add(dir.multiplyScalar(dist)), tf: this.controls.target.clone(), tt: c, t0: this.clock.getElapsedTime(), dur: .7 };
    this.dirty = true;
  }
  groundAt(x, y, z, k) {
    const G = this.farm.ground; if (!G) return false;
    const [x1, y1, z1, x2, , z2] = G.box;
    return x >= x1 && x <= x2 && y >= y1 && y <= G.top && z >= z1 && z <= z2 && this.natural(x, y, z, k);
  }
  digCells(k) {
    // клетки, где в этом шаге пропадает грунт: выкопанные и те, что заменяются новым блоком
    const s = this.farm.steps[k - 1], G = this.farm.ground; if (!G) return [];
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
    const gap = Math.min(.18, Math.max(.04, 3 / cells.length)), w = this.world();
    cells.forEach(([x, y, z], i) => {
      const kind = y === G.top ? 'grass' : y >= G.top - (G.dirt ?? 3) ? 'dirt' : 'stone';
      const obj = new THREE.Group(), cube = BLOCKS[kind].build({ t: kind, x, y, z, p: {} }, w);
      const edge = new THREE.LineSegments(this.edgeGeo, this.digCellMat); edge.position.set(.5, .5, .5); edge.scale.setScalar(1.01);
      const crack = new THREE.Mesh(this.crack.geo, this.crack.mats[0]); crack.position.set(.5, .5, .5); crack.visible = false;
      obj.add(cube, edge, crack); obj.position.set(x, y, z);
      obj.userData = { tb: t0 + CRACK_T + i * gap, kind, cube, crack, st: -1, hit: 0 };
      this.digRoot.add(obj);
    });
    return t0 + CRACK_T + (cells.length - 1) * gap + .25;
  }
  clearDig() {
    this.seq = null; if (this.cur) this.cur.visible = false;
    this.digRoot.clear();
    for (const p of this.parts) this.fxRoot.remove(p.m);
    this.parts = []; this.sub = null; this.dirty = true;
  }
  /* ---------- по одному блоку ---------- */
  putMeshes() {
    return this.entries.filter(en => en.step === this.k && this.active.has(en.id)).map(en => this.meshFor(en))
      .sort((a, b) => (a.userData.en.y - b.userData.en.y) || (a.userData.en.x + a.userData.en.z - b.userData.en.x - b.userData.en.z));
  }
  seqLen() { return this.digCells(this.k).length + this.putMeshes().length; }
  scrub(i) {
    if (!this.seq) {
      for (const a of this.anims) { a.m.scale.setScalar(1); a.m.position.copy(a.m.userData.base); }
      this.anims = []; this.clearDig(); this.startDig(this.k, Infinity);
      this.seq = { dig: [...this.digRoot.children], put: this.putMeshes() };
    }
    const { dig, put } = this.seq, cut = this.opt.cut, prev = this.sub ?? dig.length + put.length;
    let last = null;
    dig.forEach((o, j) => { const gone = j < i; if (gone && !o.userData.broken && i > prev) this.breakFx(o); o.userData.broken = gone; o.visible = !gone; if (j === i - 1) last = o.position; });
    put.forEach((m, j) => { const on = j < i - dig.length; m.scale.setScalar(1); m.position.copy(m.userData.base); m.visible = on && (cut === null || m.userData.en.y <= cut); if (j === i - 1 - dig.length) last = m.userData.base; });
    this.sub = i;
    if (!this.cur) { this.cur = new THREE.LineSegments(this.edgeGeo, new THREE.LineBasicMaterial({ color: 0xfff1a8 })); this.cur.scale.setScalar(1.1); this.root.add(this.cur); }
    this.cur.visible = !!last && i < dig.length + put.length;
    if (last) this.cur.position.set(last.x + .5, last.y + .5, last.z + .5);
    this.dirty = true;
  }
  breakFx(o) {
    const t = this.clock.getElapsedTime(), kind = o.userData.kind;
    for (let i = 0; i < 10; i++) {
      // крошки и дёрна, и земли: у травы часть крошек земляная, как у настоящего дёрна
      const m = new THREE.Mesh(this.pGeo, mat(kind === 'grass' ? (i % 3 ? 'dirt' : 'grass_top') : kind));
      m.position.set(o.position.x + .2 + Math.random() * .6, o.position.y + .2 + Math.random() * .6, o.position.z + .2 + Math.random() * .6);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.fxRoot.add(m);
      this.parts.push({ m, s0: .7 + Math.random() * .6, life: .55 + Math.random() * .25, g: 9.5,
        spin: new THREE.Vector3((Math.random() - .5) * 9, (Math.random() - .5) * 9, (Math.random() - .5) * 9),
        v: new THREE.Vector3((Math.random() - .5) * 3, 1.4 + Math.random() * 1.8, (Math.random() - .5) * 3), t0: t });
    }
  }
  // мягкая пыль из-под только что поставленного блока
  dustFx(m) {
    const t = this.clock.getElapsedTime(), b = m.userData.base;
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, p = new THREE.Mesh(this.pGeo, this.dustMat);
      p.position.set(b.x + .5 + Math.cos(a) * .45, b.y + .05, b.z + .5 + Math.sin(a) * .45);
      this.fxRoot.add(p);
      this.parts.push({ m: p, s0: .8 + Math.random() * .5, life: .45, g: -.6, spin: new THREE.Vector3(0, 2, 0),
        v: new THREE.Vector3(Math.cos(a) * 1.1, .35 + Math.random() * .3, Math.sin(a) * 1.1), t0: t });
    }
  }
  animLeft() { return Math.max(0, this.animEnd - this.clock.getElapsedTime()); }
  replay() { this.goto(this.k, { replay: true }); }
  refreshVisibility() {
    const cut = this.opt.cut;
    this.lavaOn = false;
    for (const [id, m] of this.meshes) {
      const en = this.entries[id];
      m.userData.demoHidden = false; // демо спрячет заново в следующем кадре, если надо
      let v = this.active?.has(id);
      if (v && cut !== null && en.y > cut) v = false;
      if (v && this.opt.onlyNew && en.step !== this.k) v = false;
      m.visible = !!v;
      if (v && en.t === 'lava') this.lavaOn = true;
    }
    // как в игре: стык двух стёкол (и двух клеток воды) не рисуется
    const vis = new Map();
    for (const [id, m] of this.meshes) if (m.visible) for (const [x, y, z] of this.entries[id].cells) vis.set(K(x, y, z), this.entries[id]);
    for (const [id, m] of this.meshes) {
      const cm = m.userData.cm; if (!cm || !m.visible) continue;
      const en = this.entries[id], kind = cm.userData.cull; let mask = 0;
      FACES.forEach(([dx, dy, dz], i) => {
        const nb = vis.get(K(en.x + dx, en.y + dy, en.z + dz)); if (!nb || nb.t !== kind) return;
        if (kind === 'glass' || dy !== 0 || waterH(nb) >= waterH(en)) mask |= 1 << i;
      });
      if (cm.userData.mask !== mask) { cm.userData.mask = mask; cm.geometry = maskGeo(...cm.userData.dims, mask); }
    }
    for (const e of this.ents) {
      const on = e.step <= this.k && (!e.until || this.k < e.until);
      const m = on ? this.entFor(e) : this.entMeshes.get(e.id);
      if (m) m.visible = this.entVisible(e);
    }
    this.groundRoot.visible = this.opt.ground !== 'off';
    this.dirty = true;
  }
  entVisible(e) {
    const cut = this.opt.cut;
    return e.step <= this.k && (!e.until || this.k < e.until) && !(cut !== null && e.y > cut + .2);
  }
  buildHighlights() {
    if (this.hl) { this.root.remove(this.hl); this.hl.traverse(o => o.userData.own && o.geometry.dispose()); }
    this.hl = new THREE.Group(); this.root.add(this.hl); this.dirty = true;
    if (!this.opt.highlight || !this.active || !this.k) return;
    const step = this.farm.steps[this.k - 1];
    // «копать»: одна общая фигура — контур по внешним рёбрам и лёгкая красная заливка, без каши из рамок
    const dug = new Set();
    for (const b of step.dig || []) for (const [x, y, z] of boxCells(b)) if (this.opt.cut === null || y <= this.opt.cut) dug.add(K(x, y, z));
    if (dug.size) this.hl.add(...this.shell(dug));
    for (const id of this.active) {
      const en = this.entries[id];
      if (en.step !== this.k || en.t === 'water' && !en.p.src) continue;
      if (this.opt.cut !== null && en.y > this.opt.cut) continue;
      for (const [x, y, z] of en.cells) {
        const l = new THREE.LineSegments(this.edgeGeo, this.hlMat); l.position.set(x + .5, y + .5, z + .5); l.scale.setScalar(1.04);
        this.hl.add(l);
      }
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
  buildGround() {
    // Грунт — кусок мира-«диорама»: рисуются только наружные грани (поверхность, стенки ям, срез).
    for (const o of this.groundRoot.children) { if (o.userData.ground) o.geometry.dispose(); else o.material.dispose(); }
    this.groundRoot.clear(); this.dirty = true;
    const G = this.farm.ground; if (!G) return;
    const [x1, y1, z1, x2, y2, z2] = G.box, top = G.top, dirt = G.dirt ?? 3, k = this.k, cut = this.opt.cut;
    const yTop = Math.min(y2, top, cut === null ? Infinity : cut);
    if (yTop < y1) return;
    const solid = (x, y, z) => x >= x1 && x <= x2 && y >= y1 && y <= yTop && z >= z1 && z <= z2 && this.natural(x, y, z, k);
    const buf = {}, B = key => (buf[key] ||= { p: [], n: [], uv: [], i: [] });
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= yTop; y++) for (let z = z1; z <= z2; z++) {
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
    const glass = this.opt.ground === 'glass';
    const o = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...(glass ? { transparent: true, opacity: .13, depthWrite: false } : {}) };
    for (const key in buf) {
      const b = buf[key], g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setIndex(b.i);
      const m = new THREE.Mesh(g, mat(key, o)); m.userData.ground = true; m.renderOrder = glass ? 1 : 0;
      this.groundRoot.add(m);
    }
    if (glass) {
      const box = new THREE.LineSegments(this.edgeGeo, new THREE.LineBasicMaterial({ color: 0xcdbf9f, transparent: true, opacity: .22, depthWrite: false }));
      box.scale.set(x2 - x1 + 1, yTop - y1 + 1, z2 - z1 + 1); box.position.set((x1 + x2 + 1) / 2, (y1 + yTop + 1) / 2, (z1 + z2 + 1) / 2);
      this.groundRoot.add(box);
    }
  }

  /* ---------- настройки ---------- */
  set(opt) {
    Object.assign(this.opt, opt);
    // любая настройка сбрасывает «по одному блоку» к целому шагу
    this.clearDig();
    if ('ground' in opt || 'cut' in opt) this.buildGround();
    this.refreshVisibility(); this.buildHighlights();
    if ('demo' in opt && !opt.demo) this.resetDemo();
  }
  bounds() {
    const b = new THREE.Box3();
    for (const en of this.entries) for (const [x, y, z] of en.cells) { b.expandByPoint(new THREE.Vector3(x, y, z)); b.expandByPoint(new THREE.Vector3(x + 1, y + 1, z + 1)); }
    for (const e of this.ents) b.expandByPoint(new THREE.Vector3(e.x, e.y + 1, e.z));
    return b;
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
    this.tween = { from: this.camera.position.clone(), to: c.clone().add(dir.multiplyScalar(dist)), tf: this.controls.target.clone(), tt: c, t0: this.clock.getElapsedTime(), dur: this.farm && this.k ? .6 : 0 };
    if (!this.tween.dur) { this.camera.position.copy(this.tween.to); this.controls.target.copy(c); this.tween = null; }
    this.camera.near = .1; this.camera.far = dist * 6; this.camera.updateProjectionMatrix();
    this.dirty = true;
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
  }
  resetDemo() {
    if (this.actors) this.actors.forEach(x => (x.obj.visible = false));
    for (const m of this.meshes.values()) if (m.userData.demoHidden) { m.userData.demoHidden = false; }
    this.refreshVisibility();
  }
  demoFrame(t) {
    const D = this.farm.demo; if (!D) return;
    if (!this.actors) this.buildActors();
    const T = t % D.period;
    for (const { a, obj, mats } of this.actors) {
      const ks = a.keys; let st = null;
      if (T >= ks[0][0] && T <= ks[ks.length - 1][0]) {
        for (let i = 0; i < ks.length - 1; i++) if (T >= ks[i][0] && T <= ks[i + 1][0]) {
          const [t0, ...p0] = ks[i], [t1, ...p1] = ks[i + 1]; const u = t1 > t0 ? (T - t0) / (t1 - t0) : 0;
          st = p0.map((v, j) => v + ((p1[j] ?? v) - v) * u); break;
        }
        if (!st) st = ks[ks.length - 1].slice(1);
      }
      if (!st) { obj.visible = false; continue; }
      const [x, y, z, s = 1, o = 1] = st;
      obj.visible = s > .01 && o > .01 && (a.label || this.opt.cut === null || y < this.opt.cut + 1);
      let sx = 0; if (a.shake && a.shake.some(([q, w]) => T >= q && T <= w)) sx = Math.sin(T * 45) * .05;
      obj.position.set(x + sx, y + (a.label ? 0 : 0), z);
      const bs = obj.userData.baseScale;
      if (bs) obj.scale.set(bs.x * s, bs.y * s, 1); else if (a.sy) obj.scale.set(1, s, 1); else obj.scale.setScalar(s);
      const fl = a.flash && a.flash.some(([q, w]) => T >= q && T <= w);
      for (const m of mats) {
        m.opacity = o;
        if (m.userData.c0) { m.color.copy(m.userData.c0); if (fl) m.color.multiply(TINT.setRGB(1.7 + .5 * Math.sin(T * 20), .62, .42)); }
      }
    }
    const hidden = new Set();
    for (const [x, y, z, q, w] of D.hide || []) if (T >= q && T <= w) { const ids = this.hist.get(K(x, y, z)); if (ids) ids.forEach(id => hidden.add(id)); }
    for (const [id, m] of this.meshes) {
      const h = hidden.has(id);
      if (h && m.visible) { m.visible = false; m.userData.demoHidden = true; }
      else if (!h && m.userData.demoHidden) { m.userData.demoHidden = false; m.visible = true; }
    }
    for (const [id, q, w] of D.hideEnt || []) {
      const m = this.entMeshes.get(id), e = this.ents.find(x => x.id === id);
      if (m && e) m.visible = this.entVisible(e) && !(T >= q && T <= w);
    }
  }

  /* ---------- кадр ---------- */
  frame() {
    // рисуем только когда что-то меняется: на телефоне статичная сцена не жжёт батарею
    const t = this.clock.getElapsedTime();
    let busy = false;
    if (this.tween) {
      const u = Math.min(1, (t - this.tween.t0) / this.tween.dur), e = 1 - Math.pow(1 - u, 3);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, e); this.controls.target.lerpVectors(this.tween.tf, this.tween.tt, e);
      if (u >= 1) this.tween = null;
      busy = true;
    }
    if (this.anims.length) busy = true;
    for (const an of this.anims) {
      const u = (t - an.t0) / an.dur; const m = an.m;
      if (u < 0) { m.scale.setScalar(.001); continue; }
      // блок ставится: вырастает из половины с лёгким пружинящим перебором и чуть опускается на место
      const v = Math.min(1, u); const s = .5 + .5 * ease(v);
      m.scale.set(s, s, s); m.position.set(m.userData.base.x + (1 - s) * .5, m.userData.base.y + (1 - v) * .22 + (1 - s) * .5, m.userData.base.z + (1 - s) * .5);
      if (v >= 1) { m.scale.setScalar(1); m.position.copy(m.userData.base); an.done = true; if (an.dust && m.visible) this.dustFx(m); }
    }
    this.anims = this.anims.filter(a => !a.done);
    // копание: по блоку бьют киркой — трещина растёт, блок вздрагивает от ударов, потом лопается крошками
    for (const o of this.digRoot.children) {
      const d = o.userData; if (d.broken) continue;
      if (t >= d.tb) { d.broken = true; o.visible = false; this.breakFx(o); busy = true; }
      else if (t >= d.tb - CRACK_T) {
        const st = Math.min(5, Math.floor((t - d.tb + CRACK_T) / CRACK_T * 6));
        if (st !== d.st) { d.st = st; d.crack.material = this.crack.mats[st]; d.crack.visible = true; d.hit = t; }
        const s = 1 - .05 * Math.max(0, 1 - (t - d.hit) / .08);
        const j = st >= 4 ? .03 : 0;
        d.cube.scale.setScalar(s); d.crack.scale.setScalar(s);
        d.cube.position.set(.5 + (Math.random() - .5) * j, .5 + (Math.random() - .5) * j, .5 + (Math.random() - .5) * j); // куб стоит центром в .5
        busy = true;
      }
    }
    const dt = Math.min(.05, t - (this.lastT ?? t)); this.lastT = t;
    if (this.parts.length) busy = true;
    for (const p of this.parts) {
      const u = (t - p.t0) / (p.life ?? .6);
      p.v.y -= (p.g ?? 9.5) * dt; p.m.position.addScaledVector(p.v, dt);
      if (p.spin) { p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt; }
      p.m.scale.setScalar(Math.max(.01, (p.s0 ?? 1) * (1 - u * u)));
      if (u >= 1) { this.fxRoot.remove(p.m); p.done = true; }
    }
    this.parts = this.parts.filter(p => !p.done);
    const demoOn = this.opt.demo && this.farm && this.k === this.N && !REDUCED;
    if (this.lavaOn || demoOn) {
      const lava = mat('lava', { glow: true });
      if (lava.map) lava.map.offset.y = (t * .05) % 1;
      if (t - this.lastDraw > 1 / 24) busy = true; // лава течёт медленно, 24 кадров хватает
    }
    if (demoOn) { this.demoFrame(t); busy = true; }
    else if (this.actors && this.actors.some(x => x.obj.visible)) { this.resetDemo(); busy = true; }
    this.controls.update();
    if (!busy && !this.dirty) return;
    this.dirty = false; this.lastDraw = t;
    this.renderer.render(this.scene, this.camera);
  }

  /* ---------- наведение ---------- */
  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    const objs = [...this.blockRoot.children.filter(o => o.visible), ...this.entRoot.children.filter(o => o.visible)];
    // прозрачный грунт не мешает наводиться на блоки внутри
    if (this.groundRoot.visible && this.opt.ground !== 'glass') objs.push(...this.groundRoot.children.filter(o => o.userData.ground));
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
