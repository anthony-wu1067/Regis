'use strict';
/* Runs inside every page opened in Regis's browser (isolated from the page's own scripts). It only watches for a login form being submitted
   and tells Regis the host, username and password so Regis can offer to save them. It exposes nothing to the page. */
const { ipcRenderer, contextBridge, webFrame } = require('electron');
let last = '';
/* On Google's sign-in pages Regis presents itself as Firefox (see lib/browser.js). Firefox has no navigator.userAgentData, so hide it
   there too, or Google sees a mismatch and says "This browser or app may not be secure". Nothing changes on any other site. */
if (location.protocol === 'https:' && /^accounts\.(google|youtube)\.com$/i.test(location.hostname)) {
  const hide = function () {
    try { delete Navigator.prototype.userAgentData; } catch (_) {}
    var def = function (k, v) { try { Object.defineProperty(Navigator.prototype, k, { get: function () { return v; }, configurable: true }); } catch (_) {} };
    def('vendor', ''); def('productSub', '20100101'); def('oscpu', navigator.platform === 'MacIntel' ? 'Intel Mac OS X 10.15' : navigator.platform.indexOf('Linux') === 0 ? 'Linux x86_64' : 'Windows NT 10.0; Win64; x64');
    def('buildID', '20181001000000');
    try { delete window.chrome; } catch (_) {} try { Object.defineProperty(window, 'chrome', { get: function () { return undefined; }, configurable: true }); } catch (_) {}
  };
  try { if (contextBridge && contextBridge.executeInMainWorld) contextBridge.executeInMainWorld({ func: hide }); else throw 0; }
  catch (_) { try { webFrame.executeJavaScript('(' + hide.toString() + ')()'); } catch (_) {} }
}
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
