// Read DMARC aggregate reports (the "Report domain: … Submitter: …" emails) and print, per sending
// IP, how many messages passed or failed SPF and DKIM. node scripts/dmarc.js [days]
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { gunzipSync, inflateRawSync } from 'node:zlib';
process.loadEnvFile?.('.env');
const { MAIL_HOST, MAIL_USER, MAIL_PASSWORD } = process.env;

// a zip with one file: read the local header and inflate it
const unzip = (b) => { const n = b.readUInt16LE(26), x = b.readUInt16LE(28), size = b.readUInt32LE(18); const data = b.subarray(30 + n + x, 30 + n + x + size); return b.readUInt16LE(8) === 8 ? inflateRawSync(data) : data; };
const tag = (xml, t) => [...xml.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'))].map((m) => m[1]);

const imap = new ImapFlow({ host: MAIL_HOST, port: 993, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASSWORD }, logger: false });
await imap.connect();
for (const box of ['INBOX', 'Junk', 'Spam']) {
  let lock; try { lock = await imap.getMailboxLock(box); } catch { continue; }
  try {
    const uids = await imap.search({ subject: 'Report domain', since: new Date(Date.now() - (Number(process.argv[2]) || 14) * 864e5) }, { uid: true });
    for await (const m of uids.length ? imap.fetch(uids, { uid: true, source: true }, { uid: true }) : []) {
      const mail = await simpleParser(m.source);
      for (const a of mail.attachments) {
        const xml = (/\.gz$/i.test(a.filename) ? gunzipSync(a.content) : /\.zip$/i.test(a.filename) ? unzip(a.content) : a.content).toString();
        const [org] = tag(xml, 'org_name'), [b] = tag(xml, 'begin'), [e] = tag(xml, 'end');
        console.log(`== ${org} · ${new Date(b * 1000).toISOString().slice(0, 10)} to ${new Date(e * 1000).toISOString().slice(0, 10)} · policy p=${tag(xml, 'p')[0]}`);
        for (const r of tag(xml, 'record')) {
          const ip = tag(r, 'source_ip')[0], n = tag(r, 'count')[0], [dkim, spf] = [tag(tag(r, 'policy_evaluated')[0], 'dkim')[0], tag(tag(r, 'policy_evaluated')[0], 'spf')[0]];
          console.log(`  ${ip.padEnd(16)} ${String(n).padStart(4)} msgs · DKIM ${dkim} · SPF ${spf} · from ${tag(r, 'header_from')[0]}`);
        }
      }
    }
  } finally { lock.release(); }
}
await imap.logout();
