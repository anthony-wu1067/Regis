'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, safeStorage, shell, session, nativeImage, globalShortcut, Notification, screen } = require('electron');
const path = require('path');
const http = require('http');
const { Store } = require('./lib/store');
const { Google, signIn } = require('./lib/google');
const { Anthropic } = require('./lib/anthropic');
const { agentList } = require('./lib/agents');
const { teamKit } = require('./lib/teamkit');
const { AlertFloat } = require('./lib/alert-float');
const { Ollama, localBase } = require('./lib/ollama');
let alertFloat = null;
const { Canvas, normHost } = require('./lib/canvas');
const { Mini } = require('./lib/mini');
const { Updater } = require('./lib/updater');
const { BrowserHost, keyAction, PARTITION } = require('./lib/browser');
const { Downloads, readFile } = require('./lib/downloads');
const { OfficeDock } = require('./lib/office');
const { Extensions } = require('./lib/extensions');
const { CommHost } = require('./lib/comm');

let plDock = null, commHost = null, runningVersion = null, browserHost = null, linkInApp = false, officeDock = null, officeBye = false;
let win = null, tray = null, quitting = false, capWin = null, mini = null, updater = null;
const BUNDLED_PAGE = path.join(__dirname, 'renderer', 'index.html');
const MINI_KEY = 'CommandOrControl+Shift+M';
function setMini(on) { if (!mini) return false; const r = mini.set(!!on); if (win && !win.isDestroyed()) win.webContents.send('mini:state', r); return r; }
const pendingCaptures = [];
const CAPTURE_KEY = 'CommandOrControl+Shift+Space';
/* 1.9.1 the Regis overlay: a "tell Regis" bar over whatever page is open. Alt+Space (Ctrl+Space would steal Excel's
   select-column and code editors' autocomplete); Ctrl+Alt+Space if another app already uses Alt+Space. */
const OVERLAY_KEYS = ['Alt+Space', 'CommandOrControl+Alt+Space'];
let overlayKey = '';
function summonOverlay() { if (!win || win.isDestroyed()) createWindow(); const was = win.isVisible() && !win.isMinimized() && win.isFocused(); showWindow(); try { win.webContents.send('app:overlay', was); } catch (_) {} }
const wrap = (fn) => async (_e, ...a) => { try { return { ok: true, value: await fn(...a) }; } catch (e) { return { ok: false, error: { code: e.code || 'error', message: e.message || String(e) } }; } };


/* Write start-up crashes to a file and show them, so a failure is never silent. */
function crashLog(err) {
  try {
    const fs = require('fs');
    const f = path.join(app.getPath('userData'), 'regis-error.log');
    fs.appendFileSync(f, '[' + new Date().toISOString() + '] ' + (err && err.stack || err) + '\n');
    return f;
  } catch (_) { return ''; }
}
process.on('uncaughtException', (e) => {
  const f = crashLog(e);
  try { require('electron').dialog.showErrorBox('Regis hit a problem', String(e && e.message || e) + (f ? '\n\nDetails were saved to:\n' + f : '')); } catch (_) {}
});
process.on('unhandledRejection', (e) => { crashLog(e); });

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

function crypt() {
  return safeStorage.isEncryptionAvailable()
    ? { enc: (s) => 'safe:' + safeStorage.encryptString(s).toString('base64'), dec: (s) => safeStorage.decryptString(Buffer.from(s.slice(5), 'base64')) }
    : undefined; // falls back to obfuscated local file (Linux without keyring)
}

function showWindow() { if (!win) createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

function sendCapture(text) {
  text = String(text || '').trim().slice(0, 200); if (!text) return false;
  pendingCaptures.push(text);
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('capture:add', pendingCaptures.splice(0));
  return true;
}
function openCapture() {
  if (capWin && !capWin.isDestroyed()) { capWin.show(); capWin.focus(); return; }
  const d = screen.getPrimaryDisplay().workArea, w = 520, h = 150;
  capWin = new BrowserWindow({
    width: w, height: h, x: Math.round(d.x + (d.width - w) / 2), y: Math.round(d.y + d.height * 0.22), frame: false, resizable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#12101c', title: 'Regis quick capture',
    webPreferences: { preload: path.join(__dirname, 'capture-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  capWin.loadFile(path.join(__dirname, 'renderer', 'capture.html'));
  capWin.once('ready-to-show', () => { capWin.show(); capWin.focus(); });
  capWin.on('blur', () => { if (capWin && !capWin.isDestroyed()) capWin.close(); });
  capWin.on('closed', () => { capWin = null; });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 420, minHeight: 600, backgroundColor: '#0a0713', title: 'Regis', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  /* Background throttling is off (so Spotify keeps playing), which also hides minimise/tray from the page. Tell it, so visuals can pause. */
  const vis = (v) => () => { try { if (win && !win.isDestroyed()) win.webContents.send('win:vis', v); } catch (_) {} };
  win.on('hide', vis(false)); win.on('minimize', vis(false)); win.on('show', vis(true)); win.on('restore', vis(true));
  /* docked Office windows follow the Regis window */
  ['move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'hide', 'show', 'minimize', 'restore'].forEach((ev) => win.on(ev, () => { if (officeDock) officeDock.follow(); if (plDock) plDock.follow(); if (alertFloat) alertFloat.follow(); }));
  const staged = updater && updater.current();      // a newer interface downloaded over the air, if any
  runningVersion = staged ? staged.version : app.getVersion();
  win.loadFile(staged ? path.join(staged.dir, 'index.html') : BUNDLED_PAGE);
  if (staged) { /* fall back to the built-in page only if the staged page itself could not load; a failed iframe/embed or a cancelled load must never throw the update away */
    const onFail = (_e, code, _d, _u, isMainFrame) => { if (!isMainFrame || code === -3) return; win.webContents.removeListener('did-fail-load', onFail); updater.clear(); if (win && !win.isDestroyed()) win.loadFile(BUNDLED_PAGE); runningVersion = app.getVersion(); };
    win.webContents.on('did-fail-load', onFail); win.webContents.once('did-finish-load', () => { if (win && !win.isDestroyed()) win.webContents.removeListener('did-fail-load', onFail); });
  }
  /* web links from Regis (emails, calendar, ...) open in the Regis Browser when the page asked for that (Appearance option), else the default browser */
  const openLink = (url) => { if (!/^https?:/i.test(url)) return; if (linkInApp && win && !win.isDestroyed()) win.webContents.send('app:link', url); else shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { openLink(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openLink(url); } });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } }); // keep running in the tray so autopilot + scheduled sends continue
  win.webContents.on('did-finish-load', () => { if (pendingCaptures.length) win.webContents.send('capture:add', pendingCaptures.splice(0)); });
  win.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); } });
  win.on('enter-full-screen', () => { if (!win.isDestroyed()) win.webContents.send('win:fs', true); });
  win.on('leave-full-screen', () => { if (!win.isDestroyed()) win.webContents.send('win:fs', false); });
  win.on('closed', () => { win = null; if (mini) mini.reset(); });
  win.webContents.on('did-finish-load', () => { if (updater && runningVersion) { const p = updater.pending(runningVersion); if (p) win.webContents.send('update:ready', p.version); } });
  win.webContents.on('did-finish-load', () => { if (mini && mini.on) win.webContents.send('mini:state', true); });
}

/* keep audio smooth: do not let Chromium slow the page down when the window is behind others or minimised to the tray */
for (const sw of ['disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows', 'disable-background-timer-throttling']) app.commandLine.appendSwitch(sw);
/* 1.9.5: after a few graphics-process crashes Chromium stops using the graphics card for the rest of the session (WebGL off: the
   Firewall / Waterwall backgrounds went blank). The owner's Intel driver crashes it several times an evening; keep restarting it. */
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.setAppUserModelId('app.regis.desktop'); // Windows: groups the taskbar icon and lets notifications show as Regis
let DRM = false;
/* when the audio engine's signature file last changed (re-signing clears the page's "Regis can't play" note) */
function drmSig() { try { return String(require('fs').statSync(process.execPath + '.sig').mtimeMs | 0); } catch (_) { return ''; } } /* true only on the castlabs Electron build that ships Widevine (copy-protected audio) */
app.whenReady().then(async () => {
  try { const c = require('electron').components; if (c && c.whenReady) { await Promise.race([c.whenReady(), new Promise((_, no) => setTimeout(() => no(new Error('cdm timeout')), 30000))]); DRM = true; } } catch (_) { DRM = false; } /* never block start-up on it */
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null); /* no File/Edit/View bar: Regis has its own controls */
  mini = new Mini(() => win, screen);
  const store = new Store(app.getPath('userData'), crypt());
  const google = new Google({ creds: () => ({ clientId: store.getMeta('gClientId', ''), clientSecret: store.getSecret('gSecret'), refreshToken: store.getSecret('gRefresh') }) });
  const canvas = new Canvas({ creds: () => ({ host: store.getMeta('cvHost', ''), token: store.getSecret('cvToken') }) });
  updater = new Updater({ dir: path.join(app.getPath('userData'), 'bundle'), bundledVersion: app.getVersion() });
  const updateUrl = () => store.getMeta('updateUrl', '') || '';
  const notifyPending = () => { const p = updater.pending(runningVersion); if (p && win && !win.isDestroyed()) win.webContents.send('update:ready', p.version); return p; };
  const runCheck = async () => { let r = await updater.check(updateUrl()); const p = notifyPending(); if (p) r = { status: 'staged', version: p.version }; return r; };
  /* 1.9.7: the real client. Nothing calls it directly: every Claude call goes through kit.claude, which counts it and enforces the hard caps. */
  const claudeRaw = new Anthropic({ getKey: () => store.getSecret('anthropicKey'), onUsage: (t) => store.addUsage(t) });

  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media' || perm === 'protected-media-identifier'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media' || perm === 'protected-media-identifier');
  ipcMain.handle('app:drm', wrap(() => DRM));
  ipcMain.handle('app:linkMode', wrap((inApp) => { linkInApp = !!inApp; return linkInApp; }));
  /* a site's icon for a shortcut: fetched here (pages can't, because of web security rules); images only, small, http(s) sites only */
  ipcMain.handle('app:favicon', wrap(async (u) => {
    let host = ''; try { const x = new URL(String(u || '')); if (!/^https?:$/.test(x.protocol)) throw 0; host = x.hostname; } catch (_) { throw new Error('Not a web address'); }
    const r = await require('electron').net.fetch('https://www.google.com/s2/favicons?sz=128&domain=' + encodeURIComponent(host));
    if (!r.ok) throw new Error('No icon found');
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp|svg\+xml)$/.test(type)) throw new Error('Not an image');
    const b = Buffer.from(await r.arrayBuffer()); if (b.length > 400000) throw new Error('Icon too large');
    return 'data:' + type + ';base64,' + b.toString('base64');
  }));
  /* Vault device key: lets this computer fill and save logins without the master password. Kept only when the OS can protect it
     (Windows DPAPI / macOS Keychain via safeStorage); never written in a readable form. */
  const vaultSafe = () => { try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; } };
  ipcMain.handle('vault:keyGet', wrap(() => (vaultSafe() ? store.getSecret('vaultDevKey') || '' : '')));
  ipcMain.handle('vault:keySet', wrap((v) => { const k = typeof v === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(v) ? v : ''; if (k && !vaultSafe()) return false; store.setSecret('vaultDevKey', k); return !!k; }));

  ipcMain.handle('spotify:auth', wrap((url) => new Promise((resolve, reject) => {
    let u; try { u = new URL(String(url)); } catch (_) { return reject(new Error('Bad address')); }
    if (u.protocol !== 'https:' || u.hostname !== 'accounts.spotify.com') return reject(new Error('Not a Spotify address'));
    let done = false; const fin = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { srv.close(); } catch (_) {} fn(v); };
    const srv = http.createServer((req, res) => {
      const q = new URL(req.url, 'http://127.0.0.1:8888'); if (q.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><title>Regis</title><body style="font:16px system-ui;background:#0b0816;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><p>Spotify is connected. You can close this tab and go back to Regis.</p>');
      if (q.searchParams.get('error')) fin(reject, new Error('Spotify said: ' + q.searchParams.get('error'))); else fin(resolve, { code: q.searchParams.get('code') || '', state: q.searchParams.get('state') || '' });
    });
    const timer = setTimeout(() => fin(reject, new Error('Spotify sign-in timed out')), 5 * 60 * 1000);
    srv.on('error', (e) => fin(reject, new Error(e.code === 'EADDRINUSE' ? 'Port 8888 is busy. Close whatever uses it and try again.' : String(e.message))));
    srv.listen(8888, '127.0.0.1', () => { shell.openExternal(u.toString()); });
  })));
  ipcMain.handle('db:load', wrap(() => store.getDb()));
  ipcMain.handle('db:save', wrap((db) => { store.setDb(db); return true; }));
  ipcMain.handle('mcp:call', wrap((server, tool, input) => server === 'Canvas' ? canvas.callTool(tool, input || {}) : google.callTool(server, tool, input)));
  /* 1.9.4 Local AI (Ollama on this computer). Settings in store meta 'aiLocal': { model, use: {regis|agentId: 'local'|'claude'}, fallback, base } */
  const AGENT_IDS = ['regis'].concat(agentList().map((a) => a.id));
  const aiPrefs = () => { const p = store.getMeta('aiLocal', {}) || {}; return { model: String(p.model || ''), use: p.use && typeof p.use === 'object' ? p.use : {}, fallback: p.fallback !== false, base: localBase(p.base) }; };
  const ollama = new Ollama({ getBase: () => aiPrefs().base });
  ipcMain.handle('ai:localStatus', wrap(async () => Object.assign(await ollama.status(), { prefs: aiPrefs() })));
  ipcMain.handle('ai:localSet', wrap((p) => { p = p && typeof p === 'object' ? p : {}; const cur = aiPrefs(), use = {};
    AGENT_IDS.forEach((id) => { const v = p.use && p.use[id] !== undefined ? p.use[id] : cur.use[id]; if (v === 'local' || v === 'claude') use[id] = v; });
    const next = { model: p.model !== undefined ? String(p.model).slice(0, 120) : cur.model, use, fallback: p.fallback !== undefined ? !!p.fallback : cur.fallback, base: localBase(p.base !== undefined ? p.base : cur.base) };
    store.setMeta('aiLocal', next); return next; }));
  ipcMain.handle('ai:localTry', wrap(async () => { const p = aiPrefs(); const t0 = Date.now(); const r = await ollama.sample('Reply with exactly this sentence: Local AI is working.', { model: p.model, maxTokens: 40 }); return { text: r.text.slice(0, 200), ms: Date.now() - t0 }; }));
  ipcMain.handle('ai:localPull', wrap(async (name) => { await ollama.pull(name, (pr) => send('ai:pull', pr)); send('ai:pull', { name: String(name), status: 'success', pct: 100, done: true }); return true; }));
  ipcMain.handle('claude:sample', wrap(async (input, opts = {}) => {
    const p = aiPrefs();
    if (p.model && p.use.regis === 'local') {
      try { const r = await ollama.sample(input, { model: p.model, maxTokens: opts.maxTokens || 2048, json: !!opts.json }); return opts.json ? { value: Anthropic.parseJson(r.text) } : r; }
      catch (e) { if (!p.fallback) throw e; }
    }
    return kit.sample(input, opts);   /* 1.9.7: counted as team 'regis' and capped like every other Claude call */
  }));
  /* 1.9.1 Guild: AI workspaces. One table of chat rows (context_scope = agent id) in Regis's data file; each request only ever
     reads its own scope, and the agent's persona goes in as the system prompt (lib/agents.js) */
  const kit = teamKit({ anthropic: claudeRaw, local: ollama, prefs: aiPrefs, table: (k, d) => ({ load: () => store.getMeta(k, d), save: (v) => store.setMeta(k, v) }) }), guild = kit.guild;
  ipcMain.handle('guild:agents', wrap(() => agentList()));
  ipcMain.handle('guild:history', wrap((id) => guild.history(String(id || ''))));
  ipcMain.handle('guild:send', wrap((id, text, extra) => guild.send(String(id || ''), text, extra && typeof extra === 'object' ? { tasks: extra.tasks, file: extra.file, addins: extra.addins } : {})));
  ipcMain.handle('guild:clear', wrap((id) => guild.clear(String(id || ''))));
  /* 1.9.7 Teams: the organisation under the four leads (specialists, tools, workflows, memory, policy), the queue's orchestrator and the Claude ledger */
  ['get', 'policy', 'global', 'run', 'memAdd', 'memDel', 'ledger'].forEach((k) => ipcMain.handle('team:' + k, wrap((...a) => kit.api[k](...a))));
  ipcMain.handle('app:status', wrap(() => ({
    googleConfigured: !!(store.getMeta('gClientId', '') && store.getSecret('gSecret')), googleConnected: !!store.getSecret('gRefresh'),
    googleEmail: store.getMeta('gEmail', ''), anthropicKey: !!store.getSecret('anthropicKey'), usage: store.monthUsage(),
    canvasConnected: !!(store.getMeta('cvHost', '') && store.getSecret('cvToken')), canvasHost: (store.getMeta('cvHost', '') || '').replace(/^https?:\/\//, ''),
    openAtLogin: app.getLoginItemSettings().openAtLogin, voice: true, overlayKey, version: runningVersion || app.getVersion(), shell: app.getVersion(), drm: DRM, drmSig: drmSig(), updateUrl: updateUrl()
  })));
  ipcMain.handle('app:saveGoogle', wrap(({ clientId, clientSecret }) => {
    if (clientId) store.setMeta('gClientId', String(clientId).trim()); if (clientSecret) store.setSecret('gSecret', String(clientSecret).trim()); return true; }));
  ipcMain.handle('app:connectGoogle', wrap(async () => {
    const r = await signIn({ clientId: store.getMeta('gClientId', ''), clientSecret: store.getSecret('gSecret'), openExternal: (u) => shell.openExternal(u) });
    store.setSecret('gRefresh', r.refreshToken); store.setMeta('gEmail', r.email || ''); google.at = null; showWindow(); return true; }));
  ipcMain.handle('app:disconnectGoogle', wrap(() => { store.setSecret('gRefresh', ''); store.setMeta('gEmail', ''); google.at = null; return true; }));
  ipcMain.handle('app:saveCanvas', wrap(async ({ url, token }) => {
    const host = normHost(url), tk = String(token || '').trim(); if (!tk) { const e = new Error('Paste your Canvas access token.'); e.code = 'no_token'; throw e; }
    const probe = new Canvas({ creds: () => ({ host, token: tk }) }); const who = await probe.whoami();
    store.setMeta('cvHost', host); store.setSecret('cvToken', tk); return who; }));
  ipcMain.handle('app:removeCanvas', wrap(() => { store.setMeta('cvHost', ''); store.setSecret('cvToken', ''); return true; }));
  ipcMain.handle('app:saveKey', wrap((k) => { store.setSecret('anthropicKey', String(k || '').trim()); return true; }));
  ipcMain.handle('app:saveUpdateUrl', wrap((u) => { store.setMeta('updateUrl', String(u || '').trim()); return true; }));
  ipcMain.handle('app:updateCheck', wrap(() => runCheck()));
  ipcMain.handle('app:updateApply', wrap(() => { const st = updater.current(); if (!st || !win) return false; runningVersion = st.version; win.loadFile(path.join(st.dir, 'index.html')); return true; }));
  const send = (ch, v) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, v); } catch (_) {} };
  /* browsing history (for address-bar suggestions and Ctrl+H): newest first, one entry per address, last 2000 */
  let HIST = []; try { HIST = JSON.parse(store.getMeta('bwHistory', '[]') || '[]'); } catch (_) {} let histT = null;
  const histSave = () => { clearTimeout(histT); histT = setTimeout(() => store.setMeta('bwHistory', JSON.stringify(HIST.slice(0, 2000))), 1500); };
  const histAdd = (h) => { const u = String(h.u || '').slice(0, 800); if (!/^https?:\/\//i.test(u)) return; const at = Date.now(); const i0 = HIST.findIndex((x) => x.u === u);
    if (i0 >= 0) { const x = HIST.splice(i0, 1)[0]; if (h.t) x.t = String(h.t).slice(0, 200); if (at - (x.at || 0) > 30000) x.n = (x.n || 1) + 1; x.at = at; HIST.unshift(x); } else HIST.unshift({ u, t: String(h.t || '').slice(0, 200), at, n: 1 }); if (HIST.length > 2200) HIST.length = 2000; histSave(); };
  const histFind = (q, n) => { q = String(q || '').toLowerCase().trim(); n = Math.max(1, Math.min(200, +n || 8)); if (!q) return HIST.slice(0, n);
    const w = q.split(/\s+/); const sc = (x) => { const s2 = (x.u + ' ' + (x.t || '')).toLowerCase(); if (!w.every((k) => s2.indexOf(k) >= 0)) return -1; const host = x.u.replace(/^https?:\/\/(www\.)?/i, '').toLowerCase(); return (host.indexOf(q) === 0 ? 50 : 0) + Math.min(30, (x.n || 1) * 3) + Math.max(0, 20 - (Date.now() - x.at) / 864e5); };
    return HIST.map((x) => [sc(x), x]).filter((p) => p[0] >= 0).sort((a, b) => b[0] - a[0]).slice(0, n).map((p) => p[1]); };
  /* Easy Files: a site asked for a file; Regis's picker answers through these one-time tokens */
  const filePend = new Map();
  browserHost = new BrowserHost({ getWin: () => win, sleepMin: +store.getMeta('bwSleep', 30), onFind: (r) => send('browser:find', r), onHistory: histAdd, onPerm: (p) => send('browser:perm', p), permLoad: () => store.getMeta('bwPerms', {}) || {}, permSave: (v) => store.setMeta('bwPerms', v), onFilePick: (r) => { filePend.set(r.token, { wc: r.wc, multiple: r.multiple, at: Date.now() }); if (filePend.size > 30) filePend.delete(filePend.keys().next().value); send('browser:filepick', { token: r.token, accept: r.accept, multiple: r.multiple, host: r.host, tab: r.tab }); }, onKey: (k) => { if (win && !win.isDestroyed()) win.webContents.send('browser:key', k); }, onCred: (c) => { if (win && !win.isDestroyed()) win.webContents.send('browser:cred', c); }, shield: store.getMeta('bwShield', '1') !== '0', onPersist: (urls) => store.setMeta('bwTabs', JSON.stringify(urls)) });
  const dl = new Downloads({ dir: app.getPath('downloads'), load: () => { try { return JSON.parse(store.getMeta('downloads', '[]') || '[]'); } catch (_) { return []; } }, save: (l) => store.setMeta('downloads', JSON.stringify(l)), onChange: (l) => send('browser:downloads', l), onDone: (d) => send('browser:dldone', d) });
  dl.attach(session.fromPartition(PARTITION));
  const bw = browserHost;
  /* 1.9.0: if the graphics process restarts, the page redraws its backgrounds (pre-drawn layers are lost otherwise) */
  app.on('child-process-gone', (_e, d) => {
    /* a small log so a crash can be confirmed later: <userData>/regis-events.log (type, reason, exit code; nothing personal) */
    try { require('fs').appendFileSync(path.join(app.getPath('userData'), 'regis-events.log'), new Date().toISOString() + ' ' + (d && d.type) + ' ' + (d && d.reason) + ' ' + (d && d.exitCode) + '\n'); } catch (_) {}
    if (d && d.type === 'GPU') setTimeout(() => send('app:gpuReset', true), 1200);
  });
  bw.onActive = () => { try { if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) win.webContents.send('win:vis', true); } catch (_) {} };
  /* 1.8.5 Chrome extensions, loaded into the browser's session only (never into Regis's own pages) */
  const bses = session.fromPartition(PARTITION);
  const exts = new Extensions({ root: path.join(app.getPath('userData'), 'extensions'), getSession: () => bses, chromeVersion: process.versions.chrome, onChange: (l) => send('ext:list', l) });
  try { const pf = exts.preloadFile(); bses.registerPreloadScript({ type: 'frame', id: 'regis-ext', filePath: pf }); bses.registerPreloadScript({ type: 'service-worker', id: 'regis-ext-sw', filePath: pf }); } catch (e) { console.warn('extension preload', e.message); }
  const isExtUrl = (u) => /^chrome-extension:\/\//.test(String(u || ''));
  const extOf = (u) => { const m = String(u || '').match(/^chrome-extension:\/\/([a-p]{32})\//); return m ? m[1] : ''; };
  /* extension pages that need a window of their own (options, pages they open) */
  const extWindow = (u) => { const w2 = new BrowserWindow({ width: 980, height: 720, backgroundColor: '#0a0713', title: 'Extension', autoHideMenuBar: true, webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true } }); w2.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) { bw.open(url); send('ext:showBrowser'); } else if (isExtUrl(url)) extWindow(url); return { action: 'deny' }; }); w2.loadURL(u).catch(() => {}); return w2; };
  const extMsg = (extId, m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'badge') exts.setBadge(extId, m.text);
    else if (m.t === 'note' && Notification.isSupported()) { try { new Notification({ title: String(m.title || 'Extension').slice(0, 80), body: String(m.body || '').slice(0, 300) }).show(); } catch (_) {} }
    else if (m.t === 'open' && m.url) { const u = String(m.url); if (isExtUrl(u)) extWindow(u); else if (/^https?:/.test(u)) { bw.open(u); send('ext:showBrowser'); } }
    else if (m.t === 'options') { const rid = exts.byExt(extId), e = exts.list().find((x) => x.id === rid); if (e && e.options) extWindow(exts.pageUrl(rid, e.options)); }
  };
  ipcMain.on('ext:msg', (e, m) => { const id = extOf(e.senderFrame && e.senderFrame.url); if (id) extMsg(id, m); });
  ipcMain.handle('ext:tabs', (e, q) => (isExtUrl(e.senderFrame && e.senderFrame.url) ? bw.extTabs(q || {}) : []));
  try { bses.serviceWorkers.on('running-status-changed', (d) => { try { const sw = bses.serviceWorkers.getWorkerFromVersionID(d.versionId); if (!sw || sw.__regis || !isExtUrl(sw.scope)) return; sw.__regis = true; const id = extOf(sw.scope);
    sw.ipc.handle('ext:tabs', (_e, q) => bw.extTabs(q || {})); sw.ipc.on('ext:msg', (_e, m) => extMsg(id, m)); } catch (_) {} }); } catch (_) {}
  /* the toolbar popup: a small borderless window under the button, closed when it loses focus */
  let extPop = null;
  const openPopup = async (rid, at) => {
    const e = exts.list().find((x) => x.id === rid); if (!e || !e.popup) throw new Error('This extension has no popup.');
    if (extPop && !extPop.isDestroyed()) extPop.close();
    const p = new BrowserWindow({ parent: win, show: false, frame: false, resizable: false, skipTaskbar: true, width: 360, height: 420, backgroundColor: '#1b1a24', webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true } });
    extPop = p; p.on('blur', () => { setTimeout(() => { if (!p.isDestroyed() && !p.isFocused()) p.close(); }, 150); });
    p.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) { bw.open(url); send('ext:showBrowser'); } else if (isExtUrl(url)) extWindow(url); return { action: 'deny' }; });
    const cb = win.getContentBounds(), x = Math.round(cb.x + (+at.x || 0)), y = Math.round(cb.y + (+at.y || 0));
    await p.loadURL(exts.pageUrl(rid, e.popup)).catch(() => {});
    const fit = async () => { try { if (p.isDestroyed()) return; const r = await p.webContents.executeJavaScript('[Math.max(document.documentElement.scrollWidth,document.body?document.body.scrollWidth:0),Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)]'); const w2 = Math.min(800, Math.max(200, r[0] | 0)), h2 = Math.min(600, Math.max(80, r[1] | 0)); if (!p.isDestroyed()) p.setBounds({ x: Math.max(cb.x, x - w2), y, width: w2, height: h2 }); } catch (_) {} };
    await fit(); if (!p.isDestroyed()) { p.show(); p.focus(); } setTimeout(fit, 400); setTimeout(fit, 1200); return true;
  };
  const extReady = exts.loadAll().catch(() => {});
  /* 1.8.9 Comm: chat apps in their own signed-in views; one can float over every page */
  commHost = new CommHost({ getWin: () => win, chromeVersion: process.versions.chrome,
    load: () => { try { return JSON.parse(store.getMeta('comm', '{}') || '{}'); } catch (_) { return {}; } }, save: (o) => store.setMeta('comm', JSON.stringify(o)), onState: (st) => send('comm:state', st) });
  commHost.onLink = (u) => { bw.open(u); send('ext:showBrowser'); };
  commHost.onOpen = (id) => { send('comm:open', id); try { if (win && !win.isDestroyed()) win.focus(); } catch (_) {} };
  { const oe = bw._emit.bind(bw); bw._emit = function () { oe(); try { commHost._layout(); } catch (_) {} }; }
  ipcMain.handle('comm:state', wrap(() => commHost.state()));
  ipcMain.handle('comm:add', wrap((a) => commHost.add(a || {})));
  ipcMain.handle('comm:remove', wrap((id, wipe) => commHost.remove(String(id), !!wipe)));
  ipcMain.handle('comm:mute', wrap((id, on) => commHost.setMute(String(id), !!on)));
  ipcMain.handle('comm:bg', wrap((id, on) => commHost.setBg(String(id), !!on)));
  ipcMain.handle('comm:reload', wrap((id) => commHost.reload(String(id))));
  ipcMain.handle('comm:show', wrap((v, id) => commHost.show(!!v, id ? String(id) : null)));
  ipcMain.handle('comm:bounds', wrap((b) => commHost.setBounds(b || null)));
  ipcMain.handle('comm:float', wrap((id, min) => commHost.setFloat(id === null ? null : id ? String(id) : undefined, min === undefined || min === null ? undefined : !!min)));
  ipcMain.handle('comm:overlay', wrap((on) => commHost.overlay(!!on)));
  ipcMain.handle('comm:phoneLink', wrap(() => shell.openExternal('ms-phone:').then(() => true)));
  /* 1.9.0 iMessage through Phone Link: the real Phone Link app docked into the Comm page (same way as Office) */
  plDock = new OfficeDock(() => win, path.join(__dirname, 'lib', 'office-dock.ps1'), ['phonelink']);
  plDock.onState = (st) => send('comm:pl', { docked: st.docs.some((d) => d.docked), waiting: !!st.waiting });
  ipcMain.handle('comm:plState', wrap(async () => Object.assign(plDock.state(), { rect: plDock.rect, screen: plDock._screenRect(), helper: !!plDock.ps, list: plDock.ps ? await plDock._cmd({ op: 'list' }).catch(() => null) : null })));
  ipcMain.handle('comm:plInstalled', wrap(() => process.platform === 'win32' && plDock.phoneLinkInstalled()));
  ipcMain.handle('comm:native', wrap(async (v, r) => {
    if (process.platform !== 'win32') throw new Error('Phone Link needs Windows.');
    if (r) plDock.bounds(r);
    if (!v) { await plDock.show(false); return true; }
    await plDock.show(true, 0, true);
    if (!plDock.state().docs.some((d) => d.docked)) { await plDock.startPhoneLink(); await plDock.scan(); }
    return true;
  }));
  ipcMain.handle('comm:plOpen', wrap(async () => { const st = plDock.state(); for (const d of st.docs) if (d.docked) await plDock.release(d.h); return shell.openExternal('ms-phone:').then(() => true).catch(() => plDock.startPhoneLink()); }));
  setTimeout(() => { try { commHost.startBackground(); } catch (_) {} }, 1500);
  ipcMain.handle('ext:list', wrap(async () => { await extReady; return exts.list(); }));
  ipcMain.handle('ext:install', wrap((link) => exts.installStore(String(link || ''))));
  ipcMain.handle('ext:installPick', wrap(async (folder) => { const r = await require('electron').dialog.showOpenDialog(win, folder ? { title: 'Choose an unpacked extension folder', properties: ['openDirectory'] } : { title: 'Choose an extension file', properties: ['openFile'], filters: [{ name: 'Chrome extension', extensions: ['crx', 'zip'] }] }); if (r.canceled || !r.filePaths.length) return null; return folder ? exts.installFolder(r.filePaths[0]) : exts.installFile(r.filePaths[0]); }));
  ipcMain.handle('ext:on', wrap((id, on) => exts.setOn(String(id), !!on)));
  ipcMain.handle('ext:remove', wrap((id) => exts.remove(String(id))));
  ipcMain.handle('ext:popup', wrap((id, at) => openPopup(String(id), at || {})));
  ipcMain.handle('ext:options', wrap((id) => { const e = exts.list().find((x) => x.id === String(id)); if (!e || !e.options) throw new Error('This extension has no options page.'); extWindow(exts.pageUrl(e.id, e.options)); return true; }));
  ipcMain.handle('browser:state', wrap(async () => { await extReady; return (() => { if (!bw.tabs.length) { let urls = []; try { urls = JSON.parse(store.getMeta('bwTabs', '[]') || '[]'); } catch (_) {} bw.init(); if (urls.length) bw.restore(urls); else bw.open(''); } return bw.snapshot(); })(); }));
  ipcMain.handle('browser:open', wrap((u) => bw.open(u)));
  ipcMain.handle('browser:close', wrap((id) => bw.close(+id)));
  ipcMain.handle('browser:activate', wrap((id) => bw.activate(+id)));
  ipcMain.handle('browser:go', wrap((id, text) => bw.go(+id, text)));
  ipcMain.handle('browser:back', wrap((id) => bw.back(+id)));
  ipcMain.handle('browser:forward', wrap((id) => bw.forward(+id)));
  ipcMain.handle('browser:reload', wrap((id) => bw.reload(+id)));
  ipcMain.handle('browser:stop', wrap((id) => bw.stop(+id)));
  ipcMain.handle('browser:bounds', wrap((b) => bw.setBounds(b || {})));
  ipcMain.handle('browser:show', wrap((v, snap) => bw.show(!!v, snap !== false)));
  ipcMain.on('bw:cred', (e, d) => { try { bw.cred(e.sender, d); } catch (_) {} });
  ipcMain.on('bw:shieldOn', (e) => { e.returnValue = !!bw.shield; });
  /* 1.9.5: "/" on a web page (outside a text box) jumps to Regis's address bar; the Web Store gets an "Add to Regis" button */
  const isTab = (wc) => bw.tabs.some((t) => t.view && t.view.webContents === wc);
  ipcMain.on('bw:slash', (e) => { try { if (!isTab(e.sender)) return; const t = bw.tabs.find((x) => x.view && x.view.webContents === e.sender); try { if (win && !win.isDestroyed()) win.webContents.focus(); } catch (_) {} bw.key('addr', t && t.id); } catch (_) {} });
  ipcMain.on('bw:extInstall', async (e, url) => { const wc = e.sender; const back = (ok, msg) => { try { if (!wc.isDestroyed()) wc.send('bw:extDone', { ok, msg }); } catch (_) {} };
    try { if (!isTab(wc)) return; const u = new URL(String(url || '')); if (u.protocol !== 'https:' || !/^(chromewebstore\.google\.com|chrome\.google\.com)$/.test(u.hostname)) return back(false, 'Not a Web Store page.');
      const r = await exts.installStore(u.toString()); back(true, 'Added to Regis' + (r && r.name ? ': ' + r.name : '') + '.'); }
    catch (err) { back(false, (err && err.message) || 'Could not add it.'); } });
  ipcMain.handle('browser:fill', wrap((id, user, pass) => bw.fill(+id, user, pass)));
  ipcMain.handle('browser:shield', wrap((on) => { store.setMeta('bwShield', on ? '1' : '0'); return bw.setShield(!!on); }));
  ipcMain.handle('browser:move', wrap((id, to) => bw.move(+id, +to)));
  ipcMain.handle('browser:duplicate', wrap((id) => bw.duplicate(+id)));
  ipcMain.handle('browser:reopen', wrap(() => bw.reopen()));
  ipcMain.handle('browser:mute', wrap((id, on) => bw.mute(+id, on === undefined ? undefined : !!on)));
  ipcMain.handle('browser:find', wrap((id, text, o) => bw.find(+id, String(text || '').slice(0, 300), { back: !!(o && o.back), next: !!(o && o.next) })));
  ipcMain.handle('browser:stopFind', wrap((id) => bw.stopFind(+id)));
  ipcMain.handle('browser:print', wrap((id) => bw.print(+id)));
  ipcMain.handle('browser:zoom', wrap((id, lv) => bw.zoom(+id, +lv)));
  ipcMain.handle('browser:sleep', wrap((id) => bw.sleep(+id)));
  ipcMain.handle('browser:setSleep', wrap((m) => { const v = bw.setSleep(+m); store.setMeta('bwSleep', v); return v; }));
  ipcMain.handle('browser:viewKeys', wrap((k) => { keyAction.views = String(k || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 26); return keyAction.views; }));
  ipcMain.handle('browser:history', wrap((q, n) => histFind(q, n)));
  ipcMain.handle('browser:historyDel', wrap((u) => { HIST = HIST.filter((x) => x.u !== String(u)); histSave(); return true; }));
  ipcMain.handle('browser:permAnswer', wrap((id, allow, remember) => bw.permAnswer(+id, !!allow, !!remember)));
  ipcMain.handle('browser:perms', wrap(() => bw.permList()));
  ipcMain.handle('browser:permForget', wrap((h) => bw.permForget(String(h || ''))));
  /* 1.9.1 alerts drawn above web pages / docked apps (lib/alert-float.js) */
  alertFloat = new AlertFloat({ getWin: () => win, onAct: (a) => send('alert:act', a) });
  ipcMain.handle('alert:float', wrap((list, rect) => { const th = rect && rect.theme; return alertFloat.show(list, rect, th && typeof th === 'object' ? th : {}); }));
  ipcMain.handle('browser:clear', wrap(async (o) => { o = o || {}; if (o.history) { HIST = []; histSave(); } if (o.downloads) dl.clear(); await bw.clearData({ cache: !!o.cache, cookies: !!o.cookies }); return true; }));
  ipcMain.on('bw:filepick', (e, d) => { try { bw.filePick(e.sender, d); } catch (_) {} });
  ipcMain.handle('browser:fileGive', wrap(async (token, c) => {
    const p = filePend.get(String(token)); if (!p) return false; filePend.delete(String(token)); c = c || {};
    if (p.wc.isDestroyed()) return false;
    if (c.cancel) return true;
    if (c.native) { p.wc.send('bw:files', { token, native: true }); return true; }
    let files = [];
    if (c.browse) { const r = await require('electron').dialog.showOpenDialog(win, { properties: ['openFile'].concat(p.multiple ? ['multiSelections'] : []) }); if (r.canceled) return false; files = (r.filePaths || []).slice(0, p.multiple ? 20 : 1).map(readFile); }
    else files = (Array.isArray(c.ids) ? c.ids : []).slice(0, p.multiple ? 20 : 1).map((id) => dl.read(id));
    if (files.length) p.wc.send('bw:files', { token, files: files.map((f) => ({ name: f.name, type: f.type, data: new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength) })) });
    return files.length;
  }));
  /* Office page: Word/Excel/PowerPoint files in Documents, Downloads, Desktop and OneDrive (newest first). Only files from this list can be opened. */
  const OFFICE_EXT = /\.(docx?|docm|rtf|odt|xlsx?|xlsm|csv|ods|pptx?|pptm|odp)$/i; let officeSeen = new Set();
  ipcMain.handle('office:recent', wrap(async () => {
    const fsp = require('fs').promises, home = app.getPath('home'), roots = [];
    const add = (p, label) => { if (p && !roots.some((r) => r.p.toLowerCase() === String(p).toLowerCase())) roots.push({ p, label }); };
    add(app.getPath('documents'), 'Documents'); add(app.getPath('downloads'), 'Downloads'); add(app.getPath('desktop'), 'Desktop');
    ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'].forEach((k) => add(process.env[k], 'OneDrive'));
    const out = []; let seen = 0;
    const walk = async (dir, depth, label) => {
      if (depth > 3 || seen > 6000) return; let ents = [];
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of ents) { seen++; if (seen > 6000) return; const n = e.name; if (n.startsWith('.') || n.startsWith('~$') || /^(node_modules|AppData|\$RECYCLE\.BIN)$/i.test(n)) continue; const p = path.join(dir, n);
        if (e.isDirectory()) await walk(p, depth + 1, label);
        else if (OFFICE_EXT.test(n)) { try { const st = await fsp.stat(p); out.push({ path: p, name: n, size: st.size, mtime: st.mtimeMs, where: label + (path.dirname(p).length > 0 && path.dirname(p) !== roots.find((r) => r.label === label).p ? ' › ' + path.basename(path.dirname(p)) : '') }); } catch (_) {} } }
    };
    for (const r of roots) await walk(r.p, 0, r.label);
    const uniq = new Map(); out.forEach((f) => uniq.set(f.path.toLowerCase(), f));
    const list = [...uniq.values()].sort((a, b) => b.mtime - a.mtime).slice(0, 200);
    officeSeen = new Set(list.map((f) => f.path)); void home; return list;
  }));
  ipcMain.handle('office:open', wrap(async (p) => { p = String(p || ''); if (!officeSeen.has(p)) throw new Error('Refresh the list and try again.'); const e = await shell.openPath(p); if (e) throw new Error(e); return true; }));
  officeDock = new OfficeDock(() => win, path.join(__dirname, 'lib', 'office-dock.ps1'));
  officeDock.onState = (st) => { try { if (win && !win.isDestroyed()) win.webContents.send('office:dock', st); } catch (_) {} };
  const needDock = () => { if (!officeDock.available()) throw new Error('Docking Office apps needs Windows.'); return officeDock; };
  ipcMain.handle('office:dockApps', wrap(() => (officeDock.available() ? officeDock.apps() : null)));
  ipcMain.handle('office:dockState', wrap(() => needDock().state()));
  ipcMain.handle('office:dockShow', wrap((v, h, f) => needDock().show(!!v, +h || 0, !!f)));
  ipcMain.handle('office:dockBounds', wrap((r) => { if (officeDock.available()) officeDock.bounds(r || {}); return true; }));
  ipcMain.handle('office:dockNew', wrap((k) => needDock().create(String(k || ''))));
  ipcMain.handle('office:dockStart', wrap((k) => needDock().start(String(k || ''))));
  ipcMain.handle('office:dockPick', wrap((k) => needDock().pick(String(k || ''))));
  ipcMain.handle('office:dockOpen', wrap((p) => { p = String(p || ''); if (!officeSeen.has(p)) throw new Error('Refresh the list and try again.'); return needDock().openPath(p); }));
  ipcMain.handle('office:dockClose', wrap((h) => needDock().close(+h)));
  ipcMain.handle('office:dockAdopt', wrap((h) => needDock().adopt(+h)));
  ipcMain.handle('office:dockRelease', wrap((h) => needDock().release(+h)));
  ipcMain.handle('office:dockFocus', wrap(() => needDock().focus()));
  ipcMain.handle('office:show', wrap((p) => { p = String(p || ''); if (!officeSeen.has(p)) throw new Error('Refresh the list and try again.'); shell.showItemInFolder(p); return true; }));
  /* downloads list and actions (Ctrl+J panel) */
  ipcMain.handle('dl:list', wrap(() => dl.list()));
  ipcMain.handle('dl:open', wrap((id) => { const p = dl.pathOf(id); if (!p) throw new Error('That file is no longer there.'); return shell.openPath(p); }));
  ipcMain.handle('dl:show', wrap((id) => { const p = dl.pathOf(id); if (p) shell.showItemInFolder(p); else shell.openPath(app.getPath('downloads')); return true; }));
  ipcMain.handle('dl:cancel', wrap((id) => dl.cancel(id)));
  ipcMain.handle('dl:pause', wrap((id) => dl.pause(id)));
  ipcMain.handle('dl:resume', wrap((id) => dl.resume(id)));
  ipcMain.handle('dl:remove', wrap((id) => dl.remove(id)));
  ipcMain.handle('dl:clear', wrap(() => dl.clear()));
  ipcMain.handle('dl:folder', wrap(() => shell.openPath(app.getPath('downloads'))));
  /* a finished download as bytes, for an upload inside Regis itself */
  ipcMain.handle('dl:read', wrap((id) => { const f = dl.read(id); return { name: f.name, type: f.type, data: new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength) }; }));
  ipcMain.handle('win:fullscreen', wrap((on) => { if (!win) return false; win.setFullScreen(typeof on === 'boolean' ? on : !win.isFullScreen()); return win.isFullScreen(); }));
  ipcMain.handle('win:fsState', wrap(() => !!(win && win.isFullScreen())));
  ipcMain.handle('app:mini', wrap((on) => setMini(!!on)));
  ipcMain.handle('app:miniState', wrap(() => !!(mini && mini.on)));
  ipcMain.handle('app:notify', wrap((title, body) => {
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: String(title || 'Regis').slice(0, 120), body: String(body || '').slice(0, 240), icon: path.join(__dirname, 'assets', 'icon.png') });
    n.on('click', () => showWindow()); n.show(); return true; }));
  ipcMain.handle('capture:submit', wrap((text) => { const ok = sendCapture(text); if (capWin && !capWin.isDestroyed()) capWin.close(); return ok; }));
  ipcMain.handle('capture:close', wrap(() => { if (capWin && !capWin.isDestroyed()) capWin.close(); return true; }));
  ipcMain.handle('app:openAtLogin', wrap((b) => { app.setLoginItemSettings({ openAtLogin: !!b, openAsHidden: true }); return true; }));

  createWindow();
  setTimeout(() => { if (updateUrl()) runCheck().catch(() => {}); }, 15000);
  setInterval(() => { if (updateUrl()) runCheck().catch(() => {}); }, 6 * 3600 * 1000);
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
    tray.setToolTip('Regis');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Regis', click: showWindow }, { label: 'Quick capture', accelerator: CAPTURE_KEY, click: openCapture }, { label: 'Mini mode on/off', accelerator: MINI_KEY, click: () => { showWindow(); setMini(!(mini && mini.on)); } }, { type: 'separator' }, { label: 'Quit Regis', click: () => { quitting = true; app.quit(); } }]));
    tray.on('click', showWindow);
  } catch (_) { /* tray unsupported: closing the window will still just hide it */ }
  try { globalShortcut.register(MINI_KEY, () => { showWindow(); setMini(!(mini && mini.on)); }); } catch (_) { /* shortcut unsupported */ }
  try { if (!globalShortcut.register(CAPTURE_KEY, openCapture)) console.warn('Quick capture shortcut is taken by another app.'); } catch (_) { /* shortcut unsupported */ }
  for (const k of OVERLAY_KEYS) { try { if (globalShortcut.register(k, summonOverlay)) { overlayKey = k; break; } } catch (_) { /* shortcut unsupported */ } }
  /* give docked Office windows their frames back before the Regis window goes away */
  app.on('before-quit', (e) => { const docks = [officeDock, plDock].filter((d) => d && d.ps); if (docks.length && !officeBye) { e.preventDefault(); officeBye = true; quitting = true; Promise.all(docks.map((d) => d.releaseAll())).finally(() => app.quit()); return; } });
  app.on('before-quit', () => { quitting = true; try { browserHost && browserHost.destroy(); } catch (_) {} globalShortcut.unregisterAll(); store.flush(); });
  app.on('activate', showWindow);
});
app.on('window-all-closed', () => { /* stay alive in tray */ });
