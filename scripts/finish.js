// Opens the application in your own Chrome, filled with the tailored resume and true answers,
// and presses Submit so the site sends its verification code. He types the code and submits: the
// "are you human" step is always his. The window waits up to 20 minutes and records the result.
// node scripts/finish.js <job id> [<job id> ...]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { db, log } from '../src/db.js';
import { fillForm } from '../src/apply/fill.js';
import { tailor, CV_NAME } from '../src/resume/tailor.js';
process.loadEnvFile('.env');

const DONE = /thank(s| you)[^.]{0,40}(appl|submi|interest)|application (has been |was )?(submitted|received|sent)|we('ve| have) received your application|successfully (submitted|applied)|you('ve| have) (successfully )?applied/i;
const ids = process.argv.slice(2);
const chrome = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1280,1000'] });
const ctx = await chrome.newContext({ viewport: null });
const shell = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined }); // for the resume PDF

const open = [];
for (const id of ids) {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!j) continue;
  const cv = await tailor(j, shell);
  const page = await ctx.newPage();
  const gh = j.id.match(/^gh:([^:]+):(\d+)$/);
  let url = gh && !/greenhouse\.io/.test(j.apply_url || '') ? `https://job-boards.greenhouse.io/${gh[1]}/jobs/${gh[2]}` : j.apply_url || j.url;
  if (j.apply_kind === 'lever' && !/\/apply/.test(url)) url = url.replace(/\/?$/, '/apply');
  if (j.apply_kind === 'ashby' && !/\/application/.test(url)) url = url.replace(/\/?$/, '/application');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.locator('form input, input[type=file]').first().waitFor({ timeout: 20000 }).catch(() => {});
  const r = await fillForm(page, { name: CV_NAME, mimeType: 'application/pdf', buffer: readFileSync(cv.path) });
  if (!r.unknown.length) {
    const submit = page.locator('button[type=submit], input[type=submit]').or(page.getByRole('button', { name: /submit( application)?/i })).last();
    await submit.click().catch(() => {});
  }
  db.prepare("UPDATE jobs SET status = 'finishing' WHERE id = ?").run(id);
  console.log(`opened: ${j.company} · ${j.title}${r.unknown.length ? ` · still needs: ${r.unknown.map((u) => u.label).join(' | ')}` : ' · code requested: check your email'}`);
  open.push({ j, page, cv });
}
await shell.close();

// wait for each to be submitted (or the window closed)
const end = Date.now() + 20 * 60 * 1000;
while (open.length && Date.now() < end) {
  await new Promise((r) => setTimeout(r, 3000));
  for (const o of [...open]) {
    const closed = o.page.isClosed();
    const text = closed ? '' : await o.page.locator('body').innerText().catch(() => '');
    if (!closed && !DONE.test(text)) continue;
    const ok = !closed;
    const shot = `data/shots/${o.j.id.replace(/[^a-z0-9]+/gi, '_')}.png`;
    if (ok) await o.page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    db.prepare('INSERT INTO applications (job_id, method, sent_at, state, detail) VALUES (?, ?, ?, ?, ?)').run(o.j.id, o.j.apply_kind, new Date().toISOString(), ok ? 'submitted' : 'needs_you', JSON.stringify({ via: 'your Chrome', resume: o.cv.tailored ? `tailored: ${o.cv.role}` : 'original', resumePath: o.cv.path, shot: ok ? shot : undefined, error: ok ? undefined : 'window closed before submitting' }));
    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(ok ? 'applied' : 'needs_you', o.j.id);
    log('finish', { job: o.j.id, ok });
    console.log(`${ok ? 'SUBMITTED' : 'closed    '} ${o.j.company} · ${o.j.title}`);
    open.splice(open.indexOf(o), 1);
  }
}
for (const o of open) db.prepare("UPDATE jobs SET status = 'needs_you' WHERE id = ?").run(o.j.id);
await chrome.close().catch(() => {});
