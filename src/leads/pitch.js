// A first pitch email for a lead, written from what the audit actually found on their site. Short,
// specific, one ask. Claude rewrites it in your voice once ANTHROPIC_API_KEY is set; until then
// this template is the draft. Always a draft first: you send it from the dashboard.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolveMx } from 'node:dns/promises';
import { db } from '../db.js';

// a pitch needs at least one of these, verified in a real browser; small things only ever support it
// speed only counts when measured fairly (Google PageSpeed, or from the US server: SPEED_TRUSTED=true); from far away every site looks slow
const STRONG = process.env.SPEED_TRUSTED === 'true' ? /not built for phones|no HTTPS|footer still says|slow: ([6-9]|\d{2})|2000s-era/ : /not built for phones|no HTTPS|footer still says|2000s-era/;
const NOREPLY = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce)/i;

/** Re-check the site in a real browser on a phone-sized screen, so we only ever pitch problems that are really there. */
export async function verifySite(url, shotName) {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
    const t0 = Date.now();
    const res = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    const loadS = (Date.now() - t0) / 1000;
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const html = document.documentElement.outerHTML.toLowerCase();
      const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/g)].map((m) => +m[1]).filter((y) => y > 1995);
      return {
        title: document.title,
        challenge: /just a moment|checking your browser|attention required|verify you are human|enable javascript and cookies/.test(document.title.toLowerCase() + ' ' + document.body.innerText.slice(0, 400).toLowerCase()),
        viewport: !!document.querySelector('meta[name=viewport]'),
        wide: document.documentElement.scrollWidth > window.innerWidth + 40,
        tel: !!document.querySelector('a[href^="tel:"]'),
        cta: /book (now|online|an appointment)|schedule|request (a )?(quote|consultation|estimate)|free (estimate|consultation|quote)|get started|appointment|contact us/.test(document.body.innerText.toLowerCase()),
        copyright: years.length ? Math.max(...years) : null,
        tables: !!document.querySelector('table table, font, center, marquee'),
      };
    });
    const issues = [];
    if (r.challenge) return { blocked: true };
    // what a customer sees first on a phone: kept as proof for the screenshot version of the pitch
    let shot = null;
    if (shotName) { shot = `data/shots/${shotName}.png`; await page.screenshot({ path: shot }).catch(() => { shot = null; }); }
    if (!res.url().startsWith('https://')) issues.push('no HTTPS (browsers mark it "Not secure")');
    if (!r.viewport || r.wide) issues.push('not built for phones (no mobile viewport)');
    if (r.copyright && r.copyright <= new Date().getFullYear() - 4) issues.push(`footer still says © ${r.copyright}`);
    if (loadS > 5 && process.env.SPEED_TRUSTED === 'true') issues.push(`slow: ${Math.round(loadS * 10) / 10}s to load the page`);
    if (!r.cta) issues.push('no clear booking / quote button');
    if (!r.tel) issues.push('phone number not tappable');
    if (r.tables) issues.push('built with 2000s-era table/font markup');
    return { issues, url: res.url(), shot };
  } finally { await browser.close(); }
}

// The screenshot alone hides what matters (the address bar's "Not secure", a phone number you can't
// tap). This frames the real screenshot as a phone with the real address-bar state and labels for
// what was found, so the proof shows the problem at a glance.
export async function proofImage(shot, url, issues) {
  const { readFileSync } = await import('node:fs');
  const host = new URL(url).hostname.replace(/^www\./, '');
  const insecure = !url.startsWith('https://');
  const LABEL = [[/no HTTPS/, 'Chrome marks the site "Not secure"'], [/not built for phones/, 'Desktop page squeezed onto a phone'], [/phone number not tappable/, 'Phone number can\'t be tapped to call'], [/no clear booking/, 'No book or quote button'], [/footer still says © (\d{4})/, null], [/2000s-era/, 'Built on 2010-era code']];
  const labels = [];
  for (const i of issues) for (const [re, l] of LABEL) { const m = i.match(re); if (m) { labels.push(l || `Footer still says © ${m[1]}`); break; } }
  const img = readFileSync(shot).toString('base64');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; } body { width: 1200px; height: 900px; background: #f3f2ef; font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; display: flex; align-items: center; justify-content: center; gap: 70px; }
    .phone { width: 360px; height: 760px; border-radius: 54px; background: #111; padding: 12px; box-shadow: 0 40px 80px rgba(0,0,0,.22); }
    .screen { width: 100%; height: 100%; border-radius: 43px; overflow: hidden; background: #fff; display: flex; flex-direction: column; }
    .bar { padding: 46px 14px 10px; background: #f2f2f2; border-bottom: 1px solid #ddd; }
    .url { background: #e4e4e4; border-radius: 12px; padding: 9px 12px; font-size: 14px; display: flex; gap: 8px; align-items: center; color: #222; }
    .warn { color: #c5221f; font-weight: 600; display: flex; align-items: center; gap: 5px; }
    .page { flex: 1; background: url(data:image/png;base64,${img}) top center / 100% auto no-repeat; }
    .side { width: 520px; } h1 { font-size: 40px; letter-spacing: -.03em; line-height: 1.1; color: #111; } h1 span { color: #8a877f; display: block; }
    ul { list-style: none; padding: 0; margin-top: 34px; display: grid; gap: 14px; } li { background: #fff; border-radius: 16px; padding: 16px 18px 16px 50px; font-size: 19px; color: #111; position: relative; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
    li::before { content: '!'; position: absolute; left: 16px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; border-radius: 50%; background: #fbe6e3; color: #c93a32; font-weight: 800; font-size: 14px; display: grid; place-items: center; }
    .by { margin-top: 30px; color: #8a877f; font-size: 15px; }
  </style></head><body>
    <div class="phone"><div class="screen"><div class="bar"><div class="url">${insecure ? '<span class="warn">⚠ Not secure</span>' : '<span>🔒</span>'}<span>${host}</span></div></div><div class="page"></div></div></div>
    <div class="side"><h1>${host}<span>on a phone, today</span></h1><ul>${labels.slice(0, 4).map((l) => `<li>${l}</li>`).join('')}</ul><div class="by">Checked by ${ME} · ${SITE}</div></div>
  </body></html>`;
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'load' });
    const out = shot.replace(/\.png$/, '-proof.png');
    await page.screenshot({ path: out });
    return out;
  } finally { await browser.close(); }
}

const NICHE = { dentist: 'patients', law: 'clients', roofing: 'homeowners', hvac: 'homeowners', realestate: 'buyers and sellers', medspa: 'clients', chiro: 'patients' };
// audit issue -> what it costs them, in plain words
const PLAIN = [
  [/not built for phones/, (w) => `it isn't built for phones, so on a mobile it shows the desktop page shrunk down and ${w} have to pinch and zoom`],
  [/no HTTPS/, () => `it has no HTTPS, so Chrome shows "Not secure" next to your name before anyone reads a word`],
  [/footer still says © (\d{4})/, (_, m) => `the footer still says © ${m[1]}, which makes the business look less active than it is`],
  [/slow: ([\d.]+)s/, (_, m) => `it takes about ${m[1]} seconds to load, and most people leave a slow page before it finishes`],
  [/no clear booking/, (w) => `there's no clear "book" or "get a quote" button, so ${w} who are ready to act have to hunt for how`],
  [/phone number not tappable/, () => `the phone number isn't tappable on a phone, so calling you takes an extra step`],
  [/table\/font markup|jQuery|WordPress \d/, () => `it's built on code from around 2010, which makes it hard to update and slow to load`],
];

// The same problems, in first person: what you saw opening their site on a phone (versions B and C)
const SEEN = [
  [/not built for phones/, () => `it loaded the desktop page shrunk down, so I had to pinch and zoom to read anything`],
  [/no HTTPS/, () => `Chrome showed "Not secure" next to your address before the page had even loaded`],
  [/footer still says © (\d{4})/, (_, m) => `the footer still says © ${m[1]}, and for a second I wondered if you were still open`],
  [/no clear booking/, () => `I couldn't find a button to book or get a quote, so I had to hunt for how to reach you`],
  [/phone number not tappable/, () => `your phone number isn't tappable, so calling you meant copying it by hand`],
  [/table\/font markup|jQuery|WordPress \d/, () => `it runs on code from around 2010, which is why it feels slow and dated next to newer sites`],
];
export const VARIANTS = ['A', 'B', 'C'];
// who signs the pitch: profile.json → known_as and portfolio
const P = JSON.parse(readFileSync('config/profile.json', 'utf8'));
const ME = P.known_as || P.name, SITE = (P.portfolio || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

export function draftFor(lead, verified, variant = 'A') {
  const a = verified || JSON.parse(lead.audit || '{}');
  const who = NICHE[lead.niche] || 'customers';
  const points = [];
  for (const issue of a.issues || []) {
    for (const [re, say] of PLAIN) { const m = issue.match(re); if (m) { points.push(say(who, m)); break; } }
    if (points.length === 2) break;
  }
  if (!points.length) return null; // nothing specific and true to say: don't pitch
  if (variant !== 'A') {
    const seen = [];
    for (const issue of a.issues || []) { for (const [re, say] of SEEN) { const m = issue.match(re); if (m) { seen.push(say(who, m)); break; } } if (seen.length === 2) break; }
    if (seen.length) {
      const name = lead.name.replace(/\s*[-|–].*$/, '').trim();
      const site = new URL(lead.final_url || lead.website).hostname.replace(/^www\./, '');
      const body = `Hi ${name} team,

I opened ${site} on my phone the way a new ${who.replace(/s$/, '').replace(/ and .*/, '')} would. ${seen[0][0].toUpperCase() + seen[0].slice(1)}.${seen[1] ? ` And ${seen[1]}.` : ''}

Most ${who} check you out on a phone first, so that's the first impression they get.${variant === 'C' ? ' I attached a picture of what I saw.' : ''}

I design and build websites and apps (${SITE}). I'll mock up how your homepage could look on a phone, free, no strings. Want it?

${ME}
${SITE}

---
If you'd rather not hear from me again, just reply "no thanks" and I won't email you again.
${process.env.POSTAL_ADDRESS || '[postal address: needed before sending]'}`;
      return { subject: `${site} on a phone`, body, variant };
    }
  }
  const name = lead.name.replace(/\s*[-|–].*$/, '').trim();
  const site = new URL(lead.final_url || lead.website).hostname.replace(/^www\./, '');
  const subject = `A quick idea for ${site}`;
  const body = `Hi ${name} team,

I was looking at ${site} and noticed ${points.length === 2 ? 'two things' : 'something'} that ${points.length === 2 ? 'are' : 'is'} probably costing you ${who}:

${points[1] ? `1. ${points[0][0].toUpperCase() + points[0].slice(1)}.\n2. ${points[1][0].toUpperCase() + points[1].slice(1)}.` : `${points[0][0].toUpperCase() + points[0].slice(1)}.`}

I'm a product designer who designs and builds websites and apps (recent work: ${SITE}). I'd be happy to mock up how your homepage could look on a phone, free, so you can see the difference before deciding anything.

Want me to send it over?

${ME}
${SITE}

---
If you'd rather not hear from me again, just reply "no thanks" and I won't email you again.
${process.env.POSTAL_ADDRESS || '[postal address: needed before sending]'}`;
  return { subject, body, variant: 'A' };
}

export async function draftPitch(leadId) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  if (!lead || !lead.email) return { error: 'no public email for this lead' };
  if (NOREPLY.test(lead.email)) return { error: 'only a no-reply address' };
  if (db.prepare('SELECT 1 FROM optouts WHERE email = ?').get(lead.email.toLowerCase())) return { error: 'opted out' };
  // No mail server for the domain means a certain bounce, and bounces hurt the sending domain
  try { if (!(await resolveMx(lead.email.split('@')[1])).length) return { error: 'email domain takes no mail' }; } catch { return { error: 'email domain takes no mail' }; }
  let v;
  try { v = await verifySite(lead.final_url || lead.website, `lead_${leadId.replace(/[^a-z0-9]+/gi, '_')}`); } catch (e) { return { error: 'site did not load in a browser' }; }
  if (v.blocked) return { error: 'site blocks checks; review by hand' };
  db.prepare('UPDATE leads SET why = ? WHERE id = ?').run(`verified: ${v.issues.join('; ') || 'no issues'}`, leadId);
  if (!v.issues.some((i) => STRONG.test(i))) { db.prepare("UPDATE leads SET tier = 'cold' WHERE id = ?").run(leadId); return { error: 'site is fine on a real phone: not worth pitching' }; }
  // strong problems lead the email
  v.issues.sort((a, b) => Number(STRONG.test(b)) - Number(STRONG.test(a)));
  // versions take turns so each gets a fair test: the one with the fewest pitches goes next
  const used = Object.fromEntries(VARIANTS.map((x) => [x, db.prepare('SELECT COUNT(*) n FROM pitches WHERE variant = ?').get(x).n]));
  const want = VARIANTS.reduce((a, b) => (used[b] < used[a] ? b : a));
  const d = draftFor(lead, v, want === 'C' && !v.shot ? 'B' : want);
  if (d?.variant === 'C') v.shot = await proofImage(v.shot, v.url, v.issues).catch(() => v.shot);
  if (!d) return { error: 'nothing specific found to say' };
  db.prepare('INSERT INTO pitches (lead_id, to_addr, subject, body, created_at, variant, attachment) VALUES (?, ?, ?, ?, ?, ?, ?)').run(leadId, lead.email, d.subject, d.body, new Date().toISOString(), d.variant, d.variant === 'C' ? v.shot : null);
  db.prepare("UPDATE leads SET status = 'drafted' WHERE id = ?").run(leadId);
  return { ok: true, ...d };
}
