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

## Architecture (agreed)

- **Public site**, static front end on S3 + CloudFront, same pattern as `wc2026-predictions`.
- **Lambda** for Apple queries and flight lookups; **DynamoDB** as the cache and the thing
  that shields Apple from public traffic.
- **Live flight prices** via an API (Amadeus Self-Service free tier is the likely choice).
- **User picks any origin airport** — needs an IATA airport dataset.
- Terraform for all infrastructure.

## Layout

```
scripts/apple.mjs   data layer: catalog + availability  (proven)
scripts/probe.mjs   CLI probe across countries          (proven)
data/countries.json 22 markets, SIM-tray flag, store-search location
site/               static front end                    (empty)
infra/              terraform                           (empty)
```

## Try it

```bash
npm run probe -- sg hk uk de jp
```

## Open questions

- Flight API choice and whether its free tier survives public traffic.
- Tourist VAT/GST refund rates per country — real money, varies a lot, needs a sourced table.
- Whether to show reservation deep links per store or bounce to Apple's own picker.
