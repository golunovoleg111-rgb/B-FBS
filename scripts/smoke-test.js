'use strict';
const assert=require('node:assert/strict');
const XLSX=require('xlsx');
const base=process.env.BFBS_URL||'http://127.0.0.1:8080';
let token='';
async function api(path,options={}){const response=await fetch(base+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}}),body=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(body.error||`HTTP ${response.status}`),{status:response.status});return body}
(async()=>{
  const health=await api('/api/health');assert.equal(health.ok,true);
  const login=await api('/api/auth/login',{method:'POST',body:JSON.stringify({login:'Admin1',password:process.env.BFBS_TEST_ADMIN_PASSWORD||'Admin123'})});token=login.token;assert.equal(login.user.role,'admin');
  const suffix=Date.now().toString(36),pickerPassword='Picker-12345';
  const created=await api('/api/users',{method:'POST',body:JSON.stringify({login:`picker_${suffix}`,name:'Тестовый сборщик',role:'picker',password:pickerPassword})});assert.equal(created.user.role,'picker');
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['Артикул','Баркод','Размер'],['WB-TEST','2030000000099','L']]);XLSX.utils.book_append_sheet(workbook,sheet,'Номенклатура');const file=XLSX.write(workbook,{bookType:'xlsx',type:'buffer'});
  const preview=await api('/api/import/preview',{method:'POST',body:JSON.stringify({name:'wb-test.xlsx',data:file.toString('base64')})});assert.equal(preview.rows[1][0],'WB-TEST');
  const state=await api('/api/state');const saved=await api('/api/state',{method:'PUT',body:JSON.stringify({revision:state.revision,state:state.state})});assert.equal(saved.revision,state.revision+1);
  const pickerLogin=await api('/api/auth/login',{method:'POST',body:JSON.stringify({login:created.user.login,password:pickerPassword})});token=pickerLogin.token;let forbidden=false;try{await api('/api/users')}catch(error){forbidden=error.status===403}assert.equal(forbidden,true);
  console.log('B-FBS smoke test: OK');
})().catch(error=>{console.error(error);process.exitCode=1});
