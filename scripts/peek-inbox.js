import { ImapFlow } from 'imapflow';
process.loadEnvFile?.('.env');
const { MAIL_HOST, MAIL_USER, MAIL_PASSWORD } = process.env;
const imap = new ImapFlow({ host: MAIL_HOST, port: 993, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASSWORD }, logger: false });
await imap.connect();
for (const box of ['INBOX', 'Junk', 'Spam']) {
  try { await imap.mailboxOpen(box); } catch { continue; }
  const since = new Date(Date.now() - 4 * 864e5);
  const uids = await imap.search({ since });
  console.log(`== ${box}: ${uids.length} since ${since.toISOString().slice(0,10)}`);
  for await (const m of imap.fetch(uids, { envelope: true })) {
    const f = m.envelope.from?.[0];
    console.log(m.envelope.date.toISOString().slice(0,16), '|', f?.name || '', `<${f?.address}>`, '|', m.envelope.subject);
  }
}
await imap.logout();
