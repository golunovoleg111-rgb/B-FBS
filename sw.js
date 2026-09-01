const CACHE='b-fbs-v19';
const ASSETS=['./','./index.html','./manifest.webmanifest','./styles.css','./editor-fixes.css','./workspace-v4.css','./workspace-v5.css','./workspace-v6.css','./wms-final.css','./ui-v2.css','./app.js','./workspace-hotfix.js','./workspace-v4.js','./workspace-v5.js','./workspace-v6.js','./vendor/qrcode.min.js','./vendor/xlsx.full.min.js','./wms-final.js','./ui-v2.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const requestUrl=new URL(event.request.url);
  if(event.request.method!=='GET'||requestUrl.origin!==self.location.origin||requestUrl.pathname.startsWith('/api/'))return;
  event.respondWith(fetch(event.request).then(response=>{
    const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
  }).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('./index.html'))));
});
