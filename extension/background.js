// Talks to the pipeline dashboard for the page (no CORS from the page itself), and fills any page
// when the toolbar icon is clicked.
const settings = async () => ({ server: 'http://localhost:3000', user: '', pass: '', ...(await chrome.storage.sync.get(['server', 'user', 'pass'])) });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== 'api') return;
  (async () => {
    const { server, user, pass } = await settings();
    const headers = { 'Content-Type': 'application/json' };
    if (user && pass) headers.Authorization = `Basic ${btoa(`${user}:${pass}`)}`;
    try {
      const r = await fetch(server.replace(/\/$/, '') + msg.path, { method: msg.method || 'GET', headers, body: msg.body ? JSON.stringify(msg.body) : undefined });
      reply({ ok: r.ok, status: r.status, data: await r.json().catch(() => null) });
    } catch (e) {
      reply({ ok: false, error: `Can't reach your pipeline at ${server}. Is the dashboard running?` });
    }
  })();
  return true;
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const [{ result: loaded } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => !!window.__jobfill }).catch(() => [{}]);
    if (!loaded) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['filler.js', 'content.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__jobfill?.fill() });
  } catch {
    // a page Chrome keeps extensions out of (chrome://, the Web Store, a new tab): nothing to fill
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    chrome.action.setTitle({ tabId: tab.id, title: "Fill my application can't run on this page. Open a job application." });
  }
});
