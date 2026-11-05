'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('accountant demo adapter previews and confirms through authenticated API',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../dist/accountant-demo-api.js'),'utf8');
 const {createAccountantDemoApi}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const calls=[];
 const api=createAccountantDemoApi({fetchImpl:async(url,options)=>{
  calls.push({url,options});
  return {ok:true,json:async()=>url.endsWith('/confirm')?{ok:true,imported:1}:{token:'preview-123',validCount:1,errors:[],canCommit:true}};
 }});
 const rows=[{machineId:'JCB-DEMO-01',kind:'expense',amount:1234,description:'Fictional expense'}];
 const preview=await api.previewRows(rows);
 assert.equal(preview.canCommit,true);
 assert.equal(preview.token,'preview-123');
 assert.deepEqual(JSON.parse(calls[0].options.body),{rows});
 assert.equal(calls[0].options.credentials,'same-origin');
 const result=await api.confirm(preview.token);
 assert.equal(result.imported,1);
 assert.deepEqual(JSON.parse(calls[1].options.body),{token:'preview-123'});
 await assert.rejects(()=>api.confirm(''));
});

test('accountant demo adapter propagates server authorization errors',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../dist/accountant-demo-api.js'),'utf8');
 const {createAccountantDemoApi}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const api=createAccountantDemoApi({fetchImpl:async()=>({ok:false,json:async()=>({error:'Forbidden'})})});
 await assert.rejects(()=>api.state(),/Forbidden/);
});
