export const money = value => {
 if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid money');
 const str = String(value).trim();
 if (!/^-?\d{1,13}(?:\.\d{1,2})?$/.test(str)) throw new Error('Invalid money');
 return Math.round(Number(str)*100);
};
export function validateFinanceRows(rows, period) {
 if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Invalid period');
 if (!Array.isArray(rows) || rows.length===0 || rows.length>5000) throw new Error('Invalid rows');
 const seen=new Set();
 return rows.map((r,i)=>{
  if (!r || typeof r.machineId!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.machineId)) throw new Error('Row '+(i+1)+': invalid machine');
  if (seen.has(r.machineId)) throw new Error('Row '+(i+1)+': duplicate machine');
  seen.add(r.machineId);
  const amounts={};
  for(const key of ['revenue','fuel','repairs','payroll','otherExpenses','reportedExpenses','reportedProfit']) amounts[key]=money(r[key]);
  for(const key of ['revenue','fuel','repairs','payroll','otherExpenses','reportedExpenses']) if(amounts[key]<0) throw new Error('Row '+(i+1)+': negative '+key);
  const sum=amounts.fuel+amounts.repairs+amounts.payroll+amounts.otherExpenses;
  const calculated=amounts.revenue-amounts.reportedExpenses;
  const issues=[];
  if(sum!==amounts.reportedExpenses)issues.push('expense_components_mismatch');
  if(calculated!==amounts.reportedProfit)issues.push('profit_mismatch');
  return {machineId:r.machineId,period,amounts,issues,reviewStatus:issues.length?'needs_review':'ok'};
 });
}
