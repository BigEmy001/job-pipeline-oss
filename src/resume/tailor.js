// A resume shaped to one job, from your real one (config/resume.html, see config/resume.example.html). Nothing
// is invented: the headline leads with the role being hired, the summary opens on the matching side,
// and bullets, selected work and skill groups are reordered so what this job asks for comes first.
// If the result would spill past one page, the original resume is used instead.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

process.loadEnvFile?.('.env');
const SRC = process.env.RESUME_HTML || 'config/resume.html';
const P = JSON.parse(readFileSync('config/profile.json', 'utf8'));
export const BASE_PDF = P.resume_pdf || 'config/resume.pdf';
// the file name employers see
export const CV_NAME = `${(P.name || 'Resume').replace(/\s+/g, '-')}-CV.pdf`;

// Which side of you this job wants: the headline, and (optionally) a new first sentence for the
// summary. Set your own in profile.json → angles: [["regex", "key", "headline", "opener or null"]].
// Keep every opener true. These defaults suit a product designer who also builds.
const DEFAULT_ANGLES = [
  [/design engineer|ui engineer|ux engineer|design technologist|front-?end|applied ai|ai engineer|agent(ic)? engineer/i, 'engineer', 'Design Engineer · Product Designer (UI/UX)',
    null],
  [/ui\s*\/?\s*ux|ux\s*\/?\s*ui|ui designer|ux designer|visual designer|interaction designer/i, 'ui', 'UI/UX Designer · Product Designer',
    null],
  [/web designer|webflow/i, 'web', 'Web Designer · Product Designer (UI/UX)',
    null],
  [/./, 'product', 'Product Designer (UI/UX) · Design Engineer', null],
];
const ANGLES = P.angles ? P.angles.map(([re, ...rest]) => [new RegExp(re, 'i'), ...rest]) : DEFAULT_ANGLES;
export const angleFor = (title) => ANGLES.find(([re]) => re.test(title)) || [/./, 'general', null, null];

// words that tie a line of the resume to a job; each counts once per job
const TOPICS = {
  fintech: /fintech|payments?|wallet|banking|stablecoin|crypto|usdc|usdt|money|finance/i,
  mobility: /mobility|ride|rides|delivery|logistics|transport|fleet|map/i,
  food: /food|restaurant|kitchen|order/i,
  commerce: /e-?commerce|commerce|marketplace|store|checkout|seller|vendor|merchant|retail/i,
  dashboard: /dashboard|admin|internal tool|operations|b2b|saas|analytics|data/i,
  research: /user research|usability|research|testing|interview/i,
  system: /design system|component|tokens|consisten/i,
  react: /react|front-?end|frontend|javascript|typescript|tailwind|html|css|code|engineer/i,
  ai: /\bai\b|llm|machine learning|gpt|claude|prompt/i,
  motion: /motion|animation|animate|video|prototype/i,
  web: /website|landing|marketing site|webflow|responsive|web/i,
  mobile: /mobile|ios|android|app\b/i,
  brand: /brand|visual|marketing|social/i,
};
export const topicsOf = (text) => Object.keys(TOPICS).filter((k) => TOPICS[k].test(text));

export async function tailor(job, browser) {
  const own = !browser;
  browser ||= await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
  const want = topicsOf(`${job.title} ${(job.description || '').slice(0, 8000)}`);
  const [, angle, role, opener] = angleFor(job.title);
  const page = await browser.newPage();
  try {
    await page.setContent(readFileSync(SRC, 'utf8'), { waitUntil: 'networkidle' });
    const fits = await page.evaluate(({ want, angle, role, opener, TOPICS }) => {
      const re = Object.fromEntries(Object.entries(TOPICS).map(([k, s]) => [k, new RegExp(s, 'i')]));
      const score = (el) => want.filter((k) => re[k].test(el.textContent)).length;
      const sortKids = (parent, sel) => {
        const kids = [...parent.querySelectorAll(`:scope > ${sel}`)];
        kids.map((el, i) => [el, score(el), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).forEach(([el]) => parent.append(el));
      };
      document.documentElement.style.background = document.body.style.background = '#fff';
      if (role) document.querySelector('.role').textContent = role;
      if (opener) {
        const p = document.querySelector('.summary');
        p.textContent = p.textContent.replace(/^[^.]*\./, opener); // the summary's first sentence
      }
      document.querySelectorAll('main .item ul').forEach((ul) => sortKids(ul, 'li'));
      const work = document.querySelector('ul.work'); if (work) sortKids(work, 'li');
      if (angle === 'engineer') { // Build before Design
        const [design, build] = [...document.querySelectorAll('aside section')].filter((s) => /^(Design|Build)$/.test(s.querySelector('h4')?.textContent.trim()));
        if (design && build) design.before(build);
      }
      const main = document.querySelector('main'), side = document.querySelector('aside');
      return main.scrollHeight <= main.clientHeight + 1 && side.scrollHeight <= side.clientHeight + 1;
    }, { want, angle, role, opener, TOPICS: Object.fromEntries(Object.entries(TOPICS).map(([k, r]) => [k, r.source])) });
    if (!fits) return { path: BASE_PDF, tailored: false, why: 'tailored version ran past one page' };
    mkdirSync('data/resumes', { recursive: true });
    const path = `data/resumes/${job.id.replace(/[^a-z0-9]+/gi, '_')}.pdf`;
    await page.pdf({ path, format: 'A4', printBackground: true, preferCSSPageSize: true });
    return { path, tailored: true, angle, role, focus: want };
  } finally {
    await page.close();
    if (own) await browser.close();
  }
}
