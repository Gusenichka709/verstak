// Вкладка «Редактор»: собери свою схему блок за блоком, разбей на шаги и скопируй текстом.
// Схема — тот же формат, что у ферм: steps[{ t, put: [[блок, x, y, z, {свойства}]], dig: [[x, y, z]], ents: [...] }].
import * as THREE from 'three';
import { Viewer } from './engine.js';
import { BLOCKS, ENTS } from './blocks.js';
import { load, save } from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// что можно поставить: блоки по разделам и мобы/предметы
const GROUPS = [
  ['b', 'Блоки'], ['m', 'Устройства'], ['r', 'Редстоун'], ['f', 'Жидкости'], ['x', 'Метки'],
];
const MOBS = ['villager', 'villager_baby', 'zombie', 'zvillager', 'golem', 'boat', 'minecart', 'hopper_minecart'];
const SKIP = new Set(['air', 'melon', 'pumpkin', 'birch_leaves', 'birch_log']);
// куда может смотреть блок
const F6 = ['n', 's', 'e', 'w', 'u', 'd'], F4 = ['n', 's', 'e', 'w'];
const FACING = { piston: F6, sticky_piston: F6, observer: F6, chest: F4, blast_furnace: F4, bed: F4, repeater: F4, comparator: F4, dispenser: F4, hopper: ['d', 'n', 's', 'e', 'w'] };
const DIRN = { n: 'север', s: 'юг', e: 'восток', w: 'запад', u: 'вверх', d: 'вниз' };
// что вешается на опору: опору берём из грани, по которой кликнул
const WALLED = new Set(['lever', 'button', 'torch', 'rtorch', 'sign', 'ladder', 'iron_door', 'trapdoor']);
const OPP = { '1,0,0': 'w', '-1,0,0': 'e', '0,0,1': 'n', '0,0,-1': 's' };

const blank = () => ({ title: 'Моя схема', steps: [{ t: 'Шаг 1', put: [], dig: [], ents: [] }], cur: 0 });
let S = load('editor', null) || blank();
let tool = { t: 'cobble', mode: 'place', f: 'n', water: 'src', top: false, open: false, on: false, axis: 'x', depth: 1, rect: false, ...load('editorTool', {}) };
let ev = null, undo = [], booted = false, cut = null, solo = false, shift = false;
let corner = null, hoverAt = null; // corner — первый угол прямоугольника; hoverAt — клетка под мышкой (для «F»)

function persist() { save('editor', S); save('editorTool', tool); }
function snapshot() { undo.push(JSON.stringify(S)); if (undo.length > 60) undo.shift(); }
const step = () => S.steps[S.cur];

/* ---------- картинки блоков для палитры ---------- */
const thumbs = new Map();
function makeThumbs(keys) {
  let R; try { R = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); } catch { return; }
  R.setPixelRatio(1); R.setSize(48, 48); R.outputColorSpace = THREE.SRGBColorSpace;
  const cam = new THREE.OrthographicCamera(-.85, .85, .85, -.85, .1, 20); cam.position.set(3.2, 2.7, 3.8); cam.lookAt(0, 0, 0);
  const W = { isType: () => false, dustConn: () => [], dustUp: () => [], at: () => null };
  for (const [k, isMob] of keys) {
    const sc = new THREE.Scene(), g = new THREE.Group();
    const o = isMob ? ENTS[k].build({}) : BLOCKS[k].build({ t: k, x: 0, y: 0, z: 0, p: k === 'water' ? { src: true } : {} }, W);
    g.add(o);
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    g.position.sub(c); const h = Math.max(sz.x, sz.y, sz.z, .5) * .75;
    cam.left = cam.bottom = -h; cam.right = cam.top = h; cam.updateProjectionMatrix();
    sc.add(g); R.render(sc, cam); thumbs.set(k, R.domElement.toDataURL('image/png'));
  }
  R.dispose(); R.forceContextLoss();
}

/* ---------- схема → «ферма» для 3D ---------- */
function asFarm() {
  return {
    id: 'editor', title: S.title, short: '', badges: [], stats: [],
    ground: { box: [-14, -16, -14, 14, -1, 14], top: -1, dirt: 3, mode: 'solid' },
    view: { dir: [-.8, 1, 1.1], zoom: .7 },
    steps: S.steps.map((s, i) => ({ t: s.t || `Шаг ${i + 1}`, d: '', put: s.put, dig: s.dig.map(c => [...c]), ents: s.ents })),
  };
}
function rebuild(keepCam = true) {
  if (!ev) return;
  const cp = ev.camera.position.clone(), ct = ev.controls.target.clone();
  ev.setFarm(asFarm());
  ev.set({ ground: 'solid', layer: false, solo: false, cut: null, demo: false, highlight: true });
  ev.goto(S.cur + 1, { animate: false });
  // срез ставим после goto: goto сам подгоняет срез под шаг и сбросил бы наш
  ev.set({ layer: cut !== null && solo, solo, cut }); ev.buildHighlights();
  if (hoverBox) { ev.root.add(hoverBox); hoverBox.visible = false; }
  if (keepCam && booted) { ev.tween = null; ev.camera.position.copy(cp); ev.controls.target.copy(ct); ev.camera.lookAt(ct); ev.dirty = true; }
  booted = true;
  panel(); persist();
}

/* ---------- клик по сцене ---------- */
function cellKey(c) { return c.join(','); }
function propsFor(t, n) {
  const p = {};
  if (FACING[t]) p.f = FACING[t].includes(tool.f) ? tool.f : FACING[t][0];
  if (WALLED.has(t) && n) { const s = OPP[`${n[0]},${n[1]},${n[2]}`]; if (s) p.side = s; else if (t === 'lever' || t === 'ladder' || t === 'iron_door' || t === 'sign') p.side = 'n'; }
  if (t === 'trapdoor') { if (tool.top) p.top = true; if (tool.open) { p.open = true; p.side = p.side || 'n'; } else delete p.side; }
  if (t === 'water') { if (tool.water === 'src') p.src = true; else p.flow = tool.water; }
  if (t === 'slab' && tool.top) p.top = true;
  if ((t === 'lamp' || t === 'lever') && tool.on) p.on = true;
  if (t === 'rail' || t === 'powered_rail') { p.axis = tool.axis; if (t === 'powered_rail' && tool.on) p.on = true; }
  return Object.keys(p).length ? p : null;
}
function findPut(x, y, z) {
  for (let i = S.steps.length - 1; i >= 0; i--) {
    const j = S.steps[i].put.findIndex(e => e[1] === x && e[2] === y && e[3] === z);
    if (j >= 0) return [i, j];
  }
  return null;
}
function onPick(p) {
  if (!p) return;
  const s = step();
  const mode = shift ? 'erase' : tool.mode; // Shift+клик — стереть, не переключая режим
  if (mode === 'erase') {
    if (p.ent) { for (const st of S.steps) { const j = st.ents.findIndex(e => e.id === p.ent.id); if (j >= 0) { snapshot(); st.ents.splice(j, 1); return rebuild(); } } }
    if (p.en) { const f = findPut(p.en.x, p.en.y, p.en.z); if (f) { snapshot(); S.steps[f[0]].put.splice(f[1], 1); return rebuild(); } }
    // клик по стенке ямы — засыпать выкопанную клетку перед этой стенкой
    if (p.ground && p.n) {
      const k = cellKey([p.ground[0] + p.n[0], p.ground[1] + p.n[1], p.ground[2] + p.n[2]]);
      for (const st of S.steps) { const j = st.dig.findIndex(c => cellKey(c) === k); if (j >= 0) { snapshot(); st.dig.splice(j, 1); return rebuild(); } }
    }
    return;
  }
  if (mode === 'dig') {
    if (!p.ground) return;
    if (tool.rect && !corner) { corner = p.ground; return hint(); }
    const a = corner || p.ground, b = p.ground, top = Math.max(a[1], b[1]), d = Math.max(1, tool.depth | 0);
    corner = null;
    const dug = new Set(); for (const st of S.steps) for (const c of st.dig) dug.add(cellKey(c));
    const add = [];
    for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++)
      for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++)
        for (let y = top; y > top - d && y >= -16; y--) { const c = [x, y, z]; if (!dug.has(cellKey(c))) add.push(c); }
    if (!add.length) return hint();
    snapshot(); s.dig.push(...add); return rebuild();
  }
  // поставить: к грани, по которой кликнули
  const base = p.en ? [p.en.x, p.en.y, p.en.z] : p.ground;
  if (!base || !p.n) return;
  const c = [base[0] + p.n[0], base[1] + p.n[1], base[2] + p.n[2]];
  if (MOBS.includes(tool.t)) {
    snapshot();
    s.ents.push({ id: 'm' + Date.now().toString(36), e: tool.t, x: c[0] + .5, y: c[1], z: c[2] + .5, yaw: { n: 0, s: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 }[tool.f] || 0 });
    return rebuild();
  }
  if (tool.rect && !corner) { corner = c; return hint(); }
  const a = corner || c; corner = null;
  snapshot();
  const pr = propsFor(tool.t, p.n);
  for (let x = Math.min(a[0], c[0]); x <= Math.max(a[0], c[0]); x++)
    for (let y = Math.min(a[1], c[1]); y <= Math.max(a[1], c[1]); y++)
      for (let z = Math.min(a[2], c[2]); z <= Math.max(a[2], c[2]); z++) {
        const f = findPut(x, y, z); if (f && f[0] === S.cur) s.put.splice(f[1], 1);
        s.put.push(pr ? [tool.t, x, y, z, { ...pr }] : [tool.t, x, y, z]);
      }
  rebuild();
}
// рамка под мышкой: куда встанет блок / что выкопается / что сотрётся (с углом — весь прямоугольник)
let hoverBox = null;
function showHover(h) {
  if (!ev) return;
  if (!hoverBox) {
    hoverBox = new THREE.LineSegments(ev.edgeGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .95, depthTest: false }));
    hoverBox.renderOrder = 10; ev.root.add(hoverBox);
  }
  const mode = shift ? 'erase' : tool.mode;
  let c = null;
  if (h && mode === 'erase') c = h.en ? [h.en.x, h.en.y, h.en.z] : null;
  else if (h && mode === 'dig') c = h.ground || null;
  else if (h && (h.en || h.ground) && h.n) { const b = h.en ? [h.en.x, h.en.y, h.en.z] : h.ground; c = [b[0] + h.n[0], b[1] + h.n[1], b[2] + h.n[2]]; }
  hoverBox.visible = !!c;
  if (c) {
    const a = corner && mode !== 'erase' ? corner : c;
    const lo = [0, 1, 2].map(i => Math.min(a[i], c[i])), hi = [0, 1, 2].map(i => Math.max(a[i], c[i]));
    if (mode === 'dig') lo[1] = Math.max(-16, hi[1] - Math.max(1, tool.depth | 0) + 1);
    hoverBox.scale.set(hi[0] - lo[0] + 1.04, hi[1] - lo[1] + 1.04, hi[2] - lo[2] + 1.04);
    hoverBox.position.set((lo[0] + hi[0] + 1) / 2, (lo[1] + hi[1] + 1) / 2, (lo[2] + hi[2] + 1) / 2);
  }
  ev.dirty = true;
}
// подсказка внизу панели: что сейчас ждёт клик
function hint() {
  const el = $('#edHover'); if (!el) return;
  el.textContent = corner ? `Первый угол: x ${corner[0]} · y ${corner[1]} · z ${corner[2]}. Кликни второй угол (Esc — отмена).`
    : 'Клик по земле или грани блока — поставить. Shift+клик — стереть. Ctrl+Z — отменить.';
}

/* ---------- панель ---------- */
function count() { let b = 0, d = 0, m = 0; for (const s of S.steps) { b += s.put.length; d += s.dig.length; m += s.ents.length; } return { b, d, m }; }
function panel() {
  const P = $('#edPanel'); if (!P) return;
  const t = tool.t, opts = [];
  if (FACING[t] || MOBS.includes(t)) {
    const dirs = FACING[t] || F4;
    opts.push(`<label class="erow">Куда смотрит <select id="edF">${dirs.map(d => `<option value="${d}"${tool.f === d ? ' selected' : ''}>${DIRN[d]}</option>`).join('')}</select></label>`);
  }
  if (WALLED.has(t)) opts.push('<p class="ehint">Вешается на грань, по которой кликнешь.</p>');
  if (t === 'trapdoor') opts.push(`<label class="chk"><input type="checkbox" id="edTop"${tool.top ? ' checked' : ''}>в верхней половине</label><label class="chk"><input type="checkbox" id="edOpen"${tool.open ? ' checked' : ''}>открыт</label>`);
  if (t === 'slab') opts.push(`<label class="chk"><input type="checkbox" id="edTop"${tool.top ? ' checked' : ''}>верхняя половина</label>`);
  if (t === 'water') opts.push(`<label class="erow">Вода <select id="edW">${[['src', 'источник (ведро)'], ...['n', 's', 'e', 'w'].map(d => [d, 'течёт на ' + DIRN[d]])].map(([v, n]) => `<option value="${v}"${tool.water === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`);
  if (t === 'lamp' || t === 'lever' || t === 'powered_rail') opts.push(`<label class="chk"><input type="checkbox" id="edOn"${tool.on ? ' checked' : ''}>включён</label>`);
  if (t === 'rail' || t === 'powered_rail') opts.push(`<label class="erow">Вдоль <select id="edAx"><option value="x"${tool.axis === 'x' ? ' selected' : ''}>запад–восток</option><option value="z"${tool.axis === 'z' ? ' selected' : ''}>север–юг</option></select></label>`);
  const c = count(), name = MOBS.includes(t) ? ENTS[t].n : BLOCKS[t]?.n || t;
  P.innerHTML = `
    <div class="emodes" role="group" aria-label="Что делает клик">
      <button data-mode="place" aria-pressed="${tool.mode === 'place'}">➕ Ставить</button>
      <button data-mode="dig" aria-pressed="${tool.mode === 'dig'}">⛏ Копать</button>
      <button data-mode="erase" aria-pressed="${tool.mode === 'erase'}">✖ Стереть</button>
    </div>
    ${tool.mode === 'dig' ? `<label class="erow">Вглубь <select id="edDepth">${[1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16].map(n => `<option value="${n}"${tool.depth === n ? ' selected' : ''}>${n} бл.</option>`).join('')}</select></label>`
      : `<div class="ecur">${thumbs.get(t) ? `<img src="${thumbs.get(t)}" alt="">` : ''}<b>${esc(name)}</b></div>${opts.join('')}`}
    ${tool.mode !== 'erase' ? `<label class="chk"><input type="checkbox" id="edRect"${tool.rect ? ' checked' : ''}>прямоугольником (2 клика по углам)</label>` : '<p class="ehint">Клик по стенке ямы — засыпать клетку.</p>'}
    <h4>Шаги</h4>
    <div class="esteps">${S.steps.map((s, i) => `<button data-step="${i}" aria-pressed="${i === S.cur}">${i + 1}</button>`).join('')}<button id="edAddStep" title="Новый шаг">＋</button></div>
    <label class="erow">Название шага <input id="edStepT" value="${esc(step().t)}"></label>
    ${S.steps.length > 1 ? '<button class="linkbtn" id="edDelStep">Удалить шаг</button>' : ''}
    <h4>Срез</h4>
    <div class="erow"><button class="btn sm" id="edCutDn">▼</button><span id="edCutL">${cut === null ? 'всё видно' : 'до y=' + cut}</span><button class="btn sm" id="edCutUp">▲</button><label class="chk"><input type="checkbox" id="edSolo"${solo ? ' checked' : ''}>один слой</label></div>
    <p class="ehint">Блоков ${c.b} · выкопано ${c.d} · мобов ${c.m}</p>
    <div class="ebtns">
      <button class="btn" id="edUndo"${undo.length ? '' : ' disabled'}>↶ Отменить</button>
      <button class="btn primary" id="edCopy">📋 Скопировать схему</button>
      <button class="btn" id="edPaste">Вставить схему</button>
      <button class="linkbtn" id="edClear">Начать заново</button>
    </div>
    <textarea id="edText" hidden rows="5" placeholder="Сюда вставь текст схемы и нажми «Вставить схему» ещё раз"></textarea>
    <p class="ehint" id="edHover"></p>
    <p class="ehint">Камера: колесо — к мышке, правая кнопка — сдвиг, F — к клетке под мышкой, Q/E — ниже/выше на блок.</p>`;
  hint();
}
function palette() {
  const B = Object.entries(BLOCKS).filter(([k]) => !SKIP.has(k));
  const sec = GROUPS.map(([cat, name]) => {
    const items = B.filter(([, d]) => d.cat === cat);
    return items.length ? grp(cat, name, items.map(([k, d]) => item(k, d.n)).join('')) : '';
  }).join('') + grp('mob', 'Мобы и предметы', MOBS.map(k => item(k, ENTS[k].n)).join(''));
  $('#edPal').innerHTML = `<input id="edFind" type="search" placeholder="Найти блок…" aria-label="Найти блок">${sec}`;
}
// раздел палитры сворачивается; свёрнутые запоминаем
const shut = new Set(load('editorShut', []));
const grp = (id, name, html) => `<details class="egrp" data-g="${id}"${shut.has(id) ? '' : ' open'}><summary>${name}</summary><div class="egrid">${html}</div></details>`;
const item = (k, n) => `<button class="eitem" data-t="${k}" title="${esc(n)}" aria-pressed="${tool.t === k}">${thumbs.get(k) ? `<img src="${thumbs.get(k)}" alt="">` : ''}<span>${esc(n.replace(/\s*\(.*\)/, ''))}</span></button>`;

/* ---------- запуск и события ---------- */
export function showEditor(on) {
  const sec = $('#v-editor');
  if (!on) { ev?.setActive(false); return; }
  if (!sec.dataset.ready) {
    sec.dataset.ready = 1;
    sec.innerHTML = `
      <header class="sheethead"><h2>Редактор схем</h2><p>Собери свою постройку блок за блоком, разбей на шаги и нажми «Скопировать схему» — этот текст можно прислать, и из него получится ферма на сайте.</p></header>
      <div class="ewrap">
        <aside class="epal" id="edPal" aria-label="Блоки"></aside>
        <div class="eview"><div class="viewport" id="edView"></div><input class="etitle" id="edTitle" value="${esc(S.title)}" aria-label="Название схемы"></div>
        <aside class="epanel" id="edPanel" aria-label="Инструменты"></aside>
      </div>`;
    makeThumbs([...Object.keys(BLOCKS).filter(k => !SKIP.has(k)).map(k => [k, false]), ...MOBS.map(k => [k, true])]);
    palette();
    try {
      ev = window.__ev = new Viewer($('#edView'), {
        onPick: p => onPick(p),
        onHover: h => {
          showHover(h);
          const el = $('#edHover'); if (!el || !h) return; const c = h.en ? [h.en.x, h.en.y, h.en.z] : h.ground; if (!c) return;
          hoverAt = c;
          el.textContent = (corner ? `Угол x ${corner[0]} · y ${corner[1]} · z ${corner[2]} → ` : '') + `x ${c[0]} · y ${c[1]} · z ${c[2]}${h.en ? ' — ' + (BLOCKS[h.en.t]?.n || h.en.t) : ' — земля'}`;
        },
      });
    } catch { $('#edView').textContent = 'Без 3D (WebGL) редактор не работает.'; return; }
    // колесо приближает к мышке, а не к центру — можно залезть в яму; близко подлетать можно
    ev.controls.zoomToCursor = true; ev.controls.minDistance = 1.5;
    // Shift+клик — стереть, не переключая режим
    $('#edView').addEventListener('pointerdown', e => { shift = e.shiftKey; }, true);
    events();
  }
  ev.setActive(true); ev.resize();
  rebuild(false);
}
function events() {
  const sec = $('#v-editor');
  sec.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.t) { tool.t = t.dataset.t; sec.querySelectorAll('.eitem').forEach(b => b.setAttribute('aria-pressed', b === t)); if (tool.mode !== 'place') tool.mode = 'place'; panel(); persist(); return; }
    if (t.dataset.mode) { tool.mode = t.dataset.mode; corner = null; panel(); persist(); return; }
    if (t.dataset.step) { S.cur = +t.dataset.step; rebuild(); return; }
    switch (t.id) {
      case 'edAddStep': snapshot(); S.steps.push({ t: `Шаг ${S.steps.length + 1}`, put: [], dig: [], ents: [] }); S.cur = S.steps.length - 1; return rebuild();
      case 'edDelStep': snapshot(); S.steps.splice(S.cur, 1); S.cur = Math.max(0, S.cur - 1); return rebuild();
      case 'edUndo': if (undo.length) { S = JSON.parse(undo.pop()); rebuild(); } return;
      case 'edCutDn': cut = cut === null ? Math.max(-1, ...S.steps.flatMap(s => s.put.map(e => e[2]))) - 1 : Math.max(-16, cut - 1); return rebuild();
      case 'edCutUp': cut = cut === null ? null : cut + 1 > 12 ? null : cut + 1; return rebuild();
      case 'edCopy': {
        const txt = JSON.stringify({ v: 1, title: S.title, steps: S.steps });
        const ta = $('#edText'); ta.hidden = false; ta.value = txt; ta.select();
        navigator.clipboard?.writeText(txt).then(() => { t.textContent = '✓ Скопировано'; setTimeout(() => (t.textContent = '📋 Скопировать схему'), 1800); }, () => {});
        return;
      }
      case 'edPaste': {
        const ta = $('#edText');
        if (ta.hidden || !ta.value.trim()) { ta.hidden = false; ta.value = ''; ta.focus(); return; }
        try {
          const d = JSON.parse(ta.value);
          if (!Array.isArray(d.steps)) throw 0;
          snapshot();
          S = { title: d.title || 'Схема', steps: d.steps.map((s, i) => ({ t: s.t || `Шаг ${i + 1}`, put: s.put || [], dig: s.dig || [], ents: s.ents || [] })), cur: 0 };
          $('#edTitle').value = S.title; ta.hidden = true; rebuild(false);
        } catch { ta.value = 'Не получилось прочитать схему — вставь текст целиком.'; }
        return;
      }
      case 'edClear': if (!t.classList.contains('sure')) { t.classList.add('sure'); t.textContent = 'Точно стереть всё?'; setTimeout(() => { t.classList.remove('sure'); t.textContent = 'Начать заново'; }, 2500); return; }
        snapshot(); S = blank(); $('#edTitle').value = S.title; return rebuild(false);
    }
  });
  sec.addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'edF') tool.f = e.target.value;
    else if (id === 'edTop') tool.top = e.target.checked;
    else if (id === 'edOpen') tool.open = e.target.checked;
    else if (id === 'edW') tool.water = e.target.value;
    else if (id === 'edOn') tool.on = e.target.checked;
    else if (id === 'edAx') tool.axis = e.target.value;
    else if (id === 'edDepth') tool.depth = +e.target.value;
    else if (id === 'edRect') { tool.rect = e.target.checked; corner = null; hint(); }
    else if (id === 'edSolo') { solo = e.target.checked; if (solo && cut === null) cut = 0; return rebuild(); }
    else if (id === 'edStepT') { step().t = e.target.value; }
    else if (id === 'edTitle') { S.title = e.target.value; }
    persist();
  });
  sec.addEventListener('toggle', e => {
    const d = e.target; if (!d.classList?.contains('egrp') || $('#edFind')?.value.trim()) return;
    d.open ? shut.delete(d.dataset.g) : shut.add(d.dataset.g); save('editorShut', [...shut]);
  }, true);
  sec.addEventListener('input', e => {
    if (e.target.id !== 'edFind') return;
    const q = e.target.value.trim().toLowerCase();
    sec.querySelectorAll('.eitem').forEach(b => { b.hidden = !!q && !b.title.toLowerCase().includes(q); });
    // при поиске раскрываем разделы, где что-то нашлось
    sec.querySelectorAll('.egrp').forEach(d => { if (q) d.open = [...d.querySelectorAll('.eitem')].some(b => !b.hidden); else d.open = !shut.has(d.dataset.g); });
  });
  addEventListener('keydown', e => {
    if ($('#v-editor').hidden || e.target.closest?.('input, textarea, select')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (undo.length) { S = JSON.parse(undo.pop()); rebuild(); } }
    if (e.key === 'Escape' && corner) { corner = null; hint(); }
    const k = e.key.toLowerCase();
    // F — навести камеру на клетку под мышкой; Q/E — опустить/поднять камеру на блок (лезть в яму)
    if ((k === 'f' || k === 'а') && hoverAt && ev) {
      const t = new THREE.Vector3(hoverAt[0] + .5, hoverAt[1] + .5, hoverAt[2] + .5);
      const off = ev.camera.position.clone().sub(ev.controls.target).setLength(7);
      ev.tween = null; ev.controls.target.copy(t); ev.camera.position.copy(t).add(off); ev.dirty = true;
    }
    if (ev && (k === 'q' || k === 'й' || k === 'e' || k === 'у')) {
      const dy = k === 'q' || k === 'й' ? -1 : 1;
      ev.tween = null; ev.controls.target.y += dy; ev.camera.position.y += dy; ev.dirty = true;
    }
    if (e.key === 'r' || e.key === 'к') { const d = FACING[tool.t] || F4; tool.f = d[(d.indexOf(tool.f) + 1) % d.length]; panel(); persist(); }
  });
}
