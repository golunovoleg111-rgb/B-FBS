'use strict';

const assert=require('node:assert/strict');
const base=process.env.BFBS_URL||'http://127.0.0.1:8080';
const adminPassword=process.env.BFBS_TEST_ADMIN_PASSWORD||'Admin123';

async function request(pathname,{token='',method='GET',body,expectStatus}={}){
  const response=await fetch(base+pathname,{
    method,
    headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
  const data=await response.json().catch(()=>({}));
  if(expectStatus!==undefined){
    assert.equal(response.status,expectStatus,`${method} ${pathname} expected ${expectStatus}, got ${response.status}: ${data.error||''}`);
    return data;
  }
  if(!response.ok)throw Object.assign(new Error(data.error||`HTTP ${response.status}`),{status:response.status,data});
  return data;
}

(async()=>{
  const admin=await request('/api/auth/login',{method:'POST',body:{login:'Admin1',password:adminPassword}});
  assert.equal(admin.user.role,'admin');
  assert.equal(admin.user.permissions.zones_manage,true);

  const suffix=Date.now().toString(36);
  const pickerPassword='Picker-Permissions-123!';
  const created=await request('/api/users',{
    token:admin.token,
    method:'POST',
    body:{
      login:`perm_picker_${suffix}`,
      name:'Проверка прав',
      role:'picker',
      password:pickerPassword,
      permissions:{
        dashboard_view:true,workspace_view:true,layout_manage:false,zones_manage:false,
        inventory_view:true,inventory_manage:false,nomenclature_manage:false,
        transfers_view:false,transfers_manage:false,revisions_view:false,revisions_manage:false,
        tasks_view:true,tasks_manage:false,tasks_pick:true
      }
    }
  });
  assert.equal(created.user.permissions.zones_manage,false);

  const original=await request('/api/state',{token:admin.token});
  const seeded=structuredClone(original.state||{});
  const zone={id:'PERMISSION-ZONE',name:'Исходная зона',x:100,y:100,w:100,h:100,capacity:10,locked:false};
  seeded.warehouses=[{
    id:'PERMISSION-WH',name:'Permission test',
    draft:{name:'Permission test',walls:[],objects:[],width:10,height:10,grid:.5,snap:true},
    published:null,zones:[structuredClone(zone)],versions:[]
  }];
  seeded.workspace={draft:{name:'Permission test',walls:[],objects:[],width:10,height:10,grid:.5,snap:true},published:null,zones:[structuredClone(zone)],versions:[]};
  seeded.wms=seeded.wms||{nomenclature:[],boxes:[],transfers:[],revisions:[],tasks:[],movements:[],events:[]};

  const seededSave=await request('/api/state',{
    token:admin.token,method:'PUT',body:{revision:original.revision,state:seeded}
  });

  const picker=await request('/api/auth/login',{method:'POST',body:{login:created.user.login,password:pickerPassword}});
  assert.equal(picker.user.permissions.zones_manage,false);

  const pickerState=await request('/api/state',{token:picker.token});
  const forbiddenState=structuredClone(pickerState.state);
  forbiddenState.warehouses[0].zones[0].name='Запрещенное изменение';
  forbiddenState.workspace.zones[0].name='Запрещенное изменение';
  const forbidden=await request('/api/state',{
    token:picker.token,method:'PUT',
    body:{revision:pickerState.revision,state:forbiddenState},
    expectStatus:403
  });
  assert.equal(forbidden.permission,'zones_manage');

  const enabledPermissions={...created.user.permissions,zones_manage:true};
  const updated=await request(`/api/users/${encodeURIComponent(created.user.id)}`,{
    token:admin.token,method:'PATCH',body:{permissions:enabledPermissions}
  });
  assert.equal(updated.user.permissions.zones_manage,true);

  const refreshed=await request('/api/state',{token:picker.token});
  assert.equal(refreshed.user.permissions.zones_manage,true,'Active session must receive updated permissions');

  const allowedState=structuredClone(refreshed.state);
  allowedState.warehouses[0].zones[0].name='Разрешенное изменение';
  allowedState.workspace.zones[0].name='Разрешенное изменение';
  const allowed=await request('/api/state',{
    token:picker.token,method:'PUT',
    body:{revision:refreshed.revision,state:allowedState}
  });
  assert.equal(allowed.revision,refreshed.revision+1);

  await request('/api/state',{
    token:admin.token,method:'PUT',
    body:{revision:allowed.revision,state:original.state}
  });

  console.log('B-FBS permissions test: OK');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
