import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {previewFinanceWorkbook} from '../src/excel-preview.js';

test('reads a monthly vehicle block and flags incorrect reported profit',async()=>{
 const wb=new ExcelJS.Workbook();
 const ws=wb.addWorksheet('Лист1');
 ws.getCell('B2').value='JCB 77 АА 1234';
 const items=[['отработано',1000],['топливо',100],['ремонт/запчасти',50],['зарплата',200],['иные расходы',50],['итого расходы',400],['прибыль',0]];
 items.forEach(([label,value],i)=>{ws.getCell('C'+(i+3)).value=label;ws.getCell('E'+(i+3)).value=value;});
 const bytes=Buffer.from(await wb.xlsx.writeBuffer());
 const result=await previewFinanceWorkbook(bytes,{period:'2026-09',resolveMachineId:()=> 'jcb_1234'});
 assert.equal(result.accepted,1);
 assert.deepEqual(result.rows[0].issues,['profit_mismatch']);
});
