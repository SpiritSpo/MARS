import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {previewFinanceWorkbook} from '../src/excel-preview.js';

test('warns when sheet month differs from requested period', async () => {
 const wb = new ExcelJS.Workbook();
 wb.addWorksheet('ИЮЛЬ');
 const bytes = Buffer.from(await wb.xlsx.writeBuffer());
 const result = await previewFinanceWorkbook(bytes, {
  period:'2026-09',
  resolveMachineId:()=>null
 });
 assert.ok(result.warnings.some(w => w.code === 'sheet_period_mismatch'));
});
