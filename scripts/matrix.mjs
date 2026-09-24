// Build the full market x SKU matrix the UI filters against.
// 16 markets x (1 catalog + 2 batched availability calls) — about 48 requests total.

import { writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchCatalog, fetchAvailabilityBatch, politeSleep } from './apple.mjs';
import { toUSD } from './fx.mjs';
import { estimateProvider, travelpayoutsProvider, withFallback, gatewayFor } from './flights.mjs';
import { dataFile } from './paths.mjs';

const { countries } = JSON.parse(readFileSync(dataFile('countries.json')));
const { airports } = JSON.parse(readFileSync(dataFile('airports.json')));
const vat = JSON.parse(readFileSync(dataFile('vat.json'))).countries;

const log = (m) => process.stderr.write(m);

export async function buildMatrix() {
const ORIGIN = process.env.SNAPSHOT_ORIGIN ?? 'IAD';
const provider = process.env.TRAVELPAYOUTS_TOKEN
  ? withFallback(travelpayoutsProvider(), estimateProvider())
  : estimateProvider();

const markets = {};
const allColors = new Set(), allCaps = new Set(), allModels = new Set();

for (const c of countries) {
  try {
    const cat = await fetchCatalog(c.cc);
    if (!cat.length) { log(`  ${c.name}: empty catalog\n`); continue; }
    await politeSleep();

    const avail = await fetchAvailabilityBatch(c.cc, cat.map((p) => p.partNumber), c.location);
    const gw = gatewayFor(c.cc);
    const ap = gw ? airports[gw] : null;

    let flight = null;
    try { flight = gw ? await provider.roundTrip(ORIGIN, gw) : null; } catch {}

    const skus = [];
    for (const p of cat) {
      const a = avail.get(p.partNumber) ?? { available: [], totalStores: 0 };
      allColors.add(p.color); allCaps.add(p.capacity); allModels.add(p.model);
      skus.push({
        partNumber: p.partNumber,
        model: p.model,
        capacity: p.capacity,
        color: p.color,
        localPrice: p.price,
        priceUSD: Math.round(await toUSD(p.price, c.currency)),
        stores: a.available.length,
        airport: a.available.some((s) => s.airport),
        storeName: a.available[0]?.storeName ?? null,
        reserveUrl: a.available.find((s) => s.airport)?.reserveUrl ?? a.available[0]?.reserveUrl ?? null,
      });
    }

    markets[c.cc || 'us'] = {
      cc: c.cc || 'us',
      name: c.name,
      currency: c.currency,
      simTray: c.simTray,
      gateway: gw,
      lat: ap?.lat ?? null,
      lon: ap?.lon ?? null,
      city: ap?.city ?? null,
      flightUSD: flight?.usd ?? null,
      flightEstimate: flight?.estimate ?? false,
      flightAirline: flight?.airline ?? null,
      flightLink: flight?.link ?? null,
      vatRate: vat[c.cc]?.vatRate ?? null,
      refundVerified: vat[c.cc]?.verified ?? false,
      skus,
    };
    const inStock = skus.filter((s) => s.stores > 0).length;
    log(`  ${c.name.padEnd(15)} ${skus.length} SKUs, ${inStock} in stock\n`);
  } catch (e) {
    log(`  ${c.name}: ${e.message}\n`);
  }
  await politeSleep();
}

const out = {
  generatedAt: new Date().toISOString(),
  origin: ORIGIN,
  originCity: airports[ORIGIN]?.city ?? ORIGIN,
  usBaseline: { priceUSD: 1199, model: 'iPhone 18 Pro', capacity: '256GB', note: 'US models are eSIM-only' },
  facets: {
    models: [...allModels].sort(),
    capacities: [...allCaps].sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)),
    colors: [...allColors].sort(),
  },
  markets,
};

  return out;
}

// CLI: write to site/data. In Lambda the caller ships it to S3 instead.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await buildMatrix();
  await mkdir(new URL('../site/data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../site/data/matrix.json', import.meta.url), JSON.stringify(out));
  const n = Object.keys(out.markets).length;
  const total = Object.values(out.markets).reduce((a, m) => a + m.skus.length, 0);
  console.log(`\nwrote ${n} markets, ${total} SKU rows`);
}
