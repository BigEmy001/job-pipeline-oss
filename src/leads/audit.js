// The site audit: what a designer would spot in ten seconds, measured. Reads only the business's
// own public homepage (and its contact page for a public email), politely.
const UA = 'Mozilla/5.0 (compatible; site-audit/0.1; +https://github.com/BigEmy001/job-pipeline)';
const YEAR = new Date().getFullYear();

const grab = async (url) => {
  const t0 = Date.now();
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  const html = await r.text();
  return { status: r.status, url: r.url, html, ms: Date.now() - t0, bytes: html.length };
};

const PARKED = /domain (is )?for sale|buy this domain|parked free|godaddy\.com\/domainsearch|this domain may be for sale|account suspended|site not found|coming soon/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ROLE_OK = /^(info|hello|contact|office|admin|appointments|frontdesk|front\.desk|reception|team|support|help|inquiries|enquiries|service|sales|marketing)@/i;

export async function audit(lead) {
  const a = { issues: [], good: [], email: lead.email };
  let page;
  try {
    page = await grab(lead.website);
  } catch (e) {
    a.dead = true;
    a.issues.push('site does not load');
    return a;
  }
  const h = page.html;
  const low = h.toLowerCase();
  a.final_url = page.url;
  a.load_ms = page.ms;
  if (page.status >= 400) { a.dead = true; a.issues.push(`homepage returns ${page.status}`); return a; }
  if (PARKED.test(h.slice(0, 20000)) && h.length < 40000) { a.dead = true; a.issues.push('parked or placeholder page'); return a; }

  if (!page.url.startsWith('https://')) a.issues.push('no HTTPS (browsers mark it "Not secure")');
  if (!/<meta[^>]+name=["']viewport["']/i.test(h)) a.issues.push('not built for phones (no mobile viewport)');
  const years = [...low.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/g)].map((m) => +m[1]).filter((y) => y > 1995 && y <= YEAR);
  if (years.length) { a.copyright = Math.max(...years); if (a.copyright <= YEAR - 4) a.issues.push(`footer still says © ${a.copyright}`); }
  const gen = h.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1] || '';
  a.builder = /wix/i.test(low) ? 'Wix' : /squarespace/i.test(low) ? 'Squarespace' : /weebly/i.test(low) ? 'Weebly' : /godaddy|websites\.godaddy|img1\.wsimg/i.test(low) ? 'GoDaddy builder' : /wp-content/i.test(low) ? 'WordPress' : /webflow/i.test(low) ? 'Webflow' : gen || null;
  const wp = gen.match(/WordPress\s*([\d.]+)/i)?.[1];
  if (wp && parseFloat(wp) < 6) a.issues.push(`WordPress ${wp} (years out of date)`);
  const jq = low.match(/jquery[.-]?(1\.\d+|2\.\d+)(?:\.\d+)?(?:\.min)?\.js/)?.[1];
  if (jq) a.issues.push(`jQuery ${jq} (pre-2016)`);
  if (/<table[^>]*>\s*<tr[^>]*>\s*<td[^>]*>\s*<table/i.test(h) || /<font\b|<marquee|<center>/i.test(h)) a.issues.push('built with 2000s-era table/font markup');
  if (/\.swf\b|shockwave-flash/i.test(low)) a.issues.push('uses Flash');
  if (!/<title>[^<]{3,}/i.test(h)) a.issues.push('no page title');
  if (!/<meta[^>]+name=["']description["']/i.test(h)) a.issues.push('no meta description (weak on Google)');
  if (page.ms > 4000) a.issues.push(`slow: ${Math.round(page.ms / 100) / 10}s to load the page`);
  const cta = /book (now|online|an appointment)|schedule|request (a )?(quote|consultation|estimate)|free (estimate|consultation|quote)|get started|appointment/i.test(low);
  if (!cta) a.issues.push('no clear booking / quote button');
  else a.good.push('has a call to action');
  if (/href=["']tel:/i.test(h)) a.good.push('tap-to-call'); else a.issues.push('phone number not tappable');
  if (/our team|meet the team|our doctors|our attorneys|our staff/i.test(low)) a.team = true;
  a.locations = (low.match(/locations?\b/g) || []).length > 3 ? 'multiple' : 'single';
  if (/careers|we.?re hiring|join our team|now hiring/i.test(low)) a.hiring = true;

  // a public business email: on the homepage, else the contact page
  // Code on a page is full of things that look like addresses (v@build.version), so only real-looking endings count
  const TLD = /\.([a-z]{2}|com|net|org|biz|info|law|legal|dental|dentist|realty|homes|properties|clinic|health|care|pro|io|co|us|app|me)$/;
  const findEmail = (html) => [...new Set((html.match(EMAIL) || []).map((e) => e.toLowerCase().replace(/^[^a-z0-9]+/, "")))].filter((e) => !/\.(png|jpg|gif|webp|svg|js|css)$|sentry|wixpress|example|domain\.com|godaddy|email\.com/.test(e) && TLD.test(e));
  let emails = findEmail(h);
  if (!emails.length) {
    const href = h.match(/href=["']([^"']*contact[^"']*)["']/i)?.[1];
    if (href) {
      try {
        const cp = await grab(new URL(href, page.url).href);
        emails = findEmail(cp.html);
        a.contact_page = cp.url;
        if (/<form/i.test(cp.html)) a.form = true;
      } catch {}
    }
  }
  a.email = a.email || emails.find((e) => ROLE_OK.test(e)) || emails[0] || null;
  if (/<form/i.test(h)) a.form = true;
  return a;
}
