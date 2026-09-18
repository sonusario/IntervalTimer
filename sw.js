const C='interval-v1';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  // Only this app's own files. Anything else (fonts, other sites) is left to the browser,
  // so a blocked or offline third party fails the way it normally would.
  if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
  e.respondWith(caches.open(C).then(async c=>{
    const hit=await c.match(e.request,{ignoreSearch:true});
    if(hit){
      e.waitUntil(fetch(e.request).then(r=>{if(r&&r.ok)return c.put(e.request,r.clone())}).catch(()=>{}));
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
