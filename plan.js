// Планировщик «как в выживании»: в каком порядке ставить блоки шага, где при этом стоять
// и где нужны временные блоки (столб под себя, мостик к висячему блоку). Их потом ломают.
// Правила игры, которые учитываем:
//  - блок ставится только к грани соседнего твёрдого блока (в воздух нельзя);
//  - факел, пыль, рельсы, тростник и т. п. — только на свою опору (снизу или сбоку, см. side);
//  - рука достаёт на 4,5 блока от глаз (Java: атрибут block_interaction_range), глаза на 1,62 над ногами;
//  - ходишь по твёрдому, шагаешь вверх на 1, спрыгиваешь до 3; блок нельзя поставить туда, где стоишь;
//  - временные блоки — строительные леса из бамбука: внутри них лазишь вверх и вниз, на них стоишь,
//    к ним прислоняешь блоки; сломал нижний — осыпается всё, что на нём держится.
// Ручные правки в файле фермы: в шаге plan: false — без планировщика (старая волна), temp: [[x,y,z] | box] —
// свои временные блоки, from: [x, y, z] — откуда начинать шаг; у фермы plan: false — выключить совсем.
import { BLOCKS, DIRS } from './blocks.js';

export const REACH = 4.5, EYE = 1.62;
export const TEMP_NAME = 'Строительные леса (временные)';
const R2 = REACH * REACH;
// сквозь это ходят, и к этому блок не прислонишь
const SOFT = new Set(['dust', 'air', 'lever', 'button', 'rtorch', 'torch', 'repeater', 'comparator', 'water', 'rail', 'powered_rail', 'sign', 'ladder', 'mark', 'sugar_cane', 'bamboo_shoot', 'melon_stem', 'pumpkin_stem', 'birch_sapling', 'carrots']);
// само вырастает или появляется
const AUTO = new Set(['melon', 'pumpkin', 'mark', 'air']);
// держится только на блоке снизу
const BELOW = new Set(['dust', 'rail', 'powered_rail', 'repeater', 'comparator', 'sugar_cane', 'bamboo_shoot', 'bamboo', 'birch_sapling', 'carrots', 'melon_stem', 'pumpkin_stem', 'iron_door']);
// держится на блоке со стороны side (по умолчанию снизу)
const SIDED = new Set(['torch', 'rtorch', 'sign', 'ladder', 'lever', 'button']);
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const K = (x, y, z) => `${x},${y},${z}`;

function expand(e) {
  const t = e[0], nums = e.slice(1);
  let p = {};
  if (nums.length && typeof nums[nums.length - 1] === 'object') p = nums.pop();
  if (nums.length === 3) return [{ t, x: nums[0], y: nums[1], z: nums[2], p }];
  const [a, b, c, d, f, g] = nums, out = [];
  for (let x = Math.min(a, d); x <= Math.max(a, d); x++)
    for (let y = Math.min(b, f); y <= Math.max(b, f); y++)
      for (let z = Math.min(c, g); z <= Math.max(c, g); z++) out.push({ t, x, y, z, p });
  return out;
}
function box(b) {
  const [a, c, d, e, f, g] = b.length === 3 ? [...b, ...b] : b, out = [];
  for (let x = Math.min(a, e); x <= Math.max(a, e); x++)
    for (let y = Math.min(c, f); y <= Math.max(c, f); y++)
      for (let z = Math.min(d, g); z <= Math.max(d, g); z++) out.push([x, y, z]);
  return out;
}
const cellsOf = en => (BLOCKS[en.t]?.cells ? BLOCKS[en.t].cells(en) : [[0, 0, 0]]).map(([dx, dy, dz]) => [en.x + dx, en.y + dy, en.z + dz]);
// блок ставят руками (а не вырастает и не растекается сам)
export const planned = en => !(AUTO.has(en.t) || en.p.free || (en.t === 'water' && !en.p.src));
const reqDir = en => (BELOW.has(en.t) ? 'd' : SIDED.has(en.t) ? (en.p.side || 'd') : null);
const cls = t => (t === 'lava' ? 3 : SOFT.has(t) ? 1 : 2); // 0 пусто, 1 сквозь ходят, 2 твёрдое, 3 лава, 4 леса
const firm = v => v === 2 || v === 4; // на этом стоишь и к этому прислоняешь блок

const cache = new WeakMap();
// план на все шаги (шаг начинается там, где закончился прошлый): [{ acts, order, temps, ok }] или null у шага без плана
export function planFarm(f) {
  if (!cache.has(f)) { let r; try { r = new Planner(f).all(); } catch (e) { console.warn('план постройки:', e); r = f.steps.map(() => null); } cache.set(f, r); }
  return cache.get(f);
}

class Planner {
  constructor(f) {
    this.f = f; this.G = f.ground || null;
    this.entries = []; this.hist = new Map(); this.digAt = new Map();
    f.steps.forEach((s, i) => {
      const step = i + 1;
      for (const b of s.dig || []) for (const [x, y, z] of box(b)) { const k = K(x, y, z); if (!this.digAt.has(k)) this.digAt.set(k, step); }
      for (const p of s.put || []) for (const en of expand(p)) {
        if (!BLOCKS[en.t]) continue;
        en.step = step; en.id = this.entries.length; en.cells = cellsOf(en); this.entries.push(en);
        for (const [x, y, z] of en.cells) { const k = K(x, y, z); if (!this.hist.has(k)) this.hist.set(k, []); this.hist.get(k).push(en.id); }
      }
    });
    // рабочая коробка: где можно ходить (по грунту-диораме) и строить столбы
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const en of this.entries) for (const [x, y, z] of en.cells) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (!this.entries.length) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 0; }
    const G = this.G;
    if (G) { const b = G.box; this.X0 = b[0]; this.X1 = b[3]; this.Z0 = b[2]; this.Z1 = b[5]; this.Y0 = b[1]; this.Y1 = Math.max(y1, G.top) + 10; this.floor = b[1] - 1; }
    else { this.X0 = x0 - 4; this.X1 = x1 + 4; this.Z0 = z0 - 4; this.Z1 = z1 + 4; this.floor = y0 - 1; this.Y0 = y0; this.Y1 = y1 + 10; }
    this.NX = this.X1 - this.X0 + 1; this.NY = this.Y1 - this.Y0 + 1; this.NZ = this.Z1 - this.Z0 + 1;
    const n = this.NX * this.NY * this.NZ;
    this.grid = new Uint8Array(n); this.dist = new Int32Array(n); this.prev = new Int32Array(n); this.rem = new Map();
  }
  idx(x, y, z) { return ((x - this.X0) * this.NY + (y - this.Y0)) * this.NZ + (z - this.Z0); }
  inR(x, y, z) { return x >= this.X0 && x <= this.X1 && y >= this.Y0 && y <= this.Y1 && z >= this.Z0 && z <= this.Z1; }
  xyz(i) { const z = i % this.NZ, r = (i - z) / this.NZ, y = r % this.NY, x = (r - y) / this.NY; return [x + this.X0, y + this.Y0, z + this.Z0]; }
  c(x, y, z) { return this.inR(x, y, z) ? this.grid[this.idx(x, y, z)] : (y <= this.floor ? 2 : 0); }
  // грунт-диорама на шаге k: не выкопан и не занят блоком
  natural(x, y, z, k) {
    const G = this.G; if (!G) return y <= this.floor;
    if (y > G.top || y > G.box[4] || y < G.box[1]) return false;
    const key = K(x, y, z), d = this.digAt.get(key); if (d !== undefined && d <= k) return false;
    const ids = this.hist.get(key); if (ids && this.entries[ids[0]].step <= k) return false;
    return true;
  }
  activeAt(k) {
    const act = new Set();
    for (const ids of this.hist.values()) { let cur = null; for (const id of ids) if (this.entries[id].step <= k) cur = id; if (cur !== null && this.entries[cur].t !== 'air') act.add(cur); }
    return act;
  }
  all() {
    const out = []; let P = null, prev = new Set();
    this.f.steps.forEach((s, i) => {
      const k = i + 1, act = this.activeAt(k);
      const r = (this.f.plan === false || s.plan === false) ? null : this.step(k, s, prev, act, P);
      out.push(r); if (r) P = r.end;
      prev = act;
    });
    return out;
  }
  free(x, y, z) { const v = this.c(x, y, z); return v <= 1 || v === 4; }
  standable(x, y, z) { return this.inR(x, y, z) && this.free(x, y, z) && this.free(x, y + 1, z) && firm(this.c(x, y - 1, z)); }
  // ближайшая клетка, где можно стоять (обходом во все стороны)
  settle(p, maxN = 6000) {
    if (!p) return null;
    let [x, y, z] = p;
    x = Math.max(this.X0, Math.min(this.X1, x)); z = Math.max(this.Z0, Math.min(this.Z1, z)); y = Math.max(this.Y0, Math.min(this.Y1 - 2, y));
    if (this.standable(x, y, z)) return [x, y, z];
    const seen = new Set([this.idx(x, y, z)]), q = [[x, y, z]];
    for (let h = 0; h < q.length && h < maxN; h++) {
      const [a, b, c] = q[h];
      for (const [dx, dy, dz] of N6) {
        const nx = a + dx, ny = b + dy, nz = c + dz; if (!this.inR(nx, ny, nz)) continue;
        const i = this.idx(nx, ny, nz); if (seen.has(i)) continue; seen.add(i);
        if (this.standable(nx, ny, nz)) return [nx, ny, nz];
        q.push([nx, ny, nz]);
      }
    }
    return null;
  }
  // куда можно дойти пешком: шаг по ровному, вверх на 1 (над головой пусто), вниз до 3
  bfs(P) {
    const D = this.dist, PR = this.prev; D.fill(-1);
    const s = this.idx(...P); D[s] = 0; PR[s] = -1;
    const q = [s], spots = [];
    for (let h = 0; h < q.length; h++) {
      const i = q[h], [x, y, z] = this.xyz(i); spots.push(i);
      // внутри лесов лезешь вверх (прыжок) и вниз (Shift)
      for (const dy of [1, -1]) {
        const ny = y + dy; if (!this.inR(x, ny, z)) continue;
        if (dy > 0 ? !(this.c(x, y, z) === 4 && this.c(x, ny, z) === 4 && this.free(x, ny + 1, z)) : !(this.c(x, ny, z) === 4 && this.standable(x, ny, z))) continue;
        const j = this.idx(x, ny, z); if (D[j] >= 0) continue;
        D[j] = D[i] + 1; PR[j] = i; q.push(j);
      }
      for (const [dx, dz] of N4) {
        const nx = x + dx, nz = z + dz; let ty = null;
        if (nx < this.X0 || nx > this.X1 || nz < this.Z0 || nz > this.Z1) continue;
        if (this.standable(nx, y, nz)) ty = y;
        else if (!this.free(nx, y, nz) || !this.free(nx, y + 1, nz)) { if (this.free(x, y + 2, z) && this.standable(nx, y + 1, nz)) ty = y + 1; }
        else for (let d = 1; d <= 3; d++) { if (!this.free(nx, y - d, nz)) break; if (this.standable(nx, y - d, nz)) { ty = y - d; break; } }
        if (ty === null || !this.inR(nx, ty, nz)) continue;
        const j = this.idx(nx, ty, nz); if (D[j] >= 0) continue;
        D[j] = D[i] + 1; PR[j] = i; q.push(j);
      }
    }
    return spots;
  }
  path(to) { const out = []; for (let i = this.idx(...to); i >= 0; i = this.prev[i]) out.push(this.xyz(i)); return out.reverse(); }
  reach(s, [cx, cy, cz]) {
    const ex = s[0] + .5, ey = s[1] + EYE, ez = s[2] + .5;
    const dx = Math.max(cx - ex, 0, ex - cx - 1), dy = Math.max(cy - ey, 0, ey - cy - 1), dz = Math.max(cz - ez, 0, ez - cz - 1);
    return dx * dx + dy * dy + dz * dz <= R2;
  }
  hitsBody(s, cells) { return cells.some(([x, y, z]) => x === s[0] && z === s[2] && (y === s[1] || y === s[1] + 1)); }
  // луч от глаз до точки: твёрдое и чужие леса заслоняют
  see(E, T, s) {
    const dx = T[0] - E[0], dy = T[1] - E[1], dz = T[2] - E[2], L = Math.hypot(dx, dy, dz);
    if (L > REACH) return false;
    const n = Math.ceil(L / .07);
    for (let i = 1; i < n; i++) {
      const u = i / n, x = Math.floor(E[0] + dx * u), y = Math.floor(E[1] + dy * u), z = Math.floor(E[2] + dz * u), v = this.c(x, y, z);
      if (v === 2 || (v === 4 && !(x === s[0] && z === s[2]))) return false;
    }
    return true;
  }
  // видна ли с места s грань блока nb, обращённая по нормали m (точки на грани: центр и ближе к углам)
  faceSeen(s, nb, m) {
    const E = [s[0] + .5, s[1] + EYE, s[2] + .5], fc = [nb[0] + .5 + m[0] * .5, nb[1] + .5 + m[1] * .5, nb[2] + .5 + m[2] * .5];
    if ((E[0] - fc[0]) * m[0] + (E[1] - fc[1]) * m[1] + (E[2] - fc[2]) * m[2] <= .02) return false; // грань отвёрнута от глаз
    const ax = [0, 1, 2].filter(i => !m[i]);
    for (const [p, q] of [[0, 0], [.35, .35], [-.35, .35], [.35, -.35], [-.35, -.35]]) {
      const T = [fc[0] + m[0] * .02, fc[1] + m[1] * .02, fc[2] + m[2] * .02]; T[ax[0]] += p; T[ax[1]] += q;
      if (this.see(E, T, s)) return true;
    }
    return false;
  }
  // можно ли с места s поставить блок: нужна видимая грань опоры в пределах руки (как правый клик в игре)
  canPlace(s, it) {
    if (this.hitsBody(s, it.cells)) return false;
    const rd = it.en && reqDir(it.en), own = new Set(it.cells.map(c => K(...c)));
    for (const c of rd ? [it.cells[0]] : it.cells) for (const n of rd ? [DIRS[rd]] : N6) {
      const nb = [c[0] + n[0], c[1] + n[1], c[2] + n[2]];
      if (own.has(K(...nb)) || !firm(this.c(...nb))) continue;
      if (this.faceSeen(s, nb, [-n[0], -n[1], -n[2]])) return true;
    }
    return false;
  }
  // можно ли с места s ударить по блоку c (сломать леса)
  canHit(s, c) { return N6.some(m => this.faceSeen(s, c, m)); }
  // ближайшее (по ходьбе) место, откуда реально ставится блок; spots — итог последнего обхода
  spotFor(it, spots, hit = false) {
    const c0 = it.cells[0], cand = [];
    // ниже поверхности стоять дороже: в яму спускаешься, только если сверху никак (иначе замуруешь себя люками)
    const ref = this.G ? this.G.top + 1 : this.floor + 1;
    const scan = s => { const d = this.dist[this.idx(...s)]; if (d < 0 || !this.reach(s, c0)) return; cand.push([d + Math.max(0, ref - s[1]) * 4, s]); };
    if (spots.length < 1331) for (const i of spots) scan(this.xyz(i));
    else for (let x = c0[0] - 5; x <= c0[0] + 5; x++) for (let z = c0[2] - 5; z <= c0[2] + 5; z++) for (let y = c0[1] - 6; y <= c0[1] + 4; y++) if (this.inR(x, y, z)) scan([x, y, z]);
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, s] of cand) if (hit ? this.canHit(s, c0) : this.canPlace(s, it)) return s;
    return null;
  }
  supported(it) {
    const rd = it.en && reqDir(it.en);
    if (rd) { const [x, y, z] = it.cells[0], d = DIRS[rd]; return this.c(x + d[0], y + d[1], z + d[2]) === 2; }
    const own = new Set(it.cells.map(c => K(...c)));
    return it.cells.some(([x, y, z]) => N6.some(([dx, dy, dz]) => !own.has(K(x + dx, y + dy, z + dz)) && firm(this.c(x + dx, y + dy, z + dz))));
  }
  setCells(it, v) { for (const [x, y, z] of it.cells) if (this.inR(x, y, z)) this.grid[this.idx(x, y, z)] = v; }

  step(k, s, prev, act, P0) {
    const G = this.G; this.grid.fill(0);
    for (let x = this.X0; x <= this.X1; x++) for (let y = this.Y0; y <= this.Y1; y++) for (let z = this.Z0; z <= this.Z1; z++) if (this.natural(x, y, z, k)) this.grid[this.idx(x, y, z)] = 2;
    for (const id of prev) if (act.has(id)) { const en = this.entries[id]; for (const [x, y, z] of en.cells) if (this.inR(x, y, z)) this.grid[this.idx(x, y, z)] = cls(en.t); }
    const rem = [];
    for (const en of this.entries) if (en.step === k && act.has(en.id) && planned(en)) rem.push({ en, cells: en.cells });
    if (!rem.length) return null;
    this.rem = new Map();
    for (const it of rem) for (const [x, y, z] of it.cells) this.rem.set(K(x, y, z), it);
    for (const b of s.temp || []) for (const c of box(b)) if (this.c(...c) === 0 && !this.rem.has(K(...c))) { const it = { cells: [c], temp: true }; rem.push(it); this.rem.set(K(...c), it); }
    // откуда начинаем: from, конец прошлого шага, «где стоишь» шага, середина постройки на поверхности
    const cen = rem.reduce((a, it) => [a[0] + it.cells[0][0] / rem.length, a[1] + it.cells[0][1] / rem.length, a[2] + it.cells[0][2] / rem.length], [0, 0, 0]);
    const fl = e => e && [Math.floor(e[0]), Math.floor(e[1]), Math.floor(e[2])];
    let P = this.settle(fl(s.from)) || this.settle(P0) || this.settle(fl(s.eye || this.f.eye)) || this.settle([Math.round(cen[0]), G ? G.top + 1 : this.floor + 1, Math.round(cen[2])], 40000);
    if (!P) return null;
    const start = P, acts = [], order = [], live = []; let maxLive = 0, ok = true;
    const goTo = s2 => { if (s2[0] !== P[0] || s2[1] !== P[1] || s2[2] !== P[2]) { const p = this.path(s2); if (p.length > 1) acts.push({ a: 'go', path: p }); P = s2; } };
    const putTemp = (c, rise) => {
      this.grid[this.idx(...c)] = 4; live.push(c); maxLive = Math.max(maxLive, live.length);
      acts.push({ a: 'tmp', c, rise }); if (rise) P = [P[0], P[1] + 1, P[2]];
    };
    const place = it => {
      const i = rem.indexOf(it); rem.splice(i, 1);
      for (const c of it.cells) this.rem.delete(K(...c));
      if (it.temp) putTemp(it.cells[0], false);
      else { this.setCells(it, cls(it.en.t)); acts.push({ a: 'put', id: it.en.id }); order.push(it.en.id); }
    };
    const prio = it => (it.temp ? -1e6 : 0) + it.cells[0][1] * 1000 + Math.abs(it.cells[0][0] - P[0]) + Math.abs(it.cells[0][2] - P[2]);
    // сойти со своего столба: ломаешь блок под ногами и спрыгиваешь
    const below = () => live.findIndex(c => c[0] === P[0] && c[1] === P[1] - 1 && c[2] === P[2]);
    const descend = () => {
      const j = below(); if (j < 0) return false;
      // по лесам спускаешься внутри столба (Shift), ничего не ломая
      let y = P[1] - 1; while (this.c(P[0], y - 1, P[2]) === 4) y--;
      const to = [P[0], y, P[2]]; if (!this.standable(...to)) return false;
      const path = []; for (let yy = P[1]; yy >= y; yy--) path.push([P[0], yy, P[2]]);
      acts.push({ a: 'go', path }); P = to; return true;
    };
    const fall = () => {
      if (this.standable(...P)) return;
      let y = P[1]; while (y > this.Y0 && this.free(P[0], y, P[2]) && !this.standable(P[0], y, P[2])) y--;
      const to = this.standable(P[0], y, P[2]) ? [P[0], y, P[2]] : this.settle(P);
      if (to) { acts.push({ a: 'fall', to }); P = to; }
    };
    const ref = G ? G.top + 1 : this.floor + 1;
    // ломаем леса: у каждой связной кучки — нижний блок (стоя рядом, не на ней), осыпается вся; keep — кучку под ногами не трогать
    const tear = (keep, T) => {
      let n = 0;
      const lk = new Set(live.map(c => K(...c)));
      while (lk.size) {
        const seed = live.slice().reverse().find(c => lk.has(K(...c))), comp = [seed], seen = new Set([K(...seed)]);
        for (let h = 0; h < comp.length; h++) for (const [dx, dy, dz] of N6) {
          const nn = [comp[h][0] + dx, comp[h][1] + dy, comp[h][2] + dz], kk = K(...nn);
          if (lk.has(kk) && !seen.has(kk)) { seen.add(kk); comp.push(nn); }
        }
        for (const c of comp) lk.delete(K(...c));
        if (keep && seen.has(keep)) continue;
        // кучка рядом со следующим блоком — пригодится (нарастишь её), не ломаем
        if (T && comp.some(c => Math.abs(c[0] - T.cells[0][0]) + Math.abs(c[2] - T.cells[0][2]) <= 2)) continue;
        // кучка держит ещё не поставленный блок (мостик под висячий) — пока нужна
        if (keep !== null && comp.some(c => N6.some(([dx, dy, dz]) => this.rem.has(K(c[0] + dx, c[1] + dy, c[2] + dz))))) continue;
        const base = comp.reduce((a, c) => (c[1] < a[1] ? c : a));
        comp.sort((a, b) => (a[1] - b[1]) || (Math.abs(a[0] - base[0]) + Math.abs(a[2] - base[2]) - Math.abs(b[0] - base[0]) - Math.abs(b[2] - base[2])));
        const spots = this.bfs(P).filter(i => { const [x, y, z] = this.xyz(i); return !seen.has(K(x, y - 1, z)) && !seen.has(K(x, y, z)) && !seen.has(K(x, y + 1, z)); });
        const sp = this.spotFor({ cells: [base] }, spots, true);
        if (sp) goTo(sp);
        for (const c of comp) { this.grid[this.idx(...c)] = 0; const j = live.findIndex(l => l[0] === c[0] && l[1] === c[1] && l[2] === c[2]); if (j >= 0) live.splice(j, 1); }
        acts.push({ a: 'rm', c: base, cells: comp, warp: !sp }); n++;
        fall();
      }
      return n > 0;
    };
    let guard = rem.length * 8 + 200;
    while (rem.length && guard-- > 0) {
      const spots = this.bfs(P);
      const sup = rem.filter(it => this.supported(it)).sort((a, b) => prio(a) - prio(b));
      let done = false;
      for (const it of sup) {
        const sp = this.spotFor(it, spots); if (!sp) continue;
        // сидишь в яме, а до блока можно достать и с поверхности — сначала вылезь (столбиком под себя)
        if (sp[1] < ref && this.fromTop(it, ref) && !spots.some(i => this.xyz(i)[1] >= ref) && this.climb(putTemp, () => P, ref)) { done = true; break; }
        goTo(sp); place(it); done = true; break;
      }
      if (done) continue;
      const T = sup[0];
      if (T && T.cells[0][1] < P[1] - 1 && descend()) continue;
      // отсюда ничего не достать — старые леса больше не нужны (до полезных дошёл бы пешком по ним):
      // слезь и сломай их, прежде чем строить новые, — в руках не нужно таскать гору лесов
      if (live.length) {
        if (P[1] > ref && descend()) continue;
        if (tear(below() >= 0 ? K(P[0], P[1] - 1, P[2]) : '', T)) continue;
      }
      if (sup.slice(0, 6).some(t => this.pillar(t, spots, goTo, putTemp, () => P))) continue;
      if (!T && this.bridge(rem, prio)) continue;
      if (descend()) continue;
      ok = false; break;
    }
    // не вышло по правилам — остальное просто ставим по порядку (лучше так, чем никак)
    if (rem.length) { ok = false; rem.sort((a, b) => prio(a) - prio(b)); while (rem.length) place(rem[0]); }
    tear(null);
    return { acts, order, temps: maxLive, ok, start, end: P };
  }
  // есть ли на поверхности место, откуда достаёшь до блока
  fromTop(it, ref) {
    const [cx, , cz] = it.cells[0];
    for (let x = cx - 4; x <= cx + 4; x++) for (let z = cz - 4; z <= cz + 4; z++) for (const y of [ref, ref + 1]) if (this.standable(x, y, z) && this.canPlace([x, y, z], it)) return true;
    return false;
  }
  // вылезти из ямы: блок под себя, пока рядом не окажется поверхность
  climb(putTemp, getP, ref) {
    for (let h = 0; h < 8; h++) {
      const P = getP();
      if (P[1] >= ref) return h > 0;
      if (!this.free(P[0], P[1] + 2, P[2]) || this.rem.has(K(P[0], P[1], P[2])) || this.rem.has(K(P[0], P[1] + 2, P[2]))) return h > 0;
      putTemp([P[0], P[1], P[2]], true);
      const spots = this.bfs(getP());
      if (spots.some(i => this.xyz(i)[1] >= ref)) return true;
    }
    return true;
  }
  // столб под себя: прыгаешь и ставишь блок под ноги, пока не достанешь до цели
  pillar(T, spots, goTo, putTemp, getP) {
    const c0 = T.cells[0]; let best = null, bc = Infinity;
    for (const i of spots) {
      const s = this.xyz(i), d = this.dist[i];
      if (Math.abs(s[0] - c0[0]) > 5 || Math.abs(s[2] - c0[2]) > 5 || s[1] > c0[1]) continue;
      for (let H = 1; H <= 32; H++) {
        const top = s[1] + H;
        // под столб: клетка пустая и не нужна постройке; на верху — место телу
        if (!this.inR(s[0], top + 1, s[2]) || !this.free(s[0], top + 1, s[2]) || this.rem.has(K(s[0], top + 1, s[2])) || this.rem.has(K(s[0], top - 1, s[2]))) break;
        if (H > 1 && this.c(s[0], top - 1, s[2]) !== 0) break;
        const cost = H * 4 + d;
        if (cost >= bc) break;
        const at = [s[0], top, s[2]];
        if (this.reach(at, c0) && this.canPlace(at, T)) { best = [s, H]; bc = cost; break; }
      }
    }
    if (!best) return false;
    const [s, H] = best; goTo(s);
    for (let h = 0; h < H; h++) { const P = getP(); putTemp([P[0], P[1], P[2]], true); }
    return true;
  }
  // висячий блок: от него к ближайшей опоре — цепочка временных блоков (их потом сломают)
  bridge(rem, prio) {
    let T = [...rem].sort((a, b) => prio(a) - prio(b))[0];
    for (let g = 0; g < 8 && T; g++) {
      const rd = T.en && reqDir(T.en); if (!rd) break;
      const [x, y, z] = T.cells[0], d = DIRS[rd], nb = this.rem.get(K(x + d[0], y + d[1], z + d[2]));
      if (!nb) break; T = nb;
    }
    if (!T) return false;
    const rd = T.en && reqDir(T.en), [x, y, z] = T.cells[0];
    const starts = rd ? [[x + DIRS[rd][0], y + DIRS[rd][1], z + DIRS[rd][2]]] : N6.map(([dx, dy, dz]) => [x + dx, y + dy, z + dz]);
    const ok = c => this.inR(...c) && this.c(...c) === 0 && !this.rem.has(K(...c));
    const par = new Map(), q = [];
    for (const c of starts) if (ok(c) && !par.has(K(...c))) { par.set(K(...c), null); q.push(c); }
    // вниз — дешевле: так мостик чаще встаёт столбиком на землю, а не висит
    for (let h = 0; h < q.length && h < 5000; h++) {
      const c = q[h];
      if (firm(this.c(c[0], c[1] - 1, c[2]))) { // леса держатся, только если стоят на чём-то
        const chain = []; for (let k = K(...c), cc = c; cc; cc = par.get(k), k = cc && K(...cc)) chain.push(cc);
        for (const cc of chain) { const it = { cells: [cc], temp: true }; rem.push(it); this.rem.set(K(...cc), it); }
        return true;
      }
      for (const [dx, dy, dz] of [[0, -1, 0], ...N6.filter(n => n[1] !== -1)]) {
        const n = [c[0] + dx, c[1] + dy, c[2] + dz], kk = K(...n);
        if (!par.has(kk) && ok(n)) { par.set(kk, c); q.push(n); }
      }
    }
    return false;
  }
}
