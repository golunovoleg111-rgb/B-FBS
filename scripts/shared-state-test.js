'use strict';

const assert=require('node:assert/strict');
const base=process.env.BFBS_URL||'http://127.0.0.1:8080';
const password=process.env.BFBS_TEST_ADMIN_PASSWORD||'Admin123';

async function request(pathname,{token='',method='GET',body}={}){
  const response=await fetch(base+pathname,{
    method,
    headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error||`HTTP ${response.status}`),{status:response.status,data});
  return data;
}

async function login(){
  return request('/api/auth/login',{method:'POST',body:{login:'Admin1',password}});
}

(async()=>{
  const [clientA,clientB]=await Promise.all([login(),login()]);
  assert.equal(clientA.user.id,clientB.user.id,'Both sessions must belong to the same Admin1 account');

  const original=await request('/api/state',{token:clientA.token});
  const marker={id:`SHARED_TEST_${Date.now().toString(36)}`,text:'two-device shared-state test',at:new Date().toISOString(),user:'CI'};
  const state=structuredClone(original.state||{});
  state.wms=state.wms||{};
  state.wms.events=[marker,...(state.wms.events||[])];

  const saved=await request('/api/state/import-backup',{
    token:clientA.token,
    method:'POST',
    body:{revision:original.revision,state}
  });

  const seen=await request('/api/state',{token:clientB.token});
  assert.equal(seen.revision,saved.revision,'Second session must see the imported server revision');
  assert.ok(seen.state?.wms?.events?.some(event=>event.id===marker.id),'Second session must see backup data imported by first session');

  await request('/api/state/import-backup',{
    token:clientB.token,
    method:'POST',
    body:{revision:seen.revision,state:original.state}
  });

  console.log('B-FBS shared-state test: OK');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
