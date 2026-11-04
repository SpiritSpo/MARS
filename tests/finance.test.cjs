const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function fixture(){
 const node=()=>({innerHTML:'',textContent:'',style:{},value:'',classList:{add(){},remove(){}},querySelectorAll(){return [];},addEventListener(){}});
 const elements=new Map();
 const ctx=vm.createContext({console,structuredClone,Intl,Date,Math,setTimeout,clearTimeout,
  document:{querySelector(s){if(!elements.has(s))elements.set(s,node());return elements.get(s);},querySelectorAll(){return [];},addEventListener(){},body:{style:{}},activeElement:{tagName:'BODY'}},
  localStorage:{getItem(){return null;},setItem(){}}
 });
 const run=s=>vm.runInContext(s,ctx);
 const dir=path.join(__dirname,'..','dist');
 run(fs.readFileSync(path.join(dir,'workshop.js'),'utf8'));
 run(fs.readFileSync(path.join(dir,'app.js'),'utf8').replace(/\nrender\(\);\s*$/,''));
 run('render=()=>{};toast=()=>{};role="director";period="2027-01";state.operations=[];');
 return {run,ctx};
}
function op(id,kind,amount,extra={}){
 return {id,kind,amount,date:'2027-01-04',machine:'M001',category:'Тест',note:'Тестовая операция',...extra};
}
function add(a,...items){a.ctx.inputOps=items;a.run('state.operations.push(...inputOps)');delete a.ctx.inputOps;}
function totals(a){return JSON.parse(a.run('JSON.stringify(overallFinance())'));}
function result(a){return a.run('overallFinance().income-overallFinance().expense');}

test('Company revenue and margin include accountant expenses and reconcile to the dashboard',()=>{
 const a=fixture();
 add(a,op('i','income',100000),op('m','expense',20000),op('a','expense',10000,{machine:'',allocation:'overhead',source:'excel-demo'}));
 assert.deepEqual(totals(a),{income:100000,expense:30000});
 assert.equal(result(a),70000);
 assert.equal(a.run("result(machine('M001'))"),80000);
 const html=a.run('dashboardPage()');
 assert.match(html,/Выручка/);
 assert.match(html,/100 000|100 000/);
 assert.match(html,/70 000|70 000/);
 assert.match(html,/70,0%/);
});

test('Warehouse purchase is excluded from machine and company P&L until consumed',()=>{
 const a=fixture();
 add(a,op('i','income',100000),op('w','expense',45000,{machine:'',allocation:'warehouse',source:'excel-demo'}));
 assert.deepEqual(totals(a),{income:100000,expense:0});
 assert.equal(a.run("result(machine('M001'))"),100000);
 add(a,op('repair','expense',15000,{sourceRepair:'repair-1'}));
 assert.deepEqual(totals(a),{income:100000,expense:15000});
 assert.equal(a.run("result(machine('M001'))"),85000);
});

test('Accounting overhead affects total company result but not individual machine result',()=>{
 const a=fixture();
 add(a,op('i','income',90000),op('m','expense',30000),op('o','expense',12000,{machine:'',allocation:'overhead'}));
 assert.deepEqual(totals(a),{income:90000,expense:42000});
 assert.equal(result(a),48000);
 assert.equal(a.run("result(machine('M001'))"),60000);
 assert.equal(a.run('unallocatedExpenses().length'),1);
});

test('Financial filters use the selected period without including another month',()=>{
 const a=fixture();
 add(a,op('i','income',20000),op('old','expense',5000,{date:'2026-12-30'}));
 assert.deepEqual(totals(a),{income:20000,expense:0});
 a.run('period="2026-12"');
 assert.deepEqual(totals(a),{income:0,expense:5000});
});

test('Financial figures change after accounting import and remain consistent in overview and finance',()=>{
 const a=fixture();
 add(a,op('i','income',100000));
 assert.equal(result(a),100000);
 add(a,op('a','expense',28000,{source:'excel-demo',machine:'M001',allocation:'machine'}));
 assert.equal(result(a),72000);
 assert.equal(a.run("result(machine('M001'))"),72000);
 const dashboard=a.run('dashboardPage()');
 const finance=a.run('financialStats()');
 assert.match(dashboard,/72 000|72 000/);
 assert.match(finance,/72 000|72 000|72,0/);
});
