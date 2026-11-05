import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileFinance,financeTotals} from '../src/finance-reconciliation.js';

test('FORMAT is excluded from totals while remaining visible',()=>{
 const rows=reconcileFinance([
  {machineId:'JCB-1',month:'2026-07',sourceType:'monthly',revenue:1000,expenses:300,reportedProfit:700},
  {machineId:'JCB-1',month:'2026-07',sourceType:'format',revenue:1000,expenses:300,reportedProfit:700}
 ]);
 assert.equal(rows.length,2);
 assert.equal(rows[1].includedInTotals,false);
 assert.equal(financeTotals(rows).revenue,1000);
});
test('mismatches are flagged without overwriting reported profit',()=>{
 const [row]=reconcileFinance([{machineId:'Audi A6',month:'2026-08',sourceType:'monthly',revenue:200000,expenses:100000,reportedProfit:149500}]);
 assert.equal(row.reportedProfit,149500);
 assert.equal(row.calculatedProfit,100000);
 assert.equal(row.discrepancy,49500);
 assert.equal(row.warnings[0].code,'PROFIT_MISMATCH');
});
test('duplicate machine/month/source rejected',()=>{
 const item={machineId:'A',month:'2026-09',sourceType:'monthly',revenue:1,expenses:0,reportedProfit:1};
 assert.throws(()=>reconcileFinance([item,item]),/Duplicate source/);
});
test('decimal money uses integer kopecks',()=>{
 const [row]=reconcileFinance([{machineId:'A',month:'2026-09',sourceType:'monthly',revenue:0.3,expenses:0.1,reportedProfit:0.2}]);
 assert.equal(row.discrepancy,0);
});
