// The dashboard: one small server, the SQLite file, and a single page. Behind a password when
// DASH_USER / DASH_PASS are set (always, on the VPS).
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { readFileSync, writeFileSync } from 'node:fs';
import { db, log } from './db.js';
import { draftPitch } from './leads/pitch.js';
import { spawn } from 'node:child_process';
import { jobFromUrl } from './fetchers/byurl.js';
import { placeOk, roleOk } from './filter.js';
import { score } from './score.js';
import { RULES } from './apply/fill.js';
import { BASE_PDF, CV_NAME, angleFor, tailor } from './resume/tailor.js';
const ME = JSON.parse(readFileSync('config/profile.json', 'utf8'));
process.loadEnvFile?.('.env');

const app = new Hono();
if (process.env.DASH_USER && process.env.DASH_PASS) app.use('*', basicAuth({ username: process.env.DASH_USER, password: process.env.DASH_PASS }));

const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);

app.get('/api/summary', (c) => c.json({
  me: { name: ME.name, known_as: ME.known_as || ME.name, tagline: ME.tagline || '', home: ME.location || '' },
  jobs: one("SELECT COUNT(*) n FROM jobs WHERE status = 'new'").n,
  strong: one("SELECT COUNT(*) n FROM jobs WHERE status = 'new' AND score >= 80").n,
  applied: one("SELECT COUNT(*) n FROM jobs WHERE status = 'applied'").n,
  needs: one("SELECT COUNT(*) n FROM jobs WHERE status = 'needs_you'").n,
  replies: one("SELECT COUNT(*) n FROM messages WHERE handled = 0 AND kind NOT IN ('received', 'optout', 'rejection', 'code')").n,
  interviews: one("SELECT COUNT(*) n FROM messages WHERE kind = 'interview'").n,
  hot: one("SELECT COUNT(*) n FROM leads WHERE tier = 'hot' AND status = 'new'").n,
  apps: one("SELECT COUNT(DISTINCT job_id) n FROM applications WHERE state = 'submitted'").n,
  pitches: one("SELECT COUNT(*) n FROM pitches WHERE state = 'draft'").n,
  warm: one("SELECT COUNT(*) n FROM leads WHERE tier = 'warm' AND status = 'new'").n,
  lastRun: one("SELECT at, detail FROM events WHERE kind = 'run' ORDER BY id DESC LIMIT 1") ?? null,
  dryRun: process.env.DRY_RUN !== 'false',
  applySubmit: process.env.APPLY_SUBMIT === 'true',
}));

// The overview: today's funnel, where matches come from, and what is waiting on you, oldest and
// most important first.
app.get('/api/overview', async (c) => {
  const run = one("SELECT at, detail FROM events WHERE kind = 'run' ORDER BY id DESC LIMIT 1");
  const r = run ? JSON.parse(run.detail) : {};
  const sources = all("SELECT source, COUNT(*) n, SUM(score >= 80) strong FROM jobs WHERE status != 'skipped' GROUP BY source ORDER BY n DESC");
  const needs = [];
  const strong = all("SELECT id, company, title, score FROM jobs WHERE status = 'new' AND score >= 70 ORDER BY score DESC LIMIT 3");
  for (const j of strong) needs.push({ tone: 'go', tab: 'jobs', title: `${j.title.trim()} at ${j.company}`, sub: `Scores ${j.score}. Apply, or skip it` });
  const n = (sql) => one(sql).n;
  const forms = n("SELECT COUNT(*) n FROM jobs WHERE status = 'needs_you'");
  if (forms) needs.push({ tone: 'warn', tab: 'needs', title: `${forms} form${forms > 1 ? 's' : ''} the filler couldn't finish`, sub: 'A captcha or a question it had no answer for' });
  // replies first: an interview invite beats everything
  const replyItems = [];
  for (const m of all("SELECT m.kind, m.from_addr, m.subject, j.company, j.title FROM messages m LEFT JOIN jobs j ON j.id = m.job_id WHERE m.handled = 0 AND m.kind IN ('interview', 'portal', 'lead_reply') ORDER BY m.kind = 'interview' DESC, m.received_at DESC LIMIT 4"))
    replyItems.push({ tone: m.kind === 'interview' ? 'go' : m.kind === 'portal' ? 'warn' : 'info', tab: 'replies',
      title: m.kind === 'interview' ? `Interview invite${m.company ? ` from ${m.company}` : ''}` : m.kind === 'portal' ? `${m.company || 'A company'} wants a next step on their portal` : `A business replied to your pitch`,
      sub: m.subject || m.from_addr });
  needs.unshift(...replyItems);
  const answers = readFileSync('config/answers.json', 'utf8');
  const blanks = [...answers.matchAll(/"(\w+)":\s*"EDIT ME"/g)].map((m) => m[1].replace(/_/g, ' '));
  if (blanks.length) needs.push({ tone: 'warn', tab: null, title: `${blanks.length} answers missing from your answer bank`, sub: `${blanks.join(', ')} · config/answers.json` });
  const sentAll = n("SELECT COUNT(DISTINCT job_id) n FROM applications WHERE state = 'submitted'") + n("SELECT COUNT(*) n FROM pitches WHERE state = 'sent'");
  if (sentAll) { const due = (await (await app.request('/api/tracker')).json()).filter((r) => r.follow_up_due).length; if (due) needs.push({ tone: 'warn', tab: 'tracker', title: `${due} follow-up${due > 1 ? 's' : ''} due`, sub: 'No reply yet: a short nudge often gets one' }); }
  const pitches = n("SELECT COUNT(*) n FROM pitches WHERE state = 'draft'");
  if (pitches) needs.push({ tone: 'info', tab: 'pitches', title: `${pitches} pitch draft${pitches > 1 ? 's' : ''} to review`, sub: 'Nothing is sent until you press Send' });
  if (!process.env.POSTAL_ADDRESS) needs.push({ tone: 'info', tab: null, title: 'Pitches need a postal address', sub: 'US law (CAN-SPAM) asks for one in every cold email · POSTAL_ADDRESS in .env' });
  return c.json({
    lastRun: run?.at || null, dryRun: process.env.DRY_RUN !== 'false',
    funnel: { scanned: r.fetched || 0, roles: r.roles || 0, open: r.kept || 0, fresh: r.fresh || 0, applied: n('SELECT COUNT(*) n FROM applications'), interviews: n("SELECT COUNT(*) n FROM messages WHERE kind = 'interview'") },
    boards: JSON.parse(readFileSync('config/boards.json', 'utf8')).length,
    sources, needs,
    top: all("SELECT id, company, title, location, apply_kind, score, posted_at FROM jobs WHERE status = 'new' ORDER BY score DESC LIMIT 5"),
  });
});
app.get('/api/jobs', (c) => {
  const status = c.req.query('status') || 'new';
  return c.json(all('SELECT id, source, company, title, url, apply_kind, location, posted_at, score, score_why, status, (SELECT COUNT(*) FROM contacts k WHERE lower(k.company) = lower(jobs.company)) people FROM jobs WHERE status = ? ORDER BY score DESC, posted_at DESC LIMIT 200', status));
});

// People: who to write to at a company. Found by hand (LinkedIn via Google, Apollo's extension),
// saved here so the note to them can be drafted later.
app.get('/api/contacts', (c) => c.json(all('SELECT * FROM contacts WHERE lower(company) = lower(?) ORDER BY id', c.req.query('company') || '')));
app.post('/api/contacts', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const clean = (s, n = 200) => String(s || '').trim().slice(0, n);
  if (!clean(b.company) || !clean(b.name)) return c.json({ error: 'a name is needed' }, 400);
  const email = clean(b.email).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) return c.json({ error: "that email doesn't look right" }, 400);
  const linkedin = clean(b.linkedin, 400);
  if (linkedin && !/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(linkedin)) return c.json({ error: 'LinkedIn link should start with https://linkedin.com/' }, 400);
  db.prepare('INSERT INTO contacts (company, job_id, name, role, email, linkedin, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(clean(b.company), clean(b.job_id), clean(b.name), clean(b.role), email, linkedin, new Date().toISOString());
  log('contact:add', clean(b.company));
  return c.json({ ok: true });
});
app.delete('/api/contacts/:id', (c) => { db.prepare('DELETE FROM contacts WHERE id = ?').run(c.req.param('id')); return c.json({ ok: true }); });
// The search launcher: Google searches you run in your own browser (last week only), plus a box to
// save a job link you found, which is read, scored and listed like the rest.
app.get('/api/searches', (c) => {
  const S = JSON.parse(readFileSync('config/searches.json', 'utf8'));
  const google = (q) => `https://www.google.com/search?q=${encodeURIComponent(q.replace('{roles}', S.roles))}&tbs=qdr:w`;
  return c.json({ searches: S.searches.map((s) => ({ ...s, url: google(s.q) })), links: S.links });
});
app.post('/api/jobs/add', async (c) => {
  const { url } = await c.req.json().catch(() => ({}));
  try {
    const j = await jobFromUrl(url);
    const { score: s, why } = score(j);
    const r = db.prepare(`INSERT OR IGNORE INTO jobs (id, source, company, title, url, apply_url, apply_kind, location, remote, description, posted_at, found_at, score, score_why)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(j.id, j.source, j.company, j.title, j.url, j.apply_url, j.apply_kind, j.location, j.remote, j.description, j.posted_at, new Date().toISOString(), s, why);
    log('job:add', j.id);
    return c.json({ ok: true, added: !!r.changes, title: j.title, company: j.company, score: s, why, roleOk: roleOk(j.title), placeOk: placeOk(j) });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 400);
  }
});
// The questions a form asked that had no true answer yet, and saving your answers to them (kept in
// config/answers.json → custom, reused on every later form that asks the same thing).
const normQ = (s = '') => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
app.get('/api/questions', (c) => {
  const A = JSON.parse(readFileSync('config/answers.json', 'utf8'));
  const rows = all("SELECT a.job_id, a.detail FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.status = 'needs_you' AND a.id = (SELECT MAX(id) FROM applications WHERE job_id = a.job_id)");
  const out = {};
  for (const r of rows) {
    const d = JSON.parse(r.detail || '{}');
    out[r.job_id] = { finish: !!d.finish || /captcha/i.test(d.error || ''), error: d.error || null, shot: d.shot || null, resume: d.resumePath?.startsWith('data/resumes/') ? `/resumes/${d.resumePath.split('/').pop()}` : null, questions: (d.unknown || []).map((u) => ({ label: u.label, key: u.key, answer: (u.key && u.key !== 'custom' && A[u.key] && !/EDIT ME/.test(A[u.key]) ? A[u.key] : A.custom?.[normQ(u.label)]) || '' })) };
  }
  return c.json(out);
});
app.post('/api/answers', async (c) => {
  const { answers = [] } = await c.req.json().catch(() => ({}));
  const A = JSON.parse(readFileSync('config/answers.json', 'utf8'));
  A.custom ||= {};
  let n = 0;
  for (const { label, key, value } of answers) {
    const v = String(value || '').trim().slice(0, 1000);
    if (!v || !label) continue;
    if (key && key !== 'custom' && key in A) A[key] = v; // a standard answer (salary, notice period…) fills the bank
    else A.custom[normQ(label)] = v;
    n++;
  }
  writeFileSync('config/answers.json', JSON.stringify(A, null, 2) + '\n');
  log('answers', { saved: n });
  return c.json({ ok: true, saved: n });
});
app.post('/api/jobs/:id/:action', (c) => {
  const { id, action } = c.req.param();
  const to = { approve: 'queued', skip: 'skipped', needs: 'needs_you', applied: 'applied', reset: 'new' }[action];
  if (!to) return c.json({ error: 'unknown action' }, 400);
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(to, id);
  log(`job:${action}`, id);
  if (action === 'approve') startApplying();
  return c.json({ ok: true, status: to });
});

app.get('/api/leads', (c) => {
  const tier = c.req.query('tier') || 'hot,warm';
  const tiers = tier.split(',');
  return c.json(all(`SELECT id, name, niche, city, website, final_url, phone, email, score, tier, why, status, audit FROM leads WHERE tier IN (${tiers.map(() => '?').join(',')}) AND status = 'new' ORDER BY score DESC LIMIT 200`, ...tiers)
    .map((l) => ({ ...l, audit: JSON.parse(l.audit || '{}') })));
});
app.post('/api/leads/:id/:action', async (c) => {
  const { id, action } = c.req.param();
  if (action === 'pitch') return c.json(await draftPitch(id));
  const to = { skip: 'skip', won: 'won', lost: 'lost', reset: 'new' }[action];
  if (!to) return c.json({ error: 'unknown action' }, 400);
  db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(to, id);
  log(`lead:${action}`, id);
  return c.json({ ok: true, status: to });
});

app.get('/api/pitches', (c) => c.json(all("SELECT p.*, l.name, l.niche, l.city, l.final_url FROM pitches p JOIN leads l ON l.id = p.lead_id WHERE p.state = 'draft' ORDER BY p.id DESC")));
// Send one pitch (you press Send): the site is checked again in a real browser, the email is
// redrafted from what's true today, and it goes out with an unsubscribe header. Opt-outs never.
app.post('/api/pitches/:id/send', async (c) => {
  const old = one("SELECT * FROM pitches WHERE id = ? AND state = 'draft'", c.req.param('id'));
  if (!old) return c.json({ error: 'not a draft' }, 400);
  if (!process.env.POSTAL_ADDRESS) return c.json({ error: 'add POSTAL_ADDRESS to .env first' }, 400);
  db.prepare("UPDATE pitches SET state = 'skipped' WHERE id = ?").run(old.id);
  const d = await draftPitch(old.lead_id);
  if (d.error) return c.json({ error: `not sent: ${d.error}` }, 400);
  const p = one('SELECT * FROM pitches WHERE lead_id = ? ORDER BY id DESC LIMIT 1', old.lead_id);
  const { send } = await import('./mail.js');
  const r = await send({ to: p.to_addr, subject: p.subject, text: p.body, headers: { 'List-Unsubscribe': `<mailto:${process.env.MAIL_USER}?subject=unsubscribe>` }, attachments: p.attachment ? [{ filename: 'what-i-saw-on-my-phone.png', path: p.attachment }] : undefined });
  db.prepare("UPDATE pitches SET state = 'sent', sent_at = ? WHERE id = ?").run(new Date().toISOString(), p.id);
  db.prepare("UPDATE leads SET status = 'sent' WHERE id = ?").run(old.lead_id);
  log('pitch:sent', { lead: old.lead_id, to: p.to_addr, messageId: r.messageId });
  return c.json({ ok: true, to: p.to_addr, body: p.body });
});
app.post('/api/pitches/:id/skip', (c) => { db.prepare("UPDATE pitches SET state = 'skipped' WHERE id = ?").run(c.req.param('id')); return c.json({ ok: true }); });
app.get('/api/applications', (c) => c.json(all("SELECT a.*, j.company, j.title, j.url FROM applications a JOIN jobs j ON j.id = a.job_id ORDER BY a.id DESC LIMIT 100").map((a) => ({ ...a, detail: JSON.parse(a.detail || '{}') }))));
app.get('/resumes/:f', (c) => { const f = c.req.param('f').replace(/[^a-zA-Z0-9_.-]/g, ''); try { return c.body(readFileSync(`data/resumes/${f}`), 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${CV_NAME}"` }); } catch { return c.notFound(); } });
app.get('/shots/:f', (c) => { const f = c.req.param('f').replace(/[^a-zA-Z0-9_.-]/g, ''); try { return c.body(readFileSync(`data/shots/${f}`), 200, { 'Content-Type': 'image/png' }); } catch { return c.notFound(); } });
let applying = false;
// Applying runs in the background. Pressing Apply on a job starts it; jobs approved while it runs
// are picked up by the same run, and if any are left when it ends it starts again.
const startApplying = () => {
  if (applying) return false;
  applying = true;
  const p = spawn(process.execPath, ['src/apply/run.js'], { stdio: 'ignore' });
  p.on('exit', (code) => { applying = false; if (code === 0 && one("SELECT COUNT(*) n FROM jobs WHERE status = 'queued'").n) startApplying(); });
  return true;
};
// Finish in Chrome: opens the filled form in your own Chrome for the steps only you can do
app.post('/api/finish/:id', (c) => {
  const id = c.req.param('id');
  if (!one('SELECT 1 FROM jobs WHERE id = ?', id)) return c.json({ error: 'no such job' }, 404);
  spawn(process.execPath, ['scripts/finish.js', id], { stdio: 'ignore', detached: true }).unref();
  return c.json({ started: true });
});
app.post('/api/apply-now', (c) => c.json(startApplying() ? { started: true } : { busy: true }));
// The tracker: every application, pitch and founder DM sent, one list, with what came back and when
// to follow up. Status comes from replies the inbox sorted, or what you set by hand.
const FOLLOW_DAYS = { Application: 10, Email: 7, 'Client pitch': 5, 'Founder DM': 5 };
app.get('/api/tracker', (c) => {
  const manual = Object.fromEntries(all('SELECT * FROM track').map((t) => [t.key, t]));
  const replyFor = (col, id) => one(`SELECT kind, subject, received_at FROM messages WHERE ${col} = ? AND kind NOT IN ('received', 'code') ORDER BY received_at DESC LIMIT 1`, id);
  const rows = [];
  for (const a of all("SELECT a.job_id, MIN(a.sent_at) sent_at, a.method, j.company, j.title, j.url, j.status FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.state = 'submitted' GROUP BY a.job_id")) {
    const r = replyFor('job_id', a.job_id), got = one("SELECT 1 FROM messages WHERE job_id = ? AND kind = 'received'", a.job_id);
    rows.push({ key: `app:${a.job_id}`, type: a.method === 'email' ? 'Email' : 'Application', who: a.company, what: a.title.trim(), url: a.url, channel: { greenhouse: 'Greenhouse', ashby: 'Ashby', lever: 'Lever', email: 'Email' }[a.method] || a.method, sent_at: a.sent_at,
      auto: r ? { interview: 'Interview', rejection: 'Rejected', portal: 'Next step', other: 'Replied' }[r.kind] || 'Replied' : a.status === 'closed' ? 'Rejected' : got ? 'Received' : null, reply: r?.subject || null });
  }
  for (const p of all("SELECT p.id, p.to_addr, p.sent_at, p.variant, l.name, l.niche, l.city, l.final_url, l.status, l.id lead_id FROM pitches p JOIN leads l ON l.id = p.lead_id WHERE p.state = 'sent'")) {
    const r = replyFor('lead_id', p.lead_id);
    rows.push({ key: `pitch:${p.id}`, variant: p.variant || 'A', type: 'Client pitch', who: p.name, what: `Website redesign · ${p.niche}, ${p.city}`, url: p.final_url, channel: p.to_addr, sent_at: p.sent_at,
      auto: p.status === 'unsubscribed' ? 'Opted out' : r ? 'Replied' : null, reply: r?.subject || null });
  }
  for (const o of readOut().filter((o) => o.status === 'sent' || o.status === 'replied'))
    rows.push({ key: `dm:${o.company}`, variant: o.variant || 'A', type: 'Founder DM', who: o.company, what: `${o.founders.map((f) => f.name.split(' ')[0]).join(' / ')} · hiring ${o.role}`, url: o.site, channel: 'X / LinkedIn', sent_at: o.sent_at || o.replied_at, auto: o.status === 'replied' ? 'Replied' : null });
  const now = Date.now();
  for (const r of rows) {
    const m = manual[r.key];
    r.status = m?.status || r.auto || 'Waiting';
    r.note = m?.note || '';
    const base = new Date(m?.followed_up_at || r.sent_at).getTime();
    r.follow_up_at = new Date(base + FOLLOW_DAYS[r.type] * 864e5).toISOString();
    r.follow_up_due = ['Waiting', 'Received'].includes(r.status) && now > new Date(r.follow_up_at).getTime();
    r.followed_up = !!m?.followed_up_at;
  }
  rows.sort((a, b) => (b.sent_at || '').localeCompare(a.sent_at || ''));
  return c.json(rows);
});
app.post('/api/tracker', async (c) => {
  const { key, status, note, followed_up } = await c.req.json().catch(() => ({}));
  if (!key) return c.json({ error: 'key needed' }, 400);
  const cur = one('SELECT * FROM track WHERE key = ?', key) || {};
  db.prepare('INSERT OR REPLACE INTO track (key, status, note, followed_up_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(key, status ?? cur.status ?? null, note ?? cur.note ?? null, followed_up ? new Date().toISOString() : cur.followed_up_at ?? null, new Date().toISOString());
  log('track', { key, status, followed_up: !!followed_up });
  return c.json({ ok: true });
});

// Founder outreach: startups hiring designers, their founders' public profiles and a short DM
// written for each. You send DMs from your own accounts; this only tracks them.
const OUT = 'data/outreach.json';
const readOut = () => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return []; } };
app.get('/api/outreach', (c) => c.json(readOut()));
app.post('/api/outreach/:i/:action', (c) => {
  const list = readOut(), i = +c.req.param('i'), to = { sent: 'sent', replied: 'replied', skip: 'skipped', reset: 'draft' }[c.req.param('action')];
  if (!list[i] || !to) return c.json({ error: 'unknown' }, 400);
  list[i].status = to; list[i][`${to}_at`] = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(list, null, 2));
  log(`outreach:${to}`, list[i].company);
  return c.json({ ok: true });
});
app.get('/api/messages', (c) => c.json(all("SELECT m.*, j.company, j.title, l.name lead_name FROM messages m LEFT JOIN jobs j ON j.id = m.job_id LEFT JOIN leads l ON l.id = m.lead_id ORDER BY m.handled, CASE m.kind WHEN 'interview' THEN 0 WHEN 'portal' THEN 1 WHEN 'lead_reply' THEN 2 ELSE 3 END, m.received_at DESC LIMIT 150")));
app.post('/api/messages/:id/done', (c) => { db.prepare('UPDATE messages SET handled = 1 WHERE id = ?').run(c.req.param('id')); return c.json({ ok: true }); });
// The inbox is read every 15 minutes while the dashboard runs, and on demand.
let reading = false;
const readInbox = () => {
  if (reading) return false;
  reading = true;
  spawn(process.execPath, ['src/inbox.js'], { stdio: 'ignore' }).on('exit', () => { reading = false; });
  return true;
};
app.post('/api/inbox/check', (c) => c.json({ started: readInbox() }));
setInterval(readInbox, 15 * 60 * 1000);
setTimeout(readInbox, 5000);
// The Chrome extension ("Fill my application"). It asks for the filling rules and answers, the resume
// tailored to the page's job, saves answers typed into questions it didn't know, and reports a
// submitted application. Only the extension (and this machine) can call these: no CORS headers.
app.get('/api/ext/profile', (c) => {
  const A = JSON.parse(readFileSync('config/answers.json', 'utf8'));
  const answers = Object.fromEntries(Object.entries(A).filter(([k, v]) => typeof v === 'string' && !/EDIT ME/.test(v) && k !== '_note'));
  return c.json({ answers, custom: A.custom || {}, rules: RULES.map(([re, key]) => [re.source, re.flags, key]) });
});
const jobForUrl = (u) => {
  let url; try { url = new URL(u); } catch { return null; }
  const gh = url.searchParams.get('gh_jid') || (/greenhouse\.io$/.test(url.hostname) && url.pathname.match(/\/jobs\/(\d+)/)?.[1]);
  if (gh) return one("SELECT * FROM jobs WHERE id LIKE 'gh:%:' || ?", gh);
  const uuid = url.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  if (uuid) return one("SELECT * FROM jobs WHERE id LIKE 'lv:%:' || ? OR id LIKE 'ab:%:' || ?", uuid, uuid);
  const bare = `${url.origin}${url.pathname}`.replace(/\/(apply|application)\/?$/, '');
  return one('SELECT * FROM jobs WHERE url LIKE ? || \'%\' OR apply_url LIKE ? || \'%\'', bare, bare);
};
app.get('/api/ext/resume', async (c) => {
  const u = c.req.query('url') || '';
  let job = jobForUrl(u);
  if (!job) { // a job we haven't seen: read it, score it, keep it
    try {
      const j = await jobFromUrl(u.replace(/\/(apply|application)\/?(\?.*)?$/, ''));
      const { score: s, why } = score(j);
      db.prepare(`INSERT OR IGNORE INTO jobs (id, source, company, title, url, apply_url, apply_kind, location, remote, description, posted_at, found_at, score, score_why)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(j.id, 'extension', j.company, j.title, j.url, j.apply_url, j.apply_kind, j.location, j.remote, j.description, j.posted_at, new Date().toISOString(), s, why);
      job = one('SELECT * FROM jobs WHERE id = ?', j.id);
    } catch {}
  }
  let path = BASE_PDF, label = 'original resume';
  if (job) {
    const cached = `data/resumes/${job.id.replace(/[^a-z0-9]+/gi, '_')}.pdf`;
    try { readFileSync(cached); path = cached; label = `tailored: ${angleFor(job.title)[2]}`; } catch {
      const cv = await tailor(job).catch(() => null);
      if (cv?.tailored) { path = cv.path; label = `tailored: ${cv.role}`; }
    }
  }
  return c.json({ job: job ? { id: job.id, company: job.company, title: job.title.trim(), score: job.score } : null, resume: label, pdf: readFileSync(path).toString('base64') });
});
app.post('/api/ext/answer', async (c) => {
  const { label, value } = await c.req.json().catch(() => ({}));
  const v = String(value || '').trim().slice(0, 1000);
  if (!label || !v) return c.json({ error: 'label and value needed' }, 400);
  const A = JSON.parse(readFileSync('config/answers.json', 'utf8'));
  (A.custom ||= {})[normQ(label)] = v;
  writeFileSync('config/answers.json', JSON.stringify(A, null, 2) + '\n');
  log('ext:answer', label.slice(0, 80));
  return c.json({ ok: true });
});
app.post('/api/ext/applied', async (c) => {
  const { url } = await c.req.json().catch(() => ({}));
  const job = jobForUrl(url || '');
  if (!job) return c.json({ ok: false });
  db.prepare('INSERT INTO applications (job_id, method, sent_at, state, detail) VALUES (?, ?, ?, ?, ?)').run(job.id, job.apply_kind, new Date().toISOString(), 'submitted', JSON.stringify({ via: 'Fill my application (your Chrome)', url }));
  db.prepare("UPDATE jobs SET status = 'applied' WHERE id = ?").run(job.id);
  log('ext:applied', job.id);
  return c.json({ ok: true, job: job.id });
});
app.get('/', (c) => c.html(readFileSync('public/index.html', 'utf8'), 200, { 'Cache-Control': 'no-store' }));

const port = +(process.env.PORT || 3000);
serve({ fetch: app.fetch, port, hostname: process.env.HOST || '127.0.0.1' });
console.log(`dashboard on http://localhost:${port}`);
