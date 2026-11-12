'use strict';
/* Comm: chat apps (Discord, Slack, WhatsApp, Messenger, Telegram, Teams, Google Messages, Instagram, or any site) inside Regis.
   Each app runs in its own view with its own saved sign-in (session "persist:comm-<id>"), keeps running in the background so
   messages and unread counts arrive, and can be muted (no pop-up notifications, no sounds). One app can float as a small chat
   window over every page ("pop out"). */
const path = require('path');
const { WebContentsView, BrowserWindow, ipcMain, session } = require('electron');

const isWeb = (u) => /^https:\/\//i.test(String(u || ''));
const CHROME_UA = (v) => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + String(v || '140.0.0.0').split('.')[0] + '.0.0.0 Safari/537.36';
/* unread count from the page title: "(3) Discord", "* Slack", "• Messenger" */
function unreadOf(title) { const t = String(title || ''); const m = t.match(/^\s*[\(\[](\d{1,4})\+?[\)\]]/); if (m) return +m[1]; if (/^\s*[*•!]\s/.test(t)) return -1; return 0; }

/* 1.9.10: memory of one app's process in MB (shown in its menu, so the owner can see what keeping it running costs) */
function memOf(wc) { try { const pid = wc.getOSProcessId(), m = require('electron').app.getAppMetrics().find((x) => x.pid === pid); return m ? Math.round((m.memory.privateBytes || m.memory.workingSetSize) / 1024) : 0; } catch (_) { return 0; } }
class CommHost {
  constructor({ getWin, load, save, onState, chromeVersion, preload }) {
    this.getWin = getWin; this.load = load; this.save = save; this.onState = onState; this.ua = CHROME_UA(chromeVersion); this.preload = preload;
    const s = this.load() || {}; this.apps = Array.isArray(s.apps) ? s.apps.filter((a) => a && a.id && (isWeb(a.url) || a.native === 'phonelink')) : []; this.muteAll = !!s.muteAll;
    this.views = new Map(); this.active = null; this.visible = false; this.bounds = null; this.float = null; this.floatMin = false; this.fw = null; this.emitT = 0; this.over = false;
    ipcMain.on('cmf:act', (e, a) => { if (!this.fw || e.sender !== this.fw.webContents) return; this._floatAct(a); });
  }
  _win() { const w = this.getWin(); return w && !w.isDestroyed() ? w : null; }
  _persist() { try { this.save({ apps: this.apps.map((a) => ({ id: a.id, name: a.name, url: a.url, native: a.native || '', icon: a.icon || '', color: a.color || '', muted: !!a.muted, bg: a.bg !== false })), muteAll: this.muteAll }); } catch (_) {} }
  muted(id) { const a = this.apps.find((x) => x.id === id); return this.muteAll || !!(a && a.muted); }
  state() {
    return { apps: this.apps.map((a) => { const v = this.views.get(a.id); return { id: a.id, name: a.name, url: a.url, native: a.native || '', icon: a.icon || '', color: a.color || '', muted: !!a.muted, bg: a.bg !== false, live: !!v, mb: v ? memOf(v.wc) : 0, unread: v ? v.unread : 0, title: v ? v.title : '', loading: v ? v.loading : false }; }),
      active: this.active, muteAll: this.muteAll, float: this.float, floatMin: this.floatMin };
  }
  _emit() { if (this.emitT) return; this.emitT = setTimeout(() => { this.emitT = 0; if (this.onState) try { this.onState(this.state()); } catch (_) {} }, 120); }
  _part(id) { return 'persist:comm-' + id; }
  _ensure(a) {
    if (!a || a.native) return null;
    let v = this.views.get(a.id); if (v) return v;
    const ses = session.fromPartition(this._part(a.id));
    if (!ses.__regisComm) {
      ses.__regisComm = true; ses.setUserAgent(this.ua);
      /* notifications are allowed unless this app (or all of Comm) is muted; camera/mic only when asked for calls */
      ses.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'notifications' ? !this.muted(a.id) : ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
      ses.setPermissionCheckHandler((wc, perm) => (perm === 'notifications' ? !this.muted(a.id) : ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
      if (this.preload) try { ses.registerPreloadScript({ type: 'frame', id: 'regis-comm', filePath: this.preload }); } catch (_) {}
    }
    const view = new WebContentsView({ webPreferences: { partition: this._part(a.id), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true, backgroundThrottling: false } });
    try { view.setBackgroundColor('#0b0710'); } catch (_) {}
    const wc = view.webContents; v = { view, wc, unread: 0, title: a.name, loading: true, host: null, shown: false, born: Date.now(), seen: Date.now(), audible: false };
    wc.on('audio-state-changed', (e) => { v.audible = !!(e && e.audible); });
    this.views.set(a.id, v);
    wc.setAudioMuted(this.muted(a.id));
    wc.on('page-title-updated', (_e, t) => { v.title = t; const u = unreadOf(t); if (u !== v.unread) { v.unread = u; this._emit(); this._floatTitle(); } });
    wc.on('did-start-loading', () => { v.loading = true; this._emit(); });
    wc.on('did-stop-loading', () => { v.loading = false; this._emit(); });
    wc.setWindowOpenHandler(({ url }) => { if (this.onLink && /^https?:/i.test(url)) this.onLink(url); return { action: 'deny' }; });
    wc.on('will-navigate', (e, url) => { if (!/^https?:/i.test(url)) e.preventDefault(); });
    wc.on('render-process-gone', () => { this._detach(v); this.views.delete(a.id); this._emit(); });
    wc.loadURL(a.url).catch(() => {});
    return v;
  }
  /* apps set to run in the background start a little after Regis, one by one, so start-up stays quick */
  startBackground() { let n = 0; this.apps.filter((a) => a.bg !== false && !a.native).forEach((a) => { setTimeout(() => { if (this.apps.includes(a)) { this._ensure(a); this._layout(); this._emit(); } }, 6000 + 2500 * n++); }); }
  add(app) {
    /* Phone Link (iMessage) is a native app docked by main, not a web view */
    if (app && app.native === 'phonelink') { if (this.apps.some((a) => a.native === 'phonelink')) throw new Error('iMessage is already in Comm.'); const pl = { id: 'phonelink-' + Math.random().toString(36).slice(2, 7), name: 'iMessage', url: '', native: 'phonelink', color: '#34C759', muted: false, bg: false }; this.apps.push(pl); this._persist(); this.active = pl.id; this._layout(); this._emit(); return pl.id; }
    const url = String(app && app.url || '').trim(); if (!isWeb(url)) throw new Error('Use a secure web address (https://…).');
    if (this.apps.length >= 16) throw new Error('That’s a lot of apps: remove one first.');
    const id = (String(app.key || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16) || 'app') + '-' + Math.random().toString(36).slice(2, 7);
    const a = { id, name: String(app.name || new URL(url).hostname).slice(0, 30), url, icon: String(app.icon || '').slice(0, 20000), color: /^#[0-9a-f]{3,8}$/i.test(app.color || '') ? app.color : '', muted: false, bg: true };
    this.apps.push(a); this._persist(); this.active = id; this._ensure(a); this._layout(); this._emit(); return id;
  }
  async remove(id, wipe) {
    const i = this.apps.findIndex((a) => a.id === id); if (i < 0) return false; this.apps.splice(i, 1);
    const v = this.views.get(id); if (v) { this._detach(v); try { v.wc.close(); } catch (_) {} this.views.delete(id); }
    if (this.active === id) this.active = this.apps[0] ? this.apps[0].id : null; if (this.float === id) this._floatClose();
    if (wipe) { try { await session.fromPartition(this._part(id)).clearStorageData(); } catch (_) {} }
    this._persist(); this._layout(); this._emit(); return true;
  }
  setMute(id, on) { if (id === '*') this.muteAll = !!on; else { const a = this.apps.find((x) => x.id === id); if (!a) return false; a.muted = !!on; } for (const [k, v] of this.views) try { v.wc.setAudioMuted(this.muted(k)); } catch (_) {} this._persist(); this._emit(); return true; }
  setBg(id, on) { const a = this.apps.find((x) => x.id === id); if (!a) return false; a.bg = !!on; this._persist(); this._emit(); return true; }
  reload(id) { const v = this.views.get(id); if (v) v.wc.reload(); return true; }
  muteState(wc) { for (const [k, v] of this.views) if (v.wc === wc) return this.muted(k); return false; }
  /* which views show where: the active app over the Comm page, the floating one over everything */
  show(visible, id) { this.visible = !!visible; if (id && this.apps.some((a) => a.id === id)) this.active = id; if (this.visible && this.active) this._ensure(this.apps.find((a) => a.id === this.active)); this._layout(); this._emit(); return this.state(); }
  setBounds(b) { this.bounds = b ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) } : null; this._layout(); return true; }
  /* pop out: the app moves into a small borderless window that stays above Regis on every page */
  setFloat(id, min) {
    if (id === null) { this._floatClose(); return this.state(); }
    if (id) { const fa = this.apps.find((a) => a.id === id); if (!fa || fa.native) return false; this.float = id; this._ensure(this.apps.find((a) => a.id === id)); this._floatOpen(); }
    if (min !== undefined) this._floatMin(!!min);
    this._layout(); this._emit(); return this.state();
  }
  _floatOpen() {
    const w = this._win(); if (!w) return; if (this.fw && !this.fw.isDestroyed()) { this._floatTitle(); return; }
    const cb = w.getContentBounds(), W = 380, H = 560;
    const fw = new BrowserWindow({ parent: w, frame: false, show: false, width: W, height: H, minWidth: 280, minHeight: 300, x: cb.x + cb.width - W - 18, y: cb.y + cb.height - H - 18,
      skipTaskbar: true, resizable: true, backgroundColor: '#0b0710', title: 'Regis chat', webPreferences: { preload: path.join(__dirname, 'comm-float-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.fw = fw; this.floatMin = false; this.fullH = H;
    fw.loadFile(path.join(__dirname, 'comm-float.html')).then(() => this._floatTitle()).catch(() => {});
    fw.on('resize', () => this._layout()); fw.on('closed', () => { if (this.fw === fw) { this.fw = null; this.float = null; this._layout(); this._emit(); } });
    const sync = () => this._layout(); ['hide', 'show', 'minimize', 'restore'].forEach((ev) => w.on(ev, sync));
    fw.once('ready-to-show', () => { this._layout(); });
  }
  _floatMin(on) {
    const fw = this.fw; if (!fw || fw.isDestroyed()) return; this.floatMin = on; const b = fw.getBounds();
    if (on) { this.fullH = b.height; fw.setMinimumSize(200, 34); fw.setBounds({ x: b.x, y: b.y + b.height - 34, width: Math.max(220, Math.min(b.width, 300)), height: 34 }); fw.setResizable(false); }
    else { const h = this.fullH || 560; fw.setResizable(true); fw.setMinimumSize(280, 300); fw.setBounds({ x: b.x, y: Math.max(0, b.y + b.height - h), width: Math.max(320, b.width), height: h }); }
    this._floatTitle();
  }
  _floatClose() { const fw = this.fw; this.fw = null; const v = this.float && this.views.get(this.float); this.float = null; this.floatMin = false; if (v && v.host === fw) this._detach(v); if (fw && !fw.isDestroyed()) fw.destroy(); this._layout(); this._emit(); }
  _floatAct(a) {
    if (a === 'min') this._floatMin(true); else if (a === 'restore') this._floatMin(false);
    else if (a === 'close') this._floatClose();
    else if (a === 'open') { const id = this.float; this._floatClose(); if (this.onOpen) try { this.onOpen(id); } catch (_) {} }
    this._layout(); this._emit();
  }
  _floatTitle() {
    const fw = this.fw; if (!fw || fw.isDestroyed()) return; const a = this.apps.find((x) => x.id === this.float), v = a && this.views.get(a.id);
    try { fw.webContents.send('cmf:state', { name: a ? a.name : 'Chat', icon: a ? a.icon : '', color: a && a.color || '', unread: v ? v.unread : 0, min: this.floatMin }); } catch (_) {}
  }
  overlay(on) { this.over = !!on; this._layout(); return true; }
  _detach(v) { try { if (v.host && !v.host.isDestroyed()) v.host.contentView.removeChildView(v.view); } catch (_) {} v.host = null; v.shown = false; }
  _put(v, host, bounds) {
    if (v.host !== host) { this._detach(v); try { host.contentView.addChildView(v.view); v.host = host; } catch (_) { return; } }
    try { v.view.setBounds(bounds); } catch (_) {} v.seen = Date.now(); if (!v.shown) { try { v.view.setVisible(true); } catch (_) {} v.shown = true; }
  }
  _hide(v) { if (v.shown) { try { v.view.setVisible(false); } catch (_) {} v.shown = false; } }
  /* 1.9.9: after the graphics process restarts, redraw the chat app on screen (see BrowserHost.repaint) */
  repaint() { let n = 0; this.views.forEach((v) => { if (!v.shown) return; n++; try { v.wc.invalidate(); } catch (_) {} try { const b = v.view.getBounds(); if (b.width > 2) v.view.setBounds(Object.assign({}, b, { width: b.width - 1 })); } catch (_) {} });
    if (n) setTimeout(() => { try { this._layout(); } catch (_) {} }, 80); return n; }
  /* 1.9.10: a chat app NOT set to keep running for notifications is closed after 5 minutes unseen (2 minutes when the computer is
     short of memory); it opens again when you open it. Apps set to keep running are never closed. Called every minute by main. */
  idle(pressure) { const now = Date.now(), lim = pressure ? 120000 : (+process.env.REGIS_COMM_IDLE_MS || 300000); let n = 0;
    this.apps.forEach((a) => { const v = this.views.get(a.id); if (!v || a.bg !== false || v.shown || this.float === a.id || v.audible) return; if (now - (v.seen || v.born || 0) < lim) return;
      this._detach(v); try { v.wc.close(); } catch (_) {} this.views.delete(a.id); n++; });
    if (n) this._emit(); return n; }
  _layout() {
    const w = this._win(); if (!w) return; const winOk = w.isVisible() && !w.isMinimized(); const fw = this.fw && !this.fw.isDestroyed() ? this.fw : null;
    let floatShown = false;
    for (const [id, v] of this.views) {
      const inPage = !this.over && this.visible && this.active === id && this.bounds;
      if (inPage) this._put(v, w, this.bounds);
      else if (fw && this.float === id && !this.floatMin && winOk) { const b = fw.getContentBounds(); this._put(v, fw, { x: 0, y: 34, width: b.width, height: Math.max(0, b.height - 34) }); floatShown = true; }
      else { if (v.host && v.host !== w && !(fw && v.host === fw)) this._detach(v); this._hide(v); if (!v.host) { try { w.contentView.addChildView(v.view); v.host = w; v.view.setVisible(false); } catch (_) {} } }
    }
    /* the floating window: shown with Regis, hidden while its app is open on the Comm page */
    if (fw) { const want = winOk && !(this.visible && this.active === this.float); if (want && !fw.isVisible()) fw.showInactive(); else if (!want && fw.isVisible()) fw.hide(); void floatShown; }
  }
}

module.exports = { CommHost, unreadOf };
