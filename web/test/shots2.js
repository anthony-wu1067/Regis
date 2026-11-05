'use strict';
const http = require('http'), fs = require('fs'), path = require('path'); const { chromium, devices } = require('playwright'); const mock = require('./mockworld');
const dist = path.join(__dirname, '../dist'), out = process.argv[2] || '/tmp/claude-0/shots'; fs.mkdirSync(out, { recursive: true });
const only = process.argv[3];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => { let f = path.join(dist, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'x' }); r.end(b); } }); });
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port + '/';
  const b = await chromium.launch(); const report = [];
  for (const [name, dev] of [['iphone', devices['iPhone 14']], ['iphone-se', devices['iPhone SE']], ['ipad', devices['iPad (gen 7)']], ['ipad-land', devices['iPad (gen 7) landscape']]]) {
    if (only && only !== name) continue;
    const ctx = await b.newContext(dev); await mock.install(ctx);
    await ctx.addInitScript(() => { try { localStorage.setItem('regis-sec', JSON.stringify({ gClientId: 'c', gSecret: 's', gRefresh: 'r', gEmail: 'me@example.com' })); } catch (_) {} });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForSelector('#p-setup'); await p.waitForTimeout(3500);
    const m = await p.evaluate(() => { const de = document.documentElement; const bad = []; document.querySelectorAll('body *').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle(e).position !== 'fixed' && (r.left < -2 || r.right > de.clientWidth + 2) && !e.closest('.scrollx,pre,table,.wk-body,.yr,.mdl,[hidden],#intro,.bg,.blob')) bad.push(e.tagName + '.' + String(e.className).slice(0, 24) + ' L' + Math.round(r.left) + ' R' + Math.round(r.right)); }); return { sw: de.scrollWidth, cw: de.clientWidth, bad: bad.slice(0, 8) }; });
    report.push(name + ' ' + JSON.stringify(m) + (errs.length ? ' ERRS ' + errs.join('|') : ''));
    await p.screenshot({ path: out + '/' + name + '-top.png' });
    await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(700); await p.screenshot({ path: out + '/' + name + '-scrolled.png' });
    const cal = await p.$('#p-cal, #p-sched'); 
    await p.evaluate(() => { const b = document.querySelector('[data-act="cal-open"],[data-act="yc-open"]'); if (b) b.click(); }); await p.waitForTimeout(1200); await p.screenshot({ path: out + '/' + name + '-cal.png' });
    await ctx.close();
  }
  await b.close(); server.close(); console.log(report.join('\n')); process.exit(0);
})();
