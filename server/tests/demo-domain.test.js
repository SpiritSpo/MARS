import test from 'node:test';
import assert from 'node:assert/strict';
import {demoSeed,demoTotals,applyDemoAction} from '../src/demo-domain.js';

test('fictional seed has an explicit DEMO marker',()=>{
 assert.equal(demoSeed.mode,'DEMO');
 assert.equal(demoTotals(demoSeed).revenue,445000);
 assert.equal(demoTotals(demoSeed).expenses,42000);
});
test('accountant enters a transaction without changing the original seed',()=>{
 const next=applyDemoAction(demoSeed,'accountant',{type:'addTransaction',machineId:'JCB-DEMO-01',kind:'expense',amount:5000,description:'Тест'});
 assert.equal(demoTotals(next).expenses,47000);
 assert.equal(demoTotals(demoSeed).expenses,42000);
});
test('mechanic parts issue reduces stock and adds an expense',()=>{
 const next=applyDemoAction(demoSeed,'mechanic',{type:'usePart',partId:'PART-01',quantity:2,machineId:'MINI-DEMO-01'});
 assert.equal(next.parts[0].quantity,4);
 assert.equal(demoTotals(next).expenses,46200);
});
test('disallowed roles cannot modify accounting or stock',()=>{
 assert.throws(()=>applyDemoAction(demoSeed,'operator',{type:'addTransaction',machineId:'JCB-DEMO-01',kind:'income',amount:100}),/Forbidden/);
 assert.throws(()=>applyDemoAction(demoSeed,'accountant',{type:'usePart',partId:'PART-01',quantity:1,machineId:'JCB-DEMO-01'}),/Forbidden/);
});
test('cannot issue more parts than available',()=>{
 assert.throws(()=>applyDemoAction(demoSeed,'mechanic',{type:'usePart',partId:'PART-01',quantity:7,machineId:'JCB-DEMO-01'}),/Invalid part issue/);
});
