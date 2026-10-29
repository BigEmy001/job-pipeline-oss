// Pilot: discover -> audit -> score, then the ranked sheet.
import { db } from '../db.js';
import { CITIES, NICHES, discover } from './discover.js';
import { audit } from './audit.js';
import { scoreLead } from './score.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cities = process.argv[2] ? process.argv[2].split(',') : Object.keys(CITIES);
const niches = process.argv[3] ? process.argv[3].split(',') : Object.keys(NICHES);
// never overwrite a lead we already have: it may already be pitched, replied or opted out
const ins = db.prepare(`INSERT OR IGNORE INTO leads (id, name, niche, city, website, final_url, phone, email, address, source, audit, score, tier, why, found_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
let found = [];
for (const c of cities) for (const n of niches) {
  try { const r = await discover(c, n); found.push(...r); console.log(`${c.padEnd(10)} ${n.padEnd(11)} ${r.length}`); } catch (e) { console.log(`${c} ${n} ! ${e.message}`); }
  await wait(4000); // be polite to the public Overpass server
}
// one per website
const byHost = new Map();
for (const l of found) { try { const h = new URL(l.website).hostname.replace(/^www\./, ''); if (!byHost.has(h)) byHost.set(h, l); } catch {} }
found = [...byHost.values()];
console.log(`\n${found.length} businesses with a website. Auditing...`);
for (let i = 0; i < found.length; i += 6) {
  await Promise.all(found.slice(i, i + 6).map(async (l) => {
    const a = await audit(l);
    const s = scoreLead(l, a);
    ins.run(l.id, l.name, l.niche, l.city, l.website, a.final_url || null, l.phone, a.email, l.address, l.source, JSON.stringify(a), s.score, s.tier, s.why, new Date().toISOString());
  }));
}
const rows = db.prepare("SELECT tier, COUNT(*) n FROM leads GROUP BY tier").all();
console.log(rows.map((r) => `${r.tier}: ${r.n}`).join(' · '), '\n');
for (const l of db.prepare("SELECT score, tier, name, niche, city, email, why FROM leads WHERE tier IN ('hot','warm') ORDER BY score DESC LIMIT 30").all())
  console.log(`${String(l.score).padStart(3)} ${l.tier.padEnd(4)} ${l.name.slice(0, 30).padEnd(30)} ${l.niche.padEnd(10)} ${l.city.padEnd(9)} ${(l.email || '-').slice(0, 30).padEnd(30)} ${l.why.slice(0, 90)}`);
