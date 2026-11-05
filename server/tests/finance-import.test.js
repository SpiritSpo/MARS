import test from 'node:test';
import assert from 'node:assert/strict';
import {stageFinanceImport} from '../src/finance-import.js';
const row={machineId:'jcb_1',revenue:'1000.00',fuel:'100.00',repairs:'50.00',payroll:'150.00',otherExpenses:'0.00',reportedExpenses:'300.00',reportedProfit:'700.00'};
function mock({existing=[],known=['jcb_1'],failInsert=false}={}){
 const calls=[];
 const client={query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT id, status'))return {rows:existing};
  if(sql.startsWith('SELECT id FROM finance_machines'))return {rows:known.map(id=>({id}))};
  if(failInsert&&sql.startsWith('INSERT INTO finance_monthly'))throw Error('Database insert failed');
  return {rows:[]};
 },release:()=>{calls.push({sql:'RELEASE'})}};
 return {pool:{connect:async()=>client},calls};
}
const input={filename:'july.xlsx',period:'2026-07',rows:[row],sourceBytes:Buffer.from('sample workbook bytes')};
test('stages a valid row in a transaction, without approving it',async()=>{
 const {pool,calls}=mock();const result=await stageFinanceImport(pool,input);
 assert.equal(result.status,'staged');assert.equal(result.rows,1);
 assert.equal(calls.filter(x=>x.sql==='COMMIT').length,1);
 assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO finance_monthly')).length,1);
 assert.equal(calls.find(x=>x.sql.startsWith('INSERT INTO finance_imports')).args[4],'staged');
});
test('repeated file checksum does not create new financial records',async()=>{
 const {pool,calls}=mock({existing:[{id:'previous',status:'staged'}]});
 const result=await stageFinanceImport(pool,input);
 assert.equal(result.duplicate,true);
 assert.equal(calls.filter(x=>x.sql.startsWith('INSERT')).length,0);
});
test('unknown machine rolls back',async()=>{
 const {pool,calls}=mock({known:[]});
 await assert.rejects(stageFinanceImport(pool,input),/Unknown machines/);
 assert.ok(calls.some(x=>x.sql==='ROLLBACK'));
 assert.equal(calls.filter(x=>x.sql.startsWith('INSERT')).length,0);
});
test('database failure rolls back',async()=>{
 const {pool,calls}=mock({failInsert:true});
 await assert.rejects(stageFinanceImport(pool,input),/Database insert failed/);
 assert.ok(calls.some(x=>x.sql==='ROLLBACK'));
 assert.ok(!calls.some(x=>x.sql==='COMMIT'));
});
test('arithmetic mismatch remains staged and is reported',async()=>{
 const {pool}=mock();const result=await stageFinanceImport(pool,{...input,rows:[{...row,reportedProfit:'0.00'}]});
 assert.deepEqual(result.issues,[{row:1,machineId:'jcb_1',code:'profit_mismatch'}]);
});
test('bad period fails before opening transaction',async()=>{
 const {pool,calls}=mock();
 await assert.rejects(stageFinanceImport(pool,{...input,period:'2026-99'}),/period/);
 assert.equal(calls.length,0);
});
