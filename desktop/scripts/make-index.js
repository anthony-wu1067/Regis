'use strict';
/* Builds renderer/index.html from page/regis.html (the same page published in Claude) by adding the document wrapper,
   a content-security-policy, and the shim that stands in for claude.ai's runtime. */
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'page', 'regis.html'), 'utf8');
const metaTitle = (src.match(/<title>[\s\S]*?<\/title>/) || ['<title>Regis</title>'])[0];
let body = src.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<meta name="claude:viewport-fit-sides"[^>]*>/, '');
const csp = "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src https: data: blob:; worker-src blob:";
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' + metaTitle +
  '<style>html{color-scheme:dark}body{margin:0}[hidden]{display:none!important}</style><script src="sync.js"></script><script src="localdb.js"></script><script src="shim.js"></script></head><body>' + body + '</body></html>';
fs.mkdirSync(path.join(root, 'renderer'), { recursive: true });
for (const f of ['sync.js', 'localdb.js']) fs.copyFileSync(path.join(root, 'core', f), path.join(root, 'renderer', f));
fs.writeFileSync(path.join(root, 'renderer', 'index.html'), html);
console.log('renderer/index.html written (' + html.length + ' bytes)');
