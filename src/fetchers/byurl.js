// One job from a link you found yourself (a Google search, a post, a friend). Greenhouse, Lever and
// Ashby links are read through their public APIs; any other page is read from its HTML.
const UA = { 'User-Agent': 'Mozilla/5.0 (job-pipeline; personal job search)' };
const strip = (html = '') => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const decode = (s = '') => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const get = async (url, as = 'json') => {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
  return as === 'json' ? r.json() : r.text();
};
const remote = (s) => (/remote|anywhere|worldwide|distributed/i.test(s) ? 1 : 0);

export async function jobFromUrl(raw) {
  const u = new URL(raw.trim());
  const [a, b, c] = u.pathname.split('/').filter(Boolean);
  if (/greenhouse\.io$/.test(u.hostname) && b === 'jobs' && c) {
    const j = await get(`https://boards-api.greenhouse.io/v1/boards/${a}/jobs/${c}`);
    const loc = j.location?.name || '';
    return { id: `gh:${a}:${j.id}`, source: 'manual', company: a, title: j.title, url: j.absolute_url, apply_url: j.absolute_url, apply_kind: 'greenhouse', location: loc, remote: remote(loc), description: strip(decode(j.content)), posted_at: j.updated_at };
  }
  if (u.hostname === 'jobs.lever.co' && b) {
    const j = await get(`https://api.lever.co/v0/postings/${a}/${b}`);
    const loc = [j.categories?.location, j.workplaceType].filter(Boolean).join(' · ');
    return { id: `lv:${a}:${j.id}`, source: 'manual', company: a, title: j.text, url: j.hostedUrl, apply_url: j.applyUrl, apply_kind: 'lever', location: loc, remote: remote(loc), description: strip(j.descriptionPlain || j.description), posted_at: new Date(j.createdAt).toISOString() };
  }
  if (u.hostname === 'jobs.ashbyhq.com' && b) {
    const j = (await get(`https://api.ashbyhq.com/posting-api/job-board/${a}`)).jobs.find((x) => x.id === b);
    if (!j) throw new Error('that Ashby job is closed');
    const loc = [j.location, j.isRemote ? 'Remote' : '', j.workplaceType].filter(Boolean).join(' · ');
    return { id: `ab:${a}:${j.id}`, source: 'manual', company: a, title: j.title, url: j.jobUrl, apply_url: j.applyUrl || j.jobUrl, apply_kind: 'ashby', location: loc, remote: remote(loc), description: strip(j.descriptionPlain || j.descriptionHtml), posted_at: j.publishedAt };
  }
  const html = await get(u.href, 'text');
  const meta = (p) => decode(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)`, 'i'))?.[1] || '');
  const title = meta('og:title') || decode(html.match(/<title[^>]*>([^<]*)/i)?.[1] || '').trim() || u.hostname;
  const description = strip(html).slice(0, 20000);
  return { id: `url:${u.hostname}${u.pathname}`, source: 'manual', company: meta('og:site_name') || u.hostname.replace(/^www\./, ''), title: title.slice(0, 140), url: u.href, apply_url: u.href, apply_kind: 'link', location: remote(description.slice(0, 4000)) ? 'Remote' : '', remote: remote(description.slice(0, 4000)), description, posted_at: null };
}
