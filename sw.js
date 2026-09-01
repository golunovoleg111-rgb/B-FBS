const CACHE='b-fbs-v2';
const ASSETS=['./','./index.html','./manifest.webmanifest','./styles.css','./editor-fixes.css','./workspace-v4.css','./workspace-v5.css','./workspace-v6.css','./wms-final.css','./app.js','./workspace-hotfix.js','./workspace-v4.js','./workspace-v5.js','./workspace-v6.js','./vendor/qrcode.min.js','./wms-final.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).pathname.startsWith('/api/'))return;
  event.respondWith(fetch(event.request).then(response=>{
    const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
  }).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('./index.html'))));
});
