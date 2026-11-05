import {demoSeed,demoTotals,applyDemoAction} from './demo-domain.js';
import {previewDemoImport} from './demo-import.js';
import {parseDemoWorkbook} from './demo-xlsx.js';

// Isolated fictional-data API. Must be mounted only behind authenticated sessions.
// In-memory state is deliberately non-persistent and resets on server restart.
export function createDemoHandler({getUser}={}){
 if(typeof getUser!=='function')throw Error('Authenticated user resolver required');
 let state=structuredClone(demoSeed);
 const pending=new Map();
 const reply=(res,status,body)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(body));
 };
 return async(req,res)=>{
  const user=await getUser(req);
  if(!user)return reply(res,401,{error:'Unauthorized'});
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&path==='/demo/state'){
   const role=user.role;
   if(!['director','owner','accountant','mechanic','dispatcher','operator'].includes(role))
    return reply(res,403,{error:'Forbidden'});
   // Financial totals and transactions are restricted to management and accounting.
   const view=structuredClone(state);
   if(!['director','owner','accountant'].includes(role))delete view.transactions;
   if(!['director','owner','accountant'].includes(role)){
    if(Array.isArray(view.parts))view.parts=view.parts.map(({unitCost,...part})=>part);
   }
   if(role==='operator')delete view.parts;
   return reply(res,200,{...view,...(['director','owner'].includes(role)?{totals:demoTotals(state)}:{})});
  }
  if(req.method==='POST'&&(path==='/demo/import/preview'||path==='/demo/import/preview-xlsx'||path==='/demo/import/confirm')){
   if(!['accountant','director','owner'].includes(user.role))return reply(res,403,{error:'Forbidden'});
   const chunks=[];let bytes=0;
   for await(const chunk of req){bytes+=chunk.length;if(bytes>3000000)return reply(res,413,{error:'Request too large'});chunks.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reply(res,400,{error:'Invalid JSON'})}
   if(path==='/demo/import/preview'||path==='/demo/import/preview-xlsx'){
    let preview;try{
     if(path==='/demo/import/preview-xlsx'){
      if(typeof body.base64!=='string'||body.base64.length>2800000||! /^[A-Za-z0-9+/]+={0,2}$/.test(body.base64))throw Error('Invalid encoding');
      preview=await parseDemoWorkbook(Buffer.from(body.base64,'base64'),state.machines);
     }else preview=previewDemoImport(body.rows,state.machines);
    }catch{return reply(res,400,{error:'Invalid spreadsheet or rows'})}
    const token=crypto.randomUUID();
    if(preview.canCommit)pending.set(token,{userId:user.id,role:user.role,rows:preview.valid,expires:Date.now()+600000});
    return reply(res,200,{token:preview.canCommit?token:null,validCount:preview.valid.length,errors:preview.errors,canCommit:preview.canCommit});
   }
   const item=pending.get(body.token);
   if(!item||item.userId!==user.id||item.role!==user.role||item.expires<Date.now())return reply(res,400,{error:'Invalid or expired preview'});
   pending.delete(body.token);
   for(const row of item.rows)state=applyDemoAction(state,user.role,{type:'addTransaction',...row});
   return reply(res,200,{ok:true,imported:item.rows.length});
  }
  if(req.method==='POST'&&path==='/demo/actions'){
   const chunks=[];let bytes=0;
   for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>4096)return reply(res,413,{error:'Request too large'});
    chunks.push(chunk);
   }
   let action;
   try{action=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
   catch{return reply(res,400,{error:'Invalid JSON'})}
   try{state=applyDemoAction(state,user.role,action)}
   catch(e){return reply(res,e.message==='Forbidden'?403:400,{error:e.message==='Forbidden'?'Forbidden':'Invalid action'})}
   return reply(res,200,{ok:true});
  }
  return reply(res,404,{error:'Not found'});
 };
}
