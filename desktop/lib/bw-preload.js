'use strict';
/* Runs inside every page opened in Regis's browser (isolated from the page's own scripts). It only watches for a login form being submitted
   and tells Regis the host, username and password so Regis can offer to save them. It exposes nothing to the page. */
const { ipcRenderer, contextBridge, webFrame } = require('electron');
let last = '';
/* Give pages the window.chrome object real Chrome has (app, runtime, csi, loadTimes). Electron leaves it out, and Google's sign-in
   treats that as an embedded browser: "This browser or app may not be secure". Runs in the page's own world before its scripts. */
const chromeSurface = function () {
  try {
    var nat = new WeakSet(), T = Function.prototype.toString;
    var mk = function (name, fn) { try { Object.defineProperty(fn, 'name', { value: name }); } catch (_) {} nat.add(fn); return fn; };
    /* functions report themselves as built-in, like the real ones */
    var ts = mk('toString', function toString() { return nat.has(this) ? 'function ' + (this.name || '') + '() { [native code] }' : T.call(this); });
    Function.prototype.toString = ts;
    var c = window.chrome && typeof window.chrome === 'object' ? window.chrome : {};
    var tm = function () { return performance.timing || {}; }, nav = function () { return (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {}; };
    if (!c.app) c.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: mk('getDetails', function () { return null; }), getIsInstalled: mk('getIsInstalled', function () { return false; }),
      installState: mk('installState', function (cb) { if (typeof cb === 'function') setTimeout(function () { cb('not_installed'); }, 0); }), runningState: mk('runningState', function () { return 'cannot_run'; }) };
    if (!c.runtime) c.runtime = { OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }, RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
      connect: mk('connect', function () { throw new TypeError('Error in invocation of runtime.connect(optional string extensionId, optional object connectInfo): chrome.runtime.connect() called from a webpage must specify an Extension ID (string) for its first argument.'); }),
      sendMessage: mk('sendMessage', function () { throw new TypeError('Error in invocation of runtime.sendMessage(optional string extensionId, any message, optional object options, optional function callback): chrome.runtime.sendMessage() called from a webpage must specify an Extension ID (string) for its first argument.'); }) };
    if (!c.csi) c.csi = mk('csi', function () { var t = tm(); return { onloadT: t.domContentLoadedEventEnd || Date.now(), pageT: performance.now(), startE: t.navigationStart || Date.now(), tran: 15 }; });
    if (!c.loadTimes) c.loadTimes = mk('loadTimes', function () { var t = tm(), n = nav(), p = (performance.getEntriesByType && performance.getEntriesByType('paint')[0]) || null, s = (t.navigationStart || 0) / 1000, pr = n.nextHopProtocol || 'h2';
      return { commitLoadTime: (t.responseStart || 0) / 1000, connectionInfo: pr, finishDocumentLoadTime: (t.domContentLoadedEventEnd || 0) / 1000, finishLoadTime: (t.loadEventEnd || 0) / 1000, firstPaintAfterLoadTime: 0,
        firstPaintTime: p ? s + p.startTime / 1000 : 0, navigationType: 'Other', npnNegotiatedProtocol: pr, requestTime: s, startLoadTime: s, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: pr === 'h2' || pr === 'h3', wasNpnNegotiated: true }; });
    if (window.chrome !== c) Object.defineProperty(window, 'chrome', { value: c, writable: true, configurable: true, enumerable: true });
  } catch (_) {}
};
if (/^https?:$/.test(location.protocol)) {
  try { if (contextBridge && contextBridge.executeInMainWorld) contextBridge.executeInMainWorld({ func: chromeSurface }); else throw 0; }
  catch (_) { try { webFrame.executeJavaScript('(' + chromeSurface.toString() + ')()'); } catch (_) {} }
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
/* Easy Files: when the site opens its "upload a file" box, Regis offers your recent downloads first (and the normal file dialog).
   The file you pick is handed to that upload box only; the site never sees anything else on your computer. */
const picks = new Map(); let pickN = 0, bypass = null;
window.addEventListener('click', (e) => {
  const el = e.target; if (!el || el.tagName !== 'INPUT' || String(el.type).toLowerCase() !== 'file' || el.disabled) return;
  if (bypass === el) { bypass = null; return; }
  e.preventDefault(); e.stopImmediatePropagation();
  const token = 'f' + (++pickN) + Math.random().toString(36).slice(2, 10); picks.set(token, el); if (picks.size > 20) picks.delete(picks.keys().next().value);
  try { ipcRenderer.send('bw:filepick', { token, accept: String(el.accept || '').slice(0, 300), multiple: !!el.multiple }); } catch (_) {}
}, true);
ipcRenderer.on('bw:files', (_e, d) => {
  const el = d && picks.get(d.token); if (!el) return; picks.delete(d.token);
  if (d.native) { bypass = el; try { el.click(); } catch (_) {} return; }  /* Easy Files switched off: the site's own file box */
  if (!Array.isArray(d.files) || !d.files.length) return;
  try {
    const dt = new DataTransfer(); (el.multiple ? d.files : d.files.slice(0, 1)).forEach((f) => dt.items.add(new File([f.data], String(f.name || 'file'), { type: String(f.type || ''), lastModified: Date.now() })));
    el.files = dt.files; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (_) {}
});
