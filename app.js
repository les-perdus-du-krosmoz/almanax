'use strict';

const TZ = 'Europe/Paris';
const DATA_URL = 'data/almanax.json';
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const JOURS_COURTS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MAX_DOTS = 3;

// ---------- utilitaires ----------

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Les dates "AAAA-MM-JJ" sont manipulées en UTC pour éviter tout décalage de fuseau.
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toISO = (date) => date.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = parseISO(s); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };
const weekdayIdx = (s) => (parseISO(s).getUTCDay() + 6) % 7; // lundi = 0
const parisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const longDate = (s) => {
  const d = parseISO(s);
  const n = d.getUTCDate();
  return `${cap(JOURS[weekdayIdx(s)])} ${n === 1 ? '1er' : n} ${MOIS[d.getUTCMonth()]}`;
};
const shortDate = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const fmtNum = (n) => (n == null ? '—' : new Intl.NumberFormat('fr-FR').format(n));
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

// ---------- état ----------

const S = {
  data: null,
  byDate: new Map(),
  today: parisToday(),
  selected: null,
  month: null, // "AAAA-MM"
  searching: false,
  q: '',
  tags: new Set(),
  period: '30',
};

const tagInfo = (id) => S.data.tags[id] || { label: id, color: '#7D766C' };
const sortedTags = () => Object.entries(S.data.tags).sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99));
const dotHTML = (id) => `<span class="dot" style="--c:${esc(tagInfo(id).color)}"></span>`;
const itemImg = (tribute) => (tribute && tribute.image
  ? `<img class="item-img" src="${esc(tribute.image)}" alt="" width="56" height="56" loading="lazy">`
  : '<span class="item-img is-empty" aria-hidden="true"></span>');
const offeringText = (t) => `${esc(t.quantity ?? '?')} × ${esc(t.name || 'offrande inconnue')}`;

// ---------- rendu : en-tête ----------

function renderMeta() {
  const { coverage_until: until, generated_at: gen, today } = S.data;
  $('#coverage').textContent = `Dofus 3, données jusqu'au ${shortDate(until)}`;
  if (gen) {
    const d = new Date(gen);
    $('#generated').textContent = `Dernière mise à jour : ${d.toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'long', timeStyle: 'short' })}.`;
  }
  if (today && today < addDays(S.today, -1)) {
    const banner = $('#stale');
    banner.textContent = `Les données n'ont pas été mises à jour depuis le ${shortDate(today)}. Les jours affichés restent justes, mais la fin de la période peut manquer.`;
    banner.hidden = false;
  }
}

function renderLegend() {
  $('#legend').innerHTML = sortedTags()
    .map(([id, t]) => `<li>${dotHTML(id)}${esc(t.label)}</li>`)
    .join('');
}

// ---------- rendu : calendrier ----------

function monthBounds() {
  const first = S.data.days[0].date.slice(0, 7);
  const last = S.data.coverage_until.slice(0, 7);
  return { min: first, max: last };
}

function shiftMonth(delta) {
  const [y, m] = S.month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const next = toISO(d).slice(0, 7);
  const { min, max } = monthBounds();
  if (next < min || next > max) return;
  S.month = next;
  renderCalendar();
}

function renderCalendar() {
  const [y, m] = S.month.split('-').map(Number);
  $('#cal-title').textContent = `${cap(MOIS[m - 1])} ${y}`;
  const { min, max } = monthBounds();
  $('#cal-prev').disabled = S.month <= min;
  $('#cal-next').disabled = S.month >= max;

  const lead = weekdayIdx(`${S.month}-01`);
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let html = '<span aria-hidden="true"></span>'.repeat(lead);
  for (let n = 1; n <= nDays; n++) {
    const iso = `${S.month}-${String(n).padStart(2, '0')}`;
    const day = S.byDate.get(iso);
    const cls = ['cal-day'];
    if (iso === S.today) cls.push('is-today');
    if (iso === S.selected) cls.push('is-selected');
    const tags = day ? day.tags : [];
    const dots = tags.slice(0, MAX_DOTS).map(dotHTML).join('') + (tags.length > MAX_DOTS ? '<span class="dot-more" aria-hidden="true">+</span>' : '');
    const label = `${longDate(iso)}${day ? ` : ${tags.map((t) => tagInfo(t).label).join(', ')}` : ', pas de données'}`;
    html += `<button type="button" class="${cls.join(' ')}" data-date="${iso}" aria-pressed="${iso === S.selected}" aria-label="${esc(label)}"${day ? '' : ' disabled'}>`
      + `<span>${n}</span><span class="dots">${dots}</span></button>`;
  }
  $('#cal-grid').innerHTML = html;
}

// ---------- rendu : jour sélectionné ----------

function renderDay() {
  const el = $('#day-view');
  const d = S.byDate.get(S.selected);
  if (!d) {
    el.innerHTML = '<div class="card"><p>Pas de données pour ce jour. Choisis une date dans le calendrier.</p></div>';
    return;
  }
  const next = S.byDate.get(addDays(d.date, 1));
  const xp = d.xp ? `<div class="reward"><span class="label">XP</span><span class="value">${fmtNum(d.xp)}</span></div>` : '';
  el.innerHTML = `
    <article class="card day-card">
      <div class="day-head">
        <h2>${longDate(d.date)}</h2>
        ${d.date === S.today ? '<span class="badge">Aujourd\'hui</span>' : ''}
      </div>
      <ul class="tag-list">${d.tags.map((t) => `<li class="tag">${dotHTML(t)}${esc(tagInfo(t).label)}</li>`).join('')}</ul>
      <div class="bonus">
        <p class="bonus-name">${esc(d.bonus.name || 'Bonus')}</p>
        <p class="bonus-desc">${esc(d.bonus.description)}</p>
      </div>
      <hr class="divider">
      <div class="offering">
        ${itemImg(d.tribute)}
        <div class="offering-text"><span class="label">Offrande</span><span class="value">${offeringText(d.tribute)}</span></div>
        <div class="reward"><span class="label">Kamas</span><span class="value">${fmtNum(d.kamas)}</span></div>
        ${xp}
      </div>
    </article>
    ${next ? `
    <section class="card tomorrow" aria-label="Offrande du lendemain">
      ${itemImg(next.tribute)}
      <div><span class="label">À préparer pour ${longDate(next.date).toLowerCase()}</span><span class="value">${offeringText(next.tribute)}</span></div>
    </section>` : ''}`;
}

// ---------- rendu : recherche ----------

function renderChips() {
  $('#chips').innerHTML = sortedTags()
    .map(([id, t]) => `<button type="button" class="chip" data-tag="${esc(id)}" aria-pressed="false">${dotHTML(id)}${esc(t.label)}</button>`)
    .join('');
}

function renderHints() {
  // Pour chaque tag actif lié à un tag inactif (ex. XP -> Challenge), on propose de l'ajouter.
  const proposed = new Set();
  const hints = [];
  for (const id of S.tags) {
    const t = tagInfo(id);
    for (const rel of t.related || []) {
      if (S.tags.has(rel) || proposed.has(rel) || !t.note) continue;
      proposed.add(rel);
      hints.push(`<div class="hint"><p>${esc(t.note)}</p><button type="button" data-add-tag="${esc(rel)}">Inclure ${esc(tagInfo(rel).label)}</button></div>`);
    }
  }
  $('#hints').innerHTML = hints.join('');
}

function searchResults() {
  const q = norm(S.q);
  const limit = S.period === 'all' ? null : addDays(S.today, Number(S.period));
  return S.data.days.filter((d) => d.date >= S.today
    && (!limit || d.date <= limit)
    && (S.tags.size === 0 || d.tags.some((t) => S.tags.has(t)))
    && (!q || norm(`${d.tribute.name} ${d.bonus.name} ${d.bonus.description}`).includes(q)));
}

function renderSearch() {
  document.querySelectorAll('#chips .chip').forEach((b) => b.setAttribute('aria-pressed', String(S.tags.has(b.dataset.tag))));
  renderHints();

  if (!S.q.trim() && S.tags.size === 0) {
    $('#count').textContent = 'Choisis une catégorie ou tape le nom d\'une offrande.';
    $('#results').innerHTML = '';
    return;
  }
  const res = searchResults();
  const until = S.period === 'all' ? ` jusqu'au ${shortDate(S.data.coverage_until)}` : '';
  $('#count').textContent = res.length
    ? `${plural(res.length, 'jour')} trouvé${res.length > 1 ? 's' : ''}${until}.`
    : 'Aucun jour ne correspond. Élargis la période ou retire un filtre.';
  $('#results').innerHTML = res.map((d) => {
    const dt = parseISO(d.date);
    return `<li><button type="button" class="result" data-date="${d.date}">
      <span class="result-date"><span class="wd">${JOURS_COURTS[weekdayIdx(d.date)]}</span><span class="dd">${dt.getUTCDate()}</span><span class="mo">${MOIS_COURTS[dt.getUTCMonth()]}</span></span>
      <span class="result-body">
        <span class="result-tags">${d.tags.map((t) => `<span>${dotHTML(t)}${esc(tagInfo(t).label)}</span>`).join('')}</span>
        <span>${esc(d.bonus.description)}</span>
        <span class="result-offering">Offrande : ${offeringText(d.tribute)}</span>
      </span>
    </button></li>`;
  }).join('');
}

// ---------- navigation ----------

function updateURL() {
  const url = `?date=${S.selected}${S.searching ? '#recherche' : ''}`;
  history.replaceState(history.state, '', url);
}

function select(date) {
  if (!S.byDate.has(date)) return;
  S.selected = date;
  S.month = date.slice(0, 7);
  renderCalendar();
  renderDay();
  updateURL();
}

function setSearching(on) {
  S.searching = on;
  document.body.classList.toggle('is-searching', on);
  $('#search-view').hidden = !on;
  $('#day-view').hidden = on;
  const toggle = $('#search-toggle');
  toggle.setAttribute('aria-expanded', String(on));
  toggle.querySelector('span').textContent = on ? 'Fermer la recherche' : 'Recherche avancée';
  if (on) renderSearch();
  window.scrollTo({ top: 0 });
}

function openSearch() {
  if (S.searching) return;
  history.pushState({ searching: true }, '', `?date=${S.selected}#recherche`);
  setSearching(true);
}

function closeSearch() {
  if (!S.searching) return;
  if (history.state && history.state.searching) history.back(); // popstate referme la vue
  else { setSearching(false); updateURL(); }
}

// ---------- évènements ----------

function bind() {
  $('#cal-prev').addEventListener('click', () => shiftMonth(-1));
  $('#cal-next').addEventListener('click', () => shiftMonth(1));
  $('#cal-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.cal-day');
    if (b && !b.disabled) {
      if (S.searching) closeSearch();
      select(b.dataset.date);
    }
  });

  $('#search-toggle').addEventListener('click', () => (S.searching ? closeSearch() : openSearch()));
  $('#search-back').addEventListener('click', closeSearch);

  let timer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { S.q = e.target.value; renderSearch(); }, 150);
  });
  $('#period').addEventListener('change', (e) => { S.period = e.target.value; renderSearch(); });
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const id = b.dataset.tag;
    if (S.tags.has(id)) S.tags.delete(id); else S.tags.add(id);
    renderSearch();
  });
  $('#hints').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add-tag]');
    if (!b) return;
    S.tags.add(b.dataset.addTag);
    renderSearch();
  });
  $('#results').addEventListener('click', (e) => {
    const b = e.target.closest('.result');
    if (!b) return;
    const date = b.dataset.date;
    closeSearch();
    select(date);
  });

  window.addEventListener('popstate', () => {
    setSearching(location.hash === '#recherche');
    updateURL(); // garde la date sélectionnée dans l'URL après un retour arrière
  });
}

// ---------- démarrage ----------

async function init() {
  try {
    const r = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    S.data = await r.json();
    if (!S.data.days || !S.data.days.length) throw new Error('aucun jour');
  } catch (err) {
    console.error(err);
    $('#day-view').innerHTML = '<div class="card"><p>Les données de l\'Almanax n\'ont pas pu être chargées. Recharge la page dans quelques minutes.</p></div>';
    return;
  }

  for (const d of S.data.days) S.byDate.set(d.date, d);
  const asked = new URLSearchParams(location.search).get('date');
  S.selected = (asked && S.byDate.has(asked)) ? asked : (S.byDate.has(S.today) ? S.today : S.data.days[0].date);
  S.month = S.selected.slice(0, 7);

  renderMeta();
  renderLegend();
  renderChips();
  bind();
  renderCalendar();
  renderDay();
  if (location.hash === '#recherche') {
    history.replaceState({ searching: true }, '', location.href);
    setSearching(true);
  } else {
    updateURL();
  }
}

init();
