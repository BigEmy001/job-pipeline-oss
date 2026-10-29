// A first pass, by words: how well a job fits you. 0..100, with the reasons. The strongest
// matches get a second look by Claude before anything is sent (src/judge.js).
import { readFileSync } from 'node:fs';
const P = JSON.parse(readFileSync('config/profile.json', 'utf8'));

const TITLE = [
  [/founding design engineer/, 48, 'founding design engineer'],
  [/ai product designer|ai designer/, 48, 'AI product designer'],
  [/applied ai|ai agents? engineer|agent(ic)? engineer/, 42, 'applied AI / agent engineer'],
  [/\bai engineer/, 36, 'AI engineer'],
  [/product designer|product design\b/, 46, 'product designer'],
  [/ui\s*\/?\s*ux|ux\s*\/?\s*ui|ui designer|ux designer|user interface/, 44, 'UI/UX'],
  [/design engineer|ui engineer|ux engineer|design technologist/, 40, 'design engineer'],
  [/web designer|webflow|front-?end designer/, 36, 'web designer'],
  [/visual designer/, 34, 'visual/UI designer'],
  [/interaction designer/, 36, 'interaction designer'],
];

export function score(j) {
  const t = j.title.toLowerCase();
  const d = (j.description || '').toLowerCase();
  const why = [];
  let s = 0;
  for (const [re, pts, name] of TITLE) if (re.test(t)) { s = pts; why.push(name); break; }
  const skills = P.skills.filter((k) => d.includes(k));
  s += Math.min(34, skills.length * 4);
  if (skills.length) why.push(`skills: ${skills.slice(0, 6).join(', ')}`);
  // seniority: 4 years in. Senior is a stretch worth trying; lead and staff mostly aren't
  const yrs = [...d.matchAll(/(\d{1,2})\+?\s*(?:-\s*\d+\s*)?years?/g)].map((m) => +m[1]).filter((n) => n > 0 && n < 20);
  const need = yrs.length ? Math.min(...yrs) : null;
  if (need !== null && need > 6) { s -= 18; why.push(`asks ${need}+ yrs`); } else if (need !== null && need <= 5) { s += 6; why.push(`${need}+ yrs fits`); }
  if (/\b(lead|staff)\b/.test(t)) { s -= 10; why.push('lead/staff title'); }
  if (/\b(junior|associate|mid)\b/.test(t)) { s += 4; }
  const home = (P.home_keywords || []).map((w) => w.toLowerCase());
  if (home.length && home.some((w) => `${j.location} ${d.slice(0, 2000)}`.toLowerCase().includes(w))) { s += 8; why.push('near home'); }
  if (/worldwide|anywhere|global/.test((j.location || '').toLowerCase())) { s += 6; why.push('worldwide'); }
  const age = j.posted_at ? (Date.now() - new Date(j.posted_at)) / 864e5 : 30;
  if (age < 7) { s += 6; why.push('new this week'); } else if (age > 45) { s -= 10; why.push('older post'); }
  return { score: Math.max(0, Math.min(100, Math.round(s))), why: why.join(' · ') };
}
