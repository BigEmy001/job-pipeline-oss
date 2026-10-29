// Job-alert emails (Glassdoor, Indeed, LinkedIn) as a job source. Their sites block bots and forbid
// scraping, but the alerts they email you are yours to read. Each job in an alert becomes a job here;
// when the company has a public Greenhouse, Lever or Ashby board with the same role, the job gets that
// real form, so it can be applied to like any other.
import { db } from './db.js';
import { companyOk, roleOk } from './filter.js';
import { score } from './score.js';

export const ALERT_FROM = /glassdoor|indeed|linkedin/i;
const JOB_LINK = /https?:\/\/[^\s"'<>\]]*(?:glassdoor\.[a-z.]+\/(?:partner\/jobListing|job-listing|Job\/)|indeed\.com\/(?:rc\/clk|viewjob|pagead\/clk|m\/viewjob)|linkedin\.com\/(?:comm\/)?jobs\/view)[^\s"'<>\]]*/i;
const NOISE = /^(easy apply|apply now|new|hot|\d+(\.\d)?\s*★?|\$|£|€|\d+[dh]\b|see (all|more)|view (job|all)|save|actively recruiting|be an early applicant|promoted|\d+ (company )?alumni|estimated)/i;
const PLACE = { test: (l) => /\b(remote|hybrid|on-?site|united states|worldwide|anywhere)\b/i.test(l) || /\b[A-Z][a-z]+,\s*[A-Z]{2}\b/.test(l) };

const clean = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();

// One card per job link: the anchor's own text, plus the short lines around it
export function parseAlert(html = '') {
  const jobs = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (!JOB_LINK.test(url)) continue;
    const text = clean(m[2].replace(/<[^>]+>/g, ' '));
    // the card is the text around the link, up to the neighbouring job links
    const around = html.slice(Math.max(0, m.index - 1500), m.index + m[0].length + 1500)
      .replace(/<(br|\/p|\/div|\/td|\/tr|\/h\d|\/li)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
    const lines = around.split('\n').map(clean).filter((l) => l && l.length < 90 && !NOISE.test(l));
    const title = roleOk(text) ? text : lines.find((l) => roleOk(l));
    if (!title || seen.has(title.toLowerCase())) continue;
    const i = lines.indexOf(title);
    const near = [lines[i - 1], lines[i + 1], lines[i - 2], lines[i + 2]].filter(Boolean);
    const location = near.find((l) => PLACE.test(l)) || '';
    const company = near.find((l) => l !== location && !roleOk(l) && !/\d{2,}|http/.test(l)) || '';
    seen.add(title.toLowerCase());
    jobs.push({ title, company: company.replace(/\s*[-·|].*$/, ''), location, url });
  }
  return jobs;
}

const slugs = (name) => [...new Set([name.toLowerCase().replace(/[^a-z0-9]/g, ''), name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')])].filter(Boolean);
const same = (a, b) => { const w = (s) => new Set(s.toLowerCase().match(/[a-z]+/g)); const A = w(a), B = w(b); return [...A].filter((x) => B.has(x)).length >= Math.min(A.size, B.size) * 0.75; };

// The same role on the company's own board, if it has a public one
async function onBoard(company, title) {
  for (const s of slugs(company)) {
    const tries = [
      [`https://api.ashbyhq.com/posting-api/job-board/${s}`, (d) => d.jobs?.map((j) => ({ t: j.title, u: j.jobUrl, d: j.descriptionPlain, l: j.location }))],
      [`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`, (d) => d.jobs?.map((j) => ({ t: j.title, u: j.absolute_url, l: j.location?.name }))],
      [`https://api.lever.co/v0/postings/${s}?mode=json`, (d) => d.map?.((j) => ({ t: j.text, u: j.hostedUrl, d: j.descriptionPlain, l: j.categories?.location }))],
    ];
    for (const [url, pick] of tries) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const hit = (pick(await r.json()) || []).find((j) => same(j.t, title));
        if (hit) return { ...hit, kind: /ashby/.test(url) ? 'ashby' : /greenhouse/.test(url) ? 'greenhouse' : 'lever' };
      } catch {}
    }
  }
  return null;
}

// Store the jobs from one alert email; returns how many were new
export async function addAlertJobs(from, html) {
  const source = (from.match(ALERT_FROM)?.[0] || 'alert').toLowerCase();
  const ins = db.prepare(`INSERT OR IGNORE INTO jobs (id, source, company, title, url, apply_url, apply_kind, location, remote, description, posted_at, found_at, score, score_why)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let fresh = 0;
  for (const a of parseAlert(html)) {
    const j = { source: `${source}-alert`, company: a.company, title: a.title, location: a.location, url: a.url, apply_url: a.url, apply_kind: 'link', remote: /remote/i.test(a.location) ? 1 : 0, description: '' };
    if (!companyOk(j)) continue;
    const real = a.company ? await onBoard(a.company, a.title) : null;
    if (real) Object.assign(j, { apply_url: real.u, apply_kind: real.kind, description: real.d || '', location: real.l || j.location, title: real.t });
    const id = `${source}:${(a.company + '|' + a.title).toLowerCase().replace(/[^a-z0-9|]+/g, '-')}`;
    const { score: s, why } = score(j);
    fresh += Number(ins.run(id, j.source, j.company, j.title, j.url, j.apply_url, j.apply_kind, j.location, j.remote, j.description, null, new Date().toISOString(), s, why).changes);
  }
  return fresh;
}
