// Live availability for one market, on demand.
//
// The scheduled refresh keeps the whole board warm. This answers "is it actually there
// right now" for the one market someone is looking at. A 45s DynamoDB cache means a
// person hammering the button costs Apple one request, not twenty.

import { fetchCatalog, fetchAvailabilityBatch } from './apple.mjs';
import { makeCache, cached } from './cache.mjs';
import { readFileSync } from 'node:fs';
import { dataFile } from './paths.mjs';

const { countries } = JSON.parse(readFileSync(dataFile('countries.json')));
const live = makeCache({ ttl: 45 });

// CORS is owned by the Function URL's own config (see infra/lambda.tf). Setting the
// headers here too produced TWO Access-Control-Allow-Origin values, which browsers
// reject outright — the request succeeds on the wire and fails in the page.
const reply = (status, body) => ({
  statusCode: status,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=30',
  },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const q = event?.queryStringParameters ?? {};
  const cc = (q.cc ?? '').toLowerCase();
  const model = q.model ?? 'iPhone 18 Pro';
  const capacity = (q.capacity ?? '256GB').toUpperCase();
  const color = q.color ?? null;

  const market = countries.find((c) => (c.cc || 'us') === cc);
  if (!market) return reply(400, { error: `unknown market "${cc}"` });

  try {
    const { value, fresh } = await cached(live, `live:${cc}:${model}:${capacity}:${color ?? '*'}`, async () => {
      const cat = await fetchCatalog(market.cc);
      const want = cat.filter(
        (p) => p.model === model && p.capacity === capacity && (!color || p.color === color)
      );
      if (!want.length) return { market: market.name, cc, skus: [], checkedAt: new Date().toISOString() };

      const avail = await fetchAvailabilityBatch(market.cc, want.map((p) => p.partNumber), market.location);
      return {
        market: market.name,
        cc,
        checkedAt: new Date().toISOString(),
        skus: want.map((p) => {
          const a = avail.get(p.partNumber) ?? { available: [], totalStores: 0 };
          return {
            partNumber: p.partNumber,
            color: p.color,
            capacity: p.capacity,
            stores: a.available.length,
            totalStores: a.totalStores,
            airport: a.available.some((s) => s.airport),
            storeNames: a.available.map((s) => s.storeName),
            reserveUrl: a.available.find((s) => s.airport)?.reserveUrl ?? a.available[0]?.reserveUrl ?? null,
          };
        }),
      };
    });

    return reply(200, { ...value, cached: !fresh });
  } catch (err) {
    console.error('check failed', err);
    return reply(502, { error: 'upstream unavailable' });
  }
};
