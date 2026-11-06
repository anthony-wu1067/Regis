// Music page features against a fake Spotify (Web API, SDK, lyrics), in the real Regis app.
// Run: node_modules/electron/dist/electron test/music.test.js   (on Linux CI: xvfb-run -a ... --no-sandbox)
const { app, BrowserWindow, net } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-mu-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(120); } return false; };
const calls = []; const T0 = Date.now();
const FAKE_SDK = `window.Spotify={Player:function(){var L={};this.addListener=function(n,f){(L[n]=L[n]||[]).push(f)};this.connect=function(){setTimeout(function(){(L.ready||[]).forEach(function(f){f({device_id:"regis-dev"})})},300);return Promise.resolve(true)};
  ["pause","resume","togglePlay","nextTrack","previousTrack","seek"].forEach(function(k){this[k]=function(){return Promise.resolve()}},this);this.activateElement=function(){};this.getCurrentState=function(){return Promise.resolve(null)}}};
  setTimeout(function(){window.onSpotifyWebPlaybackSDKReady&&window.onSpotifyWebPlaybackSDKReady()},50);`;
const me = { id: 'sam', display_name: 'Sam', product: 'premium' };
const mk = (i) => ({ id: 't' + i, uri: 'spotify:track:t' + i, type: 'track', name: 'Test Song ' + i, duration_ms: 200000, artists: [{ id: 'a1', name: 'Test Artist' }], album: { id: 'al1', name: 'Test Album', images: [] } });
let pls = [{ id: 'p1', name: 'My Mix', uri: 'spotify:playlist:p1', owner: { id: 'sam', display_name: 'Sam' }, images: [], public: false, description: '' }, { id: 'p3', name: 'Their Hits', uri: 'spotify:playlist:p3', owner: { id: 'zed', display_name: 'Zed' }, images: [] }];
/* placeholder lyric lines, one every 2 s from 10 s */
const LRC = Array.from({ length: 60 }, (_, i) => { const t = 10 + i * 2; return '[' + String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') + '.00] Line ' + (i + 1); }).join('\n');
function api(method, url, body) {
  const u = new URL(url), p = u.pathname.replace('/v1', '');
  calls.push(method + ' ' + p + (body ? ' ' + body : ''));
  if (p === '/me') return [200, me];
  if (p === '/me/playlists' && method === 'GET') return [200, { items: pls, next: null }];
  if (p === '/me/playlists' && method === 'POST') { const b = JSON.parse(body || '{}'); const n = { id: 'p2', name: b.name, description: b.description, public: b.public, uri: 'spotify:playlist:p2', owner: { id: 'sam', display_name: 'Sam' }, images: [] }; pls = [n].concat(pls); return [201, n]; }
  if (p === '/me/player' && method === 'GET') return [200, { device: { id: 'pc1', name: 'PC', type: 'Computer', is_active: true, volume_percent: 50 }, is_playing: true, progress_ms: 9000 + (Date.now() - T0) % 150000, item: mk(1), shuffle_state: false, repeat_state: 'off' }];
  if (p === '/me/player/devices') return [200, { devices: [{ id: 'pc1', name: 'PC', type: 'Computer', is_active: true }] }];
  let m;
  if ((m = /^\/playlists\/(\w+)$/.exec(p)) && method === 'GET') { const pl = pls.find((x) => x.id === m[1]) || pls[0]; return [200, Object.assign({}, pl, { items: { total: pl.id === 'p1' ? 300 : 0 }, collaborative: false })]; }
  if ((m = /^\/playlists\/(\w+)\/items$/.exec(p)) && method === 'GET') { if (m[1] !== 'p1') return [200, { items: [], next: null }]; const off = +u.searchParams.get('offset') || 0, items = []; for (let i = off; i < Math.min(300, off + 50); i++) items.push({ item: mk(i + 1) }); return [200, { items, next: off + 50 < 300 ? 'https://api.spotify.com/v1/playlists/p1/items?offset=' + (off + 50) + '&limit=50' : null }]; }
  if (/^\/me\/tracks\/contains/.test(p)) return [200, [false]];
  if (method !== 'GET') return [200, { snapshot_id: 's1' }];
  return [200, { items: [] }];
}
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1360, 880); win.show();
  win.webContents.session.protocol.handle('https', async (req) => {
    const url = req.url; if (!/(api\.spotify\.com|sdk\.scdn\.co|accounts\.spotify\.com|lrclib\.net)/.test(url)) return net.fetch(req, { bypassCustomProtocolHandlers: true });
    const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
    if (/sdk\.scdn\.co/.test(url)) return new Response(FAKE_SDK, { status: 200, headers: Object.assign({}, H, { 'Content-Type': 'application/javascript' }) });
    if (/accounts\.spotify\.com/.test(url)) return new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 }), { status: 200, headers: H });
    if (/lrclib\.net/.test(url)) return new Response(JSON.stringify(/search/.test(url) ? [{ syncedLyrics: LRC, plainLyrics: '' }] : { syncedLyrics: LRC, plainLyrics: '' }), { status: 200, headers: H });
    const body = req.method === 'GET' ? null : await req.text(); const r = api(req.method, url, body || null);
    return new Response(r[0] === 204 ? null : JSON.stringify(r[1]), { status: r[0], headers: H });
  });
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  const click = (sel) => J('var b=document.querySelector(' + JSON.stringify(sel) + ');if(!b)return false;b.click();return true');
  await sleep(2500);
  await J('localStorage.setItem("regis-sp-cid",JSON.stringify("cid0123456789abcdef0123456789abcd"));localStorage.setItem("regis-sp-tok",JSON.stringify({a:"AT",r:"RT",e:Date.now()+3600000}))');
  win.webContents.reload(); await sleep(5000);
  await click('#vsw [data-v="music"]'); await sleep(2000);
  ok(await until(() => J('return /My Mix/.test(document.getElementById("sp-pls").textContent)')), 'library lists your playlists');
  // folders: make one, rename it
  await click('[data-act="sp-fnew"]'); await J('document.getElementById("sp-fn").value="Gym";document.getElementById("sp-fnf").requestSubmit()'); await sleep(400);
  ok(await until(() => J('return !!document.querySelector(\'#sp-pls [data-act="sp-fren"]\')')), 'folders have a rename button');
  await click('#sp-pls [data-act="sp-fren"]'); await sleep(300);
  await J('document.getElementById("spf-fn").value="Workout";document.querySelector(\'form[data-sp-form="fren"]\').requestSubmit()'); await sleep(400);
  ok(await J('return /Workout/.test(document.getElementById("sp-pls").textContent)&&!/Gym/.test(document.getElementById("sp-pls").textContent)'), 'renaming a folder works');
  // new playlist
  await click('[data-act="sp-pnew"]'); await sleep(300);
  await J('document.getElementById("spf-n").value="Road Trip";document.getElementById("spf-d").value="Long drives";document.querySelector(\'form[data-sp-form="plnew"]\').requestSubmit()');
  ok(await until(() => Promise.resolve(calls.some((c) => /^POST \/me\/playlists .*"name":"Road Trip".*"description":"Long drives"/.test(c)))), 'New playlist creates it on Spotify with the name and description');
  ok(await until(() => J('return /Road Trip/.test(document.getElementById("sp-pls").textContent)')), 'the new playlist appears in the library');
  // open my playlist: 300 songs, edit details
  await J('var b=[].find.call(document.querySelectorAll(\'#sp-pls [data-act="sp-nav"][data-t="playlist"]\'),function(x){return x.dataset.id==="p1"});b.click()');
  ok(await until(() => J('return document.querySelectorAll("#sp-main .sp-tr").length>=300'), 12000), 'a 300-song playlist loads');
  ok(await J('return !!document.querySelector(\'[data-act="sp-pledit"]\')&&!!document.querySelector(\'[data-act="sp-pldel"]\')'), 'your own playlist offers Edit details and Delete');
  await click('[data-act="sp-pledit"]'); await sleep(300);
  await J('document.getElementById("spf-n").value="My Mix 2";document.getElementById("spf-p").checked=true;document.querySelector(\'form[data-sp-form="pledit"]\').requestSubmit()');
  ok(await until(() => Promise.resolve(calls.some((c) => /^PUT \/playlists\/p1 .*"name":"My Mix 2".*"public":true/.test(c)))), 'Edit details renames it and changes public/private');
  // smooth scrolling through the long list
  await until(() => J('return document.querySelectorAll("#sp-main .sp-tr").length>=300'), 8000); await sleep(800);
  if (process.env.CSSX) await win.webContents.insertCSS(process.env.CSSX);
  const idle = await J('var ts=[],t0=performance.now();return await new Promise(function(r){(function f(t){ts.push(t);if(t-t0<2000)requestAnimationFrame(f);else{var d=[];for(var i=1;i<ts.length;i++)d.push(ts[i]-ts[i-1]);d.sort(function(a,b){return a-b});r({p50:d[d.length>>1],p95:d[Math.floor(d.length*.95)],perf:document.documentElement.className})}})(t0)})');
  console.log('IDLE', JSON.stringify(idle));
  const pt = await J('var s=document.querySelector("#sp-main").closest(".sp-sc")||document.querySelector(".sp-sc");s.scrollTop=0;var b=s.getBoundingClientRect();window.__fr=[];var t0=performance.now();(function f(t){window.__fr.push(t);if(t-t0<3200)requestAnimationFrame(f)})(t0);return [Math.round(b.left+b.width/2),Math.round(b.top+b.height/2)]');
  let dbg = null, m0 = null; if (process.env.PROF) { dbg = win.webContents.debugger; dbg.attach('1.3'); await dbg.sendCommand('Performance.enable'); m0 = (await dbg.sendCommand('Performance.getMetrics')).metrics; await dbg.sendCommand('Profiler.enable'); await dbg.sendCommand('Profiler.start'); }
  for (let i = 0; i < 160; i++) { win.webContents.sendInputEvent({ type: 'mouseWheel', x: pt[0], y: pt[1], deltaX: 0, deltaY: -40, canScroll: true }); await sleep(16); }
  await sleep(600);
  if (dbg) { const m1 = (await dbg.sendCommand('Performance.getMetrics')).metrics, g = (a, k) => (a.find((x) => x.name === k) || {}).value || 0; const pr = (await dbg.sendCommand('Profiler.stop')).profile; const dt = {}; pr.samples.forEach((id, i) => { dt[id] = (dt[id] || 0) + (pr.timeDeltas[i] || 0); }); const self = {}; pr.nodes.forEach((n) => { if (dt[n.id]) { const k = (n.callFrame.functionName || '(anon)') + ':' + n.callFrame.lineNumber; self[k] = (self[k] || 0) + dt[n.id] / 1000; } });
    console.log('PROF', ['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'TaskDuration'].map((k) => k + ' ' + Math.round((g(m1, k) - g(m0, k)) * 1000) + 'ms').join(' '), 'styles', g(m1, 'RecalcStyleCount') - g(m0, 'RecalcStyleCount'), 'layouts', g(m1, 'LayoutCount') - g(m0, 'LayoutCount'), '| top', Object.entries(self).filter((e) => !/^\((idle|program|garbage|root)/.test(e[0])).sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0] + ' ' + e[1].toFixed(0)).join(', ')); }
  const sc = await J('var ts=window.__fr,d=[];for(var i=1;i<ts.length;i++)d.push(ts[i]-ts[i-1]);d.sort(function(a,b){return a-b});var s=document.querySelector(".sp-sc");return {n:d.length,p50:d[d.length>>1],p95:d[Math.floor(d.length*.95)],max:d[d.length-1],top:s.scrollTop}');
  console.log('SCROLL', JSON.stringify(sc));
  ok(sc.p95 < 20 && sc.max < 60, 'scrolling the 300-song list stays smooth (p95 ' + sc.p95.toFixed(1) + ' ms, worst ' + sc.max.toFixed(1) + ' ms per frame)');
  // song menu: add to another playlist, remove from this one, right-click
  await J('document.querySelector(".sp-sc").scrollTop=0'); await sleep(200);
  await click('#sp-main .sp-tr .sp-tmb'); await sleep(250);
  ok(await J('var m=document.getElementById("sp-fm");return !m.hidden&&/Add to queue/.test(m.textContent)&&/Add to playlist/.test(m.textContent)&&/Remove from this playlist/.test(m.textContent)&&/Go to album/.test(m.textContent)'), 'the song menu has queue, add, remove, like and go-to');
  if (process.env.SHOTDIR) console.log('AT', await J('var e=document.elementFromPoint(975,447);if(!e)return null;var b=e.closest("button")||e;var p=b.parentElement;return (b.className||b.tagName)+" | parent: "+(p&&p.className)+" | in row: "+!!b.closest(".sp-tr")+" | th: "+!!b.closest(".sp-th")+" | "+(b.closest(".sp-tr")||{dataset:{}}).dataset.id'));
  if (process.env.SHOTDIR) fs.writeFileSync(path.join(process.env.SHOTDIR, 'music-menu.png'), (await win.webContents.capturePage()).toPNG());
  await click('#sp-fm [data-act="sp-tadd"]'); await sleep(250);
  await click('#sp-fm [data-act="sp-tto"][data-id="p2"]');
  ok(await until(() => Promise.resolve(calls.some((c) => /^POST \/playlists\/p2\/items .*"uris":\["spotify:track:t1"\]/.test(c)))), 'Add to playlist adds the song');
  await click('#sp-main .sp-tr .sp-tmb'); await sleep(250); await click('#sp-fm [data-act="sp-trm"]');
  ok(await until(() => Promise.resolve(calls.some((c) => /^DELETE \/playlists\/p1\/items .*spotify:track:t1/.test(c)))), 'Remove from this playlist removes it');
  await J('var r=document.querySelector("#sp-main .sp-tr");var b=r.getBoundingClientRect();r.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:b.left+60,clientY:b.top+10}))'); await sleep(250);
  ok(await J('var m=document.getElementById("sp-fm");return !m.hidden&&/Add to playlist/.test(m.textContent)'), 'right-clicking a song opens the same menu');
  await J('document.body.click()'); await sleep(150);
  // seek bar fill follows the knob immediately
  const fill = await J('var s=document.getElementById("sp-seek");s.value=640;s.dispatchEvent(new Event("input",{bubbles:true}));return s.style.getPropertyValue("--p")');
  ok(fill === '64%', 'dragging the seek bar moves its coloured fill at once (' + fill + ')');
  await J('document.getElementById("sp-seek").dispatchEvent(new Event("change",{bubbles:true}))'); await sleep(1800);
  const moving = await J('var s=document.getElementById("sp-seek"),a=s.style.getPropertyValue("--p");await new Promise(function(r){setTimeout(r,250)});return [a,s.style.getPropertyValue("--p")]');
  ok(moving[0] !== moving[1], 'while playing, the bar moves continuously (' + moving.join(' then ') + ')');
  // lyrics: the button opens and closes them; lines change on time
  await click('.sp-np-v [data-act="sp-lyx"]');
  ok(await until(() => J('return !!document.querySelector("#sp-ly p")')), 'Lyrics button opens the lyrics');
  ok(await J('return document.querySelector(\'.sp-np-v [data-act="sp-lyx"]\').getAttribute("aria-pressed")==="true"'), 'the Lyrics button shows it is on');
  const lt = await J('var box=document.getElementById("sp-ly"),seen=[],last=null;var mo=new MutationObserver(function(){var on=box.querySelector("p.on");if(on&&on!==last){last=on;seen.push(performance.now())}});mo.observe(box,{subtree:true,attributes:true,attributeFilter:["class"]});await new Promise(function(r){setTimeout(r,9000)});mo.disconnect();var d=[];for(var i=1;i<seen.length;i++)d.push(seen[i]-seen[i-1]);return d');
  const dev = lt.length ? Math.max.apply(null, lt.map((x) => Math.abs(x - 2000))) : 9999;
  ok(lt.length >= 3 && dev < 90, 'lyric lines change exactly on the beat (every 2 s, worst error ' + Math.round(dev) + ' ms over ' + lt.length + ' changes)');
  await click('.sp-np-v [data-act="sp-lyx"]');
  ok(await until(() => J('return !document.querySelector("#sp-ly")')), 'pressing Lyrics again closes them');
  // delete my playlist (asks twice)
  await J('var b=[].find.call(document.querySelectorAll(\'#sp-pls [data-act="sp-nav"][data-t="playlist"]\'),function(x){return x.dataset.id==="p1"});b.click()');
  await until(() => J('return !!document.querySelector(\'[data-act="sp-pldel"]\')')); await click('[data-act="sp-pldel"]'); await sleep(200);
  ok(!calls.some((c) => /^DELETE \/playlists\/p1\/followers/.test(c)), 'Delete asks for a second press first');
  await click('[data-act="sp-pldel"]');
  ok(await until(() => Promise.resolve(calls.some((c) => /^DELETE \/playlists\/p1\/followers/.test(c)))), 'pressing Delete again deletes it');
  console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
