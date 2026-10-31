import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {hostingAccess} from './hosting.js';

test('hosted browsing is public; mutations require a signed, expiring owner cookie and trusted origin',async()=>{
  let clock=1000000;const app=express();app.use(express.json());hostingAccess({code:'test-private-code',origin:'https://pocket.example',now:()=>clock}).install(app);
  app.get('/api/evidence',(_req,res)=>res.json({sources:3}));app.post('/api/execute',(_req,res)=>res.json({started:true}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,body,headers={})=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    assert.equal((await call('/api/evidence')).status,200);assert.equal((await call('/api/execute',{})).status,401);
    assert.equal((await call('/api/access/unlock',{code:'wrong'})).status,401);
    assert.equal((await call('/api/access/unlock',{code:'test-private-code'},{Origin:'https://untrusted.example'})).status,403);
    const login=await call('/api/access/unlock',{code:'test-private-code'},{Origin:'https://pocket.example'});assert.equal(login.status,200);
    const setCookie=login.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.match(setCookie,/Secure/);assert.ok(!setCookie.includes('test-private-code'));
    const cookie=setCookie.split(';')[0];assert.equal((await call('/api/execute',{}, {Cookie:cookie,Origin:'https://pocket.example'})).status,200);
    assert.equal((await call('/api/execute',{}, {Cookie:cookie+'changed'})).status,401);
    assert.equal((await call('/api/execute',{}, {Cookie:cookie,Origin:'https://untrusted.example'})).status,403);
    clock+=13*60*60*1000;assert.equal((await call('/api/execute',{}, {Cookie:cookie})).status,401);
    assert.match((await call('/api/access/lock',{})).headers.get('set-cookie'),/Max-Age=0/);
    for(let i=0;i<10;i++)await call('/api/access/unlock',{code:'wrong'});
    assert.equal((await call('/api/access/unlock',{code:'wrong'})).status,429);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('local development works without an access code',()=>{
  const access=hostingAccess({code:''});assert.equal(access.access({headers:{}}),true);
});
