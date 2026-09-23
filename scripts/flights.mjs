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

/**
 * Travelpayouts — free token, cached fares from Aviasales search history.
 *
 * Uses aviasales/v3/prices_for_dates, not v1/prices/cheap: v3 returns a flat array with
 * round-trip prices, transfer counts and a booking deep link. v1 keys its response by
 * CITY code (LHR comes back under "LON"), which silently yields nothing if you look up
 * the airport code you passed in.
 *
 * `link` is relative and needs the aviasales host plus your affiliate marker to earn
 * commission; without TRAVELPAYOUTS_MARKER it still works as a plain search link.
 */
export function travelpayoutsProvider(token = process.env.TRAVELPAYOUTS_TOKEN) {
  const cache = fileCache({ ttl: 12 * 3600 });
  const marker = process.env.TRAVELPAYOUTS_MARKER;

  return {
    name: 'travelpayouts',
    estimate: false,
    async roundTrip(origin, dest, { month } = {}) {
      if (!token) throw new Error('TRAVELPAYOUTS_TOKEN not set');
      if (origin === dest) return { usd: 0, estimate: false, note: 'already there' };

      const when = month ?? new Date().toISOString().slice(0, 7);
      const key = `tp3:${origin}:${dest}:${when}`;

      const { value } = await cached(cache, key, async () => {
        // The cache is built from real Aviasales searches, so a specific month can be
        // empty on thin routes. Ask for the month, then fall back to any date rather
        // than reporting the route as unavailable.
        const call = async (qs) => {
          const res = await fetch(
            'https://api.travelpayouts.com/aviasales/v3/prices_for_dates' +
              `?origin=${origin}&destination=${dest}&currency=usd&one_way=false` +
              `&sorting=price&limit=5${qs}`,
            { headers: { 'X-Access-Token': token } }
          );
          if (!res.ok) throw new Error(`travelpayouts ${res.status}`);
          return ((await res.json())?.data ?? []).filter((r) => r.price);
        };

        let rows = await call(`&departure_at=${when}`);
        let windowed = true;
        if (!rows.length) { rows = await call(''); windowed = false; }
        if (!rows.length) return null;
        const best = rows.sort((a, b) => a.price - b.price)[0];
        return {
          usd: best.price,
          estimate: false,
          anyDate: !windowed,
          airline: best.airline ?? null,
          transfers: best.transfers ?? null,
          departure: best.departure_at ?? null,
          ret: best.return_at ?? null,
          // Store the raw path only. The affiliate marker is applied on read, so a
          // cached fare written before the marker existed still earns commission.
          linkPath: best.link ?? null,
        };
      });

      if (!value) throw new Error(`no fare data ${origin}->${dest}`);
      return {
        ...value,
        link: value.linkPath
          ? `https://www.aviasales.com${value.linkPath}${marker ? `&marker=${marker}` : ''}`
          : null,
      };
    },
  };
}

/** Try providers in order; the first that answers wins. Keeps a thin route from
 *  dropping out of the ranking entirely just because nobody has searched it lately. */
export function withFallback(...providers) {
  return {
    name: providers.map((p) => p.name).join('+'),
    estimate: providers.every((p) => p.estimate),
    async roundTrip(origin, dest, opts) {
      let lastErr;
      for (const p of providers) {
        try {
          const r = await p.roundTrip(origin, dest, opts);
          return { ...r, via: p.name };
        } catch (e) { lastErr = e; }
      }
      throw lastErr ?? new Error('no provider answered');
    },
  };
}
