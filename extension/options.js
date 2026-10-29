const $ = (id) => document.getElementById(id);
chrome.storage.sync.get(['server', 'user', 'pass']).then((s) => { $('server').value = s.server || 'http://localhost:3000'; $('user').value = s.user || ''; $('pass').value = s.pass || ''; });
$('save').onclick = async () => {
  const server = $('server').value.trim().replace(/\/$/, '') || 'http://localhost:3000';
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(server)) {
    const ok = await chrome.permissions.request({ origins: [`${server}/*`] });
    if (!ok) { $('msg').textContent = 'Chrome needs your OK to reach that address.'; return; }
  }
  await chrome.storage.sync.set({ server, user: $('user').value.trim(), pass: $('pass').value });
  $('msg').textContent = 'Saved.';
};
