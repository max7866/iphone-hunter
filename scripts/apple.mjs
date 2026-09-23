// Apple store data layer.
//
// Two undocumented endpoints, both verified live 2026-09-23:
//   GET /{cc}/shop/buy-iphone/iphone-18-pro   -> catalog: partNumber, local price, model/capacity/colour
//   GET /{cc}/shop/retail/pickup-message      -> per-store pickup availability + reservation URL
//
// The widely-cited /shop/fulfillment-messages endpoint is DEAD (HTTP 541). Do not use it.
// These are undocumented and can change without notice; everything here is cached upstream.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122 Safari/537.36';

const base = (cc) => `https://www.apple.com${cc ? '/' + cc : ''}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, referer) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,text/html',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(referer ? { Referer: referer } : {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

const NAME_RE =
  /^iPhone (18 Pro Max|18 Pro|Duo)\s+(\d+(?:GB|TB))\s+(.+)$/i;

/** Catalog for one country: every buyable SKU with local price, capacity and colour. */
export async function fetchCatalog(cc, family = 'iphone-18-pro') {
  const url = `${base(cc)}/shop/buy-iphone/${family}`;
  const html = await (await get(url)).text();

  const seen = new Map();
  const re = /"partNumber":"([^"]+)","price":\{"fullPrice":([\d.]+)\},"category":"iphone","name":"([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const [, partNumber, price, name] = m;
    // Apple puts U+00A0 between "iPhone"/"18" and "Pro"/"Max"; normalise before parsing.
    const clean = name.replace(/\s+/g, ' ').trim();
    const parsed = NAME_RE.exec(clean);
    if (!parsed) continue;
    seen.set(partNumber, {
      partNumber,
      price: Number(price),
      model: `iPhone ${parsed[1]}`,
      capacity: parsed[2].toUpperCase(),
      color: parsed[3].trim(),
    });
  }
  return [...seen.values()];
}

/**
 * Pickup availability for up to 16 part numbers in ONE request.
 * The endpoint accepts parts.0..parts.N but silently truncates: ask for 32 and you get
 * 20 back with no error. 16 keeps a safe margin and turns a 32-SKU catalog into 2 calls.
 */
export async function fetchAvailabilityBatch(cc, partNumbers, location) {
  const out = new Map();
  for (let i = 0; i < partNumbers.length; i += 16) {
    const batch = partNumbers.slice(i, i + 16);
    const qs = batch.map((p, n) => `parts.${n}=${encodeURIComponent(p)}`).join('&');
    const url =
      `${base(cc)}/shop/retail/pickup-message?pl=true&mts.0=regular&${qs}` +
      `&location=${encodeURIComponent(location)}`;
    const json = await (await get(url, `${base(cc)}/shop/buy-iphone/iphone-18-pro`)).json();
    const stores = json?.body?.stores ?? [];
    for (const part of batch) {
      const hits = stores
        .filter((s) => s.partsAvailability?.[part]?.pickupDisplay === 'available')
        .map((s) => ({
          storeName: s.storeName,
          city: s.city,
          airport: /airport|changi|jewel/i.test(s.storeName ?? ''),
          reserveUrl: (s.makeReservationUrl ?? s.reservationUrl ?? null)?.replace(/^http:/, 'https:') ?? null,
        }));
      out.set(part, { available: hits, totalStores: stores.length });
    }
    if (i + 16 < partNumbers.length) await politeSleep();
  }
  return out;
}

/** Pickup availability for one part number near one location. */
export async function fetchAvailability(cc, partNumber, location) {
  const url =
    `${base(cc)}/shop/retail/pickup-message` +
    `?pl=true&mts.0=regular&parts.0=${encodeURIComponent(partNumber)}` +
    `&location=${encodeURIComponent(location)}`;
  const json = await (await get(url, `${base(cc)}/shop/buy-iphone/iphone-18-pro`)).json();

  const stores = json?.body?.stores ?? [];
  return stores.map((s) => {
    const pa = s.partsAvailability?.[partNumber] ?? {};
    return {
      storeName: s.storeName,
      storeNumber: s.storeNumber,
      city: s.city,
      country: s.country,
      available: pa.pickupDisplay === 'available',
      quote: pa.pickupSearchQuote ?? null,
      // Apple hands these back as http://; upgrade so an https page links out cleanly.
      reserveUrl: (s.makeReservationUrl ?? s.reservationUrl ?? null)?.replace(/^http:/, 'https:') ?? null,
      // an airport store means a layover may be enough — no immigration, no city trip
      airport: /airport|changi|jewel/i.test(s.storeName ?? ''),
    };
  });
}

export const politeSleep = () => sleep(1100 + Math.random() * 700);
