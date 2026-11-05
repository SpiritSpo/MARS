import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoStore} from '../src/demo-store.js';
import {applyDemoAction,demoTotals} from '../src/demo-domain.js';
function pool(){
 let state=null,backup=null;
 const query=async(sql,args=[])=>{
  if(sql==='BEGIN')backup=structuredClone(state);
  else if(sql==='ROLLBACK')state=backup;
  else if(sql.startsWith('INSERT INTO'))state??=JSON.parse(args[0]);
  else if(sql.startsWith('UPDATE'))state=JSON.parse(args[0]);
  else if(sql.startsWith('SELECT'))return {rows:state?[{state:structuredClone(state)}]:[]};
  return {rows:[]};
 };
 return {query,async connect(){return {query,release(){}}}};
}
test('state persists across store instances',async()=>{
 const db=pool();
 await createDemoStore(db).update(s=>applyDemoAction(s,'accountant',{type:'addTransaction',machineId:'JCB-DEMO-01',kind:'expense',amount:1234}));
 assert.equal(demoTotals(await createDemoStore(db).read()).expenses,43234);
});
test('failed action rolls back',async()=>{
 const db=pool(),store=createDemoStore(db);
 await assert.rejects(()=>store.update(s=>applyDemoAction(s,'mechanic',{type:'usePart',partId:'PART-01',quantity:100,machineId:'JCB-DEMO-01'})));
 assert.equal(demoTotals(await store.read()).expenses,42000);
});
