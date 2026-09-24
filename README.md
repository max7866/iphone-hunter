# iPhone Hunter

Find an iPhone 18 Pro / Pro Max / Duo in stock at an Apple Store anywhere in the world,
filter by colour, capacity and physical SIM tray — then work out the cheapest realistic
way to actually get one, including the flight.

Status: **data layer proven, nothing deployed.**

## Why this is not just another availability tracker

Availability trackers exist. The twist here is **landed cost**: device price in that country
(local pricing, possibly minus a tourist VAT/GST refund) *plus* what it costs to get there
and back from an airport you choose. A phone that is 200 EUR cheaper in Germany is not
cheaper if the flight is 700 EUR — but it might be if you were transiting anyway.

## Findings that shaped the spec (verified 2026-09-23)

- **The iPhone Duo is eSIM-only in every market, including mainland China.** The SIM-tray
  filter can only ever apply to iPhone 18 Pro / Pro Max. For the Duo it is a dead control.
- **12 eSIM-only markets:** US, Canada, Mexico, Japan, Guam, US Virgin Islands, Bahrain,
  Kuwait, Oman, Qatar, Saudi Arabia, **UAE**. Everywhere else keeps the nano-SIM tray.
  Notably this means **Dubai cannot source a physical-SIM iPhone** — DXB is transit only.
- **Afghanistan has no Apple retail presence**, so KBL is only ever an origin or destination.
- **The Duo does not ship until 23 Oct 2026** (preorders 16 Oct). There is no pickup
  availability data for it before then.
- **Airport Apple Stores matter.** Jewel Changi has stock. For some routes a layover is
  enough — no immigration, no trip into the city. This is a first-class ranking signal.

## Data sources

Two undocumented Apple endpoints, both verified live:

| Endpoint | Gives |
|---|---|
| `GET /{cc}/shop/buy-iphone/iphone-18-pro` | Full catalog: part number, **local price**, model, capacity, colour |
| `GET /{cc}/shop/retail/pickup-message?parts.0=…&location=…` | Per-store pickup availability, store address/hours, reservation URL |

**`/shop/fulfillment-messages` is dead (HTTP 541).** Every blog post and old project cites
it; it no longer works. Use `retail/pickup-message`.

Two gotchas already hit and handled:

- Product names contain `U+00A0` non-breaking spaces between `iPhone`/`18` and `Pro`/`Max`.
  A literal space in a regex will not match them. `scripts/apple.mjs` normalises first.
- The pickup-message payload is `body.stores`, not the `body.content.pickupMessage.stores`
  shape that older write-ups document.

Both endpoints are undocumented and may change without notice. They are also not meant for
bulk automated access, so the architecture caches server-side: Apple should see roughly one
request per (part number, location) per refresh window no matter how many visitors we have.

## Architecture

The site is served from GitHub Pages; AWS owns the **data plane**. A visitor never reaches
Apple — the scheduled Lambda is the only thing that does.

```
EventBridge (every 6h)
      |
      v
  Lambda  --(cache reads/writes)-->  DynamoDB
      |                                 ^
      | Apple + Travelpayouts ----------'
      v
     S3  <-- OAC --  CloudFront  <--  the site (GitHub Pages)
```

| Resource | Why |
|---|---|
| `iphone-hunter-cache` (DynamoDB) | One request per (key, window) to Apple regardless of build frequency. TTL reaps rows; freshness is enforced in code. |
| `iphone-hunter-data-*` (S3) | Private, OAC-only. Holds `matrix.json` and `flights.json`. |
| CloudFront | HTTPS + CORS for the GitHub Pages origin. A CloudFront Function answers preflight at the edge because S3 behind OAC cannot. |
| `iphone-hunter-refresh` (Lambda) | Node 20, arm64, 600s. A run is ~42 requests once the catalog is cached, taking about 165s. |
| `iphone-hunter-check` (Lambda + Function URL) | On-demand live availability for one market, 45s cache. Idle costs nothing; a person hammering the button costs Apple one request. |
| `iphone-hunter-deploy` (IAM role) | Assumed by GitHub Actions via OIDC. No long-lived AWS keys exist. |

State lives in S3 with native lockfile locking. `infra/bootstrap/` creates that bucket and
is the one thing applied with local state — it cannot live inside the state it stores.

### How fresh is it

Two cadences, because stock and fares move at different speeds:

| What | Every | Why |
|---|---|---|
| Stock + pricing | 10 min | ~42 requests a run, about 4 a minute averaged — roughly what a handful of real shoppers generate |
| Fares | 6 hours | They move slowly and each costs an upstream call |
| Live check | on demand | Only for the market someone is looking at, cached 45s |

The page polls every 60s and re-polls when a backgrounded tab comes forward, so the board
is at most a couple of minutes behind, and the **live** button on any row is current to
the second.

**The edge TTL is the real ceiling.** Data was originally published with
`s-maxage=1800`, which capped freshness at 30 minutes no matter how often the refresher
ran — refreshing faster would have changed nothing a visitor could see. Cache lifetime
and refresh interval have to be decided together.

Going below ~10 minutes stops being polite to an undocumented endpoint. True
per-visitor-real-time would mean every page load hits Apple, which is exactly what the
cache exists to prevent and the fastest way to get blocked. The on-demand check is the
honest answer to "is it there *right now*".

### Deploying

Everything is Terraform, applied by CI on push to `main`. To run it by hand:

```bash
export TF_VAR_travelpayouts_token=...   # never a .tfvars file
terraform -chdir=infra apply
node scripts/build-lambda.mjs           # before apply, if Lambda code changed
node scripts/invoke-refresh.mjs         # refresh now instead of waiting for the schedule
```

## Layout

```
scripts/apple.mjs        catalog + availability (batched, 16 SKUs per request)
scripts/fx.mjs           USD conversion for 18 currencies
scripts/flights.mjs      pluggable fare providers + fallback chain
scripts/cache.mjs        cache interface (file now, DynamoDB later)
scripts/matrix.mjs       builds site/data/matrix.json  (markets x SKUs x stock)
scripts/build-flights.mjs builds site/data/flights.json (fares per origin)
scripts/build-map.mjs    builds site/data/world.json    (SVG paths, no map library)
scripts/rank.mjs         CLI landed-cost ranking
data/                    markets, airports, VAT
site/                    the app: map, filter pane, ranked results
infra/                   terraform (empty)
```

## The front end

No framework, no build step, no mapping library. Three generated files drive it:

| File | Built by | Contains |
|---|---|---|
| `matrix.json` | `matrix.mjs` | 21 markets x 32 SKUs: price, colour, capacity, per-store stock, reserve links |
| `flights.json` | `build-flights.mjs` | round-trip fares + booking links for 5 origins |
| `world.json` | `build-map.mjs` | 173 country paths, pre-projected to an equirectangular 1000x500 canvas |

The map is plain SVG because a tile layer would mean an API key, a network dependency and a
third-party request on every visit, for a picture that never needs to zoom.

Availability is fetched **16 SKUs per request**. The endpoint accepts `parts.0..parts.N` but
silently truncates — ask for 32 and you get 20 back with no error — so a 32-SKU catalog is
2 calls, and a full 21-market refresh is about 60 requests rather than 672.

## Try it

```bash
npm run probe -- sg hk uk de jp
```

## Flight pricing: Amadeus is gone

**Amadeus Self-Service was decommissioned on 17 July 2026** — existing keys stopped working
and signups are closed. Kiwi Tequila went invite-only. Most guides still recommend both.

Because a provider can disappear mid-project, `scripts/flights.mjs` is an interface, not a
vendor:

| Provider | Cost | Data |
|---|---|---|
| `estimateProvider` | free, no key | great-circle distance model. Ranking only; every result is flagged `estimate: true` so it can never be shown as a fare. |
| `travelpayoutsProvider` | free token | real round-trip fares + booking deep links, from Aviasales search-history cache. **Live and wired.** |
| Duffel | ~$0.005/search for us | real bookable fares. We never book flights, so the 1500:1 search-to-book allowance never applies and every search bills. |

Wired and working. Two things worth knowing about the Travelpayouts API:

- Use `aviasales/v3/prices_for_dates`, **not** `v1/prices/cheap`. v1 keys its response by
  *city* code — ask for `LHR` and the data comes back under `LON`, so a naive lookup by the
  code you passed silently returns nothing.
- The cache is built from real user searches, so a specific month can be empty on thin
  routes. The provider asks for the month, then falls back to any date, then to the
  distance estimate, and labels which it used. A route never drops out of the ranking just
  because nobody searched it lately.

The distance estimator it replaced was wrong by a lot and in both directions: it guessed
$1507 for IAD→BKK (real: $523) and $701 for IAD→MAD (real: $357), while *under*-estimating
IAD→SYD at $1667 (real: $2296). Ranking on estimates would have been actively misleading.

**Secrets:** `TRAVELPAYOUTS_TOKEN` lives in `.env`, which is gitignored. Run scripts with
`node --env-file=.env …`. `TRAVELPAYOUTS_MARKER` (the affiliate marker, a different value
from the API token) is still needed for booking links to earn commission.

## Open questions
- Tourist VAT/GST refund rates — `data/vat.json` has standard VAT rates, but the refund
  factor and minimum spend per scheme are **unsourced and flagged `verified: false`**. The
  ranker treats unverified entries as zero refund so no country is ranked optimistically on
  invented numbers. Two are settled: Hong Kong has no VAT at all, and the UK abolished
  visitor VAT refunds in 2021.
- Whether to show reservation deep links per store or bounce to Apple's own picker.
