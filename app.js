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
const chips = m => [...m].map(([n, c]) => `<li><span>${esc(n)}</span><b>×${c}</b></li>`).join('');

/* ---------- фермы ---------- */
function renderPicker() {
  $('#picker').innerHTML = farms.map(f => `
    <a class="pick${f === farm ? ' on' : ''}" href="#${f.id}" aria-current="${f === farm ? 'page' : 'false'}">
      <b>${esc(f.title)}</b><span>${esc(f.short)}</span><i>${esc(f.stats[0][1])}</i>
    </a>`).join('');
}
function renderPanel(k) {
  const s = farm.steps[k - 1], N = farm.steps.length;
  const need = materials(farm, k);
  $('#panel').innerHTML = `
    <header class="farmhead">
      <h2>${esc(farm.title)}</h2>
      <p>${esc(farm.short)}</p>
      <div class="badges">${farm.badges.map(b => `<span>${esc(b)}</span>`).join('')}</div>
      <dl class="stats">${farm.stats.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    </header>
    <article class="stepcard" aria-live="polite">
      <div class="num">Шаг ${k} из ${N}</div>
      <h3>${esc(s.t)}</h3>
      <p>${s.d}</p>
      ${need.size ? `<div class="need"><h4>Ставишь в этом шаге</h4><ul class="chips">${chips(need)}</ul></div>` : ''}
      ${s.tip ? `<p class="tipbox">${s.tip}</p>` : ''}
      <div class="stepnav">
        <button class="btn" data-go="${k - 1}" ${k === 1 ? 'disabled' : ''}>← Назад</button>
        <button class="btn primary" data-go="${k + 1}" ${k === N ? 'disabled' : ''}>Дальше →</button>
      </div>
    </article>
    <section class="block">
      <h4>Все шаги</h4>
      <ol class="steps">${farm.steps.map((x, i) => `<li><button class="${i + 1 === k ? 'on' : ''}" data-go="${i + 1}"><em>${i + 1}</em>${esc(x.t)}</button></li>`).join('')}</ol>
    </section>
    <section class="block">
      <h4>Материалы на всю ферму</h4>
      <ul class="chips all">${chips(materials(farm))}${(farm.extra || []).map(([n, c]) => `<li class="mob"><span>${esc(n)}</span><b>×${c}</b></li>`).join('')}</ul>
    </section>`;
}
function setStep(k, animate = true, replay = false) {
  if (viewer) { viewer.goto(k, { animate, replay }); curK = viewer.k; }
  else curK = Math.max(1, Math.min(farm.steps.length, k)); // без WebGL шаги всё равно листаются
  renderPanel(curK);
  updateControls();
}
function chip() {
  const k = viewer.k, N = farm.steps.length, c = viewer.opt.cut;
  $('#stepchip').innerHTML = `<b>${k}/${N}</b> ${esc(farm.steps[k - 1].t)}${c !== null ? ` <i class="cutbadge">срез: до y=${c}</i>` : ''}${viewer.cutReset ? ' <i class="cutbadge ok">срез сброшен, чтобы было видно новое</i>' : ''}`;
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
    }
    renderPicker();
    setStep(f.steps.length, false);
  }
  document.title = `${f.title} — Верстак`;
}
function stopPlay() { if (playing) { clearTimeout(playing); playing = null; $('#play').textContent = '▶ Собрать с нуля'; } }
function play() {
  if (playing) return stopPlay();
  $('#play').textContent = '■ Стоп';
  setStep(1, true, true);
  // следующий шаг — когда докопали и достроили текущий
  const wait = () => Math.max(2200, viewer.animLeft() * 1000 + 1100);
  const tick = () => {
    if (viewer.k >= farm.steps.length) return stopPlay();
    setStep(viewer.k + 1, true);
    playing = setTimeout(tick, wait());
  };
  playing = setTimeout(tick, wait());
}

function initFarmsView() {
  const tip = $('#tip');
  try {
    viewer = new Viewer($('#viewport'), {
      onHover: (h, e) => {
        if (!h) { tip.hidden = true; return; }
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
        const r = $('#viewport').getBoundingClientRect();
        tip.innerHTML = html; tip.hidden = false;
        tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 230) + 'px';
        tip.style.top = Math.max(e.clientY - r.top - 12, 8) + 'px';
      },
      onPick: h => { if (h.en) setStep(h.en.step, false); else if (h.ent) setStep(h.ent.step, false); },
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
  $('#panel').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b && !b.disabled) { stopPlay(); const k = +b.dataset.go; setStep(k, k === curK + 1); } });
  addEventListener('keydown', e => {
    if ($('#v-farms').hidden || e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') { stopPlay(); setStep(curK + 1, true); }
    if (e.key === 'ArrowLeft') { stopPlay(); setStep(curK - 1, false); }
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
  $('#cut').oninput = () => { const v = +$('#cut').value; viewer.cutReset = false; setOpt({ cut: v >= +$('#cut').max ? null : v }); showCut(); chip(); };
  $('#hl').onchange = e => setOpt({ highlight: e.target.checked });
  $('#onlyNew').onchange = e => setOpt({ onlyNew: e.target.checked });
  document.querySelectorAll('[name=ground]').forEach(r => (r.onchange = () => setOpt({ ground: r.value })));
  $('#viewIso').onclick = () => viewer.fit('iso');
  $('#viewTop').onclick = () => viewer.fit('top');
}

/* ---------- шпаргалка: жители ---------- */
const em = '<i class="em" aria-label="изумруд"></i>';
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
      <article class="prof" data-text="${esc((p.n + ' ' + p.ws + ' ' + JSON.stringify(p.lv)).toLowerCase())}">
        <header>${wsIcon(p.id, p.ws)}<div><h3>${esc(p.n)}</h3><p>Рабочее место: <b>${esc(p.ws)}</b></p></div></header>
        ${p.craft ? `<p class="wscraft"><span>Крафт</span>${esc(p.craft)}</p>` : ''}
        <p class="best">${esc(p.best)}</p>
        <div class="lvhead"><span></span><span>Продаёт тебе</span><span>Покупает у тебя</span></div>
        ${p.lv.map((l, i) => row(VIL.levels[i], l)).join('')}
        ${p.note ? `<p class="pnote">${esc(p.note)}</p>` : ''}
      </article>`).join('')}
    </div>
    <div class="notes">${VIL.notes.map(n => `<article><h3>${esc(n.t)}</h3><p>${esc(n.d)}</p></article>`).join('')}</div>`;
  $('#vq').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#vcards .prof').forEach(c => (c.hidden = q && !c.dataset.text.includes(q)));
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
  $('#v-potions').addEventListener('click', e => { const b = e.target.closest('[data-brew]'); if (b) pick(b.dataset.brew); });
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
function route() {
  const h = location.hash.slice(1);
  const SHEETS = { villagers: 'Жители', potions: 'Зелья', tips: 'Советы' };
  const sheet = SHEETS[h] ? h : null;
  $('#v-farms').hidden = !!sheet;
  for (const k in SHEETS) $('#v-' + k).hidden = sheet !== k;
  document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-current', (a.dataset.v === (sheet || 'farms')) ? 'page' : 'false'));
  if (sheet) { stopPlay(); viewer?.setActive(false); document.title = SHEETS[sheet] + ' — Верстак'; return; }
  // размер сцены — до showFarm, чтобы камера вписалась по настоящим пропорциям экрана
  viewer?.setActive(true); viewer?.resize();
  const f = farms.find(x => x.id === h) || farm || farms[0];
  $('#tabFarms').href = '#' + f.id;
  showFarm(f);
}
// пиксельный шрифт нужен до первых подписей в 3D
try { await Promise.race([document.fonts.load('48px Tiny5', 'Жж'), new Promise(r => setTimeout(r, 1500))]); } catch { /* без шрифта тоже работает */ }
renderVillagers(); renderPotions(); renderTips(); initFarmsView();
addEventListener('hashchange', route);
route();

// офлайн и установка на телефон (PWA); в превью без https просто не включится
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && document.querySelector('link[rel=manifest]')) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Офлайн-режим не включился:', err));
}
