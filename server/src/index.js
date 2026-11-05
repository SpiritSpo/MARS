import http from 'node:http';
import {Pool} from 'pg';
import {createAuthHandler} from './auth-handler.js';
import {createDemoHandler} from './demo-handler.js';
import {createDemoStore} from './demo-store.js';

// Finance data must never be served without a database-backed session.
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
const pool=process.env.DATABASE_URL?new Pool({
 connectionString:process.env.DATABASE_URL,
 ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:true}:undefined
}):null;
const auth=pool?createAuthHandler(pool,{secureCookies:process.env.NODE_ENV!=='test'}):null;
const demo=auth?createDemoHandler({getUser:auth.currentUser,store:createDemoStore(pool)}):null;
const send=(res,status,body)=>{
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(body));
};
const server=http.createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&path==='/health')return send(res,200,{status:'ok',databaseConfigured:!!pool});
  if(path.startsWith('/auth/')||path==='/finance/access-check'||path==='/finance/report'){
   if(!auth)return send(res,503,{error:'Service not configured'});
   return await auth.handle(req,res);
  }
  if(path.startsWith('/demo/')){
   if(!demo)return send(res,503,{error:'Service not configured'});
   return await demo(req,res);
  }
  return send(res,404,{error:'Not found'});
 }catch(error){
  console.error('MARS API request failed:',error);
  if(!res.headersSent)send(res,500,{error:'Internal server error'});
  else res.destroy();
 }
});
server.listen(port,()=>console.log('MARS API listening on '+port));
const shutdown=async()=>{server.close();if(pool)await pool.end();};
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
