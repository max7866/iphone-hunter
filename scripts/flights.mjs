// Flight cost providers.
//
// IMPORTANT: Amadeus Self-Service — the obvious choice and what most guides still
// recommend — was decommissioned on 17 July 2026. Existing keys stopped working and
// signups are closed. Kiwi Tequila went invite-only. So the provider is an interface,
// not a hardcoded vendor, and losing one again should not touch the ranker.
//
//   estimateProvider     no key, great-circle distance model. Ranking only, never a quote.
//   travelpayoutsProvider free token, cached real fares from Aviasales search history.
//   (duffel)             real bookable fares, ~$0.005/search for us since we never book.

import { readFileSync } from 'node:fs';
import { fileCache, cached } from './cache.mjs';

const { airports, marketGateway } = JSON.parse(
  readFileSync(new URL('../data/airports.json', import.meta.url))
);

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function distanceKm(a, b) {
  const A = airports[a], B = airports[b];
  if (!A || !B) throw new Error(`unknown airport ${!A ? a : b}`);
  const dLat = rad(B.lat - A.lat), dLon = rad(B.lon - A.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(A.lat)) * Math.cos(rad(B.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const gatewayFor = (cc) => marketGateway[cc] ?? null;

/**
 * Distance-based round-trip estimate. Deliberately crude and deliberately labelled:
 * it exists so the ranking works before a real provider is wired, and every result it
 * produces is marked estimate:true so the UI can never present it as a fare.
 */
export function estimateProvider() {
  return {
    name: 'estimate',
    estimate: true,
    async roundTrip(origin, dest) {
      if (origin === dest) return { usd: 0, estimate: true, note: 'already there' };
      const km = distanceKm(origin, dest);
      // rough long-haul economy: a fixed cost plus a per-km taper
      const usd = Math.round(180 + km * 0.085 + Math.max(0, km - 8000) * 0.02);
      return { usd, km: Math.round(km), estimate: true };
    },
  };
}

/** Travelpayouts Data API — free token, cached cheapest fares. Set TRAVELPAYOUTS_TOKEN. */
export function travelpayoutsProvider(token = process.env.TRAVELPAYOUTS_TOKEN) {
  const cache = fileCache({ ttl: 12 * 3600 });
  return {
    name: 'travelpayouts',
    estimate: false,
    async roundTrip(origin, dest) {
      if (!token) throw new Error('TRAVELPAYOUTS_TOKEN not set');
      if (origin === dest) return { usd: 0, estimate: false, note: 'already there' };
      const key = `tp:${origin}:${dest}`;
      const { value } = await cached(cache, key, async () => {
        const url =
          `https://api.travelpayouts.com/v1/prices/cheap?origin=${origin}&destination=${dest}&currency=usd`;
        const res = await fetch(url, { headers: { 'X-Access-Token': token } });
        if (!res.ok) throw new Error(`travelpayouts ${res.status}`);
        const json = await res.json();
        const offers = Object.values(json?.data?.[dest] ?? {});
        const cheapest = offers.map((o) => o.price).filter(Boolean).sort((a, b) => a - b)[0];
        return cheapest ? { usd: cheapest, estimate: false } : null;
      });
      if (!value) throw new Error(`no fare data ${origin}->${dest}`);
      return value;
    },
  };
}
