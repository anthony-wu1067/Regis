// YouTube ad cleaner (Shield) against a fake youtube.com served inside the browser's session. No real YouTube needed.
// Run: node_modules/electron/dist/electron test/youtube.test.js
const { app, BrowserWindow, session, net, webContents } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-yt-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(150); } return false; };
const PAGE = `<!doctype html><title>yt</title><div id="movie_player" class="html5-video-player"><video></video></div>
<ytd-ad-slot-renderer id="ad">ad</ytd-ad-slot-renderer><div id="real">video</div>
<script>
var a=JSON.parse('{"playerResponse":{"adPlacements":[1],"playerAds":[2],"videoDetails":{"title":"x"}},"adSlots":[3]}');
window.ytInitialPlayerResponse={adPlacements:[1],playerAds:[1],streamingData:{ok:1}};
var feed=JSON.parse('{"contents":[{"richItemRenderer":{"content":{"adSlotRenderer":{}}}},{"richItemRenderer":{"content":{"videoRenderer":{}}}}]}');
fetch('/youtubei/v1/player').then(function(r){return r.json()}).then(function(j){
  window.RESULT={parse:!a.playerResponse.adPlacements&&!a.playerResponse.playerAds&&!a.adSlots&&a.playerResponse.videoDetails.title==="x",
    initial:!window.ytInitialPlayerResponse.adPlacements&&!window.ytInitialPlayerResponse.playerAds&&window.ytInitialPlayerResponse.streamingData.ok===1,
    feed:feed.contents.length===1&&!!feed.contents[0].richItemRenderer.content.videoRenderer,
    fetch:!j.adPlacements&&j.streamingData.ok===1};document.title="done"});
</script>`;
const { PARTITION } = require(path.join(__dirname, '..', 'lib', 'browser.js'));
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  const ses = session.fromPartition(PARTITION);
  ses.protocol.handle('https', (req) => {
    const u = new URL(req.url);
    if (u.hostname === 'www.youtube.com') {
      if (u.pathname === '/youtubei/v1/player') return new Response(JSON.stringify({ adPlacements: [1], streamingData: { ok: 1 } }), { headers: { 'content-type': 'application/json' } });
      return new Response(PAGE, { headers: { 'content-type': 'text/html' } });
    }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1300, 840); win.show(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(1200);
  await J('var a=document.getElementById("bw-addr");a.value="https://www.youtube.com/watch?v=test";document.getElementById("bw-form").requestSubmit()');
  let yt; ok(await until(() => { yt = webContents.getAllWebContents().find((w) => /youtube\.com\/watch/.test(w.getURL())); return yt && yt.getTitle() === 'done'; }), 'the fake YouTube page loads in a Regis tab');
  const r = yt ? await yt.executeJavaScript('window.RESULT||{}') : {};
  ok(r.parse, 'ad data is removed from the player response (JSON.parse)');
  ok(r.initial, 'ad data is removed from ytInitialPlayerResponse, the rest is kept');
  ok(r.feed, 'ad cards are dropped from the home feed');
  ok(r.fetch, 'ad data is removed from player answers fetched later');
  ok(yt && await yt.executeJavaScript('getComputedStyle(document.getElementById("ad")).display==="none"&&getComputedStyle(document.getElementById("real")).display!=="none"'), 'ad boxes are hidden, videos are not');
  await yt.executeJavaScript('document.getElementById("movie_player").classList.add("ad-showing")');
  ok(await until(() => yt.executeJavaScript('document.querySelector("video").muted===true')), 'an ad that still starts is muted and skipped');
  await yt.executeJavaScript('document.getElementById("movie_player").classList.remove("ad-showing")');
  ok(await until(() => yt.executeJavaScript('document.querySelector("video").muted===false')), 'the sound comes back when the video itself plays');
  // Shield off: nothing is changed
  await J('var b=document.getElementById("bw-shield");if(b&&b.getAttribute("aria-pressed")==="true")b.click()'); await sleep(500);
  await yt.loadURL('https://www.youtube.com/watch?v=two'); await until(() => yt.getTitle() === 'done');
  const r2 = await yt.executeJavaScript('window.RESULT||{}');
  ok(r2.parse === false, 'with Shield off, YouTube is left as it is');
  console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
