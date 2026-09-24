// Cache abstraction. The point is that Apple and Travelpayouts see one request per
// (key, refresh window) no matter how often we build or how many people visit.
//
//   local   -> JSON files under cache/
//   lambda  -> DynamoDB, chosen by CACHE_DRIVER=ddb
//
// The driver is picked from the environment so the build logic never knows which it got.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const sha = (s) => createHash('sha1').update(s).digest('hex');

export function fileCache({ ttl = 900 } = {}) {
  const ROOT = new URL('../cache/', import.meta.url).pathname;
  const keyPath = (key) => join(ROOT, sha(key).slice(0, 2), sha(key) + '.json');
  return {
    name: 'file',
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

/** DynamoDB driver. Uses the SDK bundled with the Lambda Node 20 runtime. */
export function ddbCache({ ttl = 900, table = process.env.CACHE_TABLE } = {}) {
  let client;
  const load = async () => {
    if (!client) {
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
      client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    }
    return client;
  };
  return {
    name: 'ddb',
    async get(key) {
      const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
      const c = await load();
      try {
        const r = await c.send(new GetCommand({ TableName: table, Key: { k: sha(key) } }));
        if (!r.Item) return null;
        if (Date.now() - r.Item.at > ttl * 1000) return null;
        return JSON.parse(r.Item.v);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      const c = await load();
      await c.send(new PutCommand({
        TableName: table,
        Item: {
          k: sha(key),
          at: Date.now(),
          v: JSON.stringify(value),
          // DynamoDB TTL reaps rows well after they stop being served, so the table
          // never grows without bound even though freshness is enforced above.
          expires: Math.floor(Date.now() / 1000) + ttl * 4,
        },
      }));
      return value;
    },
  };
}

/** Whichever driver this environment calls for. */
export function makeCache(opts = {}) {
  return process.env.CACHE_DRIVER === 'ddb' ? ddbCache(opts) : fileCache(opts);
}

/** Run `producer` only on a cache miss. */
export async function cached(cache, key, producer) {
  const hit = await cache.get(key);
  if (hit !== null) return { value: hit, fresh: false };
  const value = await producer();
  await cache.set(key, value);
  return { value, fresh: true };
}
