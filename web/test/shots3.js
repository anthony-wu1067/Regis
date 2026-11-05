'use strict';
/* design review shots: node shots3.js outDir [tag] ; desktop + phone + tablet, a couple of skins */
const http=require('http'),fs=require('fs'),path=require('path');const {chromium,devices}=require('playwright');const mock=require('./mockworld');
const dist=path.join(__dirname,'../dist'),out=process.argv[2]||'/tmp/claude-0/ds';fs.mkdirSync(out,{recursive:true});const tag=process.argv[3]||'';
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
const server=http.createServer((q,r)=>{let f=path.join(dist,q.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,b)=>{if(e){r.writeHead(404);r.end()}else{r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'});r.end(b)}})});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/';const b=await chromium.launch();
const targets=[['desk',{viewport:{width:1440,height:900},deviceScaleFactor:1}],['phone',devices['iPhone 14']],['tab',devices['iPad (gen 7) landscape']]];
const looks=[['violet',{skin:'violet',perf:'lite'}],['rhodes',{skin:'rhodes',perf:'lite',ui:'1',bg:'cosmos'}]];
for(const [tn,dev] of targets)for(const [ln,lk] of looks){if(process.env.ONLY&&process.env.ONLY!==tn+'-'+ln)continue;
const ctx=await b.newContext(dev);await mock.install(ctx);
await ctx.addInitScript((lk)=>{try{localStorage.setItem('regis-sec',JSON.stringify({gClientId:'c',gSecret:'s',gRefresh:'r',gEmail:'me@example.com'}));localStorage.setItem('regis-skin',lk.skin);localStorage.setItem('regis-perf',lk.perf);if(lk.ui)localStorage.setItem('regis-ui',lk.ui);if(lk.bg)localStorage.setItem('regis-bg',lk.bg)}catch(_){}},lk);
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(base);await p.waitForSelector('#p-setup');await p.waitForTimeout(3800);
await p.screenshot({path:`${out}/${tn}-${ln}${tag}-top.png`});await p.screenshot({path:`${out}/${tn}-${ln}${tag}-full.png`,fullPage:true});
if(errs.length)console.log(tn,ln,'ERR',errs.join('|'));await ctx.close()}
await b.close();server.close();process.exit(0)})();
