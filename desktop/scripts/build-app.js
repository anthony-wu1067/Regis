'use strict';
/* node scripts/build-app.js [--install] [--no-sign]
   Builds Regis as a real Windows app, like a game folder: dist/Regis/Regis.exe with Regis inside it (resources/app).
   It is made from the Electron in node_modules, so with the Spotify audio engine (castlabs) Regis.exe can play Spotify.
   --install  copies it to %LOCALAPPDATA%\Programs\Regis and points the Desktop and Start-menu shortcuts at Regis.exe
   --no-sign  skips the Spotify audio signing step (Regis works; only in-app Spotify audio needs the signature)
   Your data stays where it was (AppData\Roaming\regis), so nothing is lost when switching to the app. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const WIN = process.platform === 'win32';
const args = process.argv.slice(2), INSTALL = args.includes('--install'), SIGN = !args.includes('--no-sign');
const SRC = path.join(ROOT, 'node_modules', 'electron', 'dist');
const OUT = path.join(ROOT, 'dist', 'Regis');
const DEST = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Regis');
const say = (m) => console.log('  ' + m);
const fail = (m) => { console.log('\n  ' + m + '\n'); process.exit(1); };

if (!WIN) fail('Building Regis.exe works on Windows. On a Mac use "Regis.command" for now.');
if (!fs.existsSync(path.join(SRC, 'electron.exe'))) fail('The Regis engine is missing. Double-click "Setup Regis" first, then run this again.');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
let engine = ''; try { engine = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version || ''; } catch (_) {}
const audio = /wvcus/.test(engine);
console.log('\n  Building Regis ' + pkg.version + ' (engine ' + engine + (audio ? ', with Spotify audio' : ', without Spotify audio') + ')\n');

/* 1. the page */
const mk = spawnSync(process.execPath, [path.join(__dirname, 'make-index.js')], { cwd: ROOT, stdio: 'inherit' });
if (mk.status !== 0) fail('Could not build the page.');

/* 2. the engine, renamed to Regis.exe */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.cpSync(SRC, OUT, { recursive: true });
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, 'Regis.exe'));
fs.rmSync(path.join(OUT, 'electron.exe.sig'), { force: true });           /* it belonged to electron.exe; Regis.exe gets its own */
fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });
say('engine copied');

/* 3. Regis itself, in resources/app (Electron starts it automatically) */
const APP = path.join(OUT, 'resources', 'app');
fs.mkdirSync(APP, { recursive: true });
for (const f of ['main.js', 'preload.js', 'capture-preload.js']) fs.copyFileSync(path.join(ROOT, f), path.join(APP, f));
for (const d of ['lib', 'renderer', 'assets']) fs.cpSync(path.join(ROOT, d), path.join(APP, d), { recursive: true });
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({ name: pkg.name, productName: 'Regis', version: pkg.version, description: pkg.description, main: 'main.js', author: pkg.author, license: pkg.license }, null, 2));
say('Regis files added');

/* 4. icon and file details on Regis.exe (before signing: signing covers the final file) */
const rcedit = [path.join(ROOT, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe'), path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')].find((p) => fs.existsSync(p));
if (rcedit) {
  const v = pkg.version + '.0';
  const r = spawnSync(rcedit, [path.join(OUT, 'Regis.exe'), '--set-icon', path.join(ROOT, 'assets', 'icon.ico'), '--set-file-version', v, '--set-product-version', v,
    '--set-version-string', 'ProductName', 'Regis', '--set-version-string', 'FileDescription', 'Regis', '--set-version-string', 'CompanyName', 'Regis',
    '--set-version-string', 'OriginalFilename', 'Regis.exe', '--set-version-string', 'InternalName', 'Regis', '--set-version-string', 'LegalCopyright', ''], { stdio: 'inherit' });
  say(r.status === 0 ? 'Regis icon set' : 'could not set the icon (Regis still works)');
} else say('icon tool not found, keeping the default icon');

/* 5. install: replace the old copy, keep nothing else of it */
let target = OUT;
if (INSTALL) {
  const running = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Regis.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  if (/Regis\.exe/i.test(running.stdout || '')) fail('Regis is open. Quit it (right-click its icon by the clock, Quit Regis), then run this again.');
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.cpSync(OUT, DEST, { recursive: true });
  target = DEST;
  const exe = path.join(DEST, 'Regis.exe'), ico = path.join(DEST, 'resources', 'app', 'assets', 'icon.ico');
  const ps = "$s=New-Object -ComObject WScript.Shell;" +
    "foreach($p in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){" +
    "$l=$s.CreateShortcut((Join-Path $p 'Regis.lnk'));$l.TargetPath='" + exe + "';$l.Arguments='';$l.WorkingDirectory='" + DEST + "';$l.IconLocation='" + ico + ",0';$l.Description='Regis';$l.Save()}";
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'inherit' });
  say('installed to ' + DEST);
  say(r.status === 0 ? 'Desktop and Start-menu shortcuts now open Regis.exe' : 'could not update the shortcuts; open ' + exe + ' directly');
}

/* 6. Spotify audio: Regis.exe needs its own VMP signature (castlabs EVS, free account the first time) */
if (audio && SIGN) {
  console.log('\n  Now signing Regis.exe so Spotify can play inside it.\n');
  const s = spawnSync(process.execPath, [path.join(__dirname, 'drm.js'), 'sign', target], { cwd: ROOT, stdio: 'inherit' });
  if (s.status !== 0) console.log('\n  Regis is ready, but Spotify audio is NOT signed yet. Run "Enable Spotify audio" to finish that.\n');
}
console.log('\n  Done. ' + (INSTALL ? 'Open Regis from the Desktop or the Start menu.' : 'Regis.exe is in ' + OUT) + '\n');
