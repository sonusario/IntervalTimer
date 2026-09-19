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
