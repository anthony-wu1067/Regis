// Launch with:  xvfb-run -a npx electron --no-sandbox test/smoke.js
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('path'); const fs = require('fs');
app.setPath('userData', fs.mkdtempSync(require('os').tmpdir() + '/regis-smoke-'));
const root = path.join(__dirname, '..');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { preload: path.join(root, 'preload.js'), sandbox: true, contextIsolation: true } });
  let db = {};
  ipcMain.handle('db:load', async () => ({ ok: true, value: db })); ipcMain.handle('db:save', async (_e, d) => { db = d; return { ok: true, value: true }; });
  ipcMain.handle('app:status', async () => ({ ok: true, value: { googleConfigured: false, googleConnected: false, anthropicKey: false, usage: { tokens: 0, calls: 0 }, voice: true, openAtLogin: false } }));
  ipcMain.handle('mcp:call', async () => ({ ok: false, error: { code: 'needs_setup', message: 'Connect Google first' } }));
  const errs = []; w.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) errs.push(msg); });
  await w.loadFile(path.join(root, 'renderer', 'index.html')); await new Promise((r) => setTimeout(r, 2500));
  const info = await w.webContents.executeJavaScript(`(async()=>{
    const hud=window.__HUD; await new Promise(r=>setTimeout(r,300));
    document.querySelector('[data-act="todo-add"]');
    return {title:document.title, hasClaude:typeof window.claude?.use, app:!!window.regisApp, owner:hud&&hud.owner, setupVisible:!document.querySelector('#app-setup').hidden,
      chips:[...document.querySelectorAll('.chip')].map(c=>c.textContent).slice(0,4), clock:document.querySelector('#clock')?.textContent, hasSeconds:/\\d:\\d\\d:\\d\\d/.test(document.querySelector('#clock')?.textContent||'')}})()`);
  console.log(JSON.stringify(info)); console.log('console errors:', JSON.stringify(errs));
  const img = await w.webContents.capturePage(); fs.writeFileSync(process.env.SHOT || '/tmp/claude-0/regis-smoke.png', img.toPNG());
  app.quit();
});
