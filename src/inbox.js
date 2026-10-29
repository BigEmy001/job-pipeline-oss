// Reads replies in your mailbox (MAIL_USER, and its aliases) and sorts them: interview, rejection, portal
// (finish an assessment or apply on their system), received (an automatic "thanks for applying")
// or other. Each reply is tied to the job or the lead it's about, the job's status follows the
// reply, and anyone asking not to be emailed again is added to the opt-out list for good.
import { ALERT_FROM, addAlertJobs } from './alerts.js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db, log } from './db.js';
process.loadEnvFile?.('.env');

try { db.exec('ALTER TABLE messages ADD COLUMN lead_id TEXT'); } catch {}
const { MAIL_HOST, MAIL_USER, MAIL_PASSWORD } = process.env;
const DAYS = +(process.argv[2] || 30);

const KINDS = [
  ['optout', /\b(unsubscribe me|remove me|stop emailing|don.?t (email|contact) me|not interested,? (please )?stop|take me off)\b/i],
  ['rejection', /unfortunately|not (be )?(moving|proceeding) forward|decided (not )?to (move|pursue|proceed)|other candidates|not (the right )?(a )?(fit|match)|position has (been )?(filled|closed)|regret to|no longer (being )?consider|will not be (moving|progressing)/i],
  ['interview', /schedul(e|ing) (a|an|your)? ?(call|chat|interview|time)|availability|calendly\.com|cal\.com|book (a )?time|(phone|video|intro|screening) (call|interview|chat)|(would|we.?d) (love|like) to (chat|talk|speak|meet)|next (step|round) (is|will be) (a|an) (call|interview|chat)|invite you to (an )?interview/i],
  ['portal', /assessment|take[- ]home|complete (your|the|our) (application|profile|questionnaire)|create an account|candidate portal|online test|hackerrank|codility|testgorilla|coderbyte|questionnaire|apply (on|through|via) our (site|portal|careers)/i],
  ['received', /(received|receipt of) your application|thank(s| you) for (applying|your application|your interest)|application (was|has been) (received|submitted)/i],
];
// "Thanks for applying, we've received it" emails often mention, in passing, what happens to people
// they don't move forward with. Only a definite no counts as a rejection.
// "unfortunately our emails sometimes land in spam" is not a no: unfortunately counts only with a no in the same sentence
const DEFINITE_NO = /unfortunately[^.]{0,120}\b(not|other candidates|unable|filled|closed)\b|regret to|decided (not )?to (move|pursue|proceed) with (other|another)|will not be (moving|progressing)|not (be )?moving forward with your|position has (been )?(filled|closed)/i;
const CODE = /security code for your application|verification code|enter the \d+-character code/i;
export const classify = (text) => {
  if (CODE.test(text)) return 'code';
  const k = KINDS.find(([, re]) => re.test(text))?.[0] || 'other';
  if (k === 'rejection' && !DEFINITE_NO.test(text) && KINDS.find(([n]) => n === 'received')[1].test(text)) return 'received';
  return k;
};

const linkFor = (kind, html, text) => {
  const links = [...`${html || ''} ${text || ''}`.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0].replace(/&amp;/g, '&'));
  const good = links.filter((l) => !/unsubscribe|preferences|privacy|linkedin\.com\/(company|in)|facebook|twitter|x\.com|instagram|\.(png|jpe?g|gif)(\?|$)|list-manage|mailchimp/i.test(l));
  const want = kind === 'interview' ? /calendly|cal\.com|meet|zoom|schedule|book|goodtime|interview/i : /assessment|portal|candidate|apply|application|careers|hackerrank|codility|testgorilla|coderbyte|greenhouse|lever|ashby|workable/i;
  return good.find((l) => want.test(l)) || null;
};

const norm = (s = '') => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
const jobs = db.prepare("SELECT id, company, title, apply_url, url FROM jobs WHERE status IN ('applied', 'needs_you', 'ready', 'applying', 'queued') OR id IN (SELECT job_id FROM applications)").all();
const leads = db.prepare("SELECT id, name, email, final_url, website FROM leads WHERE status IN ('drafted', 'sent', 'replied')").all();
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function matchJob(from, subject, text) {
  const dom = (from.split('@')[1] || '').toLowerCase();
  const hay = ` ${norm(`${from} ${subject} ${text.slice(0, 4000)}`)} `;
  let best = null;
  for (const j of jobs) {
    const c = norm(j.company).trim();
    if (c.length < 3) continue;
    let s = 0;
    if (dom.replace(/\.(com|io|co|ai|org|net|app)$/, '').replace(/[^a-z0-9]/g, '') === c.replace(/ /g, '')) s += 3; // replies from the company's own domain
    if (hay.includes(` ${c} `)) s += 2;
    if (hay.includes(` ${norm(j.title).trim()} `)) s += 2;
    if (s > (best?.s || 1)) best = { id: j.id, s };
  }
  return best?.id || null;
}
const matchLead = (from) => {
  const addr = from.toLowerCase(), dom = addr.split('@')[1] || '';
  return leads.find((l) => (l.email && l.email.toLowerCase() === addr) || (dom && [host(l.final_url), host(l.website)].includes(dom)))?.id || null;
};

const imap = new ImapFlow({ host: MAIL_HOST, port: 993, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASSWORD }, logger: false });
await imap.connect();
const lock = await imap.getMailboxLock('INBOX');
const counts = {};
try {
  const uids = await imap.search({ since: new Date(Date.now() - DAYS * 864e5) }, { uid: true });
  const ins = db.prepare('INSERT OR IGNORE INTO messages (id, job_id, lead_id, received_at, from_addr, subject, snippet, kind, portal_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for await (const m of uids.length ? imap.fetch(uids, { uid: true, source: true }, { uid: true }) : []) { // source is fetched with PEEK: nothing gets marked read
    const mail = await simpleParser(m.source);
    const from = (mail.from?.value?.[0]?.address || '').toLowerCase();
    if (!from || from.endsWith('@' + (MAIL_USER || '').split('@')[1])) continue; // our own mail and tests
    const id = mail.messageId || `uid:${m.uid}`;
    if (db.prepare('SELECT 1 FROM messages WHERE id = ?').get(id)) continue;
    const text = (mail.text || '').replace(/\s+/g, ' ').trim();
    const subject = mail.subject || '';
    // A bounce: the pitch never arrived, so mark it and never email that address again
    if (/mailer-daemon|postmaster/.test(from)) {
      const to = (mail.text || '').match(/Final-Recipient:\s*rfc822;\s*(\S+)/i)?.[1] || (mail.text || '').match(/<([^>\s]+@[^>\s]+)>/)?.[1];
      if (to && db.prepare("UPDATE pitches SET state = 'bounced' WHERE lower(to_addr) = ? AND state = 'sent'").run(to.toLowerCase()).changes) {
        db.prepare('INSERT OR IGNORE INTO optouts (email, at) VALUES (?, ?)').run(to.toLowerCase(), new Date().toISOString());
        ins.run(id, null, null, (mail.date || new Date()).toISOString(), from, subject, `bounced: ${to}`, 'bounce', null);
        counts.bounce = (counts.bounce || 0) + 1;
        console.log(`bounce     ${to}`);
      }
      continue;
    }
    // Glassdoor / Indeed / LinkedIn job alerts: the jobs in them go on the Jobs page
    if (ALERT_FROM.test(from) && /job|alert|match|recommend/i.test(subject)) {
      const n = await addAlertJobs(from, mail.html || '');
      ins.run(id, null, null, (mail.date || new Date()).toISOString(), from, subject, `${n} new jobs from this alert`, 'alert', null);
      counts.alert = (counts.alert || 0) + n;
      console.log(`alert      ${from.padEnd(34)} ${n} new jobs`);
      continue;
    }
    const lead = matchLead(from);
    const job = lead ? null : matchJob(from, subject, text);
    let kind = classify(`${subject} ${text.slice(0, 6000)}`);
    if (!job && !lead && kind !== 'optout') continue; // not about a job or a pitch: leave it alone
    if (lead && kind !== 'optout') kind = 'lead_reply';
    const portal = ['portal', 'interview'].includes(kind) ? linkFor(kind, mail.html, mail.text) : null;
    ins.run(id, job, lead, (mail.date || new Date()).toISOString(), mail.from?.text || from, subject, text.slice(0, 300), kind, portal);
    counts[kind] = (counts[kind] || 0) + 1;
    if (kind === 'optout') {
      db.prepare('INSERT OR IGNORE INTO optouts (email, at) VALUES (?, ?)').run(from, new Date().toISOString());
      if (lead) db.prepare("UPDATE leads SET status = 'unsubscribed' WHERE id = ?").run(lead);
    }
    if (lead && kind === 'lead_reply') db.prepare("UPDATE leads SET status = 'replied' WHERE id = ?").run(lead);
    if (job && kind === 'rejection') db.prepare("UPDATE jobs SET status = 'closed' WHERE id = ?").run(job);
    if (job && ['interview', 'portal'].includes(kind)) db.prepare("UPDATE jobs SET status = 'applied' WHERE id = ? AND status != 'applied'").run(job);
    console.log(`${kind.padEnd(10)} ${from.padEnd(34)} ${subject.slice(0, 60)}${job ? `  → ${job}` : lead ? `  → lead ${lead}` : ''}`);
  }
} finally {
  lock.release();
  await imap.logout();
}
log('inbox', counts);
console.log(Object.keys(counts).length ? counts : 'no new replies about jobs or pitches');
