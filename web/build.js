'use strict';
/* Builds the installable web app (also what the iPhone/iPad app loads) into web/dist. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const esbuild = require('esbuild');
const root = __dirname, proj = path.join(root, '..'), desk = path.join(proj, 'desktop'), dist = path.join(root, 'dist');
const version = fs.readFileSync(path.join(proj, 'VERSION'), 'utf8').trim();
fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(dist, { recursive: true });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const touchCss = '<style id="touch">body{padding-top:env(safe-area-inset-top,0);padding-bottom:env(safe-area-inset-bottom,0);padding-left:env(safe-area-inset-left,0);padding-right:env(safe-area-inset-right,0);-webkit-text-size-adjust:100%;overscroll-behavior-y:none}' +
  '@media (pointer:coarse){.btn,button,summary,[data-act]{min-height:40px}.btn.sm,button.sm{min-height:36px;padding-top:8px;padding-bottom:8px}.chk{min-width:30px;min-height:30px}input,select,textarea{font-size:16px!important}input[type=checkbox],input[type=radio]{min-width:22px;min-height:22px}a,[data-act],label{-webkit-tap-highlight-color:transparent}}' +
  '@media (max-width:520px){.fbar{flex-wrap:wrap}.modal,.mbox{max-width:100vw}}</style>';
(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'src/entry.js')], bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['safari15'], outfile: path.join(dist, 'regis-lib.js'),
    alias: { crypto: path.join(root, 'src/stub.js'), http: path.join(root, 'src/stub.js') }, logLevel: 'error' });
  for (const f of ['sync.js', 'localdb.js']) fs.copyFileSync(path.join(desk, 'core', f), path.join(dist, f));
  fs.copyFileSync(path.join(desk, 'renderer/shim.js'), path.join(dist, 'shim.js'));
  fs.copyFileSync(path.join(root, 'src/webbridge.js'), path.join(dist, 'webbridge.js'));
  for (const f of ['callback.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(root, 'src', f), path.join(dist, f));

  const src = fs.readFileSync(path.join(desk, 'page', 'regis.html'), 'utf8');
  const title = (src.match(/<title>[\s\S]*?<\/title>/) || ['<title>Regis</title>'])[0];
  const body = src.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<meta name="claude:viewport-fit-sides"[^>]*>/, '');
  const csp = "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' https: data: blob:; worker-src 'self' blob:; manifest-src 'self'";
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' + title +
    '<meta name="theme-color" content="#0b0a12"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Regis">' +
    '<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="apple-touch-icon.png"><link rel="icon" href="icon-192.png">' +
    '<style>html{color-scheme:dark}body{margin:0}[hidden]{display:none!important}</style>' + touchCss +
    '<script src="regis-lib.js"></script><script src="sync.js"></script><script src="localdb.js"></script><script src="webbridge.js"></script><script src="shim.js"></script></head><body>' + body + '</body></html>';
  fs.writeFileSync(path.join(dist, 'index.html'), html);

  /* desktop over-the-air bundle: the interface files the Electron app runs (built from the same page) */
  require('child_process').execFileSync(process.execPath, [path.join(desk, 'scripts/make-index.js')], { stdio: 'ignore' });
  const bundle = { version, minShell: 1, built: new Date().toISOString(), files: {} };
  for (const f of ['index.html', 'shim.js', 'sync.js', 'localdb.js']) { const b = fs.readFileSync(path.join(desk, 'renderer', f)); bundle.files[f] = { sha256: sha(b), b64: b.toString('base64') }; }
  fs.writeFileSync(path.join(dist, 'desktop-bundle.json'), JSON.stringify(bundle));

  const files = fs.readdirSync(dist).filter((f) => f !== 'sw.js' && f !== 'desktop-bundle.json');
  const sw = fs.readFileSync(path.join(root, 'src/sw.js'), 'utf8').replace('__VERSION__', version).replace('__FILES__', JSON.stringify(['./'].concat(files)));
  fs.writeFileSync(path.join(dist, 'sw.js'), sw);
  const manifest = {}; fs.readdirSync(dist).forEach((f) => { manifest[f] = sha(fs.readFileSync(path.join(dist, f))); });
  fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify({ version, built: new Date().toISOString(), files: manifest }, null, 1));
  console.log('web build ok: v' + version + ', ' + Object.keys(manifest).length + ' files, index.html ' + (html.length / 1024 | 0) + ' KB');
})().catch((e) => { console.error(e); process.exit(1); });
