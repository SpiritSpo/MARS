import {createHash,randomUUID} from 'node:crypto';
import {validateFinanceRows} from './validation.js';

const digest=content=>createHash('sha256').update(content).digest('hex');
const fromCents=n=>(n/100).toFixed(2);

/**
 * Stage reviewed, normalized machine-month rows. This does NOT parse Excel.
 * No partial imports: any error rolls back all writes.
 * caller must authenticate and authorize uploader BEFORE invoking.
 */
export async function stageFinanceImport(pool,{filename,period,rows,sourceBytes}){
 if(!pool||typeof pool.connect!=='function')throw Error('Database pool required');
 if(typeof filename!=='string'||filename.length<1||filename.length>255)throw Error('Invalid filename');
 if(!Buffer.isBuffer(sourceBytes)||sourceBytes.length===0||sourceBytes.length>10*1024*1024)throw Error('Invalid source file');
 const normalized=validateFinanceRows(rows,period);
 const checksum=digest(sourceBytes);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const existing=await client.query('SELECT id, status FROM finance_imports WHERE sha256=$1',[checksum]);
  if(existing.rows.length){
   await client.query('ROLLBACK');
   return {duplicate:true,importId:existing.rows[0].id,status:existing.rows[0].status};
  }
  const ids=normalized.map(r=>r.machineId);
  const known=await client.query('SELECT id FROM finance_machines WHERE id=ANY($1::text[])',[ids]);
  const knownIds=new Set(known.rows.map(r=>r.id));
  const unknown=ids.filter(id=>!knownIds.has(id));
  if(unknown.length)throw Error('Unknown machines: '+unknown.join(', '));
  const id=randomUUID();
  await client.query('INSERT INTO finance_imports (id,sha256,filename,period,status) VALUES ($1,$2,$3,$4,$5)',[id,checksum,filename,period,'staged']);
  for(const r of normalized){
   const a=r.amounts;
   await client.query(`INSERT INTO finance_monthly
    (import_id,machine_id,period,revenue,fuel,repairs,payroll,other_expenses,reported_expenses,reported_profit,review_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id,r.machineId,period,fromCents(a.revenue),fromCents(a.fuel),fromCents(a.repairs),fromCents(a.payroll),fromCents(a.otherExpenses),fromCents(a.reportedExpenses),fromCents(a.reportedProfit),r.reviewStatus]);
  }
  await client.query('COMMIT');
  return {duplicate:false,importId:id,status:'staged',rows:normalized.length,issues:normalized.flatMap((r,i)=>r.issues.map(code=>({row:i+1,machineId:r.machineId,code})))};
 }catch(e){
  try{await client.query('ROLLBACK')}catch{}
  throw e;
 }finally{client.release()}
}

/** Approval is intentionally unavailable until auth, audit, and versioning exist. */
