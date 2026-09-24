// Scheduled refresher.
//
// Rebuilds the market matrix and the per-origin fares, then writes them to S3 where
// CloudFront serves them. Visitors never reach Apple — this function is the only thing
// that does, and DynamoDB keeps even this from refetching what it already has.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { buildMatrix } from './matrix.mjs';
import { buildFlights } from './build-flights.mjs';

const s3 = new S3Client({});
const BUCKET = process.env.DATA_BUCKET;

async function put(key, body) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(body),
    ContentType: 'application/json',
    // Short browser cache, longer at the edge: a refresh invalidates nothing, it just
    // becomes visible on the next edge revalidation.
    CacheControl: 'public, max-age=300, s-maxage=1800',
  }));
}

export const handler = async (event) => {
  const started = Date.now();
  const only = event?.only ?? null;
  const done = {};

  try {
    if (!only || only === 'flights') {
      const flights = await buildFlights();
      await put('flights.json', flights);
      done.flights = Object.keys(flights.origins).length;
    }

    if (!only || only === 'matrix') {
      const matrix = await buildMatrix();
      await put('matrix.json', matrix);
      done.markets = Object.keys(matrix.markets).length;
      done.skus = Object.values(matrix.markets).reduce((a, m) => a + m.skus.length, 0);
    }
  } catch (err) {
    // A partial refresh is better than none: whatever was written stays served, and the
    // failure is loud in logs and in the return value.
    console.error('refresh failed', err);
    return { ok: false, error: String(err?.message ?? err), done, ms: Date.now() - started };
  }

  const result = { ok: true, ...done, ms: Date.now() - started };
  console.log('refresh complete', JSON.stringify(result));
  return result;
};
