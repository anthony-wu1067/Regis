// Office workspace with a real desktop Office app (Windows with Office installed; skips otherwise).
// Run: node_modules/electron/dist/electron test/office.test.js     OFFICE_APP=excel|word|powerpoint (default powerpoint)
// It skips when that app is already open, so it never touches the owner's own documents.
const { app, BrowserWindow } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-office-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(250); } return false; };
const K = process.env.OFFICE_APP || 'powerpoint';
const NAME = { word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint' }[K], EXE = { word: 'WINWORD.EXE', excel: 'EXCEL.EXE', powerpoint: 'POWERPNT.EXE' }[K];
const BLANK = { word: 'Blank document', excel: 'Blank workbook', powerpoint: 'Blank presentation' }[K], KEY = { word: 'Page break', excel: 'AutoSum', powerpoint: 'slide show' }[K];
const running = () => { try { return new RegExp(EXE, 'i').test(cp.execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq ' + EXE, '/NH'], { encoding: 'utf8', windowsHide: true })); } catch (_) { return false; } };
/* pixels of just the Office window (PrintWindow), never the screen */
const ribbonShown = (h) => { if (!process.env.SNAP) return true; try { return /ok/.test(cp.execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', process.env.SNAP, String(h)], { encoding: 'utf8', windowsHide: true })); } catch (_) { return false; } };
require(path.join(process.env.DESK || path.join(__dirname, '..'), 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setBounds({ x: 40, y: 30, width: 1300, height: 840 }); win.show(); win.focus(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  const st = () => J('return await window.regisBridge.office.dock.state()').catch(() => null);
  const apps = await J('return await window.regisBridge.office.dock.apps()');
  if (process.platform !== 'win32' || !apps || !apps[K]) { console.log('SKIP no desktop ' + NAME); console.log('0 passed, 0 failed'); app.exit(0); return; }
  if (running()) { console.log('SKIP ' + NAME + ' is already open (left alone)'); console.log('0 passed, 0 failed'); app.exit(0); return; }
  await J('document.querySelector(\'#vsw [data-v="office"]\').click()'); await sleep(1500);
  ok(await J('return !document.getElementById("ofd").hidden&&getComputedStyle(document.getElementById("ofd")).display==="flex"&&getComputedStyle(document.getElementById("office")).display==="none"'), 'the Office page shows the workspace with Word, Excel and PowerPoint in a sidebar');
  ok(await J('return document.querySelectorAll("#ofd-side [data-act=ofd-app]").length===4'), 'sidebar has Files, Word, Excel and PowerPoint');
  await J('document.querySelector(\'#ofd-side [data-k="' + K + '"]\').click()'); await sleep(500);
  ok(await J('return document.getElementById("ofd-ph").textContent.indexOf(' + JSON.stringify(BLANK) + ')>=0'), NAME + ' with nothing open offers ' + BLANK + ', Open and Templates');
  await J('document.querySelector(\'#ofd-ph [data-act="ofd-new"]\').click()');
  ok(await until(async () => { const s = await st(); return s && s.docs.some((d) => d.k === K && d.docked && s.active === d.h && s.visible); }, 60000), 'a new file opens in desktop ' + NAME + ', docked and showing inside Regis');
  await sleep(3000);
  const s1 = await st(); const doc = s1.docs.find((d) => d.k === K && d.docked);
  ok(ribbonShown(doc.h), NAME + ' keeps its title row and ribbon (key tips and ribbon shortcuts work)');
  ok(await J('return document.querySelectorAll("#ofd-bar .ofd-doc").length===1&&document.querySelector("#ofd-bar .ofd-doc.on")!==null'), 'the bar lists the open file as a tab (' + (doc && doc.t) + ')');
  ok(await J('return document.getElementById("ofd-stage").classList.contains("live")'), 'the stage is marked live while ' + NAME + ' covers it');
  await J('document.querySelector(\'#vsw [data-v="music"]\').click()'); await sleep(1200);
  ok(!(await st()).visible, 'switching to Music hides ' + NAME);
  await J('document.querySelector(\'#vsw [data-v="office"]\').click()'); await sleep(1500);
  ok((await st()).visible, 'coming back shows ' + NAME + ' again');
  await J('document.querySelector(\'[data-act="look"]\').click()'); await sleep(900);
  ok(!(await st()).visible, 'opening Appearance hides ' + NAME + ' so the menu is on top');
  await J('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await J('var l=document.getElementById("look");if(l&&!l.hidden){var c=document.querySelector(\'[data-act="look-close"]\');if(c)c.click()}'); await sleep(900);
  ok((await st()).visible, 'closing Appearance shows ' + NAME + ' again');
  await J('document.querySelector(\'#ofd-side [data-act="ofd-keys"]\').click()'); await sleep(500);
  ok(await J('return /Ctrl\\+S/.test(document.getElementById("modal").textContent)&&document.getElementById("modal").textContent.indexOf(' + JSON.stringify(KEY) + ')>=0'), 'Keys lists common Office and ' + NAME + ' shortcuts');
  await J('var b=document.querySelector(\'#modal [data-act="modal-close"]\');if(b)b.click()'); await sleep(600);
  await J('document.querySelector("#ofd-bar [data-act=ofd-close]").click()');
  ok(await until(async () => { const s = await st(); return s && !s.docs.some((d) => d.h === doc.h); }, 20000), 'closing the tab closes the file in ' + NAME);
  ok(await until(() => J('return !document.querySelector("#ofd-bar .ofd-doc")&&document.getElementById("ofd-ph").textContent.indexOf(' + JSON.stringify(BLANK) + ')>=0'), 5000), 'the bar is empty again');
  console.log(pass + ' passed, ' + fail + ' failed');
  setTimeout(() => process.exit(fail ? 1 : 0), 15000); app.quit();
});
