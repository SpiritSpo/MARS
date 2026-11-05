import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoHandler} from '../src/demo-handler.js';

function request({method='GET',url='/demo/state',body}={}){
 const chunks=body===undefined?[]:[Buffer.from(JSON.stringify(body))];
 return {method,url,headers:{},async *[Symbol.asyncIterator](){yield* chunks}};
}
function response(){
 return {status:0,body:null,writeHead(status){this.status=status},end(body){this.body=JSON.parse(body)}};
}
async function call(handler,options){
 const res=response();await handler(request(options),res);return res;
}
test('demo rejects unauthenticated access',async()=>{
 const handler=createDemoHandler({getUser:async()=>null});
 assert.equal((await call(handler)).status,401);
 assert.equal((await call(handler,{method:'POST',url:'/demo/actions',body:{type:'addTransaction'}})).status,401);
});
test('mechanic can issue stock but cannot see finance transactions',async()=>{
 const handler=createDemoHandler({getUser:async()=>({role:'mechanic'})});
 const before=await call(handler);
 assert.equal(before.status,200);
 assert.equal('transactions' in before.body,false);
 const changed=await call(handler,{method:'POST',url:'/demo/actions',body:{type:'usePart',partId:'PART-01',quantity:2,machineId:'MINI-DEMO-01'}});
 assert.equal(changed.status,200);
 const after=await call(handler);
 assert.equal(after.body.parts[0].quantity,4);
});
test('accountant can record demo income but cannot issue parts',async()=>{
 const handler=createDemoHandler({getUser:async()=>({role:'accountant'})});
 const accepted=await call(handler,{method:'POST',url:'/demo/actions',body:{type:'addTransaction',machineId:'JCB-DEMO-01',kind:'income',amount:1000}});
 assert.equal(accepted.status,200);
 const denied=await call(handler,{method:'POST',url:'/demo/actions',body:{type:'usePart',partId:'PART-01',quantity:1,machineId:'JCB-DEMO-01'}});
 assert.equal(denied.status,403);
});
test('director receives recalculated totals after action',async()=>{
 const handler=createDemoHandler({getUser:async()=>({role:'director'})});
 await call(handler,{method:'POST',url:'/demo/actions',body:{type:'addTransaction',machineId:'JCB-DEMO-01',kind:'expense',amount:2000}});
 const res=await call(handler);
 assert.equal(res.status,200);
 assert.deepEqual(res.body.totals,{revenue:445000,expenses:44000,profit:401000});
});

test('accountant previews and confirms fictional import once',async()=>{
 const handler=createDemoHandler({getUser:async()=>({id:7,role:'accountant'})});
 const rows=[{machineId:'JCB-DEMO-01',kind:'income',amount:1500,description:'Демо'}];
 const preview=await call(handler,{method:'POST',url:'/demo/import/preview',body:{rows}});
 assert.equal(preview.status,200);
 assert.equal(preview.body.canCommit,true);
 const confirm=await call(handler,{method:'POST',url:'/demo/import/confirm',body:{token:preview.body.token}});
 assert.equal(confirm.status,200);
 assert.equal(confirm.body.imported,1);
 const repeated=await call(handler,{method:'POST',url:'/demo/import/confirm',body:{token:preview.body.token}});
 assert.equal(repeated.status,400);
 const state=await call(handler);
 assert.equal(state.body.transactions.length,4);
});
test('mechanic cannot import and duplicate preview cannot commit',async()=>{
 const mechanic=createDemoHandler({getUser:async()=>({id:8,role:'mechanic'})});
 const denied=await call(mechanic,{method:'POST',url:'/demo/import/preview',body:{rows:[]}});
 assert.equal(denied.status,403);
 const accountant=createDemoHandler({getUser:async()=>({id:9,role:'accountant'})});
 const row={machineId:'JCB-DEMO-01',kind:'income',amount:1500,description:'Демо'};
 const preview=await call(accountant,{method:'POST',url:'/demo/import/preview',body:{rows:[row,row]}});
 assert.equal(preview.body.canCommit,false);
 assert.equal(preview.body.errors.length,1);
});
