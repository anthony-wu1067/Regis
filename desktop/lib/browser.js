'use strict';
/* Built-in browser for Regis. Each tab is its own sandboxed web page (a WebContentsView) laid over the Browser view's stage.
   Everything uses one persistent session ("persist:regis-browser"), so signing in to Google once keeps you signed in.
   The pages you browse get no access to Regis or to your computer: no Node, no preload, sandboxed, only http(s) allowed. */
const { WebContentsView, session } = require('electron');
const path = require('path');

const PARTITION = 'persist:regis-browser';
const AD_HOSTS = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'adnxs.com', 'taboola.com', 'outbrain.com', 'criteo.com', 'criteo.net',
  'scorecardresearch.com', 'quantserve.com', 'moatads.com', 'adsrvr.org', 'pubmatic.com', 'rubiconproject.com', 'openx.net', 'amazon-adsystem.com', 'hotjar.com', 'adform.net', 'smartadserver.com', 'casalemedia.com', 'advertising.com', 'yieldmo.com'];
const AD_SET = new Set(AD_HOSTS);
const hostBlocked = (h) => { h = String(h || '').toLowerCase(); while (h) { if (AD_SET.has(h)) return true; const i = h.indexOf('.'); if (i < 0) return false; h = h.slice(i + 1); } return false; };

/* in-page scripts (run in the page, results come back as plain data) */
const PROBE_JS = `(function(){var v=function(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0};return Array.prototype.some.call(document.querySelectorAll('input[type=password]'),v)})()`;
const fillJS = (user, pass) => `(function(u,p){var v=function(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0};
  var set=function(el,val){var d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))};
  var pw=Array.prototype.filter.call(document.querySelectorAll('input[type=password]'),v)[0];if(!pw)return {user:false,pass:false};
  var scope=pw.form||document,list=Array.prototype.filter.call(scope.querySelectorAll('input'),function(i){return i!==pw&&v(i)&&/^(text|email|tel|)$/i.test(i.type||'text')}),us=null;
  list.forEach(function(i){if(i.compareDocumentPosition(pw)&Node.DOCUMENT_POSITION_FOLLOWING)us=i});
  if(!us)us=list.filter(function(i){return /user|email|login|account/i.test((i.name||'')+(i.id||'')+(i.autocomplete||''))})[0]||null;
  var res={user:false,pass:false};if(us&&u){set(us,u);res.user=true}set(pw,p);res.pass=true;return res})(${JSON.stringify(String(user || ''))},${JSON.stringify(String(pass || ''))})`;

/* what a person typed in the address bar -> a safe https/http URL, or a Google search */
function resolveInput(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^localhost(:\d+)?([/?#]|$)/i.test(t) && !/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(t)) return 'https://www.google.com/search?q=' + encodeURIComponent(t);
  if (!/\s/.test(t) && (/^localhost(:\d+)?([/?#]|$)/i.test(t) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(t))) return 'http://' + t;
  if (!/\s/.test(t) && /^[^\s/]+\.[a-z]{2,}([/:?#]|$)/i.test(t)) return 'https://' + t;
  return 'https://www.google.com/search?q=' + encodeURIComponent(t);
}
const isWeb = (u) => /^https?:\/\//i.test(String(u || ''));

class BrowserHost {
  constructor({ getWin, onPersist, onCred, shield = true }) {
    this.getWin = getWin; this.onPersist = onPersist || (() => {}); this.onCred = onCred || null; this.pT = null; this.lastPersist = '';
    this.tabs = []; this.active = null; this.n = 0; this.visible = false; this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.shield = !!shield; this.blocked = 0; this.attached = null; this.emitT = null; this.inited = false;
  }
  get ses() { return session.fromPartition(PARTITION); }
  init() {
    if (this.inited) return; this.inited = true;
    const ses = this.ses;
    const ua = (ses.getUserAgent() || '').replace(/\sElectron\/\S+/i, '').replace(/\sregis\/\S+/i, '').replace(/\sRegis\/\S+/i, '');
    ses.setUserAgent(ua);
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-sanitized-write', 'fullscreen', 'pointerLock'].includes(perm)));
    ses.setPermissionCheckHandler((_wc, perm) => ['clipboard-sanitized-write', 'fullscreen'].includes(perm));
    ses.webRequest.onBeforeRequest((d, cb) => {
      if (this.shield && d.resourceType !== 'mainFrame') { try { if (hostBlocked(new URL(d.url).hostname)) { this.blocked++; this._emitSoon(); return cb({ cancel: true }); } } catch (_) {} }
      cb({});
    });
  }
  _win() { const w = this.getWin && this.getWin(); return w && !w.isDestroyed() ? w : null; }
  _tab(id) { return this.tabs.find((t) => t.id === id); }
  snapshot() {
    return { active: this.active, shield: this.shield, blocked: this.blocked,
      tabs: this.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, loading: t.loading, blank: !t.view, canBack: t.canBack, canFwd: t.canFwd, secure: /^https:/i.test(t.url), login: !!t.login })) };
  }
  _emit() { clearTimeout(this.emitT); this.emitT = null; const w = this._win(); if (w) w.webContents.send('browser:state', this.snapshot()); this._persist(); }
  _emitSoon() { if (this.emitT) return; this.emitT = setTimeout(() => this._emit(), 120); }
  _persist(now) {
    clearTimeout(this.pT);
    const run = () => { this.pT = null; try { const urls = this.tabs.filter((t) => t.url).map((t) => t.url).slice(0, 12), k = urls.join('\n'); if (k !== this.lastPersist) { this.lastPersist = k; this.onPersist(urls); } } catch (_) {} };
    if (now) run(); else this.pT = setTimeout(run, 1500);
  }
  flush() { this._persist(true); }
  open(input) {
    this.init();
    const t = { id: ++this.n, title: 'New tab', url: '', view: null, loading: false, canBack: false, canFwd: false };
    this.tabs.push(t); this.active = t.id;
    const u = resolveInput(input); if (u) this._load(t, u);
    this._attach(); this._emit(); return t.id;
  }
  restore(urls) { if (this.tabs.length) return; (urls || []).filter(isWeb).slice(0, 12).forEach((u, i) => { const id = this.open(u); if (i === 0) this.first = id; }); if (this.first) this.activate(this.first); }
  _ensureView(t) {
    if (t.view) return t.view;
    const v = new WebContentsView({ webPreferences: { partition: PARTITION, preload: path.join(__dirname, 'bw-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true, backgroundThrottling: true } });
    const wc = v.webContents; t.view = v;
    const sync = () => { t.url = wc.getURL() || t.url; t.canBack = wc.navigationHistory.canGoBack(); t.canFwd = wc.navigationHistory.canGoForward(); this._emitSoon(); };
    wc.on('page-title-updated', (_e, title) => { t.title = title || t.title; this._emitSoon(); });
    wc.on('did-start-loading', () => { if (!t.loading) { t.loading = true; this._emitSoon(); } });
    const probe = () => { clearTimeout(t.prT); t.prT = setTimeout(() => { if (wc.isDestroyed()) return; wc.executeJavaScript(PROBE_JS).then((r) => { if (!!r !== !!t.login) { t.login = !!r; this._emitSoon(); } }).catch(() => {}); }, 500); };
    wc.on('did-stop-loading', () => { t.loading = false; if (!wc.isDestroyed()) { t.title = wc.getTitle() || t.title; sync(); probe(); } });
    wc.on('did-navigate-in-page', probe);
    wc.on('did-navigate', sync); wc.on('did-navigate-in-page', sync);
    wc.on('will-navigate', (e, url) => { if (!isWeb(url)) e.preventDefault(); });
    wc.on('render-process-gone', () => { t.loading = false; t.title = 'This tab crashed. Reload it.'; this._emitSoon(); });
    wc.setWindowOpenHandler(({ url }) => { if (isWeb(url)) setImmediate(() => this.open(url)); return { action: 'deny' }; });
    return v;
  }
  _load(t, url) { if (!isWeb(url)) return false; const v = this._ensureView(t); t.url = url; t.title = url.replace(/^https?:\/\//i, '').slice(0, 60); v.webContents.loadURL(url).catch(() => {}); return true; }
  go(id, input) { const t = this._tab(id); if (!t) return false; const u = resolveInput(input); if (!u) return false; const ok = this._load(t, u); this._attach(); this._emit(); return ok; }
  _attach() {
    const w = this._win(); if (!w) return;
    const want = this.visible ? ((this._tab(this.active) || {}).view || null) : null;
    if (this.attached && this.attached !== want) { try { w.contentView.removeChildView(this.attached); } catch (_) {} this.attached = null; }
    if (want && this.attached !== want) { w.contentView.addChildView(want); this.attached = want; }
    if (want) want.setBounds(this.bounds);
  }
  setBounds(b) { const n = (v) => Math.max(0, Math.round(+v || 0)); this.bounds = { x: n(b.x), y: n(b.y), width: n(b.width), height: n(b.height) }; if (this.attached) this.attached.setBounds(this.bounds); return true; }
  show(v) { this.visible = !!v; this._attach(); return this.visible; }
  activate(id) { if (!this._tab(id)) return false; this.active = id; this._attach(); this._emit(); return true; }
  close(id) {
    const i = this.tabs.findIndex((t) => t.id === id); if (i < 0) return false;
    const t = this.tabs[i]; const w = this._win();
    if (t.view) { try { if (w && this.attached === t.view) { w.contentView.removeChildView(t.view); this.attached = null; } t.view.webContents.close(); } catch (_) {} t.view = null; }
    this.tabs.splice(i, 1);
    if (!this.tabs.length) { this.active = null; this.open(''); return true; }
    if (this.active === id) this.active = (this.tabs[i] || this.tabs[i - 1]).id;
    this._attach(); this._emit(); return true;
  }
  _wc(id) { const t = this._tab(id || this.active); return t && t.view ? t.view.webContents : null; }
  back(id) { const wc = this._wc(id); if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return !!wc; }
  forward(id) { const wc = this._wc(id); if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return !!wc; }
  reload(id) { const wc = this._wc(id); if (wc) wc.reload(); return !!wc; }
  stop(id) { const wc = this._wc(id); if (wc) wc.stop(); return !!wc; }
  /* a login form was submitted inside a tab (sent by bw-preload.js) */
  cred(sender, d) {
    const t = this.tabs.find((x) => x.view && x.view.webContents === sender); if (!t || !this.onCred || !d) return false;
    const host = String(d.host || '').toLowerCase().slice(0, 200), pass = String(d.pass || '').slice(0, 300); if (!host || !pass) return false;
    try { this.onCred({ tab: t.id, host, url: String(d.url || '').slice(0, 500), user: String(d.user || '').slice(0, 300), pass }); } catch (_) {} return true;
  }
  async fill(id, user, pass) { const wc = this._wc(id); if (!wc) return { user: false, pass: false }; try { return await wc.executeJavaScript(fillJS(user, pass)); } catch (_) { return { user: false, pass: false }; } }
  setShield(on) { this.shield = !!on; this._emit(); return this.shield; }
  destroy() { this.flush(); this.tabs.slice().forEach((t) => { try { t.view && t.view.webContents.close(); } catch (_) {} }); this.tabs = []; this.attached = null; }
}
module.exports = { BrowserHost, resolveInput, hostBlocked, fillJS, PARTITION };
