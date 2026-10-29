// Why were design roles dropped by the location filter? Groups the dropped ones by their location,
// so a too-strict rule shows up. node scripts/why-dropped.js
import { fetchAll } from '../src/fetchers/index.js';
import { companyOk, fullTimeOk, placeOk, roleOk } from '../src/filter.js';
const all = await fetchAll(() => {});
const roles = all.filter((j) => j.title && roleOk(j.title) && companyOk(j) && fullTimeOk(j));
const dropped = roles.filter((j) => !placeOk(j));
const by = {};
for (const j of dropped) { const k = (j.remote || /remote/i.test(j.location || '') ? 'REMOTE ' : 'onsite ') + (j.location || '-').slice(0, 50); (by[k] ||= []).push(`${j.company}: ${j.title}`); }
const rows = Object.entries(by).sort((a, b) => b[1].length - a[1].length);
console.log(`${roles.length} full-time design roles, ${dropped.length} dropped, ${rows.filter(([k]) => k.startsWith('REMOTE')).reduce((n, [, v]) => n + v.length, 0)} of them remote`);
for (const [k, v] of rows.filter(([k]) => k.startsWith('REMOTE')).slice(0, 60)) console.log(String(v.length).padStart(3), k, '|', v[0]);
