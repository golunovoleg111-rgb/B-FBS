'use strict';

const assert=require('node:assert/strict');
const http=require('node:http');
const net=require('node:net');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

const token='wb-test-token-12345678901234567890';
const order={id:5656392763,orderUid:'test-uid',article:'TEST-ARTICLE',skus:['2000000000001'],warehouseId:658434,nmId:123456,createdAt:'2026-09-04T08:00:00Z'};
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'bfbs-wb-test-'));
let app=null,mock=null;

function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})})}
function listen(server,port){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})}
async function waitFor(url){for(let i=0;i<60;i++){try{const response=await fetch(url);if(response.ok)return}catch(_){}await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Тестовый сервер B-FBS не запустился.')}

(async()=>{
  const [mockPort,appPort]=await Promise.all([freePort(),freePort()]);
  mock=http.createServer((req,res)=>{
    assert.equal(req.url,'/api/v3/orders/new');
    assert.equal(req.headers.authorization,token,'WB token must stay in the server-to-server request');
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({orders:[order]}));
  });
  await listen(mock,mockPort);
  const appEnv={...process.env,PORT:String(appPort),BFBS_DATA_DIR:dataDir,BFBS_ADMIN_PASSWORD:'Test-Admin-12345',BFBS_WB_API_BASE:`http://127.0.0.1:${mockPort}`};
  delete appEnv.WB_API_TOKEN;
  app=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:appEnv,stdio:['ignore','pipe','pipe']});
  let stderr='';app.stderr.on('data',chunk=>{stderr+=chunk});
  await waitFor(`http://127.0.0.1:${appPort}/api/health`);
  let response=await fetch(`http://127.0.0.1:${appPort}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:'Admin1',password:'Test-Admin-12345'})});
  const login=await response.json();assert.ok(login.token);
  const headers={Authorization:`Bearer ${login.token}`,'Content-Type':'application/json'};
  response=await fetch(`http://127.0.0.1:${appPort}/api/wb/status`,{headers});
  assert.equal((await response.json()).configured,false);
  response=await fetch(`http://127.0.0.1:${appPort}/api/wb/token`,{method:'PUT',headers,body:JSON.stringify({token})});
  const saved=await response.json();assert.equal(response.status,200,stderr||saved.error);assert.equal(saved.configured,true);assert.equal(saved.ordersCount,1);
  response=await fetch(`http://127.0.0.1:${appPort}/api/wb/orders/new`,{headers:{Authorization:`Bearer ${login.token}`}});
  const result=await response.json();assert.equal(response.status,200,stderr||result.error);assert.deepEqual(result.orders,[order]);
  response=await fetch(`http://127.0.0.1:${appPort}/api/wb/token`,{method:'DELETE',headers});
  assert.equal((await response.json()).configured,false);
  response=await fetch(`http://127.0.0.1:${appPort}/api/wb/orders/new`,{headers});
  assert.equal(response.status,503);
  console.log('B-FBS WB API test: OK');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
  if(app&&app.exitCode===null){
    const exited=new Promise(resolve=>{app.once('exit',resolve);setTimeout(resolve,3000)});
    app.kill();await exited;
  }
  if(mock)await new Promise(resolve=>mock.close(resolve));
  fs.rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
});
