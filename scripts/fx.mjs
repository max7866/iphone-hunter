// Currency conversion.
//
// open.er-api.com covers every currency we need (free, no key). Frankfurter/ECB is
// cleaner but omits TWD, AED, SAR and QAR — and Taiwan keeps the SIM tray, so that
// gap is disqualifying.
//
// AED/SAR/QAR are hard USD pegs (3.6725 / 3.75 / 3.64) and the live feed agrees, so a
// stale rate for those is harmless.

import { fileCache, cached } from './cache.mjs';

const cache = fileCache({ ttl: 6 * 3600 });

export async function usdRates() {
  const { value } = await cached(cache, 'fx:usd', async () => {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error(`FX ${res.status}`);
    const json = await res.json();
    if (!json.rates?.USD) throw new Error('FX payload missing rates');
    return { rates: json.rates, asOf: json.time_last_update_utc ?? null };
  });
  return value;
}

/** Convert an amount in `currency` to USD. */
export async function toUSD(amount, currency) {
  if (currency === 'USD') return amount;
  const { rates } = await usdRates();
  const r = rates[currency];
  if (!r) throw new Error(`no FX rate for ${currency}`);
  return amount / r;
}
