'use strict';
/* Runs inside every page opened in Regis's browser (isolated from the page's own scripts). It only watches for a login form being submitted
   and tells Regis the host, username and password so Regis can offer to save them. It exposes nothing to the page. */
const { ipcRenderer } = require('electron');
let last = '';
const visible = (el) => { try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (_) { return false; } };
function userFor(pw) {
  const scope = pw.form || document;
  const list = Array.from(scope.querySelectorAll('input')).filter((i) => i !== pw && visible(i) && /^(text|email|tel|)$/i.test(i.type || 'text'));
  let best = null;
  for (const i of list) { if (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) best = i; }
  if (!best) best = list.find((i) => /user|email|login|account/i.test((i.name || '') + (i.id || '') + (i.autocomplete || ''))) || null;
  return best;
}
function grab() {
  const pws = Array.from(document.querySelectorAll('input[type=password]')).filter(visible);
  for (const pw of pws) { if (!pw.value) continue; const u = userFor(pw); return { user: u ? u.value : '', pass: pw.value }; }
  return null;
}
function send() {
  const c = grab(); if (!c) return;
  const key = location.hostname + '|' + c.user + '|' + c.pass; if (key === last) return; last = key;
  try { ipcRenderer.send('bw:cred', { host: location.hostname, url: location.href, user: String(c.user).slice(0, 300), pass: String(c.pass).slice(0, 300) }); } catch (_) {}
}
window.addEventListener('submit', send, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.type === 'password') send(); }, true);
window.addEventListener('click', (e) => { const b = e.target && e.target.closest && e.target.closest('button,input[type=submit],[role=button]'); if (b && grab()) setTimeout(send, 0); }, true);
