// Produce a static snapshot of the ranking for the landing page.
// The page ships real numbers, not mock data — that is the whole credibility argument.

import { writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fetchCatalog, fetchAvailability, politeSleep } from './apple.mjs';
import { toUSD } from './fx.mjs';
import { estimateProvider, travelpayoutsProvider, withFallback, gatewayFor } from './flights.mjs';

const { countries } = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url)));
const vat = JSON.parse(readFileSync(new URL('../data/vat.json', import.meta.url))).countries;

const ORIGIN = process.env.SNAPSHOT_ORIGIN ?? 'IAD';
const MODEL = 'iPhone 18 Pro';
const CAPACITY = '256GB';

const provider = process.env.TRAVELPAYOUTS_TOKEN
  ? withFallback(travelpayoutsProvider(), estimateProvider())
  : estimateProvider();

const rows = [];
for (const c of countries.filter((x) => x.simTray)) {
  try {
    const cat = await fetchCatalog(c.cc);
    const sku = cat.find((p) => p.model === MODEL && p.capacity === CAPACITY);
    if (!sku) continue;
    await politeSleep();
    const stores = await fetchAvailability(c.cc, sku.partNumber, c.location);
    const open = stores.filter((s) => s.available);
    const priceUSD = await toUSD(sku.price, c.currency);
    const dest = gatewayFor(c.cc);
    let flight = null;
    try { flight = dest ? await provider.roundTrip(ORIGIN, dest) : null; } catch {}
    rows.push({
      market: c.name, cc: c.cc, currency: c.currency,
      localPrice: sku.price, priceUSD: Math.round(priceUSD),
      color: sku.color, partNumber: sku.partNumber,
      gateway: dest,
      flightUSD: flight?.usd ?? null,
      flightEstimate: flight?.estimate ?? null,
      airline: flight?.airline ?? null,
      landed: flight ? Math.round(priceUSD + flight.usd) : null,
      inStock: open.length,
      totalStores: stores.length,
      airportStore: open.some((s) => s.airport),
      vatRate: vat[c.cc]?.vatRate ?? null,
      refundVerified: vat[c.cc]?.verified ?? false,
    });
    process.stderr.write(`  ${c.name}: ${open.length}/${stores.length} in stock\n`);
  } catch (e) {
    process.stderr.write(`  ${c.name}: ${e.message}\n`);
  }
  await politeSleep();
}

rows.sort((a, b) => (a.landed ?? 9e9) - (b.landed ?? 9e9));

const snapshot = {
  generatedAt: new Date().toISOString(),
  origin: ORIGIN,
  model: MODEL,
  capacity: CAPACITY,
  filter: 'physical SIM tray only',
  usBaseline: { model: MODEL, capacity: CAPACITY, priceUSD: 1199, note: 'US models are eSIM-only' },
  rows,
};

await mkdir(new URL('../site/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../site/data/snapshot.json', import.meta.url), JSON.stringify(snapshot, null, 2));
console.log(`\nwrote ${rows.length} markets, cheapest landed $${rows[0]?.landed}`);
