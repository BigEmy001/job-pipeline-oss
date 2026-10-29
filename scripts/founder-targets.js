// Founder outreach targets: YC startups (small teams) with a design or design-engineering job open
// right now, anywhere in the world. A founder who can't hire you full-time where they are may
// still want remote design help, so location-locked roles count here. Writes data/targets.json.
import { readFileSync, writeFileSync } from 'node:fs';

const boards = JSON.parse(readFileSync('config/boards.json', 'utf8')).filter((b) => b.from === 'yc');
const yc = Object.fromEntries((await (await fetch('https://yc-oss.github.io/api/companies/hiring.json')).json()).map((c) => [c.name.toLowerCase(), c]));
const API = {
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
};
const DESIGN = /\b(product designer|ui\/?ux|ux\/?ui|ux designer|ui designer|design engineer|founding designer|brand designer|visual designer|web designer|interaction designer|product design)\b/i;
const out = [];
let i = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  while (i < boards.length) {
    const b = boards[i++];
    try {
      const d = await (await fetch(API[b.kind](b.name), { signal: AbortSignal.timeout(15000) })).json();
      const jobs = (b.kind === 'lever' ? d : d.jobs || []).map((j) => ({ title: j.title || j.text, url: j.jobUrl || j.absolute_url || j.hostedUrl, location: typeof j.location === 'string' ? j.location : j.location?.name || j.categories?.location || '' }));
      const design = jobs.filter((j) => DESIGN.test(j.title || '') && !/intern|director|head of|vp\b/i.test(j.title));
      if (!design.length) continue;
      const c = yc[(b.company || '').toLowerCase()] || {};
      out.push({ company: b.company, slug: c.slug, website: c.website, one_liner: c.one_liner, team: c.team_size, batch: c.batch, industry: c.industry, regions: c.regions, jobs: design });
    } catch {}
  }
}));
out.sort((a, b) => (a.team || 99) - (b.team || 99));
writeFileSync('data/targets.json', JSON.stringify(out, null, 2));
console.log(`${out.length} YC startups with a design role open`);
for (const t of out.slice(0, 40)) console.log(`${String(t.team ?? '?').padStart(3)} ${t.company.padEnd(22)} ${(t.batch || '').padEnd(12)} ${t.jobs.map((j) => `${j.title} (${j.location})`).join('; ').slice(0, 110)}`);
