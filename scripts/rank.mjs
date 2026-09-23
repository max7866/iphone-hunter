// Landed-cost ranking: what does it actually cost to end up holding the phone?
//
//   landed = device price in USD  -  VAT refund (only where verified)  +  round-trip airfare
//
// Unverified refund data counts as ZERO refund, so a country is never ranked optimistically
// on numbers nobody sourced.

import { readFileSync } from 'node:fs';
import { fetchCatalog, fetchAvailability, politeSleep } from './apple.mjs';
import { toUSD } from './fx.mjs';
import { estimateProvider, travelpayoutsProvider, withFallback, gatewayFor } from './flights.mjs';

const { countries } = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url)));
const vat = JSON.parse(readFileSync(new URL('../data/vat.json', import.meta.url))).countries;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const origin = (args.from ?? 'IAD').toUpperCase();
const model = args.model ?? 'iPhone 18 Pro Max';
const capacity = (args.capacity ?? '256GB').toUpperCase();
const color = args.color ?? null;
const needTray = args.tray === 'true' || args.tray === true;
const inStockOnly = args.stock !== 'false';

const provider = process.env.TRAVELPAYOUTS_TOKEN
  ? withFallback(travelpayoutsProvider(), estimateProvider())
  : estimateProvider();

function refundUSD(cc, priceUSD) {
  const v = vat[cc];
  if (!v || !v.verified || !v.refundFactor) return { usd: 0, applied: false };
  const gross = priceUSD * (v.vatRate / (1 + v.vatRate));
  return { usd: gross * v.refundFactor, applied: true };
}

const pool = needTray ? countries.filter((c) => c.simTray) : countries;
const rows = [];

for (const c of pool) {
  try {
    const cat = await fetchCatalog(c.cc);
    const sku = cat.find(
      (p) => p.model === model && p.capacity === capacity && (!color || p.color.toLowerCase() === color.toLowerCase())
    );
    if (!sku) { console.error(`  ${c.name}: no SKU for ${model} ${capacity}${color ? ' ' + color : ''}`); continue; }

    await politeSleep();
    const stores = await fetchAvailability(c.cc, sku.partNumber, c.location);
    const open = stores.filter((s) => s.available);
    if (inStockOnly && !open.length) { rows.push({ c, sku, open: [], skipped: 'no stock' }); await politeSleep(); continue; }

    const priceUSD = await toUSD(sku.price, c.currency);
    const refund = refundUSD(c.cc, priceUSD);
    const dest = gatewayFor(c.cc);
    const flight = dest ? await provider.roundTrip(origin, dest) : { usd: 0, estimate: true };

    rows.push({
      c, sku, open,
      priceUSD, refund, dest, flight,
      landed: priceUSD - refund.usd + flight.usd,
      airport: open.some((s) => s.airport),
    });
  } catch (e) {
    console.error(`  ${c.name}: ${e.message}`);
  }
  await politeSleep();
}

const ok = rows.filter((r) => !r.skipped).sort((a, b) => a.landed - b.landed);

console.log(`\n${model} ${capacity}${color ? ' ' + color : ''} — from ${origin}` +
            `${needTray ? ', physical SIM tray only' : ''}   [fares: ${provider.name}${provider.estimate ? ', ESTIMATES' : ''}]\n`);
console.log('  ' + 'market'.padEnd(15) + 'device'.padStart(9) + 'refund'.padStart(9) +
            'flight'.padStart(10) + 'landed'.padStart(10) + '  stores');
for (const r of ok) {
  console.log(
    '  ' + r.c.name.padEnd(15) +
    ('$' + r.priceUSD.toFixed(0)).padStart(9) +
    (r.refund.applied ? '-$' + r.refund.usd.toFixed(0) : '—').padStart(9) +
    ('$' + r.flight.usd + (r.flight.estimate ? '~' : '')).padStart(10) +
    ('$' + r.landed.toFixed(0)).padStart(10) +
    `  ${r.open.length} in stock${r.airport ? ' ✈ airport store' : ''}` +
    (r.flight.airline ? `  ${r.flight.airline}` : '')
  );
}
const none = rows.filter((r) => r.skipped);
if (none.length) console.log(`\n  no stock today: ${none.map((r) => r.c.name).join(', ')}`);

const best = ok[0];
if (best) {
  console.log(`\n  Best: ${best.c.name} — ${best.sku.model} ${best.sku.capacity} ${best.sku.color}`);
  console.log(`    device $${best.priceUSD.toFixed(0)} + flight $${best.flight.usd} = $${best.landed.toFixed(0)} landed`);
  if (best.flight.link) console.log(`    flight:  ${best.flight.link.slice(0, 95)}`);
  const store = best.open.find((s) => s.airport) ?? best.open[0];
  if (store?.reserveUrl) console.log(`    reserve: ${store.storeName} — ${store.reserveUrl}`);
  if (best.flight.estimate) console.log('    NOTE: fare is a distance estimate, not a quote.');
}
console.log('\n  ~ = estimated fare. Refund shown only where the scheme is verified; blanks are conservative.');
