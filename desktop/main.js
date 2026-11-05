'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, safeStorage, shell, session, nativeImage, globalShortcut, Notification, screen } = require('electron');
const path = require('path');
const { Store } = require('./lib/store');
const { Google, signIn } = require('./lib/google');
const { Anthropic } = require('./lib/anthropic');
const { Canvas, normHost } = require('./lib/canvas');
const { Mini } = require('./lib/mini');
const { Updater } = require('./lib/updater');

let runningVersion = null;
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true }
  });
  const staged = updater && updater.current();      // a newer interface downloaded over the air, if any
  runningVersion = staged ? staged.version : app.getVersion();
  win.loadFile(staged ? path.join(staged.dir, 'index.html') : BUNDLED_PAGE);
  if (staged) win.webContents.once('did-fail-load', () => { updater.clear(); if (win && !win.isDestroyed()) win.loadFile(BUNDLED_PAGE); runningVersion = app.getVersion(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } }); // keep running in the tray so autopilot + scheduled sends continue
  win.webContents.on('did-finish-load', () => { if (pendingCaptures.length) win.webContents.send('capture:add', pendingCaptures.splice(0)); });
  win.on('closed', () => { win = null; if (mini) mini.reset(); });
  win.webContents.on('did-finish-load', () => { if (updater && runningVersion) { const p = updater.pending(runningVersion); if (p) win.webContents.send('update:ready', p.version); } });
  win.webContents.on('did-finish-load', () => { if (mini && mini.on) win.webContents.send('mini:state', true); });
}

app.setAppUserModelId('app.regis.desktop'); // Windows: groups the taskbar icon and lets notifications show as Regis
app.whenReady().then(() => {
  mini = new Mini(() => win, screen);
  const store = new Store(app.getPath('userData'), crypt());
  const google = new Google({ creds: () => ({ clientId: store.getMeta('gClientId', ''), clientSecret: store.getSecret('gSecret'), refreshToken: store.getSecret('gRefresh') }) });
  const canvas = new Canvas({ creds: () => ({ host: store.getMeta('cvHost', ''), token: store.getSecret('cvToken') }) });
  updater = new Updater({ dir: path.join(app.getPath('userData'), 'bundle'), bundledVersion: app.getVersion() });
  const updateUrl = () => store.getMeta('updateUrl', '') || '';
  const notifyPending = () => { const p = updater.pending(runningVersion); if (p && win && !win.isDestroyed()) win.webContents.send('update:ready', p.version); return p; };
  const runCheck = async () => { let r = await updater.check(updateUrl()); const p = notifyPending(); if (p) r = { status: 'staged', version: p.version }; return r; };
  const claude = new Anthropic({ getKey: () => store.getSecret('anthropicKey'), onUsage: (t) => store.addUsage(t) });

  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');

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
    openAtLogin: app.getLoginItemSettings().openAtLogin, voice: true, version: runningVersion || app.getVersion(), updateUrl: updateUrl()
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
  app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); store.flush(); });
  app.on('activate', showWindow);
});
app.on('window-all-closed', () => { /* stay alive in tray */ });
