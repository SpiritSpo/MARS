import ExcelJS from 'exceljs';
import {validateFinanceRows} from './validation.js';

const labels = [
 ['отработано','revenue'],['топливо','fuel'],['ремонт','repairs'],
 ['зарплата','payroll'],['иные расходы','otherExpenses'],
 ['итого расходы','reportedExpenses'],['прибыль','reportedProfit']
];
const normalize = v => String(v ?? '').toLowerCase().replace(/ё/g,'е').trim();
const amount = v => {
 if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2);
 if (typeof v === 'string' && /^-?[\d\s]+(?:[.,]\d{1,2})?$/.test(v.trim()))
  return Number(v.replace(/\s/g,'').replace(',','.')).toFixed(2);
 return null;
};
const matchLabel = v => labels.find(([label])=>normalize(v).startsWith(label))?.[1] ?? null;
const machineTitle = v => typeof v === 'string' && /[А-ЯA-Z]/i.test(v) && /\d/.test(v) &&
 !/итого|всего|за (июль|август|сентябрь)|прибыль|часы/i.test(v);

export async function previewFinanceWorkbook(buffer,{period,resolveMachineId}={}){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>10*1024*1024)throw Error('Invalid workbook size');
 if(typeof resolveMachineId!=='function')throw Error('Machine resolver required');
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(buffer);
 const candidates=[],warnings=[];
 for(const sheet of workbook.worksheets){
  const blocks=[];
  sheet.eachRow((row,rowNumber)=>{
   const cells=[];
   row.eachCell({includeEmpty:false},(cell,col)=>cells.push({col,value:cell.value}));
   const titles=cells.filter(c=>machineTitle(c.value) && !matchLabel(c.value));
   const financial=cells.map(c=>({...c,key:matchLabel(c.value)})).filter(c=>c.key);
   if(titles.length && !financial.length){
    for(const t of titles){
     // Blocks in accounting reports start in the first columns or in a
     // horizontal group of five columns; reject right-hand totals headings.
     if(/итого|всего|свод/i.test(t.value))continue;
     const previous=blocks.find(b=>b.start===t.col && !b.finished);
     if(previous)previous.finished=true;
     blocks.push({sheet:sheet.name,row:rowNumber,start:t.col,name:t.value.trim(),values:{},finished:false});
    }
   }
   for(const item of financial){
    const block=blocks.filter(b=>!b.finished && b.start<=item.col)
      .sort((a,b)=>b.start-a.start)[0];
    if(!block){warnings.push({sheet:sheet.name,row:rowNumber,code:'orphan_financial_row'});continue;}
    const nextStart=blocks.filter(b=>!b.finished && b.start>block.start).reduce((n,b)=>Math.min(n,b.start),Infinity);
    const numeric=cells.filter(c=>c.col>item.col && c.col<=item.col+3 && c.col<nextStart)
      .map(c=>amount(c.value)).filter(v=>v!==null).at(-1);
    if(numeric===undefined)warnings.push({sheet:sheet.name,row:rowNumber,machine:block.name,code:'missing_amount',field:item.key});
    else block.values[item.key]=numeric;
   }
  });
  for(const block of blocks){
   const missing=labels.map(([,key])=>key).filter(key=>block.values[key]===undefined);
   if(missing.length)warnings.push({sheet:sheet.name,row:block.row,machine:block.name,code:'missing_fields',fields:missing});
   else candidates.push(block);
  }
 }
 const rows=[];
 for(const candidate of candidates){
  const machineId=resolveMachineId(candidate.name);
  if(!machineId){warnings.push({sheet:candidate.sheet,row:candidate.row,machine:candidate.name,code:'unknown_machine'});continue;}
  rows.push({machineId,...candidate.values});
 }
 let validated=[];
 try{if(rows.length)validated=validateFinanceRows(rows,period);}
 catch(e){warnings.push({code:'validation_failed',message:e.message});}
 return {period,found:candidates.length,accepted:validated.length,rows:validated,warnings};
}
// Preview only. Import approval and publication remain disabled.
