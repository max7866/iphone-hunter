// Where the data files live.
//
// Locally the modules sit in scripts/ and data is ../data. In Lambda the bundle unzips
// flat into /var/task, so ../data would point outside the task root. DATA_DIR overrides.

export function dataFile(name) {
  const dir = process.env.DATA_DIR;
  if (dir) return new URL(`file://${dir.replace(/\/$/, '')}/${name}`);
  return new URL(`../data/${name}`, import.meta.url);
}
