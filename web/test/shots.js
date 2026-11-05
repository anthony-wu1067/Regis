'use strict';
const http = require('http'), fs = require('fs'), path = require('path'); const { chromium, devices } = require('playwright');
const dist = path.join(__dirname, '../dist'), out = process.argv[2] || '/tmp/claude-0/shots'; fs.mkdirSync(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => { let f = path.join(dist, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'x' }); r.end(b); } }); });
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port + '/';
  const b = await chromium.launch(); let bad = 0;
  for (const [name, dev] of [['iphone', devices['iPhone 14']], ['iphone-se', devices['iPhone SE']], ['ipad', devices['iPad (gen 7)']], ['ipad-land', devices['iPad (gen 7) landscape']]]) {
    const ctx = await b.newContext(dev); await ctx.route(/googleapis\.com|accounts\.google\.com/, (r) => r.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":{"message":"mock"}}' }));
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForSelector('#p-setup'); await p.waitForTimeout(1500);
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, over: [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 2 && getComputedStyle(e).position !== 'fixed' && !e.closest('[style*="overflow"],.scroll,pre,table'); }).slice(0, 6).map((e) => e.tagName + '.' + e.className + '#' + e.id + ' ' + Math.round(e.getBoundingClientRect().right)),
      small: [...document.querySelectorAll('button,.btn,a[data-act],input[type=checkbox],.chk,[data-act]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 30 || r.width < 30) && e.offsetParent; }).length }));
    console.log(name, JSON.stringify(m), errs.length ? 'ERRS ' + errs.join('|') : '');
    if (m.sw > m.cw + 1) bad++;
    await p.screenshot({ path: out + '/' + name + '.png', fullPage: false });
    await p.screenshot({ path: out + '/' + name + '-full.png', fullPage: true });
    await ctx.close();
  }
  await b.close(); server.close(); console.log(bad ? bad + ' viewport(s) scroll sideways' : 'no sideways scroll'); process.exit(0);
})();
