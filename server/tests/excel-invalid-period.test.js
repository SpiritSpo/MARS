import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {previewFinanceWorkbook} from '../src/excel-preview.js';

test('invalid period is rejected even when workbook contains no recognized machines', async () => {
 const workbook = new ExcelJS.Workbook();
 workbook.addWorksheet('Пустой лист');
 const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
 await assert.rejects(
  previewFinanceWorkbook(bytes, {period:'2026-13', resolveMachineId:()=>null}),
  /Invalid period/
 );
});
