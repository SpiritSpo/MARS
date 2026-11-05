import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {previewFinanceWorkbook} from '../src/excel-preview.js';

test('two machines on one sheet do not mix amounts', async () => {
 const wb = new ExcelJS.Workbook();
 const ws = wb.addWorksheet('СЕНТЯБРЬ');
 const blocks = [
  {start:2, name:'BOBCAT S-630 77 АХ 8683', id:'bobcat', revenue:100000},
  {start:7, name:'SUNWARD SWL 4028 77 МР 7936', id:'sunward', revenue:200000}
 ];
 for (const b of blocks) {
  ws.getRow(2).getCell(b.start).value = b.name;
  const entries = [
   ['отработано', 160, b.revenue], ['топливо', 10000],
   ['ремонт', 5000], ['зарплата', 20000], ['иные расходы', 5000],
   ['итого расходы', 40000], ['прибыль', b.revenue - 40000]
  ];
  entries.forEach((entry, i) => {
   ws.getRow(i + 3).getCell(b.start + 1).value = entry[0];
   entry.slice(1).forEach((value, j) => {
    ws.getRow(i + 3).getCell(b.start + 2 + j).value = value;
   });
  });
 }
 const result = await previewFinanceWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), {
  period:'2026-09',
  resolveMachineId:name => blocks.find(b => b.name === name)?.id
 });
 assert.equal(result.accepted, 2);
 assert.deepEqual(result.rows.map(r => [r.machineId,r.amounts.revenue]).sort(),
  [['bobcat',10000000],['sunward',20000000]]);
 assert.ok(result.rows.every(r => r.reviewStatus === 'ok'));
});
