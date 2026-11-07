// Интерфейс: вкладки, выбор фермы, шаги, материалы, шпаргалки.
import { Viewer, expandPut } from './engine.js';
import { BLOCKS, ENTS } from './blocks.js';
import FARM_IDS, { CATS, TIERS } from './farms/index.js';
import MECH_IDS, { MCATS } from './mech/index.js';
import { load, save } from './store.js';
import VIL from './cheats/villagers.js';
import POT from './cheats/potions.js';
import BREW from './cheats/brew.js';
import { wsIcon, tipIcon } from './icons.js';
import TIPS from './cheats/tips.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const farms = await Promise.all(FARM_IDS.map(id => import(`./farms/${id}.js`).then(m => m.default)));
// механизмы: те же пошаговые 3D-схемы, но своя вкладка, свой список и свои категории
const mechs = await Promise.all(MECH_IDS.map(id => import(`./mech/${id}.js`).then(m => ({ ...m.default, kind: 'mech' }))));
let mode = 'farms'; // какой список показан слева: 'farms' или 'mech'
const LIST = () => (mode === 'mech' ? mechs : farms), CATL = () => (mode === 'mech' ? MCATS : CATS);
const noun = f => (f?.kind === 'mech' ? 'схему' : 'ферму');
let farm = null, viewer = null, playing = null, curK = 1;

/* ---------- анимации интерфейса ----------
   Появления — через WAAPI и только на настоящие события (смена фермы, шага, первый заход во вкладку):
   CSS-анимации перезапускаются после display:none, и при возврате во вкладку всё бы мигало.
   Только transform/opacity; fill:'backwards', чтобы ничего не залипало в конечном кадре. */
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const calm = () => RM.matches; // спрашиваем каждый раз: настройку системы могут переключить на ходу
const PHONE = matchMedia('(max-width: 820px)'), ROW = matchMedia('(max-width: 1180px)');
const EASE = { out: 'cubic-bezier(.22,1,.36,1)', in: 'cubic-bezier(.4,0,1,1)', spring: 'cubic-bezier(.34,1.56,.64,1)' };
const KF = {
  rise: [{ opacity: 0, transform: 'translateY(10px) scale(.99)' }, {}],
  inR: [{ opacity: 0, transform: 'translateX(14px)' }, {}],
  inL: [{ opacity: 0, transform: 'translateX(-14px)' }, {}],
  outL: [{}, { opacity: 0, transform: 'translateX(-12px)' }],
  outR: [{}, { opacity: 0, transform: 'translateX(12px)' }],
  chip: [{ opacity: 0, transform: 'translateX(10px) scale(.96)' }, {}],
  fade: [{ opacity: 0 }, {}],
  pop: [{ transform: 'scale(1)' }, { transform: 'scale(1.07)', offset: .4 }, { transform: 'scale(1)' }],
};
const FADE = [{ opacity: 0 }, {}];
// «лесенка»: элементы въезжают друг за другом, не дольше 8 шагов задержки
function enter(els, kf, { dur = 260, step = 35, max = 8, delay = 0, ease = EASE.out } = {}) {
  [...els].forEach((el, i) => {
    const d = delay + Math.min(i, max) * step;
    // без движения: остаётся только короткое проявление
    if (calm()) el.animate(FADE, { duration: 120, delay: d / 2, fill: 'backwards' });
    else el.animate(kf, { duration: dur, delay: d, easing: ease, fill: 'backwards' });
  });
}
const stagger = (root, sel = ':scope > *') => root.querySelectorAll(sel).forEach((el, i) => el.style.setProperty('--i', i));
let booted = false;
// следующий кадр; если кадры не идут (вкладка в фоне), через 100 мс всё равно
function nextFrame(fn) { let t = 0; const go = () => { if (!t) return; clearTimeout(t); t = 0; fn(); }; t = setTimeout(go, 100); requestAnimationFrame(go); return 1; }
// пока тянут окно, плашки прыгают за ним без пружины
function still(el, fn) { el.classList.add('still'); fn(); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('still'))); }

function moveTabPill() {
  const tabs = $('.tabs'), on = tabs.querySelector('a[aria-current="page"]'), pill = tabs.querySelector('.tabpill');
  if (!on || !on.offsetWidth) return;
  pill.style.width = on.offsetWidth + 'px';
  pill.style.setProperty('--x', on.offsetLeft + 'px');
  pill.style.transform = 'translateX(var(--x))';
  // на телефоне вкладки листаются: выбранная не должна прятаться за краем
  if (on.offsetLeft < tabs.scrollLeft || on.offsetLeft + on.offsetWidth > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2;
  if (!tabs.classList.contains('ready')) requestAnimationFrame(() => tabs.classList.add('ready'));
}

/* ---------- материалы ---------- */
function materials(f, only) {
  const out = new Map();
  const add = (n, c) => out.set(n, (out.get(n) || 0) + c);
  f.steps.forEach((s, i) => {
    if (only && i + 1 !== only) return;
    for (const p of s.put || []) for (const en of expandPut(p)) {
      const d = BLOCKS[en.t];
      if (d.cat === 'x' || en.p.free) continue;
      const c = d.count ? d.count(en) : 1;
      if (c) add(d.n, c);
    }
    for (const e of s.ents || []) if (ENTS[e.e].item) add(ENTS[e.e].n, 1);
  });
  return out;
}
const allMats = new WeakMap(); // материалы на всю ферму считаем один раз
const farmMats = f => allMats.get(f) || (allMats.set(f, materials(f)), allMats.get(f));
// счётчик ×N «набегает» от нуля (через --n), если браузер умеет анимировать свои свойства
let COUNT = false;
try { CSS.registerProperty({ name: '--n', syntax: '<integer>', inherits: false, initialValue: '0' }); COUNT = true; } catch { /* уже есть или не умеет */ }
if (COUNT) document.documentElement.classList.add('cnt');
const chips = (m, cnt) => [...m].map(([n, c]) => `<li data-n="${esc(n)}"><span>${esc(n)}</span><b${cnt ? ` style="--n:${c}"` : ''}><span>×${c}</span></b></li>`).join('');

/* ---------- выбор фермы: рисуем один раз, дальше только переключаем ---------- */
// порядок списка: по категориям, внутри — по уровню, дальше как в farms/index.js
const catIdx = id => CATL().findIndex(c => c[0] === id);
const ordered = () => LIST().filter(f => !f.of).map((f, i) => [f, i])
  .sort(([a, i], [b, j]) => (catIdx(a.cat) - catIdx(b.cat)) || ((a.tier || 1) - (b.tier || 1)) || i - j).map(x => x[0]);
// уровень: 1, 2, 3 или «с плюсом» (1.5 → «1+»: чуть сложнее, например нужен кварц, но рано)
const tFloor = t => Math.floor(t || 1);
const tName = t => tFloor(t) + ((t || 1) % 1 ? '+' : '');
const tierHtml = t => {
  const b = tFloor(t), plus = (t || 1) % 1;
  return `<span class="tier${plus ? ' plus' : ''}" data-t="${b}" title="Уровень ${tName(t)}: ${TIERS[b][0]}${plus ? ', чуть сложнее' : ''} — ${TIERS[b][1]}" aria-label="уровень ${tName(t)}"><i></i><i></i><i></i></span>`;
};
let pfilt = 'all';
function renderPicker() {
  const farms = LIST();
  pfilt = load(mode === 'mech' ? 'filterMech' : 'filter', 'all');
  const used = CATL().filter(([id]) => farms.some(f => f.cat === id));
  if (pfilt !== 'all' && !used.some(c => c[0] === pfilt)) pfilt = 'all';
  const btn = (id, n, c) => `<button data-cat="${id}" aria-pressed="${pfilt === id}">${esc(n)} <b>${c}</b></button>`;
  let last = null, list = '';
  for (const f of ordered()) {
    if (f.cat !== last) { last = f.cat; list += `<h5 data-cat="${f.cat}">${esc(CATL()[catIdx(f.cat)]?.[1] || 'Разное')}</h5>`; }
    list += `<a class="pick" href="#${f.id}" data-id="${f.id}" data-cat="${f.cat}" aria-current="false">
      <span class="row"><b>${esc(f.title)}</b><span class="rt"><small class="pp"></small>${tierHtml(f.tier || 1)}</span></span><span>${esc(f.short)}</span><i>${esc(f.stats[0][1])}</i><em class="pbar" aria-hidden="true"></em>
    </a>`;
  }
  $('#picker').innerHTML = `<div class="pchips pfilt" role="group" aria-label="Категории">${btn('all', 'Все', farms.length)}${used.map(([id, n]) => btn(id, n, farms.filter(f => f.cat === id).length)).join('')}</div>
    <div class="plist">${list}<span class="pickbar" aria-hidden="true"></span></div>`;
  applyFilter(false);
  stagger($('#picker .plist'), '.pick');
  farms.forEach(f => pickProg(f));
  $('#picker .pfilt').onclick = e => {
    const b = e.target.closest('button');
    if (!b || b.dataset.cat === pfilt) return;
    pfilt = b.dataset.cat; save(mode === 'mech' ? 'filterMech' : 'filter', pfilt);
    $('#picker .pfilt').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    applyFilter(true);
  };
}
// фильтр: лишние карточки гаснут, нужные въезжают лесенкой, метка выбранной едет следом
let filterGen = 0;
function applyFilter(animate) {
  const box = $('#picker .plist'), gen = ++filterGen;
  const want = el => el.tagName === 'H5' ? pfilt === 'all' : pfilt === 'all' || el.dataset.cat === pfilt;
  const gone = [], come = [];
  for (const el of box.querySelectorAll('.pick, h5')) {
    el.getAnimations().forEach(a => a.cancel());
    if (want(el) !== el.hidden) continue;
    (el.hidden ? come : gone).push(el);
  }
  const done = () => {
    if (gen !== filterGen) return; // пока гасли, нажали другой фильтр
    gone.forEach(el => (el.hidden = true));
    come.forEach(el => (el.hidden = false));
    movePickBar();
    if (animate) enter(come.filter(el => el.classList.contains('pick')), KF.rise, { dur: 260, step: 45 });
  };
  if (!animate || calm() || !gone.length) return done();
  Promise.all(gone.map(el => el.animate([{}, { opacity: 0, transform: 'scale(.96)' }], { duration: 140, easing: EASE.in, fill: 'forwards' }).finished))
    .then(() => { done(); gone.forEach(el => el.getAnimations().forEach(a => a.cancel())); }, () => {});
}
function syncPicker(scroll) {
  const box = $('#picker .plist');
  let on = null;
  for (const a of box.querySelectorAll('.pick')) {
    const me = a.dataset.id === farm.id;
    a.classList.toggle('on', me); a.setAttribute('aria-current', me ? 'page' : 'false');
    if (me) on = a;
  }
  movePickBar();
  // в строчной раскладке выбранная карточка не должна уехать за край
  if (scroll && on && !on.hidden && ROW.matches) on.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
}
function movePickBar() {
  const box = $('#picker .plist'), on = box?.querySelector('.pick.on'), bar = box?.querySelector('.pickbar');
  if (!bar) return;
  // выбранную ферму спрятал фильтр — метка гаснет, а не висит над чужой карточкой
  bar.style.visibility = on && !on.hidden ? '' : 'hidden';
  if (!on || !on.offsetWidth) return;
  const row = ROW.matches;
  bar.style.width = (row ? on.offsetWidth - 8 : 4) + 'px';
  bar.style.height = (row ? 3 : on.offsetHeight - 16) + 'px';
  bar.style.transform = `translate(${on.offsetLeft + (row ? 4 : 0)}px, ${on.offsetTop + (row ? on.offsetHeight - 3 : 8)}px)`;
  if (!box.classList.contains('bar')) still(box, () => box.classList.add('bar'));
}

/* ---------- панель шагов: каркас — один раз на ферму, на шаге меняется только карточка ---------- */
let shownK = 0, shownDir = 0, outAnim = null, uiRaf = 0;
function buildPanel() {
  const N = farm.steps.length, P = $('#panel');
  ck = ckOf(farm);
  P.innerHTML = `
    <header class="farmhead">
      <h2>${esc(farm.title)}</h2>
      <p>${esc(farm.short)}</p>
      <div class="badges">${farm.badges.map(b => `<span>${esc(b)}</span>`).join('')}<span class="tb" title="${esc(TIERS[tFloor(farm.tier)][1])}">${tierHtml(farm.tier)}ур. ${tName(farm.tier)} · ${TIERS[tFloor(farm.tier)][0]}</span></div>
      <dl class="stats">${farm.stats.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    </header>
    ${varBlock()}
    <article class="stepcard">
      <div class="prog" style="--n:${N}" aria-hidden="true"><i></i></div>
      <div class="sbody" aria-live="polite"></div>
      <div class="stepnav">
        <button class="btn" id="sPrev" data-go="0">← Назад</button>
        <button class="btn ckbtn" id="sDone" aria-pressed="false"><i class="ck">${CK_SVG}</i><span>Сделал</span></button>
        <button class="btn primary" id="sNext" data-go="2">Дальше →</button>
      </div>
    </article>
    <section class="block">
      <h4>Все шаги</h4>
      <div class="stepswrap still"><span class="steppill" aria-hidden="true"></span>
        <ol class="steps">${farm.steps.map((x, i) => `<li><button class="${i + 1 < curK ? 'done' : i + 1 === curK ? 'on' : ''}" data-go="${i + 1}"><em>${i + 1}</em><span>${esc(x.t)}</span></button><button class="ck" data-ck="${i + 1}" aria-pressed="false" aria-label="Шаг ${i + 1} сделан">${CK_SVG}</button></li>`).join('')}</ol>
      </div>
    </section>
    <section class="block mats">
      <h4>Материалы на всю ${noun(farm)} <small class="mh"></small></h4>
      <div class="mbox"><div><ul class="chips all">${matList()}</ul></div></div>
    </section>
    ${calcBlock()}
    <button class="linkbtn" id="ckReset" hidden>Сбросить галочки</button>`;
  P.scrollTop = 0;
  shownK = 0; outAnim = null;
  stepChecks(); matHead(); calcSync();
  stagger(P);
  if (booted) enter(P.children, KF.rise, { dur: 320, step: 55 });
}
function stepBody(k) {
  const s = farm.steps[k - 1], N = farm.steps.length, need = materials(farm, k);
  return `<div class="num">Шаг ${k} из ${N}</div>
    <h3>${esc(s.t)}</h3>
    <p>${s.d}</p>
    ${need.size ? `<div class="need"><h4>Ставишь в этом шаге</h4><ul class="chips">${chips(need, COUNT)}</ul></div>` : ''}
    ${s.tip ? `<p class="tipbox">${s.tip}</p>` : ''}`;
}
// dir: 1 — вперёд (въезжает справа), -1 — назад (слева), 0 — без выезда (новая ферма)
function updateStep(k, dir) {
  const P = $('#panel'), body = P.querySelector('.sbody'), N = farm.steps.length;
  shownK = k; shownDir = dir;
  let swapped = false;
  const swap = () => {
    if (swapped) return; swapped = true;
    const k = shownK, dir = shownDir; // за время выезда могли пролистать дальше — показываем последнее
    body.innerHTML = stepBody(k);
    if (outAnim) { outAnim.cancel(); outAnim = null; }
    if (dir) enter(body.children, dir > 0 ? KF.inR : KF.inL, { step: 30 });
    const cs = body.querySelectorAll('.chips li');
    enter(cs, KF.chip, { delay: dir ? 90 : 160, step: 35 });
    if (COUNT && !calm()) cs.forEach((li, i) => {
      const b = li.querySelector('b'), n = +b.style.getPropertyValue('--n');
      b.animate([{ '--n': 0 }, { '--n': n }], { duration: 600, delay: (dir ? 90 : 160) + Math.min(i, 8) * 35, easing: EASE.out, fill: 'backwards' });
    });
  };
  if (outAnim) { /* уже уезжает: въедет сразу последний шаг */ }
  else if (dir && !calm() && body.firstElementChild) {
    outAnim = body.animate(dir > 0 ? KF.outL : KF.outR, { duration: 110, easing: EASE.in, fill: 'forwards' });
    outAnim.onfinish = swap;
    setTimeout(swap, 250); // если кадры стоят (фоновая вкладка), контент всё равно сменится
  } else swap();
  // кнопки — те же элементы: фокус и нажатие не теряются
  const pv = $('#sPrev'), nx = $('#sNext');
  pv.dataset.go = k - 1; pv.disabled = k <= 1;
  nx.dataset.go = k + 1; nx.disabled = k >= N;
  P.querySelector('.prog').style.setProperty('--p', k / N);
  P.querySelectorAll('.steps button[data-go]').forEach((b, i) => {
    b.classList.toggle('on', i + 1 === k); b.classList.toggle('done', i + 1 < k);
    if (i + 1 === k) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  moveStepPill(); stepChecks();
  // в «Материалах на всю ферму» подсвечиваем то, что идёт в этот шаг
  const need = materials(farm, k);
  P.querySelectorAll('.chips.all li[data-n]').forEach(li => {
    const cur = need.has(li.dataset.n), was = li.classList.contains('cur');
    li.classList.toggle('cur', cur);
    // один раз «пингуем» рамкой (::after: только transform/opacity)
    if (cur && !was && !calm()) try { li.animate([{ opacity: .9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.05, 1.35)' }], { duration: 520, easing: EASE.out, pseudoElement: '::after' }); } catch { /* старый браузер: хватит рамки */ }
  });
}
function moveStepPill() {
  const wrap = $('#panel .stepswrap'), on = wrap?.querySelector('button.on'), pill = wrap?.querySelector('.steppill');
  if (!on || !on.offsetHeight) return;
  pill.style.height = on.offsetHeight + 'px';
  pill.style.transform = `translateY(${on.offsetTop}px)`;
  pill.classList.add('shown');
  if (wrap.classList.contains('still')) requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.remove('still')));
}
// 3D начинает анимацию в этом кадре, панель — в следующем: так они не толкаются в одном кадре
function setStep(k, animate = true, replay = false) {
  if (viewer) { viewer.goto(k, { animate, replay }); curK = viewer.k; }
  else curK = Math.max(1, Math.min(farm.steps.length, k)); // без WebGL шаги всё равно листаются
  if (!uiRaf) uiRaf = nextFrame(syncUI);
}
function syncUI() {
  if (!uiRaf) return;
  uiRaf = 0;
  if (shownK !== curK) updateStep(curK, shownK ? Math.sign(curK - shownK) : 0);
  updateControls();
}

/* ---------- уровни фермы: одна ферма — лестница вариантов под прогресс и нужный выход ----------
   variants в файле фермы: [{ t: 1 | 1.5 | 2 | 3, name, d, id? }]. Вариант без id — тот, что построен в этом файле;
   с id — отдельный файл фермы (у него of: '<главная>', в списке ферм он не показывается); soon: true — ещё не готов. */
function varBlock() {
  const V = farm.variants;
  if (!V?.length) return '';
  const cur = V.findIndex(v => !v.soon && (!v.id || v.id === farm.id));
  return `<section class="block vars">
      <h4>Уровни этой фермы</h4>
      <div class="vlist" role="group" aria-label="Уровни фермы">${V.map((v, i) => `<button class="var${v.soon ? ' soon' : ''}" data-v="${i}" aria-pressed="${i === cur}">${tierHtml(v.t)}<b>${tName(v.t)}</b><span>${esc(v.name)}</span></button>`).join('')}</div>
      <p class="vdesc">${varDesc(V[cur] || V[0])}</p>
    </section>`;
}
const varDesc = v => `${v.soon ? '<em class="soonb">скоро</em> ' : ''}${esc(v.d)}`;
function initVars() {
  $('#panel').addEventListener('click', e => {
    const b = e.target.closest('.vars .var');
    if (!b) return;
    const v = farm.variants[+b.dataset.v];
    if (v.id && !v.soon && v.id !== farm.id) { location.hash = '#' + v.id; return; }
    b.parentElement.querySelectorAll('.var').forEach(x => x.setAttribute('aria-pressed', x === b));
    const p = $('#panel .vdesc');
    p.innerHTML = varDesc(v);
    if (!calm()) { p.animate(KF.rise, { duration: 220, easing: EASE.out }); b.animate(KF.pop, { duration: 320, easing: EASE.spring }); }
  });
}

/* ---------- галочки: шаги и материалы, помним для каждой фермы ---------- */
// хранится как prog:<id> = { s: [номера шагов], m: [названия материалов] }
const CK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
const ckOf = f => { const p = load('prog:' + f.id, {}); return { s: new Set(p.s || []), m: new Set(p.m || []) }; };
let ck = { s: new Set(), m: new Set() };
function ckSave() {
  save('prog:' + farm.id, ck.s.size || ck.m.size ? { s: [...ck.s], m: [...ck.m] } : undefined);
  pickProg(farm);
}
// полоска прогресса на карточке фермы в списке
function pickProg(f, c = f === farm ? ck : ckOf(f)) {
  const a = $(`#picker .pick[data-id="${f.id}"]`);
  if (!a) return;
  const n = [...c.s].filter(k => k >= 1 && k <= f.steps.length).length, N = f.steps.length;
  a.style.setProperty('--pp', n / N);
  a.classList.toggle('built', n === N);
  const t = a.querySelector('.pp');
  t.textContent = n ? (n === N ? '✓ построено' : `${n}/${N}`) : '';
}
const matKeys = () => [...farmMats(farm).keys(), ...(farm.extra || []).map(([n]) => n)];
// разметка списка «Материалы на всю ферму»: каждая строка — кнопка-галочка
function matList() {
  const row = (n, c, mob) => `<li data-n="${esc(n)}"${mob ? ' class="mob"' : ''}><button class="mk" aria-pressed="${ck.m.has(n)}"><span class="ck">${CK_SVG}</span><span class="nm">${esc(n)}</span><b>×${c}</b></button></li>`;
  return [...farmMats(farm)].map(([n, c]) => row(n, c)).join('') + (farm.extra || []).map(([n, c]) => row(n, c, true)).join('');
}
function matHead(animate) {
  const box = $('#panel .mats'); if (!box) return;
  const keys = matKeys(), n = keys.filter(k => ck.m.has(k)).length, full = n === keys.length && n > 0;
  box.querySelector('.mh').textContent = full ? '✓ всё собрано' : n ? `собрано ${n} из ${keys.length}` : 'нажимай, когда собрал';
  const was = box.classList.contains('full');
  box.classList.toggle('full', full);
  if (full !== was) box.classList.remove('open');
  if (full && !was && animate && !calm()) box.querySelector('h4').animate(KF.pop, { duration: 420, easing: EASE.spring });
  const any = ck.s.size || ck.m.size;
  badge($('#ckReset'), !!any);
}
function stepChecks() {
  $('#panel').querySelectorAll('.steps li').forEach((li, i) => {
    const on = ck.s.has(i + 1);
    li.classList.toggle('did', on);
    li.querySelector('.ck').setAttribute('aria-pressed', on);
  });
  const d = $('#sDone');
  if (d) { const on = ck.s.has(curK); d.setAttribute('aria-pressed', on); d.querySelector('span').textContent = on ? 'Сделано' : 'Сделал'; }
}
// искры от галочки: несколько квадратиков разлетаются и гаснут (только transform/opacity)
function sparks(el, n = 6, color = 'var(--em)') {
  if (calm()) return;
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i'), a = (i / n) * Math.PI * 2 + Math.random() * .6, d = 18 + Math.random() * 16 + n;
    s.className = 'spark'; s.style.background = color; s.style.left = cx + 'px'; s.style.top = cy + 'px';
    document.body.appendChild(s);
    s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.2) rotate(${90 + Math.random() * 180}deg)`, opacity: 0 }],
      { duration: 420 + Math.random() * 200, easing: EASE.out }).onfinish = () => s.remove();
  }
}
function toggleStep(k, from) {
  const on = !ck.s.has(k);
  if (on) ck.s.add(k); else ck.s.delete(k);
  ckSave(); stepChecks(); matHead();
  if (!on || !from) return;
  if (!calm()) from.animate(KF.pop, { duration: 360, easing: EASE.spring });
  const all = ck.s.size >= farm.steps.length && farm.steps.every((_, i) => ck.s.has(i + 1));
  sparks(from, all ? 16 : 6, all ? 'var(--gold)' : 'var(--em)');
  if (all && !calm()) $('#panel .prog').animate(KF.pop, { duration: 420, easing: EASE.spring });
}
function initChecks() {
  $('#panel').addEventListener('input', e => { if (e.target.id === 'cN') calcSync(); });
  $('#panel').addEventListener('click', e => {
    const t = e.target;
    const go = t.closest('.calc1 a[data-item]');
    if (go) { save('calcItem', go.dataset.item); return; }
    const sc = t.closest('.steps .ck');
    if (sc) return toggleStep(+sc.dataset.ck, sc);
    if (t.closest('#sDone')) {
      const k = curK, b = $('#sDone'), was = ck.s.has(k);
      toggleStep(k, b);
      // отметил шаг на карточке — через миг листаем дальше, чтобы галочка успела «щёлкнуть»
      if (!was && k < farm.steps.length) setTimeout(() => { if (curK === k && ck.s.has(k)) { stopPlay(); setStep(k + 1, true); } }, calm() ? 0 : 420);
      return;
    }
    const mk = t.closest('.mats .mk');
    if (mk) {
      const n = mk.parentElement.dataset.n, on = !ck.m.has(n);
      if (on) ck.m.add(n); else ck.m.delete(n);
      mk.setAttribute('aria-pressed', on);
      if (on && !calm()) { mk.querySelector('.ck').animate(KF.pop, { duration: 320, easing: EASE.spring }); sparks(mk.querySelector('.ck'), 5); }
      ckSave(); matHead(true);
      return;
    }
    if (t.closest('.mats.full h4')) { $('#panel .mats').classList.toggle('open'); return; }
    const rs = t.closest('#ckReset');
    if (rs) {
      // сброс — в два нажатия: случайно стереть прогресс постройки обидно
      if (!rs.classList.contains('sure')) {
        rs.classList.add('sure'); rs.textContent = 'Точно сбросить?';
        clearTimeout(rs.t); rs.t = setTimeout(() => { rs.classList.remove('sure'); rs.textContent = 'Сбросить галочки'; }, 2500);
        return;
      }
      clearTimeout(rs.t); rs.classList.remove('sure'); rs.textContent = 'Сбросить галочки';
      ck = { s: new Set(), m: new Set() }; ckSave();
      $('#panel').querySelectorAll('.mats .mk').forEach(b => b.setAttribute('aria-pressed', 'false'));
      stepChecks(); matHead();
    }
  });
}

/* ---------- калькулятор: сколько модулей строить под нужный выход ---------- */
// calc в файле фермы: { item, rate: [мин, макс] в час с одного unit, unit, base — сколько unit в показанной постройке,
//   fixed — начала названий материалов, которые не умножаются, max, note }
const avgRate = f => (f.calc.rate[0] + f.calc.rate[1]) / 2;
const unitsFor = (f, perH) => Math.max(1, Math.ceil(perH / avgRate(f)));
const fmt = n => n >= 10000 ? Math.round(n / 1000) + 'k' : String(Math.round(n));
// материалы на n unit: постройка в гайде — это base unit, делим и округляем вверх
function matsFor(f, n) {
  // fixed — что ставится один раз на всю ферму (сундук, наблюдатель на ряд): не умножаем
  const b = f.calc?.base || 1, fix = f.calc?.fixed || [], out = [];
  const one = k => fix.some(x => k.startsWith(x));
  for (const [k, c] of [...farmMats(f), ...(f.extra || [])]) out.push([k, one(k) ? c : Math.ceil(c * n / b)]);
  return out;
}
const unitWord = (u, n) => {
  const forms = { 'модуль': ['модуль', 'модуля', 'модулей'], 'росток': ['росток', 'ростка', 'ростков'], 'ряд': ['ряд', 'ряда', 'рядов'], 'печь': ['печь', 'печи', 'печей'], 'житель': ['житель', 'жителя', 'жителей'], 'платформа': ['платформа', 'платформы', 'платформ'], 'спавнер': ['спавнер', 'спавнера', 'спавнеров'] }[u];
  if (!forms) return u;
  const a = n % 10, b = n % 100;
  return forms[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 1 : 2];
};
// число меняется — коротко «подпрыгивает»
function bump(el, txt) {
  if (el.textContent === txt) return;
  el.textContent = txt;
  if (!calm()) el.animate([{ transform: 'translateY(-3px) scale(1.08)', color: '#ffd98a' }, {}], { duration: 260, easing: EASE.out });
}

// блок в панели фермы: ползунок «сколько unit» и пересчёт выхода и материалов
function calcBlock() {
  const c = farm.calc;
  if (!c) return '';
  const max = Math.max(c.max || 8, c.base || 1), n0 = c.base || 1;
  return `<section class="block calc1">
      <h4>Сколько строить</h4>
      <label class="crow"><span id="cNl"></span> <input type="range" id="cN" min="1" max="${max}" value="${n0}"> <b id="cNv">${n0}</b></label>
      <p class="cout">≈ <b id="cOut"></b> ${esc(c.item)} в час</p>
      ${c.note ? `<p class="cnote">${esc(c.note)}</p>` : ''}
      <ul class="chips cmats" id="cMats"></ul>
      <a class="linkbtn" href="#calc" data-item="${esc(c.item)}">Подобрать под нужный выход →</a>
    </section>`;
}
function calcSync() {
  const c = farm.calc, inp = $('#cN');
  if (!c || !inp) return;
  const n = +inp.value;
  $('#cNl').textContent = unitWord(c.unit, 5).replace(/^./, s => s.toUpperCase());
  bump($('#cNv'), String(n));
  bump($('#cOut'), `${fmt(c.rate[0] * n)}–${fmt(c.rate[1] * n)}`);
  $('#cMats').innerHTML = matsFor(farm, n).map(([k, v]) => `<li><span>${esc(k)}</span><b>×${v}</b></li>`).join('');
}

// вкладка «Расчёт»: выбираешь ресурс и сколько нужно в час — получаешь фермы по уровням
let calcItem = null, calcTier = 0;
function renderCalc() {
  const fs = farms.filter(f => f.calc), items = [...new Set(fs.map(f => f.calc.item))];
  calcItem = load('calcItem', items[0]); if (!items.includes(calcItem)) calcItem = items[0];
  $('#v-calc').innerHTML = `
    <div class="sheethead">
      <h2>Расчёт фермы</h2>
      <p>Выбери, что нужно, и сколько в час. Подберу фермы по уровням: сколько модулей строить и что на это уйдёт.</p>
    </div>
    <div class="calcwrap">
      <div class="calcin">
        <div class="pchips" id="ciItems" role="group" aria-label="Что нужно">${items.map(i => `<button data-i="${esc(i)}" aria-pressed="${i === calcItem}">${esc(i)}</button>`).join('')}</div>
        <label class="crow big">Нужно в час <input type="number" id="ciN" min="1" step="10" inputmode="numeric"> <span class="cunit"></span></label>
        <div class="pchips" id="ciTier" role="group" aria-label="Уровень">${[0, 1, 2, 3].map(t => `<button data-t="${t}" aria-pressed="${t === calcTier}">${t ? `${tierHtml(t)} ${TIERS[t][0]}` : 'любой уровень'}</button>`).join('')}</div>
      </div>
      <div class="calcres" id="ciRes" aria-live="polite"></div>
    </div>`;
  const N = $('#ciN');
  N.value = load('calcN', 0) || Math.round(avgRate(fs.find(f => f.calc.item === calcItem)) * 2 / 10) * 10;
  $('#ciItems').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    calcItem = b.dataset.i; save('calcItem', calcItem);
    $('#ciItems').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    calcRes(true);
  };
  $('#ciTier').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    calcTier = +b.dataset.t;
    $('#ciTier').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    calcRes(true);
  };
  let t = 0;
  N.oninput = () => { clearTimeout(t); t = setTimeout(() => { save('calcN', +N.value || 0); calcRes(false); }, 120); };
  calcRes(false);
}
function calcRes(animate) {
  const perH = Math.max(1, +$('#ciN').value || 1);
  const fs = farms.filter(f => f.calc && f.calc.item === calcItem && (!calcTier || tFloor(f.tier) === calcTier))
    .sort((a, b) => (a.tier || 1) - (b.tier || 1) || unitsFor(a, perH) - unitsFor(b, perH));
  const box = $('#ciRes');
  if (!fs.length) { box.innerHTML = `<p class="cempty">Для «${esc(calcItem)}» на этом уровне ферм пока нет. Выбери другой уровень.</p>`; return; }
  box.innerHTML = fs.map(f => {
    const c = f.calc, n = unitsFor(f, perH), over = c.max && n > c.max, m = matsFor(f, n);
    return `<article class="ccard${over ? ' over' : ''}">
      <header><b>${esc(f.title)}</b>${tierHtml(f.tier || 1)}</header>
      <p class="cbig"><em>${n}</em> ${esc(unitWord(c.unit, n))} → ${fmt(c.rate[0] * n)}–${fmt(c.rate[1] * n)} в час</p>
      ${over ? `<p class="cwarn">Это больше разумного предела (${c.max}). Возьми ферму уровнем выше или раздели по разным местам.</p>` : ''}
      ${c.note ? `<p class="cnote">${esc(c.note)}</p>` : ''}
      <ul class="chips">${m.slice(0, 8).map(([k, v]) => `<li><span>${esc(k)}</span><b>×${v}</b></li>`).join('')}</ul>
      ${m.length > 8 ? `<p class="cnote">и ещё ${m.length - 8} — в самой ферме</p>` : ''}
      <a class="btn" href="#${f.id}">Открыть схему →</a>
    </article>`;
  }).join('');
  $('#v-calc .cunit').textContent = calcItem;
  if (animate) enter(box.children, KF.rise, { dur: 260, step: 50 });
}

/* ---------- плашка шага над 3D ---------- */
let chipK = '';
function chip() {
  const k = viewer.k, N = farm.steps.length, c = viewer.opt.cut, sc = $('#stepchip');
  const n = sc.querySelector('.n'), key = `${farm.id}:${k}`;
  sc.querySelector('.t').textContent = farm.steps[k - 1].t;
  if (chipK !== key) {
    // номер перелистывается только когда шаг правда сменился: снизу вперёд, сверху назад
    const same = chipK.startsWith(farm.id + ':'), up = same && k > +chipK.split(':')[1];
    chipK = key; n.textContent = `${k}/${N}`;
    if (same && !calm()) n.animate([{ transform: `translateY(${up ? 70 : -70}%)`, opacity: 0 }, { transform: `translateY(${up ? -10 : 10}%)`, opacity: 1, offset: .6 }, { transform: 'none' }], { duration: 340, easing: EASE.out });
  }
  badge(sc.querySelector('.cv'), c !== null, `срез: до y=${c}`);
  badge(sc.querySelector('.cr'), !!viewer.cutReset);
  badge(sc.querySelector('.ca'), !!viewer.cutAuto);
}
function badge(el, show, text) {
  if (text !== undefined && show && el.textContent !== text) el.textContent = text;
  if (el.hidden === !show) return;
  el.hidden = !show;
  if (show) el.animate(calm() ? FADE : [{ opacity: 0, transform: 'scale(.9)' }, {}], { duration: 160, easing: EASE.out });
}
function updateControls() {
  if (!viewer) return;
  const k = viewer.k, N = farm.steps.length;
  chip();
  $('#prev').disabled = k <= 1; $('#next').disabled = k >= N;
  $('#demoBtn').hidden = !farm.demo || k !== N;
  syncBlk();
  const lv = viewer.levels(), cut = $('#cut');
  cut.min = lv.lo; cut.max = lv.hi;
  cut.value = viewer.opt.cut === null ? lv.hi : viewer.opt.cut;
  showCut();
}
// «по одному блоку» прячем, только если в шаге вообще ничего не ставят; если блоки спрятал срез —
// кнопки просто гаснут, но место держат, иначе весь ряд управления прыгает
function syncBlk() {
  const n = viewer.seqLen(), sc = $('#bScrub'), s = farm.steps[viewer.k - 1], any = !!(s.put?.length || s.dig?.length || s.ents?.length);
  $('#blk').hidden = !any; $('#blk').style.visibility = n ? '' : 'hidden';
  sc.max = n; sc.value = n; blkLabel();
}
// настройка вида сбрасывает «по одному блоку», ползунок должен это знать
function setOpt(o) { viewer.set(o); syncBlk(); }
function blkLabel() { const sc = $('#bScrub'); $('#bLbl').textContent = `блок ${sc.value}/${sc.max}`; }
// на паузе «Собрать с нуля» листаем блоки от места, где стройка застыла, и сборка не сбрасывается:
// «Продолжить» потом достроит шаг с этого блока
function blkGo(v) {
  if (playing && !playing.paused) pausePlay(true);
  else if (!playing) stopPlay();
  const sc = $('#bScrub'); sc.max = viewer.seqLen(); sc.value = Math.max(0, Math.min(+sc.max, v)); viewer.scrub(+sc.value); blkLabel();
}
const blkWord = n => n % 10 === 1 && n % 100 !== 11 ? 'блок' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'блока' : 'блоков';
let cutShown = null;
function showCut() {
  const v = +$('#cut').value, hi = +$('#cut').max, lo = +$('#cut').min, L = viewer?.opt.layer;
  const name = farm.levels?.[v], lab = $('#cutLabel'), n = L ? viewer.layerCount(v) : 0;
  const txt = L ? `слой y=${v} · ${n ? n + ' ' + blkWord(n) : 'пусто'}${name ? ' · ' + name : ''}` : v >= hi ? 'всё видно' : `до y=${v}${name ? ' · ' + name : ''}`;
  if (lab.textContent === txt) return;
  // подпись въезжает с той стороны, куда двинули срез
  const d = cutShown === null || !L ? 0 : Math.sign(v - cutShown); cutShown = v;
  lab.textContent = txt; lab.title = txt;
  if (d && !calm()) lab.animate([{ opacity: 0, transform: `translateY(${d * 6}px)` }, {}], { duration: 180, easing: EASE.out });
  $('#cutDn').disabled = v <= lo; $('#cutUp').disabled = v >= hi;
}
// ▲▼: ряд выше или ниже; в обычном срезе верхний край — «всё видно»
function cutGo(v) {
  const c = $('#cut'), hi = +c.max, lo = +c.min;
  v = Math.max(lo, Math.min(hi, v));
  c.value = v; viewer.cutReset = false; viewer.cutAuto = false;
  setOpt({ cut: v >= hi && !viewer.opt.layer ? null : v }); showCut(); chip();
}
function showFarm(f) {
  stopPlay();
  if (farm !== f) {
    farm = f;
    if (viewer) {
      viewer.setFarm(f);
      const gm = f.ground?.mode || 'glass';
      document.querySelectorAll('[name=ground]').forEach(r => (r.checked = r.value === gm));
      viewer.set({ cut: f.cut ?? null, ground: gm, layer: false });
      $('#layer').checked = false; $('.cutbox').classList.remove('layer');
      viewer.goto(f.steps.length, { animate: false }); curK = viewer.k;
    } else curK = f.steps.length;
    // новая ферма — сразу, без кадра с пустой карточкой
    uiRaf = 0;
    buildPanel(); updateStep(curK, 0); updateControls();
    $('#viewport .legend').innerHTML = legendHtml(f);
    syncPicker(true);
  }
  document.title = `${f.title} — Верстак`;
}

/* ---------- легенда над 3D: только то, что есть в этой схеме ---------- */
const MOB = { player: ['#3d6fb3', 'ты'], villager: ['#c9a06a', 'житель'], zvillager: ['#8fb36a', 'зомби-житель'], zombie: ['#5f9e4b', 'зомби'], golem: ['#c9c3b6', 'голем'] };
function legendHtml(f) {
  const ents = new Set([...f.steps.flatMap(s => (s.ents || []).map(e => e.e)), ...(f.demo?.actors || []).map(a => a.e)]);
  const puts = f.steps.flatMap(s => (s.put || []).flatMap(p => expandPut(p)));
  const has = t => puts.some(e => e.t === t);
  const out = [];
  if (puts.length) out.push('<span><i></i>новое в шаге</span>');
  if (f.steps.some(s => s.dig?.length)) out.push('<span><i class="dig"></i>копать</span>');
  if (puts.some(e => e.t === 'water' && e.p.src)) out.push('<span><i class="sym">◯</i>вылей ведро</span>');
  if (puts.some(e => e.t === 'water' && e.p.flow)) out.push('<span><i class="sym">➜</i>течёт вода</span>');
  if (has('observer')) out.push('<span><i class="mob" style="--c:#c42a1e"></i>выход наблюдателя</span>');
  if (has('repeater')) out.push('<span><i class="sym">▲</i>повторитель: выход по стрелке</span>');
  for (const k in MOB) if (ents.has(k)) out.push(`<span><i class="mob" style="--c:${MOB[k][0]}"></i>${MOB[k][1]}</span>`);
  return out.join('');
}

/* ---------- «Собрать с нуля» ---------- */
function playLabel(t) {
  const b = $('#play'), s = b.querySelector('span');
  s.textContent = t;
  if (!calm()) s.animate([{ opacity: 0, transform: 'translateY(4px)' }, {}], { duration: 160, easing: EASE.out });
}
// playing: { timer, due — когда следующий шаг, left — сколько оставалось на паузе }
function stopPlay(done) {
  if (!playing) return;
  clearTimeout(playing.timer); playing = null;
  if (!done) viewer?.halt(); // стоп — шаг встаёт сразу, ничего не доставляется в фоне
  const b = $('#play');
  b.classList.remove('playing', 'paused'); b.setAttribute('aria-pressed', 'false');
  playLabel('▶ Собрать с нуля');
  badge($('#stop'), false);
  if (done && !calm()) { b.animate(KF.pop, { duration: 360, easing: EASE.spring }); $('#panel .prog')?.animate(KF.pop, { duration: 360, easing: EASE.spring }); }
  setTimeout(() => { if (!playing) b.style.setProperty('--p', 0); }, 300);
}
// следующий шаг — когда докопали и достроили текущий
const playWait = () => Math.max(2200, viewer.animLeft() * 1000 + 1100);
function playArm(ms) { playing.due = performance.now() + ms; playing.timer = setTimeout(playTick, ms); }
function playTick() {
  if (viewer.k >= farm.steps.length) return stopPlay(true);
  setStep(viewer.k + 1, true);
  $('#play').style.setProperty('--p', viewer.k / farm.steps.length);
  playArm(playWait());
}
function pausePlay(on) {
  if (!playing || !!playing.paused === on) return;
  const b = $('#play');
  playing.paused = on; viewer.pause(on); b.classList.toggle('paused', on);
  if (on) { clearTimeout(playing.timer); playing.left = Math.max(0, playing.due - performance.now()); playLabel('▶ Продолжить'); }
  else { playLabel('⏸ Пауза'); if (viewer.seq) playBlocks(); else playArm(playing.left); }
}
// после ручного «по одному блоку» достраиваем шаг блок за блоком, потом — дальше по шагам
function playBlocks() {
  const sc = $('#bScrub'), n = viewer.seqLen(), i = viewer.progress();
  if (i >= n) return playArm(1100);
  sc.value = i + 1; viewer.scrub(i + 1); blkLabel();
  playing.timer = setTimeout(playBlocks, i < viewer.digCells(viewer.k).length ? 40 : 120);
}
function play() {
  if (playing) return pausePlay(!playing.paused);
  const b = $('#play'), N = farm.steps.length;
  playing = {};
  b.classList.add('playing'); b.setAttribute('aria-pressed', 'true');
  playLabel('⏸ Пауза');
  badge($('#stop'), true);
  setStep(1, true, true);
  b.style.setProperty('--p', 1 / N);
  playArm(playWait());
}

function initFarmsView() {
  const tip = $('#tip');
  let tipOff = 0, tipHTML = '';
  renderPicker();
  try {
    viewer = new Viewer($('#viewport'), {
      onHover: (h, e) => {
        // между блоками подсказка не мигает: прячем с маленькой задержкой
        clearTimeout(tipOff);
        if (!h) { tipOff = setTimeout(() => tip.classList.remove('show'), 60); return; }
        let html;
        if (h.en) {
          const lv = farm.levels?.[h.en.y];
          html = `<b>${esc(BLOCKS[h.en.t].n)}</b><span>x${h.en.x} y${h.en.y} z${h.en.z}${lv ? ' · ' + esc(lv) : ''}</span><span>шаг ${h.en.step} · клик — перейти</span>`;
        } else if (h.ent) html = `<b>${esc(ENTS[h.ent.e].n)}</b><span>появляется в шаге ${h.ent.step}</span>`;
        else {
          const [x, y, z] = h.ground, G = farm.ground, lv = farm.levels?.[y];
          const name = y === G.top ? 'Дёрн' : y >= G.top - (G.dirt ?? 3) ? 'Земля' : 'Камень';
          const fate = viewer.groundFate(x, y, z);
          const note = fate && fate.step > viewer.k ? `${fate.dig ? 'выкопаешь' : 'заменишь блоком'} в шаге ${fate.step}`
            : G.dirt === 0 ? 'ровная площадка под постройкой' : 'не копай: это стенка постройки';
          html = `<b>${name} (природный)</b><span>x${x} y${y} z${z}${lv ? ' · ' + esc(lv) : ''}</span><span>${note}</span>`;
        }
        if (html !== tipHTML) tip.innerHTML = tipHTML = html;
        const r = $('#viewport').getBoundingClientRect();
        const x = Math.min(e.clientX - r.left + 14, r.width - 230), y = Math.max(e.clientY - r.top - 12, 8);
        tip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        tip.classList.add('show');
      },
      onPick: h => { const k = h.en ? h.en.step : h.ent?.step; if (k) { stopPlay(); if (k !== viewer.k) setStep(k, false); } }, // свой шаг не трогаем: сбился бы «по одному блоку»
    });
  } catch (err) {
    // без WebGL остаются шаги, материалы и шпаргалки: не роняем весь модуль
    console.warn('WebGL недоступен:', err);
    viewer = null;
    $('#viewport').innerHTML = '<p class="nogl">Не получилось включить 3D (WebGL) в этом браузере. Шаги и материалы всё равно работают.</p>';
    $('#viewport').classList.add('off');
    document.querySelector('.controls').style.display = 'none';
  }
  if (viewer) initControls();
  $('#panel').addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b || b.disabled) return;
    stopPlay();
    // «Назад»/«Дальше» считаем от текущего шага: панель обновляется кадром позже, и data-go может отставать
    const k = b.id === 'sNext' ? curK + 1 : b.id === 'sPrev' ? curK - 1 : +b.dataset.go;
    if (k === curK || k < 1 || k > farm.steps.length) return;
    setStep(k, k === curK + 1);
    // на телефоне карточка шага выше списка: подъезжаем к ней, иначе кажется, что ничего не случилось
    if (b.closest('.steps') && PHONE.matches) $('#panel .stepcard').scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
  });
  addEventListener('keydown', e => {
    if ($('#v-farms').hidden || e.target.closest?.('input, textarea')) return;
    // на краях ничего не делаем: нечего перестраивать
    if (e.key === 'ArrowRight' && curK < farm.steps.length) { stopPlay(); setStep(curK + 1, true); }
    if (e.key === 'ArrowLeft' && curK > 1) { stopPlay(); setStep(curK - 1, false); }
  });
}
function initControls() {
  $('#loading').remove();
  window.__viewer = viewer;
  $('#prev').onclick = () => { stopPlay(); setStep(viewer.k - 1, false); };
  $('#next').onclick = () => { stopPlay(); setStep(viewer.k + 1, true); };
  $('#play').onclick = play;
  $('#stop').onclick = () => stopPlay();
  $('#bScrub').oninput = e => blkGo(+e.target.value);
  $('#bPrev').onclick = () => blkGo(viewer.progress() - 1);
  $('#bNext').onclick = () => blkGo(viewer.progress() + 1);
  $('#replay').onclick = () => { stopPlay(); setStep(viewer.k, true, true); };
  $('#demoBtn').onclick = () => { setOpt({ demo: !viewer.opt.demo }); $('#demoBtn').setAttribute('aria-pressed', viewer.opt.demo); };
  // ползунок шлёт input чаще кадров: применяем не больше раза за кадр
  let cutRaf = 0;
  $('#cut').oninput = () => {
    if (cutRaf) return;
    cutRaf = requestAnimationFrame(() => {
      cutRaf = 0;
      const v = +$('#cut').value;
      viewer.cutReset = false;
      try { viewer.cutAuto = false; } catch { /* движок мог сделать его только для чтения */ }
      setOpt({ cut: v >= +$('#cut').max && !viewer.opt.layer ? null : v }); showCut(); chip();
    });
  };
  $('#cutDn').onclick = () => cutGo(+$('#cut').value - 1);
  $('#cutUp').onclick = () => cutGo(+$('#cut').value + 1);
  // по слоям: начинаем с самого нижнего ряда постройки и поднимаемся, как строишь в игре
  $('#layer').onchange = e => {
    const on = e.target.checked, lv = viewer.levels();
    viewer.cutReset = false; viewer.cutAuto = false;
    if (on) { const lo = Math.floor(viewer.bounds().min.y); $('#cut').value = lo; setOpt({ layer: true, cut: lo }); viewer.fit('iso'); }
    else { $('#cut').value = lv.hi; setOpt({ layer: false, cut: null }); }
    $('.cutbox').classList.toggle('layer', on);
    showCut(); chip();
  };
  $('#hl').onchange = e => setOpt({ highlight: e.target.checked });
  $('#onlyNew').onchange = e => setOpt({ onlyNew: e.target.checked });
  document.querySelectorAll('[name=ground]').forEach(r => (r.onchange = () => { setOpt({ ground: r.value }); chip(); }));
  $('#viewIso').onclick = () => viewer.fit('iso');
  $('#viewTop').onclick = () => viewer.fit('top');
}

/* ---------- шпаргалка: жители ---------- */
const em = '<i class="em" aria-label="изумруд"></i>';
const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
const stem = w => { const s = w.replace(/[аеиоуыэюяйь]+$/, ''); return s.length >= 3 ? s : w; };

function renderVillagers() {
  const row = (lv, [sells, buys]) => `
    <div class="lv"><div class="lvn">${lv}</div>
      <ul class="sells">${sells.map(([n, p]) => `<li><span>${esc(n)}</span>${p === '≈' ? '<small>цена разная</small>' : `<b>${esc(p)}${em}</b>`}</li>`).join('') || '<li class="none">—</li>'}</ul>
      <ul class="buys">${buys.map(([n, p]) => `<li><span>${esc(n)}</span><b>→ ${p}${em}</b></li>`).join('') || '<li class="none">—</li>'}</ul>
    </div>`;
  $('#v-villagers').innerHTML = `
    <header class="sheethead">
      <h2>Жители: кто что продаёт</h2>
      <p>${esc(VIL.intro)}</p>
      <label class="search"><span>Найти</span><input id="vq" type="search" placeholder="книга, железо, седло…" autocomplete="off"></label>
    </header>
    <div class="cards" id="vcards">${VIL.profs.map(p => `
      <article class="prof" data-text="${esc(norm([p.n, p.ws, p.craft, p.best, p.note, JSON.stringify(p.lv)].join(' ')))}">
        <header>${wsIcon(p.id, p.ws)}<div><h3>${esc(p.n)}</h3><p>Рабочее место: <b>${esc(p.ws)}</b></p></div></header>
        ${p.craft ? `<p class="wscraft"><span>Крафт</span>${esc(p.craft)}</p>` : ''}
        <p class="best">${esc(p.best)}</p>
        <div class="lvhead"><span></span><span>Продаёт тебе</span><span>Покупает у тебя</span></div>
        ${p.lv.map((l, i) => row(VIL.levels[i], l)).join('')}
        ${p.note ? `<p class="pnote">${esc(p.note)}</p>` : ''}
      </article>`).join('')}
    </div>
    <p class="vnone" id="vnone" hidden>Ничего не нашлось. Попробуй другое слово.</p>
    <div class="notes">${VIL.notes.map(n => `<article><h3>${esc(n.t)}</h3><p>${esc(n.d)}</p></article>`).join('')}</div>`;
  $('#vq').oninput = e => {
    // каждое слово ищем по основе без окончания: «бумага» найдёт «бумаги», «железо» — «железа»
    // и только с начала слова, чтобы «ёлка» не находилась внутри «щёлкать»
    const words = norm(e.target.value).split(/[^a-zа-я0-9]+/).filter(Boolean).map(w => new RegExp('(^|[^a-zа-я0-9])' + stem(w)));
    let shown = 0;
    document.querySelectorAll('#vcards .prof').forEach(c => {
      c.hidden = !words.every(re => re.test(c.dataset.text));
      if (!c.hidden) shown++;
    });
    const none = $('#vnone'), was = none.hidden;
    none.hidden = shown > 0;
    if (was && !none.hidden) enter([none], KF.rise);
  };
}

/* ---------- шпаргалка: зелья ---------- */
function renderPotions() {
  const flask = c => `<span class="flask" style="--c:${c}" aria-hidden="true"></span>`;
  $('#v-potions').innerHTML = `
    <header class="sheethead"><h2>Зелья: что во что кидать</h2><p>${esc(POT.intro)}</p></header>
    <ol class="setup">${POT.setup.map(([a, b], i) => `<li><em>${i + 1}</em><b>${esc(a)}</b><span>${esc(b)}</span></li>`).join('')}</ol>
    <section class="recipe">
      <h3>${esc(POT.recipe.t)}</h3>
      <div class="chain">${POT.recipe.steps.map(s => `<span>${esc(s)}</span>`).join('')}</div>
      <p>${esc(POT.recipe.d)}</p>
    </section>
    <section class="brew" aria-labelledby="brewh">
      <h3 class="sub" id="brewh">Из чего что получается</h3>
      <p class="gnote">Выбери зелье и разворачивай любой ингредиент: увидишь крафт, где искать и шанс выпадения с мобов.</p>
      <div class="pchips" role="group" aria-label="Зелья">${BREW.order.map(k => `<button type="button" data-brew="${k}" style="--c:${BREW.items[k].c}"><i></i>${esc(BREW.items[k].sn)}</button>`).join('')}</div>
      <div class="tree" id="brewtree"></div>
    </section>
    <h3 class="sub">Добавки</h3>
    <ul class="mods">${POT.mods.map(([n, d, c]) => `<li style="--c:${c}"><b>${esc(n)}</b><span>${esc(d)}</span></li>`).join('')}</ul>
    ${POT.groups.map(g => `
      <h3 class="sub">${esc(g.t)}</h3>${g.note ? `<p class="gnote">${esc(g.note)}</p>` : ''}
      <div class="ptable" role="table">
        <div class="prow phead" role="row"><span role="columnheader">Зелье</span><span role="columnheader">Добавь</span><span role="columnheader">Время: обычное · +редстоун · +светокамень</span><span role="columnheader">Что даёт</span></div>
        ${g.list.map(p => `<div class="prow${p.hot ? ' hot' : ''}" role="row">
          <span role="cell">${flask(p.c)}<b>${esc(p.n)}</b></span><span role="cell">${esc(p.i)}</span>
          <span role="cell" class="dur">${p.d.map(x => `<i>${esc(x)}</i>`).join('')}</span><span role="cell">${esc(p.e)}</span></div>`).join('')}
      </div>`).join('')}
    <h3 class="sub">Что будет, если…</h3>
    <div class="facts">${BREW.facts.map(([t, d]) => `<article><h4>${esc(t)}</h4><p>${esc(d)}</p></article>`).join('')}</div>
    <h3 class="sub">Эффекты, которых не сварить</h3>
    <div class="effs">${BREW.effects.map(([n, d]) => `<div><b>${esc(n)}</b><span>${esc(d)}</span></div>`).join('')}</div>
    <p class="gnote stew">${esc(BREW.stew)}</p>`;
  const pick = k => {
    document.querySelectorAll('[data-brew]').forEach(b => b.setAttribute('aria-pressed', b.dataset.brew === k));
    $('#brewtree').innerHTML = brewNode(k, new Set(), true) +
      `<div class="mods2"><b>Дальше можно усилить</b>${BREW.mods.map(([k2, d]) => `<div class="modrow"><span>+ ${esc(d)}</span>${brewNode(k2, new Set([k]), false)}</div>`).join('')}</div>`;
  };
  $('#v-potions').addEventListener('click', e => {
    const b = e.target.closest('[data-brew]'); if (!b) return;
    if (b.getAttribute('aria-pressed') === 'true') return;
    pick(b.dataset.brew);
    if (!calm()) b.animate(KF.pop, { duration: 300, easing: EASE.spring });
    enter([$('#brewtree')], KF.fade, { dur: 180 });
  });
  // раскрытый узел дерева мягко выезжает (только по клику, а не при каждом заходе во вкладку)
  $('#brewtree').addEventListener('click', e => {
    const d = e.target.closest('summary')?.parentElement;
    if (d && !d.open) requestAnimationFrame(() => { const w = d.querySelector(':scope > .ways'); if (d.open && w) enter([w], KF.rise, { dur: 240 }); });
  });
  pick('weakness');
}

/* ---------- дерево зельеварения ---------- */
const WAY = { brew: 'варка', craft: 'крафт', smelt: 'печь', drop: 'выпадает', find: 'найти', farm: 'вырастить', trade: 'купить', fish: 'рыбалка' };
function brewNode(k, seen, open) {
  const it = BREW.items[k]; if (!it) return '';
  const path = new Set(seen); path.add(k);
  const ways = it.how.map(w => {
    const kids = (w.from || []).filter(f => !path.has(f));
    const recipe = w.k === 'brew' ? `${w.from.map(f => esc(BREW.items[f].n)).join(' + ')} → ${esc(it.n)}` : '';
    return `<li class="way"><em class="tag ${w.k}">${WAY[w.k]}</em>${recipe ? `<span class="rec">${recipe}</span>` : ''}${w.t ? `<span>${esc(w.t)}</span>` : ''}
      ${kids.length ? `<div class="kids">${kids.map(f => brewNode(f, path, false)).join('')}</div>` : ''}</li>`;
  }).join('');
  return `<details class="tn${it.pot ? ' pot' : ''}"${open ? ' open' : ''}><summary style="--c:${it.c}"><i></i><b>${esc(it.n)}</b>${it.q ? `<small>${esc(it.q)}</small>` : ''}</summary><ul class="ways">${ways}</ul></details>`;
}

/* ---------- советы ---------- */
function renderTips() {
  $('#v-tips').innerHTML = `
    <header class="sheethead"><h2>Советы: где строить и как не сломать</h2><p>${esc(TIPS.intro)}</p></header>
    <div class="cards tips">${TIPS.groups.map(g => `
      <article class="tipcard">
        <header>${tipIcon(g.icon)}<h3>${esc(g.t)}</h3></header>
        <ul>${g.list.map(x => `<li>${x}</li>`).join('')}</ul>
      </article>`).join('')}
    </div>`;
}

/* ---------- маршрут ---------- */
// первый заход во вкладку — карточки лесенкой, дальше — одно короткое проявление
const seen = new Set();
let curView = '';
function viewIn(v) {
  if (v === curView) return;
  curView = v;
  const sec = $('#v-' + v);
  if (seen.has(v)) return enter([sec], KF.fade, { dur: 160 });
  seen.add(v);
  if (v === 'farms') return booted && enter([sec], KF.fade, { dur: 200 });
  const els = [];
  for (const el of sec.children) el.matches('.cards, .notes, .setup, .facts') ? els.push(...el.children) : els.push(el);
  enter(els.slice(0, 9), KF.rise, { dur: 300, step: 40, delay: booted ? 0 : 120 });
}
let lastFarm = '', lastMech = '';
function route() {
  const h = location.hash.slice(1);
  const SHEETS = { villagers: 'Жители', potions: 'Зелья', tips: 'Советы', calc: 'Расчёт' };
  if (h === 'calc') renderCalc();
  const sheet = SHEETS[h] ? h : null;
  // вкладка «Механизмы»: #mech или id схемы; иначе фермы
  const mech = h === 'mech' || mechs.some(m => m.id === h);
  const want = mech ? 'mech' : 'farms';
  if (!sheet && want !== mode) { mode = want; renderPicker(); }
  $('#v-farms').hidden = !!sheet;
  for (const k in SHEETS) $('#v-' + k).hidden = sheet !== k;
  document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-current', (a.dataset.v === (sheet || mode)) ? 'page' : 'false'));
  moveTabPill();
  viewIn(sheet || 'farms');
  if (sheet) { pausePlay(true); viewer?.setActive(false); document.title = SHEETS[sheet] + ' — Верстак'; return; }
  // размер сцены — до showFarm, чтобы камера вписалась по настоящим пропорциям экрана
  viewer?.setActive(true); viewer?.resize();
  const list = LIST(), f = list.find(x => x.id === h) || (list.includes(farm) ? farm : null) || (mode === 'mech' ? mechs.find(m => m.id === lastMech) : farms.find(x => x.id === lastFarm)) || list[0];
  if (mode === 'mech') { lastMech = f.id; $('#tabMech').href = '#' + f.id; } else { lastFarm = f.id; $('#tabFarms').href = '#' + f.id; }
  showFarm(f);
  // пока вкладка была скрыта, мерить было нечего
  movePickBar(); moveStepPill();
}
// пиксельный шрифт нужен до первых подписей в 3D
try { await Promise.race([document.fonts.load('48px Tiny5', 'Жж'), new Promise(r => setTimeout(r, 1500))]); } catch { /* без шрифта тоже работает */ }
renderVillagers(); renderPotions(); renderTips(); initFarmsView(); initChecks(); initVars();
addEventListener('hashchange', route);
route();
addEventListener('resize', () => still($('.tabs'), () => {
  moveTabPill();
  still($('#picker .plist'), movePickBar);
  const w = $('#panel .stepswrap'); if (w) still(w, moveStepPill);
}));
document.fonts.ready.then(() => { moveTabPill(); movePickBar(); moveStepPill(); });
// анимация загрузки: всё уже на месте и в нужном шрифте — играем одну общую постановку
document.documentElement.classList.remove('pre'); document.documentElement.classList.add('boot');
booted = true;
setTimeout(() => document.documentElement.classList.remove('boot'), 1100);
// iOS включает :active только если на странице есть touchstart
document.addEventListener('touchstart', () => {}, { passive: true });
// свернули вкладку — «Собрать с нуля» не листает шаги в фоне
document.addEventListener('visibilitychange', () => { if (document.hidden) pausePlay(true); });

// офлайн и установка на телефон (PWA); в превью без https просто не включится
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && document.querySelector('link[rel=manifest]')) {
  // новая версия: воркер её уже скачал и включил, а на странице ещё старый код — предлагаем перезагрузиться.
  // Первая установка тоже меняет контроллер, но тогда страница и так свежая: плашку не показываем.
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) showUpdate(); });
  navigator.serviceWorker.register('./sw.js').then(reg => {
    // на телефоне сайт висит открытым днями: проверяем обновление, когда к нему возвращаешься
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(err => console.warn('Офлайн-режим не включился:', err));
}
function showUpdate() {
  if ($('#upd')) return;
  const b = document.createElement('div');
  b.id = 'upd'; b.className = 'upd'; b.setAttribute('role', 'status');
  b.innerHTML = '<span>Есть новая версия</span><button class="btn primary" type="button">Обновить</button><button class="x" type="button" aria-label="Позже">✕</button>';
  b.querySelector('.primary').onclick = () => location.reload();
  b.querySelector('.x').onclick = () => b.remove();
  document.body.append(b);
}
