// Lead score, the way an agency SDR scores: Need (40) + Value (30) + Reach (20) + Timing (10).
import { NICHES } from './discover.js';

const SEVERE = /not built for phones|no HTTPS|table\/font|Flash|WordPress \d|jQuery|© 20(0|1)/;

export function scoreLead(l, a) {
  if (a.dead) return { score: 0, tier: 'skip', why: a.issues[0] };
  if (l.brand) return { score: 0, tier: 'skip', why: `chain (${l.brand}): corporate site` };
  const why = [];
  // Need: what is wrong with the site, the severe things counting double
  const severe = a.issues.filter((i) => SEVERE.test(i)).length;
  const need = Math.min(40, severe * 11 + (a.issues.length - severe) * 5);
  // Value: what a client is worth in the niche, plus signs of a real operation
  const ticket = NICHES[l.niche].ticket;
  let value = ticket >= 8000 ? 20 : ticket >= 4000 ? 16 : ticket >= 2500 ? 12 : 9;
  if (a.team) value += 5;
  if (a.locations === 'multiple') value += 5;
  value = Math.min(30, value);
  // Reach: a public way in
  const reach = (a.email ? 12 : 0) + (l.phone || /tap-to-call/.test(a.good.join()) ? 4 : 0) + (a.form ? 4 : 0);
  // Timing: alive but neglected; hiring means growing
  let timing = 0;
  if (a.hiring) { timing += 5; why.push('hiring'); }
  if (a.copyright && a.copyright <= new Date().getFullYear() - 4) timing += 5;
  const score = Math.min(100, need + value + reach + timing);
  if (!a.email && !a.form) return { score, tier: 'skip', why: 'no public contact' };
  const tier = score >= 70 ? 'hot' : score >= 50 ? 'warm' : 'cold';
  return { score, tier, why: [...a.issues.slice(0, 3), ...why].join('; '), parts: { need, value, reach, timing } };
}
