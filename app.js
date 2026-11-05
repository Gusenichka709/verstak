// Интерфейс: вкладки, выбор фермы, шаги, материалы, шпаргалки.
import { Viewer, expandPut } from './engine.js';
import { BLOCKS, ENTS } from './blocks.js';
import FARM_IDS from './farms/index.js';
import VIL from './cheats/villagers.js';
import POT from './cheats/potions.js';
import BREW from './cheats/brew.js';
import { wsIcon, tipIcon } from './icons.js';
import TIPS from './cheats/tips.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const farms = await Promise.all(FARM_IDS.map(id => import(`./farms/${id}.js`).then(m => m.default)));
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
function renderPicker() {
  $('#picker').innerHTML = farms.map(f => `
    <a class="pick" href="#${f.id}" data-id="${f.id}" aria-current="false">
      <b>${esc(f.title)}</b><span>${esc(f.short)}</span><i>${esc(f.stats[0][1])}</i>
    </a>`).join('') + '<span class="pickbar" aria-hidden="true"></span>';
  stagger($('#picker'), '.pick');
}
function syncPicker(scroll) {
  const box = $('#picker');
  let on = null;
  for (const a of box.querySelectorAll('.pick')) {
    const me = a.dataset.id === farm.id;
    a.classList.toggle('on', me); a.setAttribute('aria-current', me ? 'page' : 'false');
    if (me) on = a;
  }
  movePickBar();
  // в строчной раскладке выбранная карточка не должна уехать за край
  if (scroll && on && ROW.matches) on.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
}
function movePickBar() {
  const box = $('#picker'), on = box.querySelector('.pick.on'), bar = box.querySelector('.pickbar');
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
  P.innerHTML = `
    <header class="farmhead">
      <h2>${esc(farm.title)}</h2>
      <p>${esc(farm.short)}</p>
      <div class="badges">${farm.badges.map(b => `<span>${esc(b)}</span>`).join('')}</div>
      <dl class="stats">${farm.stats.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    </header>
    <article class="stepcard">
      <div class="prog" style="--n:${N}" aria-hidden="true"><i></i></div>
      <div class="sbody" aria-live="polite"></div>
      <div class="stepnav">
        <button class="btn" id="sPrev" data-go="0">← Назад</button>
        <button class="btn primary" id="sNext" data-go="2">Дальше →</button>
      </div>
    </article>
    <section class="block">
      <h4>Все шаги</h4>
      <div class="stepswrap still"><span class="steppill" aria-hidden="true"></span>
        <ol class="steps">${farm.steps.map((x, i) => `<li><button class="${i + 1 < curK ? 'done' : i + 1 === curK ? 'on' : ''}" data-go="${i + 1}"><em>${i + 1}</em><span>${esc(x.t)}</span></button></li>`).join('')}</ol>
      </div>
    </section>
    <section class="block">
      <h4>Материалы на всю ферму</h4>
      <ul class="chips all">${chips(farmMats(farm))}${(farm.extra || []).map(([n, c]) => `<li class="mob"><span>${esc(n)}</span><b>×${c}</b></li>`).join('')}</ul>
    </section>`;
  P.scrollTop = 0;
  shownK = 0; outAnim = null;
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
  P.querySelectorAll('.steps button').forEach((b, i) => {
    b.classList.toggle('on', i + 1 === k); b.classList.toggle('done', i + 1 < k);
    if (i + 1 === k) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  moveStepPill();
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
function syncBlk() { const n = viewer.seqLen(), sc = $('#bScrub'); $('#blk').hidden = !n; sc.max = n; sc.value = n; blkLabel(); }
// настройка вида сбрасывает «по одному блоку», ползунок должен это знать
function setOpt(o) { viewer.set(o); syncBlk(); }
function blkLabel() { const sc = $('#bScrub'); $('#bLbl').textContent = `блок ${sc.value}/${sc.max}`; }
function blkGo(v) { stopPlay(); const sc = $('#bScrub'); sc.value = Math.max(0, Math.min(+sc.max, v)); viewer.scrub(+sc.value); blkLabel(); }
function showCut() {
  const v = +$('#cut').value, hi = +$('#cut').max;
  const name = farm.levels?.[v];
  $('#cutLabel').textContent = v >= hi ? 'всё видно' : `до y=${v}${name ? ' · ' + name : ''}`;
}
function showFarm(f) {
  stopPlay();
  if (farm !== f) {
    farm = f;
    if (viewer) {
      viewer.setFarm(f);
      const gm = f.ground?.mode || 'glass';
      document.querySelectorAll('[name=ground]').forEach(r => (r.checked = r.value === gm));
      viewer.set({ cut: f.cut ?? null, ground: gm });
      viewer.goto(f.steps.length, { animate: false }); curK = viewer.k;
    } else curK = f.steps.length;
    // новая ферма — сразу, без кадра с пустой карточкой
    uiRaf = 0;
    buildPanel(); updateStep(curK, 0); updateControls();
    syncPicker(true);
  }
  document.title = `${f.title} — Верстак`;
}

/* ---------- «Собрать с нуля» ---------- */
function playLabel(t) {
  const b = $('#play'), s = b.querySelector('span');
  s.textContent = t;
  if (!calm()) s.animate([{ opacity: 0, transform: 'translateY(4px)' }, {}], { duration: 160, easing: EASE.out });
}
function stopPlay(done) {
  if (!playing) return;
  clearTimeout(playing); playing = null;
  const b = $('#play');
  b.classList.remove('playing'); b.setAttribute('aria-pressed', 'false');
  playLabel('▶ Собрать с нуля');
  if (done && !calm()) { b.animate(KF.pop, { duration: 360, easing: EASE.spring }); $('#panel .prog')?.animate(KF.pop, { duration: 360, easing: EASE.spring }); }
  setTimeout(() => { if (!playing) b.style.setProperty('--p', 0); }, 300);
}
function play() {
  if (playing) return stopPlay();
  const b = $('#play'), N = farm.steps.length;
  b.classList.add('playing'); b.setAttribute('aria-pressed', 'true');
  playLabel('■ Стоп');
  setStep(1, true, true);
  b.style.setProperty('--p', 1 / N);
  // следующий шаг — когда докопали и достроили текущий
  const wait = () => Math.max(2200, viewer.animLeft() * 1000 + 1100);
  const tick = () => {
    if (viewer.k >= farm.steps.length) return stopPlay(true);
    setStep(viewer.k + 1, true);
    b.style.setProperty('--p', viewer.k / N);
    playing = setTimeout(tick, wait());
  };
  playing = setTimeout(tick, wait());
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
  $('#bScrub').oninput = e => blkGo(+e.target.value);
  $('#bPrev').onclick = () => blkGo(+$('#bScrub').value - 1);
  $('#bNext').onclick = () => blkGo(+$('#bScrub').value + 1);
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
      setOpt({ cut: v >= +$('#cut').max ? null : v }); showCut(); chip();
    });
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
function route() {
  const h = location.hash.slice(1);
  const SHEETS = { villagers: 'Жители', potions: 'Зелья', tips: 'Советы' };
  const sheet = SHEETS[h] ? h : null;
  $('#v-farms').hidden = !!sheet;
  for (const k in SHEETS) $('#v-' + k).hidden = sheet !== k;
  document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-current', (a.dataset.v === (sheet || 'farms')) ? 'page' : 'false'));
  moveTabPill();
  viewIn(sheet || 'farms');
  if (sheet) { stopPlay(); viewer?.setActive(false); document.title = SHEETS[sheet] + ' — Верстак'; return; }
  // размер сцены — до showFarm, чтобы камера вписалась по настоящим пропорциям экрана
  viewer?.setActive(true); viewer?.resize();
  const f = farms.find(x => x.id === h) || farm || farms[0];
  $('#tabFarms').href = '#' + f.id;
  showFarm(f);
  // пока вкладка была скрыта, мерить было нечего
  movePickBar(); moveStepPill();
}
// пиксельный шрифт нужен до первых подписей в 3D
try { await Promise.race([document.fonts.load('48px Tiny5', 'Жж'), new Promise(r => setTimeout(r, 1500))]); } catch { /* без шрифта тоже работает */ }
renderVillagers(); renderPotions(); renderTips(); initFarmsView();
addEventListener('hashchange', route);
route();
addEventListener('resize', () => still($('.tabs'), () => {
  moveTabPill();
  still($('#picker'), movePickBar);
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
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlay(); });

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
