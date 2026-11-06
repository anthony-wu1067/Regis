'use strict';
/* node scripts/drm.js on|off|sign
   on   : switch to the castlabs build of Electron, which includes Widevine, then VMP-sign it (see below), so Spotify can play inside Regis
   sign : only VMP-sign the Electron build that is already installed (run this again after any "npm install")
   off  : go back to the normal Electron
   Why signing matters: Spotify's licence server only hands out keys to players that carry a VMP signature. An unsigned build plays the
   few seconds of unencrypted "clear lead" at the start of a song (about 9 s), then stops; seeking stutters and songs fail with
   "Playback error". castlabs signs builds for free through their EVS service (one-time free account, made in this window).
   Needs internet (about 100 MB download) and Python 3. Run it with Regis closed. */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const CASTLABS = 'https://github.com/castlabs/electron-releases#v45.2.1+wvcus';
const NORMAL = 'electron@^45.0.0';
const ROOT = path.join(__dirname, '..');
const WIN = process.platform === 'win32';
const mode = process.argv[2];
if (!['on', 'off', 'sign'].includes(mode)) { console.log('Usage: node scripts/drm.js on|off|sign'); process.exit(1); }

const run = (cmd, args, opts) => spawnSync(cmd, args, Object.assign({ cwd: ROOT, stdio: 'inherit', shell: WIN }, opts || {}));
const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(String(a || '').trim()); }); });

function findPython() {
  for (const c of WIN ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']]) {
    const r = spawnSync(c[0], c.slice(1).concat(['--version']), { shell: WIN, encoding: 'utf8' });
    if (r.status === 0 && /Python 3\./.test((r.stdout || '') + (r.stderr || ''))) return c;
  }
  return null;
}

async function sign() {
  const dist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(dist)) { console.log('\n  Electron is not installed yet. Run "Enable Spotify audio" first.\n'); return 1; }
  const py = findPython();
  if (!py) { console.log('\n  Signing needs Python 3, which is not installed.\n  1. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH").\n  2. Close this window, then run "Enable Spotify audio" again.\n'); return 1; }
  const P = (args) => run(py[0], py.slice(1).concat(args));
  console.log('\n  Step 2 of 2: signing Regis for Spotify (castlabs EVS)...\n');
  if (P(['-m', 'pip', 'install', '--upgrade', '--quiet', 'castlabs-evs']).status !== 0) { console.log('\n  Could not install the castlabs signing tool. Check your internet connection and try again.\n'); return 1; }
  let r = P(['-m', 'castlabs_evs.vmp', 'sign-pkg', dist]);
  if (r.status !== 0) {
    console.log('\n  The signing service needs a free castlabs EVS account (one time only).');
    const a = (await ask('  Do you already have one? Type y or n, then press Enter: ')).toLowerCase();
    if (P(['-m', 'castlabs_evs.account', a.startsWith('y') ? 'reauth' : 'signup']).status !== 0) { console.log('\n  The account step did not finish. Run "Enable Spotify audio" again to retry.\n'); return 1; }
    r = P(['-m', 'castlabs_evs.vmp', 'sign-pkg', dist]);
    if (r.status !== 0) { console.log('\n  Signing did not finish. Run "Enable Spotify audio" again to retry.\n'); return 1; }
  }
  P(['-m', 'castlabs_evs.vmp', 'verify-pkg', dist]);
  return 0;
}

(async () => {
  if (mode === 'sign') { const s = await sign(); if (!s) console.log('\n  Signed. Start Regis again.\n'); process.exit(s); }
  if (mode === 'on') {
    const g = spawnSync('git', ['--version'], { shell: WIN });
    if (g.status !== 0) {
      console.log('  This needs Git, which is not installed on this computer.\n  1. Install "Git for Windows" (or Git for Mac) from https://git-scm.com/downloads\n  2. Close this window, then run this again.\n');
      process.exit(1);
    }
  }
  console.log(mode === 'on' ? '\n  Step 1 of 2: adding Spotify audio support (copy-protected audio) to Regis...\n' : '\n  Going back to the standard Regis engine...\n');
  const r = run(WIN ? 'npm.cmd' : 'npm', ['install', '--save-dev', '--no-audit', '--no-fund', mode === 'on' ? CASTLABS : NORMAL]);
  if (r.status !== 0) { console.log('\n  That did not finish. Check your internet connection and try again.\n  Regis was not changed if you see an error above.\n'); process.exit(r.status || 1); }
  if (mode === 'off') { console.log('\n  Done. Start Regis again.\n'); process.exit(0); }
  const s = await sign();
  console.log(s
    ? '  Audio support is installed but NOT signed yet, so Spotify will still stop after a few seconds. Fix the step above and run this again.\n'
    : '\n  Done. Start Regis again. In Music, press the device button: Regis can now play audio itself.\n  (To undo this, run "Disable Spotify audio".)\n');
  process.exit(s);
})();
