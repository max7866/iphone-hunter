const fmt = (n) => '$' + n.toLocaleString('en-US');

const rel = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

async function render() {
  const rowsEl = document.getElementById('rows');
  let snap;
  try {
    const res = await fetch('data/snapshot.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    snap = await res.json();
  } catch {
    rowsEl.innerHTML = '<tr><td colspan="5" class="empty">Live data unavailable right now.</td></tr>';
    return;
  }

  const ranked = snap.rows.filter((r) => r.landed != null && r.inStock > 0);
  const rest = snap.rows.filter((r) => !(r.landed != null && r.inStock > 0));

  document.getElementById('meta').textContent =
    `${snap.model} ${snap.capacity} · physical SIM tray · from ${snap.origin} · updated ${rel(snap.generatedAt)}`;

  rowsEl.innerHTML = '';
  ranked.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (i === 0) tr.className = 'best';
    tr.innerHTML =
      `<td class="market">${r.market}${r.airportStore ? '<span class="tag">✈</span>' : ''}</td>` +
      `<td class="num">${fmt(r.priceUSD)}</td>` +
      `<td class="num${r.flightEstimate ? ' est' : ''}">${fmt(r.flightUSD)}${r.flightEstimate ? '~' : ''}</td>` +
      `<td class="num landed">${fmt(r.landed)}</td>` +
      `<td class="num">${r.inStock} of ${r.totalStores}</td>`;
    rowsEl.append(tr);
  });

  rest.forEach((r) => {
    const tr = document.createElement('tr');
    tr.className = 'dim';
    tr.innerHTML =
      `<td class="market">${r.market}</td>` +
      `<td class="num">${fmt(r.priceUSD)}</td>` +
      `<td class="num">${r.flightUSD != null ? fmt(r.flightUSD) : '—'}</td>` +
      `<td class="num">—</td>` +
      `<td class="num">none today</td>`;
    rowsEl.append(tr);
  });

  // The inversion sentence is written from the data so it cannot go stale.
  const byDevice = [...ranked].sort((a, b) => a.priceUSD - b.priceUSD);
  const cheapestDevice = byDevice[0];
  const bestLanded = ranked[0];
  const inv = document.getElementById('inversion');
  if (inv && cheapestDevice && bestLanded && cheapestDevice.market !== bestLanded.market) {
    const place = ranked.indexOf(cheapestDevice) + 1;
    const ord = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][place] ?? `#${place}`;
    inv.textContent =
      `${cheapestDevice.market} sells this phone for ${fmt(cheapestDevice.priceUSD)}, less than anywhere else on the board — ` +
      `and lands ${ord}, because the flight costs more than the saving. ` +
      `${bestLanded.market}'s phone costs ${fmt(bestLanded.priceUSD - cheapestDevice.priceUSD)} more and wins, ` +
      `because you can get there for ${fmt(bestLanded.flightUSD)}. ` +
      `That inversion is the entire point, and no availability tracker can show it.`;
  }

  const best = ranked[0];
  const base = snap.usBaseline;
  if (best && base) {
    const premium = best.landed - base.priceUSD;
    document.getElementById('baseline').textContent =
      `A US ${base.model} ${base.capacity} is ${fmt(base.priceUSD)} but eSIM-only. ` +
      `Cheapest landed cost for one with a SIM tray: ${fmt(best.landed)} via ${best.market} — ` +
      `a ${fmt(premium)} premium for the tray. Flights marked ~ are distance estimates, not quotes.`;
  }
}

render();
