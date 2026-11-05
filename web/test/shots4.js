'use strict';
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');const mock=require('./mockworld');
const dist=path.join(__dirname,'../dist'),out=process.argv[2]||'/tmp/claude-0/ds';fs.mkdirSync(out,{recursive:true});const tag=process.argv[3]||'';
const widths=(process.argv[4]||'1100,1280,1440,1800').split(',').map(Number);const skin=process.argv[5]||'rhodes',ui=process.argv[6]||'1',bg=process.argv[7]||'cosmos';
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
const server=http.createServer((q,r)=>{let f=path.join(dist,q.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';fs.readFile(f,(e,b)=>{if(e){r.writeHead(404);r.end()}else{r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'});r.end(b)}})});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/';const b=await chromium.launch();
for(const w of widths){const ctx=await b.newContext({viewport:{width:w,height:620}});await mock.install(ctx);
await ctx.addInitScript(([s,u,g])=>{localStorage.setItem('regis-sec',JSON.stringify({gClientId:'c',gSecret:'s',gRefresh:'r',gEmail:'me@example.com'}));localStorage.setItem('regis-skin',s);localStorage.setItem('regis-perf','lite');if(u==='1')localStorage.setItem('regis-ui','1');localStorage.setItem('regis-bg',g)},[skin,ui,bg]);
const p=await ctx.newPage();await p.goto(base);await p.waitForSelector('#p-setup');await p.waitForTimeout(3500);
const ov=await p.evaluate(()=>{const R=e=>e.getBoundingClientRect();const d=R(document.querySelector('#dial'));const o=[];document.querySelectorAll('.tools .btn,.glance .g,.hello h1').forEach(e=>{const r=R(e);if(r.width&&r.left<d.right&&r.right>d.left&&r.top<d.bottom&&r.bottom>d.top)o.push((e.textContent||'').trim().slice(0,12))});return {dial:[Math.round(d.left),Math.round(d.right)],overlap:o}});
console.log(w,JSON.stringify(ov));await p.screenshot({path:`${out}/w${w}${tag}.png`});await ctx.close()}
await b.close();server.close();process.exit(0)})();
