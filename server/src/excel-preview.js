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
function matchLabel(value){
 const t=normalize(value);
 return labels.find(([label])=>t.startsWith(label))?.[1] ?? null;
}
export async function previewFinanceWorkbook(buffer,{period,resolveMachineId}={}){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>10*1024*1024) throw Error('Invalid workbook size');
 if(typeof resolveMachineId!=='function')throw Error('Machine resolver required');
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(buffer);
 const candidates=[],warnings=[];
 for(const sheet of workbook.worksheets){
  let current=null;
  const finish=()=>{
   if(!current)return;
   const missing=labels.map(([,k])=>k).filter(k=>current.values[k]===undefined);
   if(missing.length)warnings.push({sheet:sheet.name,row:current.row,machine:current.name,code:'missing_fields',fields:missing});
   else candidates.push(current);
   current=null;
  };
  sheet.eachRow((row,rowNumber)=>{
   const cells=[];
   row.eachCell({includeEmpty:false},(cell,col)=>cells.push({col,value:cell.value}));
   const labeled=cells.map(c=>({...c,key:matchLabel(c.value)})).filter(c=>c.key);
   if(labeled.length){
    if(!current){warnings.push({sheet:sheet.name,row:rowNumber,code:'orphan_financial_row'});return;}
    for(const item of labeled){
     const numeric=cells.filter(c=>c.col>item.col && c.col<=item.col+3).map(c=>amount(c.value)).find(v=>v!==null);
     if(numeric===undefined)warnings.push({sheet:sheet.name,row:rowNumber,code:'missing_amount',field:item.key});
     else current.values[item.key]=numeric;
    }
   }else{
    const title=cells.find(c=>typeof c.value==='string' && !/итого|за (июль|август|сентябрь)|прибыль|часы/i.test(c.value) && /[А-ЯA-Z]/i.test(c.value) && /\d/.test(c.value));
    if(title && title.col<=3){finish();current={sheet:sheet.name,row:rowNumber,name:title.value.trim(),values:{}};}
   }
  });
  finish();
 }
 const rows=[];
 for(const candidate of candidates){
  const machineId=resolveMachineId(candidate.name);
  if(!machineId){warnings.push({sheet:candidate.sheet,row:candidate.row,machine:candidate.name,code:'unknown_machine'});continue;}
  rows.push({machineId,...candidate.values});
 }
 let validated=[];
 try{if(rows.length)validated=validateFinanceRows(rows,period)}
 catch(e){warnings.push({code:'validation_failed',message:e.message});}
 return {period,found:candidates.length,accepted:validated.length,rows:validated,warnings};
}
// Preview only. Import approval and publication remain disabled.
