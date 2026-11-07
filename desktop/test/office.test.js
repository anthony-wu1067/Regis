// Office workspace with the real desktop Excel (Windows with Office installed; skips otherwise).
// Run: node_modules/electron/dist/electron test/office.test.js
const { app, BrowserWindow, desktopCapturer } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-office-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(250); } return false; };
const SHOTS = process.env.SHOTS || '';
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setBounds({ x: 40, y: 30, width: 1300, height: 840 }); win.show(); win.focus(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  const st = () => J('return await APP_STATE()').catch(() => null);
  await J('window.APP_STATE=function(){return window.regisBridge.office.dock.state()}');
  const apps = await J('return await window.regisBridge.office.dock.apps()');
  if (process.platform !== 'win32' || !apps || !apps.excel) { console.log('SKIP no desktop Excel'); console.log('0 passed, 0 failed'); app.exit(0); return; }
  const shot = async (n) => { if (!SHOTS) return; const s = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 1000 } }))[0]; fs.writeFileSync(path.join(SHOTS, n + '.png'), s.thumbnail.toPNG()); };
  await J('document.querySelector(\'#vsw [data-v="office"]\').click()'); await sleep(1500);
  ok(await J('return !document.getElementById("ofd").hidden&&getComputedStyle(document.getElementById("ofd")).display==="flex"&&getComputedStyle(document.getElementById("office")).display==="none"'), 'the Office page shows the workspace with Word, Excel and PowerPoint in a sidebar');
  ok(await J('return document.querySelectorAll("#ofd-side [data-act=ofd-app]").length===4'), 'sidebar has Files, Word, Excel and PowerPoint');
  await J('document.querySelector(\'#ofd-side [data-k="excel"]\').click()'); await sleep(500);
  ok(await J('return /Blank workbook/.test(document.getElementById("ofd-ph").textContent)'), 'Excel with nothing open offers a blank workbook, Open and Templates');
  await J('document.querySelector(\'#ofd-ph [data-act="ofd-new"]\').click()');
  ok(await until(async () => { const s = await st(); return s && s.docs.some((d) => d.k === 'excel' && d.docked && s.active === d.h && s.visible); }, 60000), 'a new workbook opens in desktop Excel, docked and showing inside Regis');
  await sleep(2500); await shot('office-excel');
  const s1 = await st(); const doc = s1.docs.find((d) => d.k === 'excel' && d.docked);
  ok(await J('return document.querySelectorAll("#ofd-bar .ofd-doc").length===1&&document.querySelector("#ofd-bar .ofd-doc.on")!==null'), 'the bar lists the open workbook as a tab (' + (doc && doc.t) + ')');
  ok(await J('return document.getElementById("ofd-stage").classList.contains("live")'), 'the stage is marked live while Excel covers it');
  // other page: hidden; back: shown
  await J('document.querySelector(\'#vsw [data-v="music"]\').click()'); await sleep(1200);
  ok(!(await st()).visible, 'switching to Music hides Excel');
  await shot('office-music');
  await J('document.querySelector(\'#vsw [data-v="office"]\').click()'); await sleep(1500);
  ok((await st()).visible, 'coming back shows Excel again');
  // a Regis menu over it: hidden while open
  await J('document.querySelector(\'[data-act="look"]\').click()'); await sleep(900);
  ok(!(await st()).visible, 'opening Appearance hides Excel so the menu is on top');
  await J('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await J('var l=document.getElementById("look");if(l&&!l.hidden){var c=document.querySelector(\'[data-act="look-close"]\');if(c)c.click()}'); await sleep(900);
  ok((await st()).visible, 'closing Appearance shows Excel again');
  // the window moves: Excel follows (checked via the shot); minimise hides it
  win.setBounds({ x: 120, y: 60, width: 1150, height: 780 }); await sleep(900); await shot('office-moved');
  // shortcuts sheet
  await J('document.querySelector(\'#ofd-side [data-act="ofd-keys"]\').click()'); await sleep(500);
  ok(await J('return /Ctrl\\+S/.test(document.getElementById("modal").textContent)&&/AutoSum/.test(document.getElementById("modal").textContent)'), 'Keys lists common Office and Excel shortcuts');
  await J('var b=document.querySelector(\'#modal [data-act="modal-close"]\');if(b)b.click()'); await sleep(600);
  // close the workbook (unchanged, so Excel closes it without asking)
  await J('document.querySelector("#ofd-bar [data-act=ofd-close]").click()');
  ok(await until(async () => { const s = await st(); return s && !s.docs.some((d) => d.h === doc.h); }, 20000), 'closing the tab closes the workbook in Excel');
  ok(await until(() => J('return !document.querySelector("#ofd-bar .ofd-doc")&&/Blank workbook/.test(document.getElementById("ofd-ph").textContent)'), 5000), 'the bar is empty again');
  console.log(pass + ' passed, ' + fail + ' failed');
  // quit like the user would: docked windows get their frames back first
  setTimeout(() => process.exit(fail ? 1 : 0), 15000); app.quit();
});
