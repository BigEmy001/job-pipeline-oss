// Find the job boards of remote-first companies (the remoteintech/remote-jobs list, ~900 companies)
// and add them to config/boards.json, so the daily run reads them. Companies that only hire in the
// Americas are skipped; the rest are checked against the public Greenhouse, Lever and Ashby APIs
// (the careers link first, then name guesses). Run monthly: node scripts/discover-remote.js
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'config/boards.json';
const boards = JSON.parse(readFileSync(FILE, 'utf8'));
const have = new Set(boards.map((b) => `${b.kind}:${b.name.toLowerCase()}`));
const list = await (await fetch('https://api.github.com/repos/remoteintech/remote-jobs/contents/src/companies?per_page=1000', { headers: { 'User-Agent': 'job-pipeline' } })).json();

const front = (md) => Object.fromEntries([...(md.match(/^---\n([\s\S]*?)\n---/)?.[1] || '').matchAll(/^(\w+):\s*"?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2].trim()]));
const API = {
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`,
};
const count = (kind, d) => (kind === 'lever' ? d.length : d.jobs?.length || 0);
const fromUrl = (u = '') => {
  const m = u.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([\w-]+)|jobs\.lever\.co\/([\w.-]+)|jobs\.ashbyhq\.com\/([\w.-]+)/i);
  return m ? (m[1] ? ['greenhouse', m[1]] : m[2] ? ['lever', m[2]] : ['ashby', m[3]]) : null;
};

async function probe(c) {
  const tries = [];
  const direct = fromUrl(c.careers_url);
  if (direct) tries.push(direct);
  const names = [...new Set([c.slug, c.slug.replace(/-/g, ''), c.title.toLowerCase().replace(/[^a-z0-9]/g, '')])];
  for (const kind of ['ashby', 'greenhouse', 'lever']) for (const n of names) tries.push([kind, n]);
  for (const [kind, name] of tries) {
    try {
      const r = await fetch(API[kind](name), { signal: AbortSignal.timeout(10000) });
      if (r.ok && count(kind, await r.json()) > 0) return { kind, name, from: 'remote-first', company: c.title, region: c.region };
    } catch {}
  }
  return null;
}

let found = 0, done = 0, skipped = 0;
const queue = list.filter((f) => f.name.endsWith('.md'));
await Promise.all(Array.from({ length: 12 }, async () => {
  while (queue.length) {
    const f = queue.shift();
    try {
      const c = front(await (await fetch(f.download_url)).text());
      c.slug ||= f.name.replace(/\.md$/, '');
      c.title ||= c.slug;
      if (/^(americas|north[_ -]?america|usa?|united[_ -]states|canada|latam)$/i.test(c.region || '')) { skipped++; continue; }
      const b = await probe(c);
      if (b && !have.has(`${b.kind}:${b.name.toLowerCase()}`)) { boards.push(b); have.add(`${b.kind}:${b.name.toLowerCase()}`); found++; }
    } catch {}
    if (++done % 100 === 0) console.log(`${done}/${list.length} checked · ${found} new boards`);
  }
}));
writeFileSync(FILE, JSON.stringify(boards, null, 2) + '\n');
console.log(`done: ${found} new remote-first boards · ${skipped} skipped (Americas only) · ${boards.length} boards in total`);
