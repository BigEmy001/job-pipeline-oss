// Find the job boards of YC companies that are hiring right now and add them to config/boards.json,
// so the daily run reads them like any other board. The list comes from yc-oss (a public mirror of
// the YC directory); each company is checked against the public Greenhouse, Lever and Ashby APIs.
// Run weekly: node scripts/discover-yc.js
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'config/boards.json';
const boards = JSON.parse(readFileSync(FILE, 'utf8'));
const have = new Set(boards.map((b) => `${b.kind}:${b.name}`));
const companies = await (await fetch('https://yc-oss.github.io/api/companies/hiring.json')).json();

const API = {
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`,
};
const count = (kind, d) => (kind === 'lever' ? d.length : d.jobs?.length || 0);
const slugs = (c) => [...new Set([c.slug, c.slug.replace(/-/g, ''), c.name.toLowerCase().replace(/[^a-z0-9]/g, '')])];

async function probe(c) {
  for (const kind of ['ashby', 'greenhouse', 'lever'])
    for (const s of slugs(c)) {
      try {
        const r = await fetch(API[kind](s), { signal: AbortSignal.timeout(10000) });
        if (r.ok && count(kind, await r.json()) > 0) return { kind, name: s, from: 'yc', company: c.name };
      } catch {}
    }
  return null;
}

let found = 0, done = 0;
const queue = companies.filter((c) => c.slug);
await Promise.all(Array.from({ length: 12 }, async () => {
  while (queue.length) {
    const c = queue.shift();
    const b = await probe(c);
    if (b && !have.has(`${b.kind}:${b.name}`)) { boards.push(b); have.add(`${b.kind}:${b.name}`); found++; }
    if (++done % 100 === 0) console.log(`${done}/${companies.length} checked · ${found} new boards`);
  }
}));
writeFileSync(FILE, JSON.stringify(boards, null, 2) + '\n');
console.log(`done: ${found} new YC boards · ${boards.length} boards in total`);
