// Lists a job application form's fields: label, type, name, required, options. For building fillers.
import { chromium } from 'playwright';
process.loadEnvFile('.env');
const url = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
const fields = await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (el.type === 'hidden') continue;
    const id = el.id;
    let label = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText) || el.closest('label')?.innerText || el.getAttribute('aria-label') || el.placeholder || '';
    if (!label) { const f = el.closest('.field, .application-question, [class*="field"], fieldset'); label = f?.querySelector('label, legend, .application-label')?.innerText || ''; }
    out.push({ tag: el.tagName.toLowerCase(), type: el.type, name: el.name, id, label: label.trim().replace(/\s+/g, ' ').slice(0, 90), required: el.required || el.getAttribute('aria-required') === 'true', options: el.tagName === 'SELECT' ? [...el.options].map((o) => o.text).slice(0, 8) : undefined });
  }
  return out;
});
for (const f of fields) console.log(JSON.stringify(f));
console.log('captcha:', await p.evaluate(() => !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, script[src*="recaptcha"]')));
await b.close();
