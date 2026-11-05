import ExcelJS from 'exceljs';
import {previewDemoImport} from './demo-import.js';

// Strict fictional template: Machine ID | Type | Amount | Description.
// Never interpret arbitrary accounting workbooks as this demo template.
export async function parseDemoWorkbook(buffer,machines){
 if(!Buffer.isBuffer(buffer)||buffer.length===0||buffer.length>2*1024*1024)throw Error('Invalid workbook size');
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(buffer);
 if(workbook.worksheets.length!==1)throw Error('Expected one worksheet');
 const sheet=workbook.worksheets[0];
 if(sheet.actualRowCount<2||sheet.actualRowCount>1001)throw Error('Invalid row count');
 const headers=['machineId','kind','amount','description'];
 for(let i=0;i<headers.length;i++){
  if(String(sheet.getRow(1).getCell(i+1).value??'').trim()!==headers[i])throw Error('Invalid template headers');
 }
 const rows=[];
 for(let i=2;i<=sheet.rowCount;i++){
  const row=sheet.getRow(i);
  if(row.hasValues)rows.push({
   machineId:row.getCell(1).value,
   kind:row.getCell(2).value,
   amount:row.getCell(3).value,
   description:row.getCell(4).value
  });
 }
 return previewDemoImport(rows,machines);
}
