// Cache abstraction. The whole point is that Apple and the flight provider see one
// request per (key, refresh window) no matter how many visitors the site has.
//
// Local  -> JSON files under cache/
// Lambda -> swap in the DynamoDB driver; the interface is get/set only.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const ROOT = new URL('../cache/', import.meta.url).pathname;
const keyPath = (key) => join(ROOT, createHash('sha1').update(key).digest('hex').slice(0, 2), createHash('sha1').update(key).digest('hex') + '.json');

export function fileCache({ ttl = 900 } = {}) {
  return {
    async get(key) {
      try {
        const raw = JSON.parse(await readFile(keyPath(key), 'utf8'));
        if (Date.now() - raw.at > ttl * 1000) return null;
        return raw.value;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const p = keyPath(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, JSON.stringify({ at: Date.now(), key, value }));
      return value;
    },
  };
}

/** Wrap any async producer so it only runs on a cache miss. */
export function cached(cache, key, producer) {
  return (async () => {
    const hit = await cache.get(key);
    if (hit !== null) return { value: hit, fresh: false };
    const value = await producer();
    await cache.set(key, value);
    return { value, fresh: true };
  })();
}
