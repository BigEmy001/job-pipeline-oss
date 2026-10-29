// The form filler, inside the page. Same rules and answers as the pipeline (it asks the dashboard
// for them), so the extension and the autopilot never disagree. It reads each question's label
// the way a person would, answers only with true saved answers, attaches the tailored resume,
// outlines the questions it couldn't answer, and never presses Submit.
(() => {
  if (window.JobFill) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const normQ = (s = '') => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const clean = (s = '') => s.replace(/\s+/g, ' ').replace(/\*\s*$/, '').trim().slice(0, 200);
  const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
  const DECLINE = /decline|prefer not|not (to )?(say|answer|disclose)|don.?t wish|do not wish|rather not/i;

  function labelOf(el) {
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (byFor) return clean(byFor.innerText);
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '); if (t.trim()) return clean(t); }
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    const box = el.closest('.field, .application-question, .application-field, [class*="field" i], [class*="question" i], fieldset, li');
    const t = box?.querySelector('label, legend, .application-label, [class*="label" i], [class*="title" i]')?.innerText || el.closest('label')?.innerText || el.placeholder || '';
    return clean(t);
  }
  const required = (el, label) => el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label) || !!el.closest('[class*="required" i]');

  function setValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function best(texts, want) {
    const w = want.toLowerCase().trim();
    const n = texts.map((o) => o.toLowerCase().trim());
    let i = n.indexOf(w);
    if (i < 0) i = n.findIndex((o) => o.startsWith(w) || w.startsWith(o));
    if (i < 0 && DECLINE.test(want)) i = n.findIndex((o) => DECLINE.test(o));
    if (i < 0 && /^yes$/i.test(want)) i = n.findIndex((o) => /^(yes|i (consent|agree|accept|confirm))|\b(consent|agree|accept)\b/.test(o));
    if (i < 0) i = n.findIndex((o) => o.includes(w));
    return i;
  }

  // react-select and other type-to-search dropdowns
  const comboOptions = (el) => {
    const ctl = el.getAttribute('aria-controls');
    const sel = el.id ? `[id^="react-select-${CSS.escape(el.id)}-option"]` : '';
    const list = [...document.querySelectorAll([sel, ctl ? `#${CSS.escape(ctl)} [role=option]` : '', '.select__option'].filter(Boolean).join(','))];
    return list.filter(visible);
  };
  async function pickCombo(el, want) {
    el.focus();
    (el.closest('[class*="control" i]') || el).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await sleep(300);
    let opts = comboOptions(el);
    if (!opts.length || opts.length > 40) {
      setValue(el, want.split(/[,(]/)[0].trim());
      for (let t = 0; t < 25; t++) { await sleep(400); opts = comboOptions(el); if (opts.length && !/loading|searching/i.test(opts[0].innerText)) break; } // location lists load slowly
    }
    const i = best(opts.map((o) => o.innerText), want);
    if (i < 0) { if (el.value) setValue(el, ''); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); el.blur(); return null; }
    const text = opts[i].innerText;
    opts[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    opts[i].click();
    await sleep(150);
    return text;
  }
  async function pickConsent(el) {
    el.focus();
    (el.closest('[class*="control" i]') || el).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await sleep(300);
    const opts = comboOptions(el), texts = opts.map((o) => o.innerText.trim());
    const i = texts.findIndex((o) => /acknowledge|consent|agree|accept|confirm/i.test(o) && !/^(yes|no)$/i.test(o));
    if (i < 0 || texts.some((o) => /^(yes|no)$/i.test(o))) { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); el.blur(); return null; }
    opts[i].click();
    return texts[i];
  }

  async function attachResume(base64, name = 'Resume.pdf') {
    const inputs = [...document.querySelectorAll('input[type=file]')];
    const input = inputs.find((i) => /resume|cv/i.test(`${i.id} ${i.name} ${labelOf(i)}`)) || inputs[0];
    if (!input) return false;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  window.JobFill = async function fill(api, onAsk) {
    const prof = await api.profile();
    const rules = prof.rules.map(([src, flags, key]) => [new RegExp(src, flags), key]);
    const answerFor = (label) => {
      const own = prof.custom[normQ(label)];
      if (own) return own;
      for (const [re, key] of rules) if (re.test(label)) return prof.answers[key] || null;
      return null;
    };
    const filled = [], unknown = [], pick = [];
    // Some sites (Greenhouse) only open their dropdowns for a real click. Then the answer is shown
    // beside the dropdown for you to pick: one click, never a workaround.
    const probe = new Map();
    const comboOpens = (el) => probe.get(el.closest('form') || document) !== false;
    const hint = (el, want) => {
      const box = el.closest('[class*="select__container"], [class*="select-shell"], .select, [class*="field" i]') || el.parentElement;
      if (box.querySelector(':scope > .jobfill-hint')) return;
      const tag = document.createElement('div');
      tag.className = 'jobfill-hint';
      tag.textContent = `Pick "${want}"`;
      tag.style.cssText = 'margin-top:6px;display:inline-block;font:600 12px -apple-system,system-ui,sans-serif;color:#1f8a5b;background:#e2f2e9;border-radius:99px;padding:3px 10px;';
      box.append(tag);
      const clear = () => setTimeout(() => { if (box.querySelector('[class*="single-value"]')) tag.remove(); }, 300);
      box.addEventListener('click', clear); box.addEventListener('keyup', clear);
    };
    const res = await api.resume(location.href).catch(() => null);
    if (res?.pdf && (await attachResume(res.pdf))) { filled.push('resume'); await sleep(1500); }

    const done = new Set();
    const firstCombo = [...document.querySelectorAll('input[role=combobox]')].find(visible);
    if (firstCombo) {
      firstCombo.focus();
      (firstCombo.closest('[class*="control" i]') || firstCombo).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await sleep(350);
      probe.set(firstCombo.closest('form') || document, comboOptions(firstCombo).length > 0);
      firstCombo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      firstCombo.blur();
    }
    // text, textarea, native select, comboboxes
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (['hidden', 'file', 'submit', 'button', 'search', 'radio'].includes(el.type) || el.name === 'g-recaptcha-response') continue;
      if (!visible(el) && el.type !== 'checkbox') continue;
      if (el.tabIndex === -1 && el.type !== 'checkbox') continue;
      const label = labelOf(el);
      if (!label) continue;
      const req = required(el, label);
      const combo = el.getAttribute('role') === 'combobox' || !!el.closest('[class*="select__"]');
      if (el.type === 'checkbox') {
        if (req && /consent|agree|acknowledge|privacy|terms|confirm|certify/i.test(label) && !el.checked) el.click();
        continue;
      }
      if (combo && el.closest('[class*="select__"]')?.querySelector('[class*="single-value"]')) continue; // already chosen
      if (!combo && el.value) continue; // already filled (e.g. by the site's resume parser)
      const want = answerFor(label);
      let got = null;
      if (combo && want && !comboOpens(el)) { hint(el, want); pick.push({ label, want }); done.add(el); continue; }
      if (want) {
        if (combo) got = await pickCombo(el, want);
        else if (el.tagName === 'SELECT') {
          const i = best([...el.options].map((o) => o.text), want);
          if (i >= 0) { el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true })); got = el.options[i].text; }
        } else { setValue(el, want); got = want; }
      } else if (combo && req) got = await pickConsent(el);
      if (got) filled.push(`${label.slice(0, 40)} = ${got.slice(0, 40)}`);
      else if (req) unknown.push({ el, label });
      done.add(el);
    }
    // Yes/No buttons (Ashby) and radio groups (Lever and others)
    const groups = new Map();
    for (const b of document.querySelectorAll('button, input[type=radio]')) {
      if (!visible(b) && b.type !== 'radio') continue;
      const text = b.type === 'radio' ? clean(b.closest('label')?.innerText || document.querySelector(`label[for="${CSS.escape(b.id)}"]`)?.innerText || b.value) : clean(b.innerText);
      if (b.type !== 'radio' && !/^(yes|no)$/i.test(text)) continue;
      const box = b.closest('fieldset, [class*="field" i], [class*="question" i], li') || b.parentElement?.parentElement;
      if (!box) continue;
      if (!groups.has(box)) groups.set(box, []);
      groups.get(box).push({ b, text });
    }
    for (const [box, opts] of groups) {
      if (opts.length < 2) continue;
      const label = clean(box.querySelector('legend, label, [class*="title" i], [class*="label" i]')?.innerText || '');
      if (!label || opts.some((o) => o.b.type === 'radio' && o.b.checked)) continue;
      const want = answerFor(label);
      const i = want ? best(opts.map((o) => o.text), want) : -1;
      if (i >= 0) { opts[i].b.click(); filled.push(`${label.slice(0, 40)} = ${opts[i].text}`); }
      else if (/\*/.test(box.innerText.slice(0, 300)) || required(opts[0].b, label)) unknown.push({ el: box, label });
    }

    // outline what only you can answer, and remember what you type there
    for (const u of unknown) {
      u.el.style.outline = '2px solid #e3a24a';
      u.el.style.outlineOffset = '3px';
      u.el.style.borderRadius = '8px';
      let last = '';
      const save = (value) => { value = clean(value || ''); if (value && value !== last) { last = value; onAsk?.(u.label, value); } };
      const isField = u.el.matches?.('input, textarea, select');
      const read = () => {
        if (u.el.tagName === 'SELECT') return u.el.options[u.el.selectedIndex]?.text;
        const chosen = u.el.closest('[class*="select__"]')?.querySelector('[class*="single-value"]');
        if (chosen) return chosen.innerText;
        return u.el.getAttribute('role') === 'combobox' ? '' : u.el.value;
      };
      if (isField) {
        u.el.addEventListener('focusout', () => setTimeout(() => save(read()), 200));
        u.el.addEventListener('change', () => setTimeout(() => save(read()), 200));
      } else { // a Yes/No or radio group: the option clicked
        u.el.addEventListener('click', (e) => {
          const b = e.target.closest('button, label, input[type=radio]');
          if (b) save(b.type === 'radio' ? (b.closest('label')?.innerText || b.value) : b.innerText);
        });
      }
    }
    unknown[0]?.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { filled, pick, unknown: unknown.map((u) => u.label), job: res?.job || null, resume: res?.resume || null };
  };
})();
