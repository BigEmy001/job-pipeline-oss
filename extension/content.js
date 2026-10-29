// The "Fill my application" button on application pages, its result card, and watching for the
// thank-you page after you press Submit (so the dashboard marks the job Applied).
(() => {
  if (window.__jobfill) return;
  const call = (path, method, body) => new Promise((ok, fail) => chrome.runtime.sendMessage({ type: 'api', path, method, body }, (r) => {
    if (!r || r.error) return fail(new Error(r?.error || 'no reply from the extension'));
    if (!r.ok) return fail(new Error(r.data?.error || `dashboard said ${r.status}`));
    ok(r.data);
  }));
  const api = {
    profile: () => call('/api/ext/profile'),
    resume: (url) => call(`/api/ext/resume?url=${encodeURIComponent(url)}`),
    answer: (label, value) => call('/api/ext/answer', 'POST', { label, value }),
    applied: (url) => call('/api/ext/applied', 'POST', { url }),
  };
  const DONE = /thank(s| you)[^.]{0,40}(appl|submi|interest)|application (has been |was )?(submitted|received|sent)|we('ve| have) received your application|successfully (submitted|applied)|you('ve| have) (successfully )?applied/i;
  const hasForm = () => !!document.querySelector('input[type=file], form input[type=email], input[name*="email" i], input[id*="email" i]');

  // the button and card live in a shadow root so the page's styles can't touch them
  let root, card, btn;
  function mount() {
    if (root || window.top !== window && !hasForm()) return;
    const host = document.createElement('div');
    host.id = 'jobfill';
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      * { box-sizing: border-box; font-family: -apple-system, system-ui, "Segoe UI", sans-serif; }
      .btn { display: flex; align-items: center; gap: 8px; background: #111; color: #fff; border: 0; border-radius: 999px; padding: 12px 18px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
      .btn:hover { background: #222; } .btn[disabled] { opacity: .7; cursor: default; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #3cbf83; }
      .card { width: 320px; background: #fff; color: #111; border-radius: 18px; padding: 16px 18px; margin-bottom: 10px; box-shadow: 0 16px 40px rgba(0,0,0,.2); font-size: 13px; line-height: 1.45; }
      .card b { font-size: 14px; } .muted { color: #6f6c66; } .warn { color: #a8640c; } .ok { color: #1f8a5b; }
      ul { margin: 8px 0 0; padding-left: 18px; } li { margin: 2px 0; }
      .x { float: right; border: 0; background: #f3f2ef; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; }
    </style><div class="card" hidden></div><button class="btn"><span class="dot"></span>Fill my application</button>`;
    card = root.querySelector('.card');
    btn = root.querySelector('.btn');
    btn.onclick = () => run();
    document.documentElement.append(host);
  }
  const show = (html) => { card.hidden = false; card.innerHTML = `<button class="x" title="Close">×</button>${html}`; card.querySelector('.x').onclick = () => { card.hidden = true; }; };
  const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let watching = false;
  async function run() {
    mount();
    btn.disabled = true;
    btn.lastChild.textContent = 'Filling…';
    try {
      const r = await window.JobFill(api, (label, value) => api.answer(label, value).then(() => show(`<b class="ok">Saved</b><div class="muted">"${esc(label.slice(0, 80))}" will be answered for you next time.</div>`)).catch(() => {}));
      const job = r.job ? `<div class="muted">${esc(r.job.title)} · ${esc(r.job.company)}${r.job.score != null ? ` · score ${r.job.score}` : ''}</div>` : '';
      show(`<b>Filled ${r.filled.length} field${r.filled.length === 1 ? '' : 's'}</b>${job}
        <div class="muted" style="margin-top:6px">Resume: ${esc(r.resume || 'none attached')}</div>
        ${r.pick?.length ? `<div class="ok" style="margin-top:10px"><b>${r.pick.length} dropdown${r.pick.length > 1 ? 's' : ''} to pick</b>: this site only lets a real click choose them. The answer is shown in green under each.</div>` : ''}
        ${r.unknown.length ? `<div class="warn" style="margin-top:10px"><b>${r.unknown.length} need you</b> (outlined in orange). What you answer is saved for next time.</div><ul>${r.unknown.slice(0, 6).map((u) => `<li>${esc(u.slice(0, 90))}</li>`).join('')}</ul>` : (r.pick?.length ? '' : '<div class="ok" style="margin-top:10px"><b>All set.</b> Check it over, then press Submit.</div>')}`);
      watch();
    } catch (e) {
      show(`<b class="warn">Couldn't fill this page</b><div class="muted">${esc(e.message)}</div>`);
    } finally {
      btn.disabled = false;
      btn.lastChild.textContent = 'Fill my application';
    }
  }

  // after Submit: a thank-you page means it went through
  function watch() {
    if (watching) return;
    watching = true;
    const start = location.href, end = Date.now() + 30 * 60 * 1000;
    const tick = setInterval(async () => {
      if (Date.now() > end) return clearInterval(tick);
      const text = document.body?.innerText || '';
      if (DONE.test(text) || (/confirmation|thank/i.test(location.href) && location.href !== start)) {
        clearInterval(tick);
        const r = await api.applied(start).catch(() => null);
        mount();
        show(`<b class="ok">Applied</b><div class="muted">${r?.ok ? 'Marked as applied in your dashboard.' : 'Submitted. (This job isn\'t in your dashboard yet.)'}</div>`);
      }
    }, 2000);
  }

  window.__jobfill = { fill: run };
  // show the button on application pages; job pages that reveal the form later get it when it appears
  if (hasForm()) mount();
  else {
    const obs = new MutationObserver(() => { if (hasForm()) { mount(); obs.disconnect(); } });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 60000);
  }
})();
