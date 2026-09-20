const C='interval-v2';
/* What counts as "a new version" is the build stamp, not the bytes: hosts and CDNs
   rarely hand back a byte-identical page twice (compression variance, injected tags,
   auto-minify), and comparing whole files cries wolf on every single load. */
const buildOf=t=>{const m=/APP_BUILD=['"]([^'"]*)['"]/.exec(t||'');return m?m[1]:''};
/* One address, one copy. A Vary header otherwise lets a second entry pile up behind
   the first, and a launch whose headers match neither goes to the network — which is
   the one thing the cache existed to avoid. */
const ONE={ignoreSearch:true,ignoreVary:true};
async function store(c,key,res){
  try{await c.delete(key,ONE)}catch(e){}
  await c.put(key,res);
}
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  // Drop caches from older versions of this worker so nothing lingers on disk.
  const names=await caches.keys();
  await Promise.all(names.filter(n=>n!==C).map(n=>caches.delete(n)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  // Only this app's own files. Anything else is left to the browser.
  if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
  const isPage=e.request.mode==='navigate'||e.request.destination==='document';
  e.respondWith(caches.open(C).then(async c=>{
    const hit=await c.match(e.request,ONE);
    if(hit){
      // Serve the cached copy at once, then refresh it in the background. If the
      // page itself came back different, tell the open windows a build is waiting.
      const seen=hit.clone();
      e.waitUntil((async()=>{
        try{
          const r=await fetch(e.request,{cache:'no-store'});
          if(!r||!r.ok)return;
          const fresh=r.clone();
          await store(c,e.request,r);
          if(!isPage)return;
          const [a,b]=await Promise.all([seen.text(),fresh.text()]);
          const ba=buildOf(a),bb=buildOf(b);
          if(ba&&bb?ba===bb:a===b)return;
          const ws=await self.clients.matchAll({type:'window',includeUncontrolled:true});
          for(const w of ws)w.postMessage({type:'update-ready',build:bb});
        }catch(err){}
      })());
      return hit;
    }
    try{
      const r=await fetch(e.request);
      if(r&&r.ok)await store(c,e.request,r.clone());
      return r;
    }catch(err){
      return new Response('Offline and not cached yet.',{status:504,headers:{'Content-Type':'text/plain'}});
    }
  }));
});
/* The app can also ask outright — "check" before showing a prompt, "refresh" just
   before reloading, so the reload cannot land back on the copy it is trying to leave. */
self.addEventListener('message',e=>{
  const d=e.data||{};
  if(d.type!=='check'&&d.type!=='refresh')return;
  const port=e.ports&&e.ports[0],src=e.source;
  const reply=(t,build)=>{const m={type:t,build:build||''};
    try{port?port.postMessage(m):src&&src.postMessage(m)}catch(x){}};
  e.waitUntil((async()=>{
    try{
      const url=(d.url||(src&&src.url)||self.location.href).split('#')[0];
      const c=await caches.open(C);
      const r=await fetch(url,{cache:'no-store'});
      if(!r||!r.ok)return reply('check-failed');
      const text=await r.clone().text(),fb=buildOf(text);
      /* Replace the page under every key it is actually stored with. Putting it under
         a bare URL instead can leave the entry a navigation matches untouched, and
         then the reload keeps serving the copy it was meant to replace. */
      /* Replace the page under the key it is actually stored with. Inventing a key
         from the bare URL leaves the entry a navigation matches untouched, so the
         reload keeps serving the very copy it was asked to replace. With nothing
         cached yet there is nothing to re-key: the next launch stores it properly. */
      const keys=await c.keys(url,ONE);
      let was=null;
      if(keys.length){
        const old=await c.match(keys[0],ONE);
        if(old)was=await old.text();
        await store(c,keys[0],r.clone());
      }
      if(d.type==='refresh')return reply('refreshed',fb);
      // Has the site moved past the build that is RUNNING? The cache cannot answer
      // that: it may already hold a newer copy the open page has not launched into.
      let news=!!(fb&&d.build&&fb!==d.build);
      if(!news&&!fb&&was!=null)news=was!==text;
      reply(news?'update-ready':'up-to-date',fb);
      if(!news)return;
      const ws=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      for(const w of ws)if(w!==src)w.postMessage({type:'update-ready',build:fb});
    }catch(err){reply('check-failed')}
  })());
});