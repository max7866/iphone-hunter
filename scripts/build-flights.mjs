// Precompute round-trip fares from several origins so the UI can offer a real origin
// picker. The browser cannot call Travelpayouts directly — CORS, and it would expose the
// token — so every origin the picker offers is resolved here at build time.

import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { estimateProvider, travelpayoutsProvider, withFallback, gatewayFor } from './flights.mjs';
import { dataFile } from './paths.mjs';

const { countries } = JSON.parse(readFileSync(dataFile('countries.json')));
const { airports } = JSON.parse(readFileSync(dataFile('airports.json')));

export async function buildFlights() {
const ORIGINS = (process.env.ORIGINS ?? 'IAD,JFK,DXB,KBL,LHR').split(',');
const provider = process.env.TRAVELPAYOUTS_TOKEN
  ? withFallback(travelpayoutsProvider(), estimateProvider())
  : estimateProvider();

const out = { generatedAt: new Date().toISOString(), origins: {} };

for (const origin of ORIGINS) {
  if (!airports[origin]) { process.stderr.write(`  ${origin}: unknown airport, skipped\n`); continue; }
  const byMarket = {};
  for (const c of countries) {
    const gw = gatewayFor(c.cc);
    if (!gw) continue;
    try {
      const f = await provider.roundTrip(origin, gw);
      byMarket[c.cc || 'us'] = {
        usd: f.usd, estimate: !!f.estimate, airline: f.airline ?? null,
        transfers: f.transfers ?? null, link: f.link ?? null, gateway: gw,
      };
    } catch (e) {
      byMarket[c.cc || 'us'] = null;
    }
  }
  const priced = Object.values(byMarket).filter(Boolean);
  out.origins[origin] = { city: airports[origin].city, name: airports[origin].name, markets: byMarket };
  process.stderr.write(`  ${origin} (${airports[origin].city}): ${priced.length} routes priced\n`);
}

  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await buildFlights();
  await writeFile(new URL('../site/data/flights.json', import.meta.url), JSON.stringify(out));
  console.log(`wrote ${Object.keys(out.origins).length} origins`);
}
