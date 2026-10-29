// Fills a job application form by reading each field's label, the way a person would. Works on
// Greenhouse, Lever and Ashby (and most simple forms). Unknown required questions are returned so
// they can go to Claude (when its key is set) or to the "Needs you" queue. Submitting is run.js's job.
import { readFileSync } from 'node:fs';
const A = JSON.parse(readFileSync('config/answers.json', 'utf8'));
const ok = (v) => v && !/EDIT ME/.test(v);

// label pattern -> answer key (first match wins; order matters)
export const RULES = [
  [/first name|given name/i, 'first_name'],
  [/last name|surname|family name/i, 'last_name'],
  [/^(full )?name\b|your name|legal name/i, 'full_name'],
  [/id for the selected messenger|messenger (id|handle|number)|whatsapp (number|id)|telegram (handle|id)/i, 'messenger_id'],
  [/preferred messenger|which messenger/i, 'messenger'],
  [/english (proficiency|level)|level of english/i, 'english'],
  [/e-?mail/i, 'email'],
  [/phone|mobile/i, 'phone'],
  [/linkedin/i, 'linkedin'],
  [/portfolio|case stud|work samples?|dribbble|behance/i, 'portfolio'],
  [/figma/i, 'figma'],
  [/twitter|\bx\.com\b|\bx (profile|handle|account)\b/i, 'x'],
  [/website|personal site|url|github/i, 'website'],
  [/^country|country of residence|which country/i, 'country'],
  [/city|location|where are you (based|located)|current address/i, 'location'],
  [/time ?zone/i, 'timezone'],
  [/current (job )?title|current role|position/i, 'current_title'],
  [/years of (professional )?experience|how many years/i, 'years_experience'],
  [/how did you (hear|find)|source|referr/i, 'how_heard'],
  [/sponsor/i, 'needs_sponsorship'],
  [/(authori[sz]ed|eligible|right) to work in the country (in which|where) you (are|currently|live|reside)|country (of|where you have) (residence|citizenship)|domiciled/i, 'authorized_home'],
  [/authori[sz]ed to work in the (us|united states)|legally (authorized|eligible) to work in the (us|united states)/i, 'authorized_us'],
  [/authori[sz]ed|eligible to work|right to work|work permit/i, 'authorized_generic'],
  [/previously (been )?(employed|worked)|worked (for|at) .* before|former employee/i, 'previously_employed'],
  [/relocat/i, 'relocate'],
  [/remote/i, 'remote_ok'],
  [/notice period/i, 'notice_period'],
  [/start date|when can you start|available to start/i, 'start_date'],
  [/salary|compensation|pay expectation|rate/i, 'salary_expectation'],
  [/gender/i, 'gender'],
  [/race|ethnic/i, 'race'],
  [/veteran/i, 'veteran'],
  [/disabilit/i, 'disability'],
];
// answers you gave in the dashboard for exact questions ("Have you shipped React Native…?")
export const normQ = (s = '') => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const answerFor = (label) => {
  const own = A.custom?.[normQ(label)];
  if (own) return { key: 'custom', value: own };
  for (const [re, key] of RULES) if (re.test(label)) return { key, value: A[key] }; return null;
};

export async function fillForm(page, resumePath) {
  const filled = [];
  const unknown = [];
  // the resume first (Greenhouse id="resume", Lever name="resume", Ashby: the first file input)
  const file = page.locator('input[type=file]#resume, input[type=file][name=resume], input[type=file]').first();
  if (await file.count()) { await file.setInputFiles(resumePath); filled.push('resume'); await page.waitForTimeout(1500); }

  const fields = await page.evaluate(() => {
    const out = [];
    let n = 0;
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (['hidden', 'file', 'submit', 'button', 'search'].includes(el.type) || el.name === 'g-recaptcha-response') continue;
      if (!el.offsetParent && el.type !== 'checkbox') continue;
      if (el.tabIndex === -1 && el.type !== 'checkbox') continue; // react-select's hidden 'required' helper
      const tag = `pf-${n++}`;
      el.setAttribute('data-pf', tag);
      const id = el.id;
      let label = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText) || el.getAttribute('aria-label') || '';
      if (!label) { const f = el.closest('.field, .application-question, .application-field, [class*="field"], [class*="Field"], fieldset, li'); label = f?.querySelector('label, legend, .application-label, [class*="label"]')?.innerText || el.closest('label')?.innerText || el.placeholder || ''; }
      const combo = el.getAttribute('role') === 'combobox' || el.closest('[class*="select__"]') !== null;
      out.push({ tag, kind: el.tagName.toLowerCase(), type: el.type, label: label.trim().replace(/\s+/g, ' ').replace(/\*$/, '').slice(0, 160), required: el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label.trim()), combo, value: el.value });
    }
    return out;
  });

  for (const f of fields) {
    const sel = `[data-pf="${f.tag}"]`;
    if (f.value && f.type !== 'checkbox') continue; // already filled (e.g. by the resume parser)
    if (f.type === 'checkbox') {
      if (/consent|agree|acknowledge|privacy|terms|confirm|certify/i.test(f.label) && f.required) {
        await page.check(sel, { force: true }).catch(() => {});
        if (!(await page.isChecked(sel).catch(() => false))) await page.locator(sel).evaluate((e) => e.click());
        if (await page.isChecked(sel).catch(() => false)) filled.push(`✓ ${f.label.slice(0, 50)}`); else unknown.push({ label: f.label, key: 'consent' });
      }
      continue;
    }
    if (/consent/i.test(f.label) && f.combo) {
      try { const got = await pick(page, sel, 'Yes'); filled.push(`${f.label.slice(0, 40)} = ${got.slice(0, 40)}`); } catch (e) { if (f.required) unknown.push({ label: f.label, key: 'consent', error: e.message.slice(0, 100) }); }
      continue;
    }
    const a = answerFor(f.label);
    if (!a && f.combo && f.required) { // a privacy notice or similar: acknowledge it, but only when that's what the options are
      const got = await pickConsent(page, sel);
      if (got) { filled.push(`${f.label.slice(0, 40)} = ${got.slice(0, 40)}`); continue; }
    }
    if (!a || !ok(a.value)) { if (f.required) unknown.push({ label: f.label, key: a?.key || null }); continue; }
    try {
      if (f.combo) { const got = await pick(page, sel, a.value); filled.push(`${f.label.slice(0, 40)} = ${got.slice(0, 40)}`); continue; }
      else if (f.kind === 'select') await page.selectOption(sel, { label: a.value }); // no close match: it goes to Needs you, never a guess
      else await page.fill(sel, a.value);
      filled.push(`${f.label.slice(0, 40)} = ${a.value.slice(0, 40)}`);
    } catch (e) {
      if (f.required) unknown.push({ label: f.label, key: a.key, error: e.message.slice(0, 80) });
    }
  }
  return { filled, unknown };
}

/** A type-to-search dropdown (react-select and friends): open it, read its own options, take the best. */
const DECLINE = /decline|prefer not|not (to )?(say|answer|disclose)|don.?t wish|do not wish|rather not/i;
async function pick(page, sel, text) {
  const el = page.locator(sel);
  const id = await el.getAttribute('id');
  const optsOf = () => page.locator(id ? `[id^="react-select-${id}-option"], .select__option` : '.select__option, [role=listbox] [role=option]');
  await el.click({ force: true });
  await page.waitForTimeout(350);
  let opts = await optsOf().allInnerTexts();
  if (!opts.length || opts.length > 40) {
    await el.type(text.split(/[,(]/)[0].trim(), { delay: 40 });
    for (let t = 0; t < 25; t++) { await page.waitForTimeout(400); opts = await optsOf().allInnerTexts(); if (opts.length && !/loading|searching/i.test(opts[0])) break; } // search-as-you-type lists load async
  }
  const want = text.toLowerCase();
  const norm = opts.map((o) => o.trim().toLowerCase());
  let i = norm.indexOf(want);
  if (i < 0) i = norm.findIndex((o) => o.startsWith(want) || want.startsWith(o));
  if (i < 0 && DECLINE.test(text)) i = norm.findIndex((o) => DECLINE.test(o));
  if (i < 0 && /^yes$/i.test(text)) i = norm.findIndex((o) => /^(yes|i (consent|agree|accept|confirm))|\b(consent|agree|accept)\b/.test(o));
  if (i < 0) i = norm.findIndex((o) => o.includes(want));
  if (i < 0) { await el.press('Escape'); throw new Error(`no option like "${text}" in [${opts.slice(0, 6).join(' | ')}]`); }
  await optsOf().nth(i).click();
  return opts[i];
}

/** Required dropdowns with no matching rule: acknowledge a notice only when the options are
 *  acknowledgements ("Acknowledge/Confirm", "I agree", "I consent") and not a real yes/no question. */
async function pickConsent(page, sel) {
  const el = page.locator(sel);
  const id = await el.getAttribute('id');
  const opts = page.locator(id ? `[id^="react-select-${id}-option"]` : '.select__option');
  await el.click({ force: true });
  await page.waitForTimeout(350);
  const texts = (await opts.allInnerTexts()).map((o) => o.trim());
  const i = texts.findIndex((o) => /acknowledge|i consent|consent|i agree|agree|accept|confirm/i.test(o) && !/^yes$|^no$/i.test(o));
  if (i < 0 || texts.some((o) => /^(yes|no)$/i.test(o))) { await el.press('Escape').catch(() => {}); return null; }
  await opts.nth(i).click();
  return texts[i];
}
