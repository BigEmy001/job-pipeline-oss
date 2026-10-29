// Works through the jobs you approved (pressed Apply): makes a resume tailored to the job, opens
// the application, fills it and, with APPLY_SUBMIT=true, submits it and checks it went through.
// Anything it can't do honestly (a captcha challenge, a question with no true answer, an error on
// the form) stops before or at submit and goes to "Needs you" with a screenshot.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { db, log } from '../db.js';
import { fillForm } from './fill.js';
import { tailor, CV_NAME } from '../resume/tailor.js';
process.loadEnvFile('.env');

const SUBMIT = process.env.APPLY_SUBMIT === 'true';
const ids = process.argv.slice(2);
const only = ids.length > 0; // given ids: just those; otherwise every approved job, including ones approved while this runs
const next = () => only
  ? (ids.length ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(ids.shift()) : null)
  : db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY score DESC LIMIT 1").get();
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });

// Only real application forms are ever filled: Greenhouse, Lever, Ashby. A job board link is
// followed to the company's own form when the page links to one; otherwise it's yours to apply to.
const ATS = [
  [/https?:\/\/(?:job-boards(?:\.eu)?|boards(?:\.eu)?)\.greenhouse\.io\/[\w-]+\/jobs\/\d+/i, 'greenhouse'],
  [/https?:\/\/jobs\.lever\.co\/[\w-]+\/[0-9a-f-]{36}/i, 'lever'],
  [/https?:\/\/jobs\.ashbyhq\.com\/[\w.-]+\/[0-9a-f-]{36}/i, 'ashby'],
];
async function realForm(j) {
  // Greenhouse jobs shown on a company's own careers page: use Greenhouse's direct form page
  const gh = j.id.match(/^gh:([^:]+):(\d+)$/);
  if (gh) return { url: /greenhouse\.io/.test(j.apply_url || '') ? j.apply_url : `https://job-boards.greenhouse.io/${gh[1]}/jobs/${gh[2]}`, kind: 'greenhouse' };
  if (['greenhouse', 'lever', 'ashby'].includes(j.apply_kind)) return { url: j.apply_url || j.url, kind: j.apply_kind };
  for (const u of [j.apply_url, j.url].filter(Boolean)) {
    for (const [re, kind] of ATS) { const m = u.match(re); if (m) return { url: m[0], kind }; }
    try {
      const html = await (await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) })).text();
      for (const [re, kind] of ATS) { const m = html.replace(/\\\//g, '/').match(re); if (m) return { url: m[0], kind }; }
      // the board's own "Apply" button often redirects to the company's form: follow it once
      const hrefs = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi)].filter(([, h, t]) => /apply/i.test(`${h} ${t}`)).map(([, h]) => new URL(h.replace(/&amp;/g, '&'), u).href).slice(0, 4);
      for (const h of hrefs) {
        const r = await fetch(h, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(15000) }).catch(() => null);
        if (!r) continue;
        for (const [re, kind] of ATS) { const m = r.url.match(re) || (await r.text().catch(() => '')).match(re); if (m) return { url: m[0], kind }; }
      }
    } catch {}
  }
  return null;
}

const DONE = /thank(s| you)[^.]{0,40}(appl|submi|interest)|application (has been |was )?(submitted|received|sent)|we('ve| have) received your application|successfully (submitted|applied)|you('ve| have) (successfully )?applied/i;
const CHALLENGE = 'iframe[title*="challenge" i], iframe[src*="hcaptcha.com"][src*="frame=challenge"], iframe[src*="recaptcha"][src*="bframe"]';

let n = 0;
for (let j = next(); j && n < 15; j = next(), n++) {
  const id = j.id;
  db.prepare("UPDATE jobs SET status = 'applying' WHERE id = ?").run(j.id);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let state = 'needs_you', detail = {};
  const shot = `data/shots/${j.id.replace(/[^a-z0-9]+/gi, '_')}.png`;
  try {
    const cv = await tailor(j, browser);
    detail = { resume: cv.tailored ? `tailored: ${cv.role}` : 'original', resumePath: cv.path };
    const form = await realForm(j);
    if (!form) throw new Error(`no Greenhouse, Lever or Ashby form for this job: apply on their site with your tailored resume`);
    let url = form.url;
    j = { ...j, apply_kind: form.kind };
    if (j.apply_kind === 'lever' && !/\/apply/.test(url)) url = url.replace(/\/?$/, '/apply');
    if (j.apply_kind === 'ashby' && !/\/application/.test(url)) url = url.replace(/\/?$/, '/application');
    await page.goto(url, { waitUntil: 'load', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    // Greenhouse and others sometimes hide the form behind an Apply button
    const applyBtn = page.getByRole('button', { name: /^apply( for this job| now)?$/i }).or(page.getByRole('link', { name: /^apply( for this job| now)?$/i })).first();
    if (!(await page.locator('form input').count()) && (await applyBtn.count())) { await applyBtn.click(); await page.waitForTimeout(2500); }
    await page.locator('form input, input[type=file], input[type=email]').first().waitFor({ timeout: 20000 }).catch(() => {}); // Ashby fetches its form after load
    if (!(await page.locator('form input, input[type=file], input[type=email]').count())) throw new Error('no application form on the page (external portal): apply on their site');
    const r = await fillForm(page, { name: CV_NAME, mimeType: 'application/pdf', buffer: readFileSync(cv.path) });
    detail = { ...detail, url, filled: r.filled.length, unknown: r.unknown, shot };
    if (r.unknown.length) state = 'needs_you';
    else if (!SUBMIT) state = 'dry_run_ready';
    else {
      const submit = page.locator('button[type=submit], input[type=submit]').or(page.getByRole('button', { name: /submit( application)?|send application|apply now/i })).last();
      if (!(await submit.count())) throw new Error('no submit button found');
      const before = page.url();
      await submit.scrollIntoViewIfNeeded();
      await submit.click();
      // wait for a thank-you page, a challenge, or form errors
      let outcome = null;
      for (let t = 0; t < 30 && !outcome; t++) {
        await page.waitForTimeout(1000);
        const text = await page.locator('body').innerText().catch(() => '');
        if (DONE.test(text) || /confirmation|thank/i.test(page.url()) && page.url() !== before) outcome = 'submitted';
        else if (/verification code was sent|enter the \d+-character code|confirm you.?re a human/i.test(text)) outcome = 'code';
        else if (await page.locator(CHALLENGE).filter({ visible: true }).count()) outcome = 'captcha';
        else if (t > 4 && await page.locator('[aria-invalid="true"], .error:visible, [class*="error" i]:visible, [role=alert]:visible').count()) outcome = 'errors';
      }
      if (outcome === 'submitted') state = 'submitted';
      else {
        state = 'needs_you';
        detail.finish = outcome === 'code';
        detail.error = outcome === 'code' ? 'the site emailed you a code to prove you\'re human: press Finish in Chrome, then type the code'
          : outcome === 'captcha' ? 'a captcha challenge appeared: finish it on the form'
          : outcome === 'errors' ? `the form showed errors: ${(await page.locator('[role=alert], .error, [class*="error" i]').allInnerTexts()).join(' · ').slice(0, 160)}`
          : 'pressed submit but saw no confirmation: check the form';
      }
    }
    await page.screenshot({ path: shot, fullPage: true });
  } catch (e) {
    detail.error = e.message.slice(0, 200);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    detail.shot = shot;
  }
  db.prepare('INSERT INTO applications (job_id, method, sent_at, state, detail) VALUES (?, ?, ?, ?, ?)').run(id, j.apply_kind, new Date().toISOString(), state, JSON.stringify(detail));
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(state === 'submitted' ? 'applied' : state === 'dry_run_ready' ? 'ready' : 'needs_you', id);
  log('apply', { job: j.id, state, ...detail });
  console.log(`${state.padEnd(14)} ${j.company} · ${j.title}${detail.resume ? ` · resume ${detail.resume}` : ''}`);
  for (const u of detail.unknown || []) console.log(`     ? ${u.label}`);
  if (detail.error) console.log(`     ! ${detail.error}`);
  await page.close();
}
await browser.close();
