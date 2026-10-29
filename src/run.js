// The daily run: fetch every source, keep the right roles in the right places, score them, store
// the new ones. (Applying, the inbox and portals come in the next steps.)
import { db, log } from './db.js';
import { fetchAll } from './fetchers/index.js';
import { companyOk, fullTimeOk, placeOk, roleOk } from './filter.js';
import { score } from './score.js';

const t0 = Date.now();
const all = await fetchAll((name, n, err) => { if (n < 0) console.log(`  ! ${name}: ${err}`); });
const roles = all.filter((j) => j.title && roleOk(j.title) && companyOk(j));
const fullTime = roles.filter(fullTimeOk);
const kept = fullTime.filter(placeOk);
const ins = db.prepare(`INSERT OR IGNORE INTO jobs (id, source, company, title, url, apply_url, apply_kind, location, remote, description, posted_at, found_at, score, score_why)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
let fresh = 0;
const seen = new Set();
for (const j of kept) {
  const key = `${(j.company || '').toLowerCase()}|${j.title.toLowerCase()}`;
  if (seen.has(key)) continue; // the same role on two boards
  seen.add(key);
  const { score: s, why } = score(j);
  const r = ins.run(j.id, j.source, j.company, j.title, j.url, j.apply_url, j.apply_kind, j.location, j.remote, j.description, j.posted_at, new Date().toISOString(), s, why);
  fresh += Number(r.changes);
}
log('run', { fetched: all.length, roles: roles.length, fullTime: fullTime.length, kept: kept.length, fresh, secs: Math.round((Date.now() - t0) / 1000) });
console.log(`fetched ${all.length} jobs · ${roles.length} design roles · ${fullTime.length} full-time · ${kept.length} open to you · ${fresh} new · ${Math.round((Date.now() - t0) / 1000)}s\n`);
for (const j of db.prepare("SELECT score, company, title, location, apply_kind, score_why FROM jobs WHERE status = 'new' ORDER BY score DESC LIMIT 25").all())
  console.log(`${String(j.score).padStart(3)}  ${(j.company || '').slice(0, 18).padEnd(18)} ${j.title.slice(0, 44).padEnd(44)} ${(j.location || '').slice(0, 28).padEnd(28)} ${j.apply_kind}`);
