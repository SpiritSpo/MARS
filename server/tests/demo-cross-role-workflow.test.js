import test from 'node:test';
import assert from 'node:assert/strict';
import {demoSeed,demoTotals,applyDemoAction} from '../src/demo-domain.js';

test('cross-role demo workflow updates financial totals and stock without mutating seed',()=>{
 const afterAccountant=applyDemoAction(demoSeed,'accountant',{
  type:'addTransaction',machineId:'JCB-DEMO-01',kind:'income',amount:10000,description:'Учебный доход'
 });
 const afterMechanic=applyDemoAction(afterAccountant,'mechanic',{
  type:'usePart',partId:'PART-01',quantity:2,machineId:'MINI-DEMO-01'
 });
 assert.equal(afterMechanic.parts[0].quantity,4);
 assert.deepEqual(demoTotals(afterMechanic),{revenue:455000,expenses:46200,profit:408800});
 assert.deepEqual(demoTotals(demoSeed),{revenue:445000,expenses:42000,profit:403000});
});
test('roles cannot perform actions outside their permissions',()=>{
 const transaction={type:'addTransaction',machineId:'JCB-DEMO-01',kind:'income',amount:100};
 for(const role of ['mechanic','dispatcher','operator','unknown']){
  assert.throws(()=>applyDemoAction(demoSeed,role,transaction),/Forbidden/);
 }
 for(const role of ['accountant','dispatcher','operator']){
  assert.throws(()=>applyDemoAction(demoSeed,role,{
   type:'usePart',partId:'PART-01',quantity:1,machineId:'JCB-DEMO-01'
  }),/Forbidden/);
 }
});
test('demo refuses invalid financial operations',()=>{
 for(const amount of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>applyDemoAction(demoSeed,'accountant',{
   type:'addTransaction',machineId:'JCB-DEMO-01',kind:'expense',amount
  }),/Invalid transaction/);
 }
});
