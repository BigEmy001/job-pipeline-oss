// Which addresses bounced? Reads delivery-failure notices (read-only) and prints the failed recipient and reason.
import { ImapFlow } from 'imapflow';
process.loadEnvFile?.('.env');
const { MAIL_HOST, MAIL_USER, MAIL_PASSWORD } = process.env;
const imap = new ImapFlow({ host: MAIL_HOST, port: 993, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASSWORD }, logger: false });
await imap.connect();
await imap.mailboxOpen('INBOX');
const uids = await imap.search({ from: 'mailer-daemon' });
for await (const m of imap.fetch(uids, { source: true, envelope: true })) {
  const s = m.source.toString();
  const to = s.match(/Final-Recipient:\s*rfc822;\s*(\S+)/i)?.[1] || s.match(/<([^>\s]+@[^>\s]+)>:?\s/)?.[1];
  const why = s.match(/Diagnostic-Code:\s*([^\n]+(?:\n\s+[^\n]+)*)/i)?.[1].replace(/\s+/g, ' ').slice(0, 160);
  console.log(m.envelope.date.toISOString().slice(0, 16), to, '|', why);
}
await imap.logout();
