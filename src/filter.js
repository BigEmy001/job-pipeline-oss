// Keep jobs that are the right kind of role and that someone where you live can actually take.
import { readFileSync } from 'node:fs';
const P = JSON.parse(readFileSync('config/profile.json', 'utf8'));

const has = (s, list) => list.some((w) => s.includes(w));
// companies you never want to see again (profile.json → avoid_companies)
export const companyOk = (j) => !(P.avoid_companies || []).some((c) => (j.company || '').toLowerCase().includes(c.toLowerCase()));
export const roleOk = (title) => {
  const t = ` ${title.toLowerCase()} `;
  return has(t, P.roles.include) && !has(t, P.roles.exclude);
};

// Where you live (profile.json → home_keywords, e.g. ["nigeria", "lagos", "africa"]): a remote role is open to you
// only when its location says so (your country or city, a region you're in, worldwide)
// or names no place at all. Any other place named ("North America", "South Africa", "Qatar") means
// it isn't.
const HOME = new RegExp(`\\b(${(P.home_keywords || []).map((w) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '$^'})\\b`, 'i');
const OPEN = /\b(worldwide|world wide|anywhere|global|globally|any country|international|timezones?)\b/i; // add your region ("africa", "emea", "latam") to home_keywords
const NOISE = /\b(remote|hybrid|full[- ]?time|part[- ]?time|contract|flexible|first|friendly|only|based|or|and|in|the|work from home|wfh|distributed|on-?site|office|hq|\(|\)|\d+)\b/gi;
// "Remote but Boston based only", "must live in Austin": remote in name only
// "anywhere within US time zones", "must overlap PST": remote, but on US hours from the US
const US_HOURS = /within (the )?(us|u\.s\.|united states|north american?) time ?zones|us time ?zones \(gmt|(anywhere|work) (from anywhere )?(with)?in (the )?(us|u\.s\.|united states)\b/i;
const CITY_ONLY = /\b(based only|only consider(ing)? (candidates|applicants) (based )?in|must (live|be located|reside) (in|near) )/i;
const TZ_ONLY = /(cet|cest|gmt|utc|wat)\s*[±+\-]|european (time ?zones?|hours|working hours)|(time ?zone|hours) overlap with (europe|cet)|within (the )?european time ?zones?|\bemea time ?zones?\b/i;
const EU_ONLY = /\b(eu|european union|eea|schengen)\b[^.]{0,40}(citizen|work (permit|authori[sz]ation)|right to work|residen)|right to work in (the )?(eu|uk|europe)|must (be )?(based|located|reside|live) in (the )?(eu|europe|european union|uk)|based in (one of )?(the following|these) (eu )?countries/i;
const PINNED = /(must|need to|required to) (be )?(be )?(located|based|reside|live|authorized to work) in (the )?(us\b|u\.s\.?|united states\b|usa\b|canada\b|uk\b|united kingdom\b|europe\b|eu\b|latam\b|india\b)|us work authorization|authorized to work in the (us|united states)|within (the )?(us|united states|usa)\b|(est|pst|cst|et|pt) (time ?zone|hours)|overlap with (us|north american)/i;

export const placeOk = (j) => {
  const loc = (j.location || '').toLowerCase();
  const head = (j.description || '').slice(0, 5000).toLowerCase();
  if (HOME.test(loc)) return true;
  if (!j.remote && !/\bremote\b/.test(loc)) return false;
  if (PINNED.test(head) && !HOME.test(head) && !/worldwide|anywhere/.test(head)) return false;
  if (US_HOURS.test((j.description || '').slice(0, 12000))) return false;
  if (CITY_ONLY.test(`${j.location} ${head.slice(0, 2500)}`) && !HOME.test(head)) return false;
  if (OPEN.test(loc) || HOME.test(loc)) return true;
  // "Europe": open to you if you're in a European time zone (e.g. CET/WAT, UTC+1) when the post asks only for a time zone, not EU residence
  if (/\beurope\b|\bcet\b|\bcest\b|european time/.test(loc) && TZ_ONLY.test(head) && !EU_ONLY.test(head)) return true;
  const rest = loc.replace(NOISE, ' ').replace(/[·,\-|/]+/g, ' ').trim();
  return rest.length === 0; // "Remote" and nothing else
};

// Full-time only. A job is dropped when its type, title or the top of its description says it is
// contract, part-time, freelance, temporary or an internship, unless it also offers full-time.
const NOT_FULL = /\b(part[- ]?time|contract(or)?|freelance|temporary|temp|fixed[- ]term|intern(ship)?|hourly|per hour|1099|gig)\b|parttime/i;
const FULL = /full[- ]?time|fulltime|permanent/i;
export const fullTimeOk = (j) => {
  const head = `${j.type || ''} ${j.title} ${(j.description || '').slice(0, 600)}`;
  if (FULL.test(j.type || '')) return true;
  if (NOT_FULL.test(`${j.type || ''} ${j.title}`)) return FULL.test(head);
  if (/\b(this is a|is a|for a|seeking a|looking for a) (paid )?(part[- ]?time|contract|freelance|temporary)\b/i.test(head)) return false;
  // unpaid or part-time hours stated anywhere near the top: equity-only, unpaid, 10 hrs/week
  if (/equity[- ]only|unpaid|no salary|volunteer|\b\d{1,2}\+? ?(hrs?|hours) ?(\/|per|a) ?week/i.test((j.description || '').slice(0, 2500))) return false;
  return true;
};
