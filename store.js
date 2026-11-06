// Память сайта в localStorage: галочки, фильтр и прочие мелочи. Нет хранилища (приватный режим) — просто не помним.
const P = 'verstak:';
export function load(key, def) {
  try { const v = localStorage.getItem(P + key); return v === null ? def : JSON.parse(v); } catch { return def; }
}
export function save(key, val) {
  try { if (val === undefined) localStorage.removeItem(P + key); else localStorage.setItem(P + key, JSON.stringify(val)); } catch { /* места нет — не страшно */ }
}
