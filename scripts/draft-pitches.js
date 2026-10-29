// Drafts pitches for warm and hot leads: each site is checked in a real phone-sized browser first,
// and only real, current problems are written up. Nothing is sent: drafts wait on the Pitches page.
// node scripts/draft-pitches.js [max]
process.loadEnvFile('.env');
const { db } = await import('../src/db.js');
const { draftPitch } = await import('../src/leads/pitch.js');
const max = +(process.argv[2] || 40);
const leads = db.prepare("SELECT id, name, niche, city, email FROM leads WHERE status = 'new' AND tier IN ('hot', 'warm') AND email IS NOT NULL AND email != '' ORDER BY score DESC LIMIT ?").all(max);
let ok = 0;
for (const l of leads) {
  const r = await draftPitch(l.id).catch((e) => ({ error: e.message }));
  if (r.ok) ok++;
  console.log(`${r.ok ? 'DRAFTED' : 'skipped'}  ${l.name.slice(0, 34).padEnd(34)} ${l.niche.padEnd(10)} ${l.city.padEnd(10)} ${r.ok ? r.subject : r.error}`);
}
console.log(`\n${ok} drafts from ${leads.length} leads`);
process.exit(0);
