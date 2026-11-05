import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {previewFinanceWorkbook} from '../src/excel-preview.js';

test('reads parallel machine blocks from real-world mini-loader layout', async () => {
 const wb = new ExcelJS.Workbook();
 const ws = wb.addWorksheet('СЕНТЯБРЬ');
 const blocks = [
  {titleCol:2,labelCol:3,valueCol:4,name:'SUNWARD SWL 4028 77 МР 7936',id:'sunward_7936'},
  {titleCol:7,labelCol:8,valueCol:9,name:'BOBCAT S-630 77 АХ 8683',id:'bobcat_8683'}
 ];
 const items=[['отработано',1000],['топливо',100],['ремонт/запчасти',50],['зарплата',200],['иные расходы',50],['итого расходы',400],['прибыль',600]];
 for(const b of blocks){
  ws.getRow(4).getCell(b.titleCol).value=b.name;
  items.forEach(([label,value],i)=>{
   ws.getRow(i+5).getCell(b.labelCol).value=label;
   ws.getRow(i+5).getCell(b.valueCol).value=value;
  });
 }
 const bytes=Buffer.from(await wb.xlsx.writeBuffer());
 const result=await previewFinanceWorkbook(bytes,{
  period:'2026-09',
  resolveMachineId:name=>blocks.find(b=>b.name===name)?.id
 });
 assert.equal(result.accepted,2,'Both side-by-side machines must be read');
 assert.deepEqual(result.rows.map(r=>r.machineId).sort(),['bobcat_8683','sunward_7936']);
});
