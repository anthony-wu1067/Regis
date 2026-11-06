'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, safeStorage, shell, session, nativeImage, globalShortcut, Notification, screen } = require('electron');
const path = require('path');
const http = require('http');
const { Store } = require('./lib/store');
const { Google, signIn } = require('./lib/google');
const { Anthropic } = require('./lib/anthropic');
const { Canvas, normHost } = require('./lib/canvas');
const { Mini } = require('./lib/mini');
const { Updater } = require('./lib/updater');
const { BrowserHost } = require('./lib/browser');

let runningVersion = null, browserHost = null;
let win = null, tray = null, quitting = false, capWin = null, mini = null, updater = null;
const BUNDLED_PAGE = path.join(__dirname, 'renderer', 'index.html');
const MINI_KEY = 'CommandOrControl+Shift+M';
function setMini(on) { if (!mini) return false; const r = mini.set(!!on); if (win && !win.isDestroyed()) win.webContents.send('mini:state', r); return r; }
const pendingCaptures = [];
const CAPTURE_KEY = 'CommandOrControl+Shift+Space';
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
  const staged = updater && updater.current();      // a newer interface downloaded over the air, if any
  runningVersion = staged ? staged.version : app.getVersion();
  win.loadFile(staged ? path.join(staged.dir, 'index.html') : BUNDLED_PAGE);
  if (staged) { /* fall back to the built-in page only if the staged page itself could not load; a failed iframe/embed or a cancelled load must never throw the update away */
    const onFail = (_e, code, _d, _u, isMainFrame) => { if (!isMainFrame || code === -3) return; win.webContents.removeListener('did-fail-load', onFail); updater.clear(); if (win && !win.isDestroyed()) win.loadFile(BUNDLED_PAGE); runningVersion = app.getVersion(); };
    win.webContents.on('did-fail-load', onFail); win.webContents.once('did-finish-load', () => { if (win && !win.isDestroyed()) win.webContents.removeListener('did-fail-load', onFail); });
  }
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
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
  const claude = new Anthropic({ getKey: () => store.getSecret('anthropicKey'), onUsage: (t) => store.addUsage(t) });

  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media' || perm === 'protected-media-identifier'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media' || perm === 'protected-media-identifier');
  ipcMain.handle('app:drm', wrap(() => DRM));
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
  ipcMain.handle('claude:sample', wrap(async (input, opts = {}) => {
    if (opts.json) return { value: await claude.json(input, opts) };
    return claude.sample(input, opts);
  }));
  ipcMain.handle('app:status', wrap(() => ({
    googleConfigured: !!(store.getMeta('gClientId', '') && store.getSecret('gSecret')), googleConnected: !!store.getSecret('gRefresh'),
    googleEmail: store.getMeta('gEmail', ''), anthropicKey: !!store.getSecret('anthropicKey'), usage: store.monthUsage(),
    canvasConnected: !!(store.getMeta('cvHost', '') && store.getSecret('cvToken')), canvasHost: (store.getMeta('cvHost', '') || '').replace(/^https?:\/\//, ''),
    openAtLogin: app.getLoginItemSettings().openAtLogin, voice: true, version: runningVersion || app.getVersion(), shell: app.getVersion(), drm: DRM, drmSig: drmSig(), updateUrl: updateUrl()
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
  browserHost = new BrowserHost({ getWin: () => win, onKey: (k) => { if (win && !win.isDestroyed()) win.webContents.send('browser:key', k); }, onCred: (c) => { if (win && !win.isDestroyed()) win.webContents.send('browser:cred', c); }, shield: store.getMeta('bwShield', '1') !== '0', onPersist: (urls) => store.setMeta('bwTabs', JSON.stringify(urls)) });
  const bw = browserHost;
  ipcMain.handle('browser:state', wrap(() => { if (!bw.tabs.length) { let urls = []; try { urls = JSON.parse(store.getMeta('bwTabs', '[]') || '[]'); } catch (_) {} bw.init(); if (urls.length) bw.restore(urls); else bw.open(''); } return bw.snapshot(); }));
  ipcMain.handle('browser:open', wrap((u) => bw.open(u)));
  ipcMain.handle('browser:close', wrap((id) => bw.close(+id)));
  ipcMain.handle('browser:activate', wrap((id) => bw.activate(+id)));
  ipcMain.handle('browser:go', wrap((id, text) => bw.go(+id, text)));
  ipcMain.handle('browser:back', wrap((id) => bw.back(+id)));
  ipcMain.handle('browser:forward', wrap((id) => bw.forward(+id)));
  ipcMain.handle('browser:reload', wrap((id) => bw.reload(+id)));
  ipcMain.handle('browser:stop', wrap((id) => bw.stop(+id)));
  ipcMain.handle('browser:bounds', wrap((b) => bw.setBounds(b || {})));
  ipcMain.handle('browser:show', wrap((v) => bw.show(!!v)));
  ipcMain.on('bw:cred', (e, d) => { try { bw.cred(e.sender, d); } catch (_) {} });
  ipcMain.handle('browser:fill', wrap((id, user, pass) => bw.fill(+id, user, pass)));
  ipcMain.handle('browser:shield', wrap((on) => { store.setMeta('bwShield', on ? '1' : '0'); return bw.setShield(!!on); }));
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
  app.on('before-quit', () => { quitting = true; try { browserHost && browserHost.destroy(); } catch (_) {} globalShortcut.unregisterAll(); store.flush(); });
  app.on('activate', showWindow);
});
app.on('window-all-closed', () => { /* stay alive in tray */ });
