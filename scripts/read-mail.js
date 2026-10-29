// Print the text of recent emails whose subject matches: node scripts/read-mail.js "<subject words>" [days]
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
process.loadEnvFile?.('.env');
const { MAIL_HOST, MAIL_USER, MAIL_PASSWORD } = process.env;
const imap = new ImapFlow({ host: MAIL_HOST, port: 993, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASSWORD }, logger: false });
await imap.connect();
const lock = await imap.getMailboxLock('INBOX');
try {
  const uids = await imap.search({ subject: process.argv[2], since: new Date(Date.now() - (Number(process.argv[3]) || 2) * 864e5) }, { uid: true });
  for await (const m of uids.length ? imap.fetch(uids, { uid: true, source: true }, { uid: true }) : []) {
    const mail = await simpleParser(m.source);
    console.log(`== ${mail.date?.toISOString()} ${mail.subject}\n${(mail.text || '').replace(/\n{2,}/g, '\n').slice(0, 1500)}\n`);
  }
} finally { lock.release(); await imap.logout(); }
