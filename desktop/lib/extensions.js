'use strict';
/* Chrome extensions for the Regis Browser.
   Install from the Chrome Web Store (paste the store link, or press "Add to Regis" on a store page), or a .crx / unpacked folder.
   Each extension lives in <userData>/extensions/<id>/ and is loaded into the browser's session only (never into Regis itself).
   Electron runs the extension (content scripts, background worker, storage, messaging, webRequest, scripting, tabs);
   Regis adds what Electron leaves out: the toolbar button with its popup, badges, and safe stand-ins for a few missing chrome.* parts. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { net } = require('electron');

const ID_RE = /^[a-p]{32}$/;
/* the 32-letter id from a Web Store link or a bare id */
function storeId(s) { s = String(s || '').trim(); if (ID_RE.test(s)) return s; const m = s.match(/(?:chromewebstore\.google\.com\/detail\/(?:[^/]+\/)?|chrome\.google\.com\/webstore\/detail\/(?:[^/]+\/)?)([a-p]{32})/i); return m ? m[1].toLowerCase() : null; }

/* a .crx is a small signed header and then an ordinary zip */
function crxZip(buf) {
  if (buf.length > 16 && buf.toString('latin1', 0, 4) === 'Cr24') {
    const ver = buf.readUInt32LE(4);
    if (ver === 3) return buf.subarray(12 + buf.readUInt32LE(8));
    if (ver === 2) return buf.subarray(16 + buf.readUInt32LE(8) + buf.readUInt32LE(12));
    throw new Error('Unknown extension package version.');
  }
  if (buf.readUInt32LE(0) === 0x04034b50) return buf;
  throw new Error('That is not an extension package.');
}
/* the public key inside a CRX3 header whose id matches, so the extension keeps its Web Store id (some extensions rely on it) */
function crxKey(buf, id) {
  try {
    if (buf.toString('latin1', 0, 4) !== 'Cr24' || buf.readUInt32LE(4) !== 3) return null;
    const h = buf.subarray(12, 12 + buf.readUInt32LE(8)); const keys = [];
    const varint = (b, i) => { let v = 0, s = 0, c; do { c = b[i++]; v += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return [v, i]; };
    const fields = (b) => { const out = []; let i = 0; while (i < b.length) { let t; [t, i] = varint(b, i); const f = Math.floor(t / 8), w = t & 7; if (w === 2) { let l; [l, i] = varint(b, i); out.push([f, b.subarray(i, i + l)]); i += l; } else if (w === 0) { [, i] = varint(b, i); } else if (w === 5) i += 4; else if (w === 1) i += 8; else break; } return out; };
    for (const [f, v] of fields(h)) if (f === 2 || f === 3) for (const [g, k] of fields(v)) if (g === 1) keys.push(Buffer.from(k));
    const idOf = (k) => [...require('crypto').createHash('sha256').update(k).digest().subarray(0, 16)].map((x) => String.fromCharCode(97 + (x >> 4)) + String.fromCharCode(97 + (x & 15))).join('');
    const k = keys.find((x) => idOf(x) === id); return k ? k.toString('base64') : null;
  } catch (_) { return null; }
}
/* minimal unzip (stored and deflated entries), refusing paths that leave the folder */
function unzip(zip, dir) {
  let eocd = -1; for (let i = zip.length - 22; i >= Math.max(0, zip.length - 70000); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('The extension package is damaged.');
  const n = zip.readUInt16LE(eocd + 10); let p = zip.readUInt32LE(eocd + 16), total = 0;
  if (n > 5000) throw new Error('The extension has too many files.');
  for (let k = 0; k < n; k++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('The extension package is damaged.');
    const method = zip.readUInt16LE(p + 10), csize = zip.readUInt32LE(p + 20), usize = zip.readUInt32LE(p + 24), nl = zip.readUInt16LE(p + 28), xl = zip.readUInt16LE(p + 30), cl = zip.readUInt16LE(p + 32), lo = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nl).replace(/\\/g, '/'); p += 46 + nl + xl + cl;
    const out = path.resolve(dir, name); if (!out.startsWith(path.resolve(dir) + path.sep)) throw new Error('The extension package has a bad file name.');
    if (name.endsWith('/')) { fs.mkdirSync(out, { recursive: true }); continue; }
    const lnl = zip.readUInt16LE(lo + 26), lxl = zip.readUInt16LE(lo + 28), data = zip.subarray(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + csize);
    const body = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null; if (!body) throw new Error('The extension uses a zip format Regis can’t open.');
    total += body.length; if (total > 300 * 1024 * 1024) throw new Error('The extension is too big.');
    if (usize && body.length !== usize) throw new Error('The extension package is damaged.');
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, body);
  }
}
/* messages like "__MSG_appName__" are looked up in _locales */
function msg(dir, man, s) {
  const m = String(s || '').match(/^__MSG_(.+)__$/); if (!m) return s;
  for (const loc of [man.default_locale, 'en', 'en_US']) { if (!loc) continue; try { const j = JSON.parse(fs.readFileSync(path.join(dir, '_locales', loc, 'messages.json'), 'utf8')); const k = Object.keys(j).find((x) => x.toLowerCase() === m[1].toLowerCase()); if (k) return j[k].message; } catch (_) {} }
  return s;
}

class Extensions {
  constructor({ root, getSession, chromeVersion, onChange }) {
    this.root = root; this.getSession = getSession; this.ver = chromeVersion || '140.0.0.0'; this.onChange = onChange;
    this.reg = this._read(); this.loaded = new Map(); this.badges = {};
  }
  _read() { try { const r = JSON.parse(fs.readFileSync(path.join(this.root, 'list.json'), 'utf8')); return Array.isArray(r) ? r : []; } catch (_) { return []; } }
  _write() { fs.mkdirSync(this.root, { recursive: true }); fs.writeFileSync(path.join(this.root, 'list.json'), JSON.stringify(this.reg, null, 1)); }
  _api() { const s = this.getSession(); return s.extensions || s; }
  _emit() { if (this.onChange) try { this.onChange(this.list()); } catch (_) {} }
  list() {
    return this.reg.map((r) => { const L = this.loaded.get(r.id), man = (L && L.manifest) || {}; const act = man.action || man.browser_action || {};
      return { id: r.id, name: r.name, version: r.version, on: r.on !== false, store: !!r.store, live: !!L, ext: L ? L.id : '', popup: act.default_popup ? String(act.default_popup) : '',
        options: (man.options_ui && man.options_ui.page) || man.options_page || '', icon: r.icon || '', badge: L ? (this.badges[L.id] || '') : '', mv: man.manifest_version || 0, note: r.note || '' }; });
  }
  async loadAll() { for (const r of this.reg) if (r.on !== false) await this._load(r).catch(() => {}); this._emit(); }
  async _load(r) {
    const dir = path.join(this.root, r.id); const e = await this._api().loadExtension(dir, { allowFileAccess: false });
    this.loaded.set(r.id, e); r.note = this._note(e.manifest); return e;
  }
  _unload(r) { const L = this.loaded.get(r.id); if (L) { try { this._api().removeExtension(L.id); } catch (_) {} this.loaded.delete(r.id); } }
  /* what may not work, said plainly */
  _note(man) {
    const p = [].concat(man.permissions || [], man.optional_permissions || []);
    if (p.includes('declarativeNetRequest') || p.includes('declarativeNetRequestWithHostAccess')) return 'Its blocking rules (declarativeNetRequest) aren’t supported here; the Browser’s Shield blocks ads instead.';
    if (p.includes('identity')) return 'Signing in through Chrome (identity) isn’t available; sign in on the extension’s own page instead.';
    if (p.includes('sidePanel')) return 'Its side panel opens as a popup.';
    return '';
  }
  async _installDir(dir, meta) {
    const mf = path.join(dir, 'manifest.json'); const man = JSON.parse(fs.readFileSync(mf, 'utf8').replace(/^﻿/, ''));
    /* Chrome gives "activeTab" extensions the open page when you press their button; Electron never does, so let them read pages instead */
    const perms = man.permissions || [];
    if (meta.key && !man.key) { man.key = meta.key; fs.writeFileSync(mf, JSON.stringify(man, null, 1)); }
    if (perms.includes('activeTab')) {
      if (man.manifest_version >= 3) { const h = man.host_permissions || []; if (!h.includes('<all_urls>')) { man.host_permissions = h.concat(['<all_urls>']); fs.writeFileSync(mf, JSON.stringify(man, null, 1)); } }
      else if (!perms.includes('<all_urls>')) { man.permissions = perms.concat(['<all_urls>']); fs.writeFileSync(mf, JSON.stringify(man, null, 1)); }
    }
    const name = msg(dir, man, man.name) || 'Extension';
    let icon = ''; const ic = man.icons || (man.action && man.action.default_icon) || {}; const best = typeof ic === 'string' ? ic : ic['128'] || ic['48'] || ic['32'] || ic[Object.keys(ic).pop()];
    if (best) { try { const b = fs.readFileSync(path.join(dir, best)); if (b.length < 200000) icon = 'data:image/' + (/\.svg$/i.test(best) ? 'svg+xml' : 'png') + ';base64,' + b.toString('base64'); } catch (_) {} }
    let r = this.reg.find((x) => x.id === meta.id);
    if (r) { this._unload(r); Object.assign(r, { name, version: man.version, icon, on: true }); } else { r = { id: meta.id, name, version: man.version, icon, on: true, store: !!meta.store }; this.reg.push(r); }
    this._write(); await this._load(r); this._emit(); return this.list().find((x) => x.id === r.id);
  }
  /* from the Chrome Web Store */
  async installStore(link) {
    const id = storeId(link); if (!id) throw new Error('Paste a Chrome Web Store link (chromewebstore.google.com/detail/…).');
    const url = 'https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=' + encodeURIComponent(this.ver) + '&x=' + encodeURIComponent('id=' + id + '&installsource=ondemand&uc');
    const res = await net.fetch(url, { session: this.getSession() });
    if (!res.ok) throw new Error('The Chrome Web Store didn’t send the extension (' + res.status + ').');
    const buf = Buffer.from(await res.arrayBuffer()); if (buf.length < 100) throw new Error('This extension isn’t available from the Chrome Web Store any more.');
    if (buf.length > 120 * 1024 * 1024) throw new Error('The extension is too big.');
    return this._unpack(crxZip(buf), { id, store: true, key: crxKey(buf, id) });
  }
  async installFile(file) { const buf = fs.readFileSync(file); const id = 'local' + require('crypto').createHash('sha256').update(path.basename(file)).digest('hex').replace(/[^a-p]/g, '').slice(0, 27).padEnd(27, 'a'); return this._unpack(crxZip(buf), { id, store: false }); }
  async installFolder(src) {
    if (!fs.existsSync(path.join(src, 'manifest.json'))) throw new Error('That folder has no manifest.json.');
    const id = 'dev' + require('crypto').createHash('sha256').update(path.resolve(src)).digest('hex').replace(/[^a-p]/g, '').slice(0, 29).padEnd(29, 'a');
    const dir = path.join(this.root, id); fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(src, dir, { recursive: true });
    return this._installDir(dir, { id, store: false });
  }
  async _unpack(zip, meta) {
    const dir = path.join(this.root, meta.id), tmp = dir + '.new';
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    try { unzip(zip, tmp); if (!fs.existsSync(path.join(tmp, 'manifest.json'))) throw new Error('The extension has no manifest.json.'); }
    catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
    const r = this.reg.find((x) => x.id === meta.id); if (r) this._unload(r);
    fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(tmp, dir);
    return this._installDir(dir, meta);
  }
  async setOn(id, on) { const r = this.reg.find((x) => x.id === id); if (!r) return false; r.on = !!on; this._write(); if (on) await this._load(r); else this._unload(r); this._emit(); return true; }
  async remove(id) { const r = this.reg.find((x) => x.id === id); if (!r) return false; this._unload(r); this.reg = this.reg.filter((x) => x !== r); this._write(); fs.rmSync(path.join(this.root, id), { recursive: true, force: true }); this._emit(); return true; }
  /* chrome-extension:// address of a page inside an installed extension (popup, options) */
  pageUrl(id, page) { const L = this.loaded.get(id); if (!L || !page) return null; return 'chrome-extension://' + L.id + '/' + String(page).replace(/^\/+/, ''); }
  setBadge(extId, text) { const t = String(text || '').slice(0, 4); if ((this.badges[extId] || '') === t) return; this.badges[extId] = t; this._emit(); }
  /* the session preload that adds the stand-ins (SHIM) to extension pages and background workers; written once, sandbox-safe (no requires but electron) */
  preloadFile() {
    fs.mkdirSync(this.root, { recursive: true }); const f = path.join(this.root, '_regis-ext-preload.js');
    const src = `'use strict';
(function () {
  var E = require('electron');
  var loc = (typeof location !== 'undefined' && location) || (typeof self !== 'undefined' && self.location) || {}, href = String(loc.href || '');
  /* background service workers: the preload can't see the address, the worker can */
  if (!href) { try { href = String(E.contextBridge.executeInMainWorld({ func: function () { return String(self.location && self.location.href || ''); } }) || ''); } catch (_) {} }
  if (href.indexOf('chrome-extension:') !== 0) return;
  try { E.contextBridge.exposeInMainWorld('__regisTabs', function (q) { return E.ipcRenderer.invoke('ext:tabs', JSON.parse(JSON.stringify(q || {}))); }); } catch (_) {}
  try { E.contextBridge.exposeInMainWorld('__regisExt', function (m) { try { E.ipcRenderer.send('ext:msg', JSON.parse(JSON.stringify(m || {}))); } catch (_) {} }); } catch (_) {}
  try { E.contextBridge.executeInMainWorld({ func: ${SHIM.toString()} }); } catch (_) {}
})();
`;
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== src) fs.writeFileSync(f, src); return f;
  }
  byExt(extId) { for (const [rid, L] of this.loaded) if (L.id === extId) return rid; return null; }
}

/* what Electron leaves out of chrome.* for extensions, filled with safe stand-ins so an extension doesn't stop at the first missing call.
   Runs inside the extension's own pages and background worker. */
const SHIM = function () {
  try {
    var c = globalThis.chrome; if (!c || !c.runtime || !c.runtime.id || c.__regisShim) return; c.__regisShim = true;
    var ev = function () { var L = []; return { addListener: function (f) { L.push(f); }, removeListener: function (f) { L = L.filter(function (x) { return x !== f; }); }, hasListener: function (f) { return L.indexOf(f) >= 0; }, hasListeners: function () { return L.length > 0; }, _fire: function () { var a = arguments; L.forEach(function (f) { try { f.apply(null, a); } catch (_) {} }); } }; };
    var done = function (v) { return function () { var cb = arguments[arguments.length - 1]; if (typeof cb === 'function') { setTimeout(function () { cb(v); }, 0); return; } return Promise.resolve(v); }; };
    var post = function (m) { try { if (globalThis.__regisExt) globalThis.__regisExt(m); } catch (_) {} };
    if (!c.action) {
      var popups = {};
      c.action = { setBadgeText: function (o, cb) { post({ t: 'badge', text: o && o.text }); return done()(cb); }, getBadgeText: done(''), setBadgeBackgroundColor: done(), getBadgeBackgroundColor: done([0, 0, 0, 0]), setBadgeTextColor: done(),
        setIcon: done(), setTitle: done(), getTitle: done(''), setPopup: function (o, cb) { popups.p = o && o.popup; return done()(cb); }, getPopup: done(''), enable: done(), disable: done(), isEnabledForTab: done(true), getUserSettings: done({ isOnToolbar: true }), openPopup: done(), onClicked: ev(), onUserSettingsChanged: ev() };
    }
    if (!c.browserAction) c.browserAction = c.action;
    if (!c.extension) c.extension = {};
    ['isAllowedFileSchemeAccess', 'isAllowedIncognitoAccess'].forEach(function (k) { if (typeof c.extension[k] !== 'function') c.extension[k] = done(false); });
    if (typeof c.extension.setUpdateUrlData !== 'function') c.extension.setUpdateUrlData = function () {};
    if (c.runtime && typeof c.runtime.openOptionsPage !== 'function') c.runtime.openOptionsPage = function (cb) { post({ t: 'options' }); return done()(cb); };
    if (c.runtime && typeof c.runtime.setUninstallURL !== 'function') c.runtime.setUninstallURL = done();
    /* tabs: Electron doesn't know Regis's tabs, so ask Regis (the open tab is the active one) */
    if (globalThis.__regisTabs && c.tabs) {
      var nq = c.tabs.query && c.tabs.query.bind(c.tabs), ng = c.tabs.get && c.tabs.get.bind(c.tabs);
      var ask = function (q) { return globalThis.__regisTabs(q || {}).then(function (r) { return Array.isArray(r) ? r : []; }); };
      c.tabs.query = function (q, cb) { var p = ask(q).catch(function () { return nq ? new Promise(function (res) { nq(q || {}, res); }) : []; }); if (typeof cb === 'function') { p.then(function (r) { cb(r); }); return; } return p; };
      c.tabs.get = function (id, cb) { var p = ask({}).then(function (r) { var t = r.filter(function (x) { return x.id === id; })[0]; if (!t && ng) return new Promise(function (res) { ng(id, res); }); return t; }); if (typeof cb === 'function') { p.then(function (r) { cb(r); }); return; } return p; };
      c.tabs.getCurrent = function (cb) { if (typeof cb === 'function') { setTimeout(function () { cb(undefined); }, 0); return; } return Promise.resolve(undefined); };
      /* opening a page: web pages become Regis tabs, the extension's own pages get a window */
      var abs = function (u) { try { return new URL(u || '', location.href).href; } catch (_) { return u; } };
      c.tabs.create = function (o, cb) { var u = abs(o && o.url); post({ t: 'open', url: u }); var t = { id: -1, index: 0, windowId: 1, active: true, url: u }; if (typeof cb === 'function') { setTimeout(function () { cb(t); }, 0); return; } return Promise.resolve(t); };
      if (!c.tabs.onActivated) c.tabs.onActivated = ev(); if (!c.tabs.onHighlighted) c.tabs.onHighlighted = ev(); if (!c.tabs.onReplaced) c.tabs.onReplaced = ev();
    }
    if (!c.contextMenus) { c.contextMenus = { create: function (o, cb) { if (typeof cb === 'function') setTimeout(cb, 0); return (o && o.id) || Math.random().toString(36).slice(2); }, update: done(), remove: done(), removeAll: done(), onClicked: ev() }; }
    if (!c.menus) c.menus = c.contextMenus;
    if (!c.alarms) { var T = {}, A = ev(); c.alarms = { create: function (n, o) { if (typeof n === 'object') { o = n; n = ''; } n = n || ''; clearTimeout(T[n]); var d = o && (o.delayInMinutes || o.periodInMinutes) ? (o.delayInMinutes || o.periodInMinutes) * 60000 : (o && o.when ? o.when - Date.now() : 60000); var fire = function () { A._fire({ name: n, scheduledTime: Date.now() }); if (o && o.periodInMinutes) T[n] = setTimeout(fire, o.periodInMinutes * 60000); }; T[n] = setTimeout(fire, Math.max(0, d)); return done()(); }, clear: function (n) { clearTimeout(T[n || '']); delete T[n || '']; return done(true)(arguments[1]); }, clearAll: function () { Object.keys(T).forEach(function (k) { clearTimeout(T[k]); }); T = {}; return done(true)(arguments[0]); }, get: done(undefined), getAll: done([]), onAlarm: A }; }
    if (!c.notifications) c.notifications = { create: function (id, o, cb) { if (typeof id === 'object') { cb = o; o = id; id = ''; } post({ t: 'note', title: o && o.title, body: o && o.message }); return done(id || 'n')(cb); }, clear: done(true), getAll: done({}), update: done(true), onClicked: ev(), onClosed: ev(), onButtonClicked: ev() };
    if (!c.fontSettings) c.fontSettings = { getFontList: done([]), getFont: done({ fontId: '', levelOfControl: 'not_controllable' }), setFont: done(), clearFont: done(), getDefaultFontSize: done({ pixelSize: 16 }), onFontChanged: ev() };
    if (!c.commands) c.commands = { getAll: done([]), onCommand: ev() };
    if (!c.sidePanel) c.sidePanel = { setOptions: done(), setPanelBehavior: done(), getOptions: done({}), open: done() };
    if (!c.offscreen) c.offscreen = { createDocument: done(), closeDocument: done(), hasDocument: done(false), Reason: {} };
    if (!c.declarativeNetRequest) c.declarativeNetRequest = { updateDynamicRules: done(), getDynamicRules: done([]), updateSessionRules: done(), getSessionRules: done([]), updateEnabledRulesets: done(), getEnabledRulesets: done([]), isRegexSupported: done({ isSupported: true }), MAX_NUMBER_OF_DYNAMIC_RULES: 30000, onRuleMatchedDebug: ev() };
    if (!c.permissions) c.permissions = { contains: done(true), request: done(true), remove: done(true), getAll: done({ permissions: [], origins: [] }), onAdded: ev(), onRemoved: ev() };
    if (c.storage && !c.storage.sync && c.storage.local) c.storage.sync = c.storage.local;
    if (c.storage && !c.storage.session && c.storage.local) c.storage.session = c.storage.local;
    if (!c.i18n || !c.i18n.getUILanguage) c.i18n = Object.assign(c.i18n || {}, { getUILanguage: function () { return navigator.language || 'en-US'; } });
    if (c.windows && c.windows.create) { c.windows.create = function (o, cb) { var u = o && [].concat(o.url || [])[0]; if (u) post({ t: 'open', url: new URL(u, location.href).href }); return done({ id: 1 })(cb); }; }
    if (!c.windows) c.windows = { WINDOW_ID_CURRENT: -2, WINDOW_ID_NONE: -1, getCurrent: done({ id: 1, focused: true, type: 'normal', state: 'normal' }), getLastFocused: done({ id: 1, focused: true, type: 'normal' }), getAll: done([{ id: 1, focused: true, type: 'normal' }]), get: done({ id: 1, focused: true }), create: function (o, cb) { var u = o && [].concat(o.url || [])[0]; if (u) post({ t: 'open', url: new URL(u, location.href).href }); return done({ id: 1 })(cb); }, update: done({ id: 1 }), onFocusChanged: ev(), onCreated: ev(), onRemoved: ev() };
  } catch (_) {}
};

module.exports = { Extensions, storeId, crxZip, crxKey, unzip, SHIM };
