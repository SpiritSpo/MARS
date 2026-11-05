import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {previewFinanceWorkbook} from '../src/excel-preview.js';

test('takes revenue rather than hours in worked row', async () => {
 const book = new ExcelJS.Workbook();
 const sheet = book.addWorksheet('СЕНТЯБРЬ');
 sheet.getCell('B2').value = 'BOBCAT S-630 77 АХ 8683';
 const entries = [
  ['отработано', 160, 120000],
  ['топливо', 20000],
  ['ремонт', 10000],
  ['зарплата', 30000],
  ['иные расходы', 5000],
  ['итого расходы', 65000],
  ['прибыль', 55000]
 ];
 entries.forEach((entry, i) => {
  sheet.getCell(i + 3, 3).value = entry[0];
  entry.slice(1).forEach((value, j) => { sheet.getCell(i + 3, 4 + j).value = value; });
 });
 const buffer = Buffer.from(await book.xlsx.writeBuffer());
 const result = await previewFinanceWorkbook(buffer, {
  period: '2026-09',
  resolveMachineId: name => name.includes('BOBCAT') ? 'bobcat_8683' : null
 });
 assert.equal(result.accepted, 1);
 assert.equal(result.rows[0].amounts.revenue, 12000000);
 assert.equal(result.rows[0].reviewStatus, 'ok');
});
