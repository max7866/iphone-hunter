// Live data comes from CloudFront, refreshed on a schedule by the Lambda. Apple is never
// touched by a visitor. world.json is static geometry and ships with the site.
const DATA_BASE = 'https://dmhxb71ukzv9s.cloudfront.net';
// On-demand live lookup for one market. The board is refreshed every 10 minutes in the
// background; this answers "right now" for the row someone actually cares about.
const CHECK_URL = 'https://eh5pj5m6yaecddocd2b3quysrm0nlxwu.lambda-url.us-east-1.on.aws/';
const POLL_MS = 60_000;

const $ = (id) => document.getElementById(id);
const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');

// "1TB" sorts before "256GB" unless TB is normalised to GB first.
const gb = (c) => (/TB$/i.test(c) ? parseFloat(c) * 1024 : parseFloat(c));
const byCapacity = (a, b) => gb(a) - gb(b);

const SWATCH = {
  Black: '#1B1C1F', Silver: '#D9DBDE', Glacier: '#BFD4E2', Burgundy: '#6B2739',
  'Desert Titanium': '#BFA48F', Natural: '#C9C5BE', White: '#EDEDED', Blue: '#3D5A80',
};

const state = {
  origin: 'IAD',
  model: 'iPhone 18 Pro',
  capacity: '256GB',
  colors: new Set(),
  trayOnly: false,
  stockOnly: true,
  sort: 'landed',
  active: null,
};

let DATA, FLIGHTS, WORLD;

/* ---------- data ---------- */

async function load() {
  const [m, f, w] = await Promise.all([
    fetch(`${DATA_BASE}/matrix.json`).then((r) => r.json()),
    fetch(`${DATA_BASE}/flights.json`).then((r) => r.json()),
    fetch('data/world.json').then((r) => r.json()),
  ]);
  DATA = m; FLIGHTS = f; WORLD = w;
}

/* ---------- map ---------- */

function drawWorld() {
  const g = $('world');
  g.innerHTML = WORLD.paths
    .map((d) => `<path d="${d}"/>`)
    .join('');
}

const project = (lat, lon) => [((lon + 180) / 360) * 1000, ((90 - lat) / 180) * 500];

function drawPins(rows) {
  const pins = $('pins');
  const byCc = new Map(rows.map((r) => [r.cc, r]));
  const landeds = rows.filter((r) => r.landed != null).map((r) => r.landed);
  const min = Math.min(...landeds), max = Math.max(...landeds);
  const radius = (v) => (max === min ? 5 : 4 + ((v - min) / (max - min)) * 5.5);

  pins.innerHTML = Object.values(DATA.markets)
    .filter((m) => m.lat != null)
    .map((m) => {
      const row = byCc.get(m.cc);
      const has = row && row.stores > 0;
      const [x, y] = project(m.lat, m.lon);
      const r = has ? radius(row.landed ?? max) : 3.2;
      const cls = ['pin', has ? '' : 'pin--none', row ? '' : 'pin--dim', row?.best ? 'pin--best' : '']
        .filter(Boolean).join(' ');
      return (
        `<g class="${cls}" data-cc="${m.cc}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">` +
        `<circle class="pin__halo" r="${(r * 2.2).toFixed(1)}"/>` +
        `<circle class="pin__dot" r="${r.toFixed(1)}"/>` +
        (m.simTray ? `<circle class="pin__ring" r="${(r + 3).toFixed(1)}"/>` : '') +
        `</g>`
      );
    })
    .join('');

  pins.querySelectorAll('.pin').forEach((el) => {
    const cc = el.dataset.cc;
    el.addEventListener('mouseenter', (e) => showTip(cc, el));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('click', () => {
      const card = document.querySelector(`.card[data-cc="${cc}"]`);
      if (card) { card.scrollIntoView({ block: 'center' }); flash(card); }
    });
  });
}

function showTip(cc, el) {
  const m = DATA.markets[cc];
  const row = currentRows().find((r) => r.cc === cc);
  const tip = $('maptip');
  const box = $('map').getBoundingClientRect();
  const p = el.getBoundingClientRect();
  tip.innerHTML =
    `<b>${m.name}</b>` +
    (row && row.stores > 0
      ? `<span>${fmt(row.landed)} landed · ${row.stores} store${row.stores > 1 ? 's' : ''}</span>`
      : `<span>none in stock today</span>`);
  tip.hidden = false;
  tip.style.left = `${p.left - box.left + p.width / 2}px`;
  tip.style.top = `${p.top - box.top}px`;
}
const hideTip = () => { $('maptip').hidden = true; };

function flash(card) {
  card.classList.add('is-active');
  setTimeout(() => card.classList.remove('is-active'), 1200);
}

/* ---------- filtering ---------- */

function currentRows() {
  const fl = FLIGHTS.origins[state.origin]?.markets ?? {};
  const rows = [];

  for (const m of Object.values(DATA.markets)) {
    if (state.trayOnly && !m.simTray) continue;

    const matches = m.skus.filter(
      (s) =>
        s.model === state.model &&
        s.capacity === state.capacity &&
        (state.colors.size === 0 || state.colors.has(s.color))
    );
    if (!matches.length) continue;

    const stocked = matches.filter((s) => s.stores > 0);
    if (state.stockOnly && !stocked.length) continue;

    const pick = (stocked.length ? stocked : matches).sort((a, b) => a.priceUSD - b.priceUSD)[0];
    const flight = fl[m.cc] ?? null;

    rows.push({
      cc: m.cc,
      name: m.name,
      city: m.city,
      simTray: m.simTray,
      sku: pick,
      stores: stocked.reduce((a, s) => a + s.stores, 0),
      airport: stocked.some((s) => s.airport),
      colorsInStock: [...new Set(stocked.map((s) => s.color))],
      priceUSD: pick.priceUSD,
      flight,
      landed: flight ? pick.priceUSD + flight.usd : null,
    });
  }

  const key = {
    landed: (r) => r.landed ?? Infinity,
    device: (r) => r.priceUSD,
    flight: (r) => r.flight?.usd ?? Infinity,
    stock: (r) => -r.stores,
  }[state.sort];
  rows.sort((a, b) => key(a) - key(b));
  if (rows.length && state.sort === 'landed') rows[0].best = true;
  return rows;
}

/* ---------- render ---------- */

function render() {
  const rows = currentRows();
  const cards = $('cards');

  $('count').textContent = rows.length
    ? `${rows.length} market${rows.length > 1 ? 's' : ''} match`
    : 'No matches';
  const duo = state.model === 'iPhone Duo';
  $('trayhint').textContent = duo
    ? 'The iPhone Duo is eSIM-only in every market, so this filter would return nothing.'
    : 'The iPhone Duo is eSIM-only everywhere, so this filter never applies to it.';
  $('f-tray').disabled = duo;
  $('sub').textContent =
    `${state.model} ${state.capacity}` +
    (state.colors.size ? ` · ${[...state.colors].join(', ')}` : '') +
    ` · from ${state.origin}`;

  if (!rows.length) {
    cards.innerHTML =
      `<li class="empty"><b>Nothing matches that combination today.</b>` +
      `Try turning off “in stock today”, or widening the colour choice.</li>`;
    drawPins([]);
    $('fine').textContent = '';
    return;
  }

  cards.innerHTML = rows
    .map((r) => {
      const est = r.flight?.estimate;
      return (
        `<li class="card${r.best ? ' card--best' : ''}" data-cc="${r.cc}">` +
        `<div class="card__market">` +
          `<span class="card__name">${r.name}</span>` +
          (r.best ? '<span class="badge badge--best">best</span>' : '') +
          (r.simTray ? '<span class="badge badge--tray">SIM tray</span>' : '') +
          (r.airport ? '<span class="badge badge--air">airport</span>' : '') +
          (r.flight && r.flight.usd === 0 ? '<span class="badge badge--here">you are here</span>' : '') +
          `<span class="card__where">${r.city ?? ''}</span>` +
        `</div>` +
        `<div class="metric"><span class="metric__k">Device</span><span class="metric__v">${fmt(r.priceUSD)}</span></div>` +
        `<div class="metric"><span class="metric__k">Flight</span><span class="metric__v">` +
          (r.flight ? `${fmt(r.flight.usd)}${est ? '<span class="est">~</span>' : ''}` : '—') +
        `</span></div>` +
        `<div class="metric"><span class="metric__k">Landed</span><span class="metric__v big">${r.landed ? fmt(r.landed) : '—'}</span></div>` +
        `<div class="go">` +
          (r.flight?.link ? `<a href="${r.flight.link}" target="_blank" rel="noopener sponsored">flight</a>` : '') +
          (r.sku.reserveUrl ? `<a href="${r.sku.reserveUrl}" target="_blank" rel="noopener">store</a>` : '') +
          `<button type="button" class="livebtn" data-cc="${r.cc}" title="Check Apple right now">live</button>` +
        `</div>` +
        `</li>`
      );
    })
    .join('');

  cards.querySelectorAll('.livebtn').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); liveCheck(b); })
  );

  cards.querySelectorAll('.card').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      const pin = document.querySelector(`.pin[data-cc="${el.dataset.cc}"]`);
      pin?.classList.add('pin--active');
    });
    el.addEventListener('mouseleave', () => {
      document.querySelectorAll('.pin--active').forEach((p) => p.classList.remove('pin--active'));
    });
  });

  const best = rows[0];
  const bestTray = rows.find((r) => r.simTray && r.landed != null);
  const base = DATA.usBaseline;

  let lead = '';
  if (best?.landed != null) {
    lead = `Cheapest right now: <strong>${best.name}</strong> at ${fmt(best.landed)} landed`;
    lead += best.flight && best.flight.usd === 0 ? ' — no flight, you are already there. ' : '. ';
  }
  // The tray premium is only meaningful against a market that actually sells a tray.
  if (bestTray && state.model !== 'iPhone Duo') {
    const premium = bestTray.landed - base.priceUSD;
    lead +=
      `Cheapest <strong>with a physical SIM tray</strong>: ${bestTray.name} at ` +
      `${fmt(bestTray.landed)} landed — about ${fmt(premium)} more than the ` +
      `${fmt(base.priceUSD)} US price, which is eSIM-only. `;
  }
  $('fine').innerHTML = lead +
    `Fares marked ~ are distance estimates, not quotes. Tax refunds are excluded unless a ` +
    `scheme is verified, so totals are conservative.`;

  drawPins(rows);
}

/* ---------- live ---------- */

async function liveCheck(btn) {
  const cc = btn.dataset.cc;
  const card = btn.closest('.card');
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const url =
      `${CHECK_URL}?cc=${encodeURIComponent(cc)}` +
      `&model=${encodeURIComponent(state.model)}&capacity=${encodeURIComponent(state.capacity)}` +
      (state.colors.size === 1 ? `&color=${encodeURIComponent([...state.colors][0])}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const live = await res.json();

    const stocked = live.skus.filter((s) => s.stores > 0);
    const total = stocked.reduce((a, s) => a + s.stores, 0);

    // Write the live answer straight into the row rather than waiting for the next poll.
    const metric = card.querySelectorAll('.metric')[2];
    card.classList.toggle('card--gone', total === 0);
    btn.textContent = total > 0 ? `${total} now` : 'none now';
    btn.classList.add('livebtn--done');
    if (metric) metric.querySelector('.metric__v').title = `checked ${new Date(live.checkedAt).toLocaleTimeString()}`;
  } catch {
    btn.textContent = 'failed';
    btn.classList.add('livebtn--fail');
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'live';
      btn.classList.remove('livebtn--done', 'livebtn--fail');
    }, 6000);
  }
}

function stamp() {
  if (!DATA) return;
  const secs = Math.round((Date.now() - new Date(DATA.generatedAt)) / 1000);
  const ago = secs < 90 ? `${secs}s` : secs < 5400 ? `${Math.round(secs / 60)} min` : `${Math.round(secs / 3600)}h`;
  $('stamp').textContent = `${Object.keys(DATA.markets).length} markets · updated ${ago} ago`;
}

async function poll() {
  try {
    const res = await fetch(`${DATA_BASE}/matrix.json`);
    if (!res.ok) return;
    const next = await res.json();
    if (next.generatedAt === DATA.generatedAt) return stamp();
    DATA = next;
    render();
  } catch {
    /* a failed poll just means the board stays as it is */
  }
}

/* ---------- controls ---------- */

function chipRow(el, values, get, set) {
  el.innerHTML = values
    .map((v) => `<button type="button" class="chip" aria-pressed="${get() === v}" data-v="${v}">${v}</button>`)
    .join('');
  el.querySelectorAll('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      set(b.dataset.v);
      el.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === get())));
      render();
    })
  );
}

function buildControls() {
  const o = $('origin');
  o.innerHTML = Object.entries(FLIGHTS.origins)
    .map(([code, v]) => `<option value="${code}">${code} — ${v.city}</option>`)
    .join('');
  o.value = state.origin;
  o.addEventListener('change', () => { state.origin = o.value; render(); });

  chipRow($('f-model'), DATA.facets.models, () => state.model, (v) => (state.model = v));
  chipRow($('f-capacity'), [...DATA.facets.capacities].sort(byCapacity), () => state.capacity, (v) => (state.capacity = v));

  const sw = $('f-color');
  sw.innerHTML = DATA.facets.colors
    .map((c) =>
      `<button type="button" class="swatch" aria-pressed="false" data-c="${c}" title="${c}" ` +
      `aria-label="${c}" style="background:${SWATCH[c] ?? '#888'}"></button>`
    )
    .join('');
  sw.querySelectorAll('.swatch').forEach((b) =>
    b.addEventListener('click', () => {
      const c = b.dataset.c;
      state.colors.has(c) ? state.colors.delete(c) : state.colors.add(c);
      b.setAttribute('aria-pressed', String(state.colors.has(c)));
      render();
    })
  );

  $('f-tray').addEventListener('change', (e) => { state.trayOnly = e.target.checked; render(); });
  $('f-stock').addEventListener('change', (e) => { state.stockOnly = e.target.checked; render(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

  $('reset').addEventListener('click', () => {
    state.colors.clear();
    state.trayOnly = false; state.stockOnly = true; state.sort = 'landed';
    state.model = DATA.facets.models.includes('iPhone 18 Pro') ? 'iPhone 18 Pro' : DATA.facets.models[0];
    state.capacity = DATA.facets.capacities.includes('256GB') ? '256GB' : DATA.facets.capacities[0];
    $('f-tray').checked = false; $('f-stock').checked = true; $('sort').value = 'landed';
    sw.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    chipRow($('f-model'), DATA.facets.models, () => state.model, (v) => (state.model = v));
    chipRow($('f-capacity'), [...DATA.facets.capacities].sort(byCapacity), () => state.capacity, (v) => (state.capacity = v));
    render();
  });
}

/* ---------- go ---------- */

(async function init() {
  try {
    await load();
  } catch {
    $('cards').innerHTML = '<li class="empty"><b>Could not load live data.</b>Try a refresh.</li>';
    return;
  }
  drawWorld();
  buildControls();
  render();
  stamp();
  setInterval(stamp, 5000);
  setInterval(poll, POLL_MS);
  // Coming back to a tab that has been open for hours should not show stale numbers.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
