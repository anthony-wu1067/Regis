const { app, BrowserWindow } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-gpu2-')));
const OUT = process.env.OUT; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
require(path.join(process.env.DESK, 'main.js'));
const spread = (img) => { const b = img.toBitmap(), s = img.getSize(); let n = 0, sum = 0, sq = 0; for (let y = 0; y < s.height; y += 7) for (let x = 0; x < s.width; x += 7) { const i = (y * s.width + x) * 4, v = (b[i] + b[i + 1] + b[i + 2]) / 3; sum += v; sq += v * v; n++; } const m = sum / n; return { mean: +m.toFixed(1), sd: +Math.sqrt(sq / n - m * m).toFixed(1) }; };
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  app.on('child-process-gone', (_e, d) => console.log('gone', d.type, d.reason));
  win.setSize(1200, 800); win.show(); await sleep(3000);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  await J('localStorage.setItem("regis-perf","bal");localStorage.setItem("regis-bg",' + JSON.stringify(process.env.BG || 'blackwall') + ');localStorage.setItem("regis-bwfx",JSON.stringify({f:200,s:50,r:150}));localStorage.setItem("regis-view","home");location.reload()'); await sleep(6000);
  await J('var s=document.createElement("style");s.textContent="#app,.sbar,#vsw,#nav-btn,#tabbar{visibility:hidden!important}";document.head.appendChild(s)'); await sleep(1500);
  const shot = async (n) => { const im = await win.webContents.capturePage(); if (OUT) fs.writeFileSync(path.join(OUT, n + '.png'), im.resize({ width: 600 }).toPNG()); return spread(im); };
  console.log('before', JSON.stringify(await shot('g2-before')));
  for (let k = 1; k <= 5; k++) { const c = new BrowserWindow({ show: false }); c.loadURL('chrome://gpucrash').catch(() => {}); await sleep(5000); try { c.destroy(); } catch (_) {} console.log('after crash ' + k, JSON.stringify(await shot('g2-c' + k)), 'gl:', await J('var c=document.createElement("canvas");return !!c.getContext("webgl")')); }
  await sleep(40000); console.log('after 40s more', JSON.stringify(await shot('g2-end')), 'fxlog', await J('return localStorage.getItem("regis-fxlog")'));
  app.exit(0);
});
