// Spotify playback rescue against a fake Spotify (SDK + Web API), in the real Regis app.
// Run: node_modules/electron/dist/electron test/spotify.test.js   (on Linux CI: xvfb-run -a ... --no-sandbox)
const { app, BrowserWindow } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path');
const DESK = path.join(__dirname, '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-sp-')));
const LG = () => {};
let pass = 0, fail = 0; const ok = (c, m) => { LG((c?'PASS ':'FAIL ')+m); if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(150); } return false; };
const calls = [];
const FAKE_SDK = `window.Spotify={Player:function(o){var L={},self=this;window.__sp={L:L,state:{paused:true,loading:false,position:0,duration:200000},opts:o};
  this.addListener=function(n,f){(L[n]=L[n]||[]).push(f)};this.connect=function(){setTimeout(function(){(L.ready||[]).forEach(function(f){f({device_id:"regis-dev"})})},300);return Promise.resolve(true)};
  this.pause=function(){window.__sp.state.paused=true;window.__sp.paused=(window.__sp.paused||0)+1;return Promise.resolve()};this.resume=function(){return Promise.resolve()};this.togglePlay=function(){return Promise.resolve()};
  this.nextTrack=function(){return Promise.resolve()};this.previousTrack=function(){return Promise.resolve()};this.seek=function(){return Promise.resolve()};this.activateElement=function(){};
  this.getCurrentState=function(){return Promise.resolve(Object.assign({},window.__sp.state))}}};setTimeout(function(){window.onSpotifyWebPlaybackSDKReady&&window.onSpotifyWebPlaybackSDKReady()},50);`;
let device = 'regis-dev', PLAYING = true;
const track = { id: 't1', uri: 'spotify:track:t1', name: 'Song One', duration_ms: 200000, artists: [{ id: 'a1', name: 'Artist' }], album: { id: 'al1', name: 'Album', images: [] } };
function api(method, url, body) {
  const u = new URL(url), p = u.pathname.replace('/v1', '');
  calls.push(method + ' ' + p + (u.search || '') + (body ? ' ' + body : ''));
  const devs = [{ id: 'regis-dev', name: 'Regis', type: 'Computer', is_active: device === 'regis-dev' }, { id: 'pc1', name: 'Spotify on PC', type: 'Computer', is_active: device === 'pc1' }];
  if (method === 'PUT' && p === '/me/player') { try { device = JSON.parse(body).device_ids[0]; } catch (_) {} return [204, ''] }
  if (p === '/me') return [200, { id: 'sam', display_name: 'Sam', product: 'premium' }];
  if (p === '/me/playlists') return [200, { items: [], next: null }];
  if (p === '/me/player/devices') return [200, { devices: devs }];
  if (p === '/me/player' && method === 'GET') return !device ? [204, ''] : [200, { device: devs.find((d) => d.id === device), is_playing: PLAYING, progress_ms: 9000, item: track, shuffle_state: false, repeat_state: 'off' }];
  if (p === '/me/player/queue') return [200, { queue: [] }];
  if (p.startsWith('/me/tracks/contains')) return [200, [false]];
  if (method !== 'GET') return [204, ''];
  return [200, { items: [] }];
}
require(path.join(DESK, 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  LG('win');win.setSize(1300, 860); win.show();
  const { net } = require('electron'); const ses = win.webContents.session;
  ses.protocol.handle('https', async (req) => {
    const url = req.url; if (!/(api.spotify.com|sdk.scdn.co|accounts.spotify.com)/.test(url)) return net.fetch(req, { bypassCustomProtocolHandlers: true });
    const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
    LG('req ' + req.method + ' ' + url.slice(0, 80));
    if (/sdk.scdn.co/.test(url)) return new Response(FAKE_SDK, { status: 200, headers: Object.assign({ 'Content-Type': 'application/javascript' }, H) });
    if (/accounts.spotify.com/.test(url)) return new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 }), { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, H) });
    const body = req.method === 'GET' ? null : await req.text(); const r = api(req.method, url, body || null);
    return new Response(r[0] === 204 ? null : (typeof r[1] === 'string' ? r[1] : JSON.stringify(r[1])), { status: r[0], headers: Object.assign({ 'Content-Type': 'application/json' }, H) });
  });
  LG('fetch on');const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  await sleep(2500);
  await J('localStorage.setItem("regis-sp-cid",JSON.stringify("cid0123456789abcdef0123456789abcd"));localStorage.setItem("regis-sp-tok",JSON.stringify({a:"AT",r:"RT",e:Date.now()+3600000}));localStorage.removeItem("regis-sp-drmbad")');
  LG('reload');win.webContents.reload(); await sleep(5000);LG('reloaded');
  await J('document.querySelector(\'#vsw [data-v="music"]\').click()'); await sleep(2500);
  ok(await until(() => J('return !!window.__sp&&calls0()'.replace('calls0()', 'true'))), 'Regis started its own Spotify player (fake SDK)');
  ok(await until(() => Promise.resolve(calls.some((c) => /GET \/me\/player\b/.test(c)))), 'Regis reads the player state');
  // 1) a playback error: Regis pauses its player at once and moves playback to the other device
  device = 'regis-dev'; const n0 = calls.length;
  await J('(window.__sp.L.playback_error||[]).forEach(function(f){f({message:"Playback error"})})');
  ok(await until(() => J('return (window.__sp.paused||0)>=1')), 'first playback error pauses Regis\'s player straight away (no song-skipping chain)');
  ok(await until(() => Promise.resolve(calls.slice(n0).some((c) => /PUT \/me\/player \{"device_ids":\["pc1"\],"play":true\}/.test(c)))), 'playback moves to the other Spotify device, playing');
  ok(await until(() => J('return /moved to Spotify on PC/.test([].map.call(document.querySelectorAll(".toast"),function(t){return t.textContent}).join(" "))')), 'Regis says where playback went');
  ok(await J('return !!localStorage.getItem("regis-sp-drmbad")'), 'Regis remembers its own player failed');
  // 2) pressing play later goes to the working device, not Regis's player
  device = ''; PLAYING = false; await J('return 1'); await sleep(5500); const n1 = calls.length;
  await J('var b=document.getElementById("sp-pp");if(b)b.click()'); await sleep(2500);
  const after = calls.slice(n1).join('\n');
  ok(/PUT \/me\/player \{"device_ids":\["pc1"\]/.test(after) || /play\?device_id=pc1/.test(after), 'next play goes to the working device');
  ok(!/device_id=regis-dev/.test(after), 'and never back to the failing Regis player');
  // 3) a silent stall (position stops moving) is caught too
  await J('localStorage.removeItem("regis-sp-drmbad")'); device = 'regis-dev'; PLAYING = true; await sleep(13000); /* wait out the rescue cooldown */
  const n2 = calls.length; await J('window.__sp.state={paused:false,loading:false,position:10000,duration:200000}');
  ok(await until(() => Promise.resolve(calls.slice(n2).some((c) => /"device_ids":\["pc1"\],"play":true/.test(c))), 9000), 'audio that silently stops (stuck position) is noticed within a few seconds and moved');
  console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
