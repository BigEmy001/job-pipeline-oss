// Can we log in? IMAP (read replies) and SMTP (send), without sending anything.
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
process.loadEnvFile?.('.env');
const { MAIL_HOST, MAIL_USER, MAIL_PASSWORD } = process.env;

const imap = new ImapFlow({ host: MAIL_HOST, port: 993, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASSWORD }, logger: false });
try {
  await imap.connect();
  const box = await imap.mailboxOpen('INBOX');
  console.log(`IMAP ok: INBOX has ${box.exists} messages`);
  const list = await imap.list();
  console.log('folders:', list.map((f) => f.path).join(', '));
  await imap.logout();
} catch (e) { console.log('IMAP failed:', e.responseText || e.message); }

const smtp = nodemailer.createTransport({ host: MAIL_HOST, port: 465, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASSWORD } });
try { await smtp.verify(); console.log('SMTP ok: ready to send as', process.env.MAIL_FROM); } catch (e) { console.log('SMTP failed:', e.message); }
