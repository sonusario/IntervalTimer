const C='interval-v2';
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
    const hit=await c.match(e.request,{ignoreSearch:true});
    if(hit){
      // Serve the cached copy at once, then refresh it in the background. If the
      // page itself came back different, tell the open windows a build is waiting.
      const seen=hit.clone();
      e.waitUntil((async()=>{
        try{
          const r=await fetch(e.request,{cache:'no-store'});
          if(!r||!r.ok)return;
          const fresh=r.clone();
          await c.put(e.request,r);
          if(!isPage)return;
          const [a,b]=await Promise.all([seen.text(),fresh.text()]);
          if(a===b)return;
          const ws=await self.clients.matchAll({type:'window',includeUncontrolled:true});
          for(const w of ws)w.postMessage({type:'update-ready'});
        }catch(err){}
      })());
      return hit;
    }
    try{
      const r=await fetch(e.request);
      if(r&&r.ok)c.put(e.request,r.clone());
      return r;
    }catch(err){
      return new Response('Offline and not cached yet.',{status:504,headers:{'Content-Type':'text/plain'}});
    }
  }));
});
// The app can also ask outright, rather than waiting for the next launch to notice.
self.addEventListener('message',e=>{
  const d=e.data||{};
  if(d.type!=='check')return;
  const port=e.ports&&e.ports[0],src=e.source;
  const reply=t=>{try{port?port.postMessage({type:t}):src&&src.postMessage({type:t})}catch(x){}};
  e.waitUntil((async()=>{
    try{
      const url=(d.url||(src&&src.url)||self.location.href).split('#')[0];
      const c=await caches.open(C);
      const hit=await c.match(url,{ignoreSearch:true});
      const r=await fetch(url,{cache:'no-store'});
      if(!r||!r.ok)return reply('check-failed');
      const text=await r.clone().text();
      // The question is whether the site has moved on from the build that is RUNNING,
      // which the cache cannot answer: it may already hold a newer copy, fetched in
      // the background, that the open page has not launched into yet.
      const m=/APP_BUILD=['"]([^'"]*)['"]/.exec(text);
      let news=!!(m&&d.build&&m[1]!==d.build);
      if(!news&&hit)news=(await hit.text())!==text;
      await c.put(url,r);
      if(!news)return reply('up-to-date');
      reply('update-ready');
      const ws=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      for(const w of ws)if(w!==src)w.postMessage({type:'update-ready'});
    }catch(err){reply('check-failed')}
  })());
});