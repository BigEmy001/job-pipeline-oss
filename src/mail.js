// Sending mail. Every message goes out through Namecheap's SMTP and a copy of the exact same message
// is filed in the mailbox's Sent folder over IMAP, so it shows in webmail and on the phone like
// anything sent by hand (SMTP alone never saves a copy).
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { ImapFlow } from 'imapflow';

process.loadEnvFile?.('.env');
const { MAIL_HOST, MAIL_USER, MAIL_PASSWORD, MAIL_FROM } = process.env;
const smtp = nodemailer.createTransport({ host: MAIL_HOST, port: 465, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASSWORD } });

export async function send({ to, subject, text, html, replyTo = process.env.MAIL_REPLY_TO || process.env.MAIL_USER, headers, attachments }) {
  const mail = { from: MAIL_FROM, replyTo, to, subject, text, html, headers, attachments, date: new Date() };
  const raw = await new MailComposer(mail).compile().build();
  const info = await smtp.sendMail({ envelope: { from: MAIL_USER, to }, raw });
  let saved = false;
  const imap = new ImapFlow({ host: MAIL_HOST, port: 993, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASSWORD }, logger: false });
  try {
    await imap.connect();
    const sent = (await imap.list()).find((b) => b.specialUse === '\\Sent')?.path || 'Sent';
    await imap.append(sent, raw, ['\\Seen']);
    saved = true;
  } catch (e) {
    console.error('sent, but the Sent copy failed:', e.message);
  } finally {
    await imap.logout().catch(() => {});
  }
  return { messageId: info.messageId, response: info.response, saved };
}
