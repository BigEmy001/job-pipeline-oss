// Hacker News "Ask HN: Who is hiring?": one thread a month, posted by founders and hiring managers
// themselves, so a reply goes to a person, not a portal. Read through the public Algolia HN API.
import { readFileSync } from 'node:fs';

const P = JSON.parse(readFileSync('config/profile.json', 'utf8'));
const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const decode = (s = '') => s.replace(/&#x2F;/g, '/').replace(/&#x27;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (html) => decode(html.replace(/<p>/g, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').trim();
const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bUi\b/g, 'UI').replace(/\bUx\b/g, 'UX');

export async function hn() {
  const { hits } = await get('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6');
  const thread = hits.find((h) => /who is hiring/i.test(h.title));
  if (!thread) return [];
  const { children } = await get(`https://hn.algolia.com/api/v1/items/${thread.objectID}`);
  const out = [];
  for (const c of children) {
    if (!c.text) continue;
    const body = text(c.text);
    const low = body.toLowerCase();
    const role = P.roles.include.find((r) => low.includes(r));
    if (!role) continue;
    // the first line is the header: "Company | Role | Location | Remote | ..."
    const head = body.split('\n')[0];
    const piped = head.includes('|');
    const parts = (piped ? head : '').split('|').map((s) => s.trim());
    const place = parts.filter((s) => /remote|onsite|on-site|in-office|hybrid|worldwide|anywhere|global|timezone|\b[A-Z][a-z]+, [A-Z]/i.test(s) && !/https?:/.test(s)).join(' · ');
    const email = body.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
    const links = [...c.text.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1]));
    const careers = links.find((l) => /career|jobs|greenhouse|lever|ashby|workable|apply/i.test(l));
    const hnUrl = `https://news.ycombinator.com/item?id=${c.id}`;
    out.push({
      id: `hn:${c.id}`, source: 'hn', company: (piped ? parts[0] : head.match(/^(?:at )?([A-Z][\w.&-]+)/i)?.[1] || '').replace(/\(.*?\)|https?:\S+/g, '').trim().slice(0, 60),
      title: title(role), url: hnUrl, apply_url: careers || (email ? `mailto:${email}` : hnUrl), apply_kind: careers ? 'link' : email ? 'email' : 'link',
      // no "| place |" header: read the start of the post instead
      location: place || (/\b(worldwide|anywhere|globally)\b/i.test(body.slice(0, 1500)) ? 'Remote · Worldwide' : ''), remote: /remote/i.test(place ? head : body.slice(0, 1500)) ? 1 : 0, type: (head.match(/full[- ]?time|part[- ]?time|contract(or)?|freelance|intern(ship)?/gi) || []).join(' '), description: body, posted_at: c.created_at,
    });
  }
  return out;
}
