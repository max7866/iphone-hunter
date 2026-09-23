import { fetchCatalog, fetchAvailability, politeSleep } from './apple.mjs';
import { readFileSync } from 'node:fs';

const { countries } = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url)));
const pick = process.argv.slice(2);
const list = pick.length ? countries.filter(c => pick.includes(c.cc || 'us')) : countries.slice(0, 5);

for (const c of list) {
  try {
    const cat = await fetchCatalog(c.cc);
    const models = [...new Set(cat.map(p => p.model))];
    const colors = [...new Set(cat.map(p => p.color))];
    const caps = [...new Set(cat.map(p => p.capacity))];
    const min = cat.length ? Math.min(...cat.map(p => p.price)) : 0;
    console.log(
      `${(c.name).padEnd(15)} ${String(cat.length).padStart(3)} SKUs  from ${min} ${c.currency}` +
      `  tray=${c.simTray ? 'yes' : 'NO '}  colors=[${colors.join(', ')}]  caps=[${caps.join('/')}]`
    );
    if (cat.length) {
      const probe = cat.find(p => p.model === 'iPhone 18 Pro Max') ?? cat[0];
      await politeSleep();
      const stores = await fetchAvailability(c.cc, probe.partNumber, c.location);
      const yes = stores.filter(s => s.available);
      const air = yes.filter(s => s.airport);
      console.log(
        `   ${probe.model} ${probe.capacity} ${probe.color}: ` +
        `${yes.length}/${stores.length} stores today` +
        (air.length ? `  [airport: ${air.map(s => s.storeName).join(', ')}]` : '')
      );
    }
  } catch (e) {
    console.log(`${(c.name).padEnd(15)} ERROR ${e.message}`);
  }
  await politeSleep();
}
