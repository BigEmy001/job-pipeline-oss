// Every source returns the same job shape. Boards (Greenhouse, Lever, Ashby) are company career
// pages with public APIs; the rest are remote job boards. Each fetch is best effort: one failing
// source never stops the run.
import Parser from 'rss-parser';
import { readFileSync } from 'node:fs';
import { hn } from './hn.js';

const UA = { 'User-Agent': `job-pipeline (personal job search; contact ${process.env.MAIL_USER || 'see README'})` };
const get = async (url, as = 'json') => {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return as === 'json' ? r.json() : r.text();
};
const strip = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const decode = (s = '') => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const job = (o) => ({ remote: /remote|anywhere|worldwide|distributed/i.test(`${o.location} ${o.title}`) ? 1 : 0, ...o });

const greenhouse = async (b) =>
  (await get(`https://boards-api.greenhouse.io/v1/boards/${b.name}/jobs?content=true`)).jobs.map((j) =>
    job({ id: `gh:${b.name}:${j.id}`, source: 'greenhouse', company: b.name, title: j.title, url: j.absolute_url, apply_url: j.absolute_url, apply_kind: 'greenhouse', location: j.location?.name || '', description: strip(decode(j.content)), posted_at: j.updated_at }));

const lever = async (b) =>
  (await get(`https://api.lever.co/v0/postings/${b.name}?mode=json`)).map((j) =>
    job({ id: `lv:${b.name}:${j.id}`, source: 'lever', company: b.name, title: j.text, url: j.hostedUrl, apply_url: j.applyUrl, apply_kind: 'lever', location: [j.categories?.location, j.workplaceType].filter(Boolean).join(' · '), type: j.categories?.commitment || '', description: strip(j.descriptionPlain || j.description), posted_at: new Date(j.createdAt).toISOString() }));

const ashby = async (b) =>
  (await get(`https://api.ashbyhq.com/posting-api/job-board/${b.name}`)).jobs.map((j) =>
    job({ id: `ab:${b.name}:${j.id}`, source: 'ashby', company: b.name, title: j.title, url: j.jobUrl, apply_url: j.applyUrl || j.jobUrl, apply_kind: 'ashby', location: [j.location, j.isRemote ? 'Remote' : '', j.workplaceType].filter(Boolean).join(' · '), type: j.employmentType || '', description: strip(j.descriptionPlain || j.descriptionHtml), posted_at: j.publishedAt }));

// Workable: many companies outside the US hire through it (for example Kuda and FairMoney)
const workable = async (b) =>
  (await get(`https://apply.workable.com/api/v1/widget/accounts/${b.name}?details=true`)).jobs.map((j) =>
    job({ id: `wk:${b.name}:${j.shortcode}`, source: 'workable', company: b.name, title: j.title, url: j.url, apply_url: j.application_url || j.url, apply_kind: 'workable', location: [j.city, j.country, j.telecommuting ? 'Remote' : ''].filter(Boolean).join(', '), remote: j.telecommuting ? 1 : 0, type: j.employment_type || '', description: strip(j.description || ''), posted_at: j.published_on }));

const remoteok = async () =>
  (await get('https://remoteok.com/api')).filter((j) => j.id && /design|ui|ux|product designer|webflow|\bai\b|llm|agent/i.test(`${j.position} ${(j.tags || []).join(' ')}`)).map((j) =>
    job({ id: `rok:${j.id}`, source: 'remoteok', company: j.company, title: j.position, url: j.url, apply_url: j.apply_url || j.url, apply_kind: 'link', location: j.location || 'Remote', remote: 1, type: (j.tags || []).filter((t) => /contract|part|freelance|full/i.test(t)).join(' '), description: strip(j.description), posted_at: j.date }));

const remotive = async () =>
  [...(await get('https://remotive.com/api/remote-jobs?category=design')).jobs, ...(await get('https://remotive.com/api/remote-jobs?search=ai%20engineer')).jobs].map((j) =>
    job({ id: `rmt:${j.id}`, source: 'remotive', company: j.company_name, title: j.title, url: j.url, apply_url: j.url, apply_kind: 'link', location: j.candidate_required_location || 'Remote', remote: 1, type: j.job_type || '', description: strip(j.description), posted_at: j.publication_date }));

const wwr = async () => {
  const feed = await new Parser({ headers: UA }).parseURL('https://weworkremotely.com/categories/remote-design-jobs.rss');
  return feed.items.map((i) => {
    const [company, ...rest] = (i.title || '').split(': ');
    return job({ id: `wwr:${i.guid || i.link}`, source: 'weworkremotely', company, title: rest.join(': '), url: i.link, apply_url: i.link, apply_kind: 'link', location: i.region || 'Remote', remote: 1, description: strip(i.content || i.contentSnippet), posted_at: i.isoDate });
  });
};

const himalayas = async () => {
  const out = [];
  for (const q of ['product designer', 'ui ux designer', 'design engineer', 'web designer', 'applied ai engineer', 'ai agent engineer', 'founding design engineer', 'ai product designer']) {
    const d = await get(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&limit=50`);
    for (const j of d.jobs || []) out.push(job({ id: `hml:${j.guid || j.applicationLink}`, source: 'himalayas', company: j.companyName, title: j.title, url: j.applicationLink, apply_url: j.applicationLink, apply_kind: 'link', location: (j.locationRestrictions || []).join(', ') || 'Worldwide', remote: 1, type: j.employmentType || '', description: strip(j.description || j.excerpt), posted_at: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null }));
  }
  return out;
};

const jobicy = async () =>
  (await get('https://jobicy.com/api/v2/remote-jobs?count=50&industry=design-multimedia')).jobs.map((j) =>
    job({ id: `jcy:${j.id}`, source: 'jobicy', company: j.companyName, title: decode(j.jobTitle), url: j.url, apply_url: j.url, apply_kind: 'link', location: j.jobGeo || 'Anywhere', remote: 1, type: [].concat(j.jobType || []).join(' '), description: strip(decode(j.jobDescription || j.jobExcerpt)), posted_at: j.pubDate }));

// More remote boards, read through their public feeds
const workingNomads = async () =>
  (await get('https://www.workingnomads.com/api/exposed_jobs/')).filter((j) => /design/i.test(`${j.category_name} ${j.title}`)).map((j) =>
    job({ id: `wn:${j.url}`, source: 'workingnomads', company: j.company_name, title: j.title, url: j.url, apply_url: j.url, apply_kind: 'link', location: j.location || 'Remote', remote: 1, description: strip(j.description), posted_at: j.pub_date }));

const rss = (source, url, parse) => async () => (await new Parser({ headers: UA }).parseURL(url)).items.map((i) => {
  const { company, title, location, remote } = parse(i);
  return job({ id: `${source}:${i.guid || i.link}`, source, company, title, url: i.link, apply_url: i.link, apply_kind: 'link', location, remote, description: strip(i.content || i.contentSnippet), posted_at: i.isoDate });
});
const dribbble = rss('dribbble', 'https://dribbble.com/jobs.rss', (i) => {
  const m = (i.title || '').match(/^(.*?) is hiring for a position of (.*?) in (.*)$/) || [];
  const location = m[3] || '';
  return { company: m[1] || i.creator, title: m[2] || i.title, location, remote: /remote|anywhere/i.test(location) ? 1 : 0 };
});
// Dribbble's feed has no job type or description: read them from the page for the remote ones
const dribbbleFull = async () => {
  const items = await dribbble();
  for (const j of items.filter((x) => x.remote)) {
    try {
      const h = await get(j.url.replace(/\?.*$/, ''), 'text');
      const t = strip(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' '));
      j.type = t.match(/Job Type (Full-time|Freelance|Part-time|Contract|Internship)/i)?.[1] || '';
      const i = t.indexOf('Job Details'), k = t.indexOf('Apply for this position', i);
      if (i >= 0) j.description = t.slice(i, k > i ? k : i + 8000);
    } catch {}
  }
  return items;
};
const nodesk = rss('nodesk', 'https://nodesk.co/remote-jobs/design/index.xml', (i) => {
  const m = (i.title || '').match(/^(.*) at (.*)$/) || [];
  return { company: m[2] || '', title: decode(m[1] || i.title), location: 'Remote', remote: 1 };
});
const jobspresso = rss('jobspresso', 'https://jobspresso.co/feed/?post_type=job_listing', (i) => ({ company: i.creator || '', title: i.title, location: 'Remote', remote: 1 }));

export async function fetchAll(onSource = () => {}) {
  const boards = JSON.parse(readFileSync('config/boards.json', 'utf8'));
  const tasks = [
    ...boards.map((b) => [`${b.kind}:${b.name}`, () => ({ greenhouse, lever, ashby, workable })[b.kind](b)]),
    ['remoteok', remoteok], ['remotive', remotive], ['weworkremotely', wwr], ['himalayas', himalayas], ['jobicy', jobicy], ['hn', hn], ['workingnomads', workingNomads], ['dribbble', dribbbleFull], ['nodesk', nodesk], ['jobspresso', jobspresso],
  ];
  const all = [];
  for (let i = 0; i < tasks.length; i += 10) {
    const res = await Promise.allSettled(tasks.slice(i, i + 10).map(([, fn]) => fn()));
    res.forEach((r, k) => {
      const name = tasks[i + k][0];
      if (r.status === 'fulfilled') { all.push(...r.value); onSource(name, r.value.length); } else onSource(name, -1, String(r.reason).slice(0, 120));
    });
  }
  return all;
}
