// Fictional demo spreadsheet import: preview first, commit only after explicit confirmation.
// Only normalized rows are accepted here; workbook parsing belongs to the upload adapter.
export function previewDemoImport(rows,machines){
 if(!Array.isArray(rows)||rows.length>1000)throw Error('Invalid rows');
 const ids=new Set(machines.map(m=>m.id));
 const seen=new Set();
 const valid=[],errors=[];
 rows.forEach((r,i)=>{
  const row=i+1;
  if(!r||typeof r!=='object'||Array.isArray(r)||!ids.has(r.machineId)||!['income','expense'].includes(r.kind)||!Number.isSafeInteger(r.amount)||r.amount<=0||typeof r.description!=='string'||r.description.length>200){
   errors.push({row,error:'Invalid machine, kind, amount or description'});return;
  }
  const key=[r.machineId,r.kind,r.amount,r.description.trim()].join('|');
  if(seen.has(key)){errors.push({row,error:'Duplicate row in upload'});return;}
  seen.add(key);
  valid.push({machineId:r.machineId,kind:r.kind,amount:r.amount,description:r.description.trim()});
 });
 return {valid,errors,canCommit:errors.length===0&&valid.length>0};
}
