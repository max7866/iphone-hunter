// Turn Natural Earth 110m country polygons into a small set of SVG paths.
// Done at build time so the page ships no mapping library, no tiles and no API key.

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2] ?? '/tmp/ne110m.json';
const W = 1000, H = 500;                       // equirectangular canvas
const project = ([lon, lat]) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];

const round = (n) => Math.round(n * 10) / 10;

function ringToPath(ring) {
  let d = '', last = null;
  for (const c of ring) {
    const [x, y] = project(c).map(round);
    // drop points that add nothing at this resolution
    if (last && Math.abs(x - last[0]) < 0.6 && Math.abs(y - last[1]) < 0.6) continue;
    d += (d ? 'L' : 'M') + x + ' ' + y;
    last = [x, y];
  }
  return d ? d + 'Z' : '';
}

const geo = JSON.parse(readFileSync(SRC, 'utf8'));
const paths = [];

for (const f of geo.features) {
  const name = f.properties?.NAME ?? f.properties?.name ?? '';
  if (name === 'Antarctica') continue;               // nothing to buy there
  const g = f.geometry;
  if (!g) continue;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let d = '';
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length < 8) continue;                 // skip specks
      d += ringToPath(ring);
    }
  }
  if (d) paths.push(d);
}

const out = { width: W, height: H, paths };
writeFileSync(new URL('../site/data/world.json', import.meta.url), JSON.stringify(out));
const bytes = JSON.stringify(out).length;
console.log(`${paths.length} country paths, ${(bytes / 1024).toFixed(0)} KB`);
