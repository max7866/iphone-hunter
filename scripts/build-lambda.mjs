// Assemble the Lambda bundle. The build logic is shared with the CLI rather than
// duplicated, so the function cannot drift from what runs locally.

import { mkdir, cp, rm, writeFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const out = new URL('lambda/build/', root);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// handler
for (const f of ['index.mjs', 'check.mjs']) {
  await cp(new URL(`lambda/src/${f}`, root), new URL(f, out));
}

// shared build logic
for (const f of ['apple.mjs', 'cache.mjs', 'fx.mjs', 'flights.mjs', 'matrix.mjs', 'build-flights.mjs', 'paths.mjs']) {
  await cp(new URL(`scripts/${f}`, root), new URL(f, out));
}

// the modules resolve data with ../data/<file>, so keep that shape inside the bundle
await mkdir(new URL('data/', out), { recursive: true });
for (const f of ['countries.json', 'airports.json', 'vat.json']) {
  await cp(new URL(`data/${f}`, root), new URL(`data/${f}`, out));
}

await writeFile(new URL('package.json', out), JSON.stringify({ type: 'module' }, null, 2));

const files = await readdir(out);
console.log(`lambda/build: ${files.join(', ')}`);
