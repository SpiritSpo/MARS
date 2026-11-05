import http from 'node:http';
import {Pool} from 'pg';

// Minimal private API skeleton. No financial routes until authentication,
// server-side machine mapping and import staging are implemented and tested.
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='require'?{rejectUnauthorized:true}:undefined}):null;
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 if(req.method==='GET'&&req.url==='/health'){
  res.writeHead(200);res.end(JSON.stringify({status:'ok',databaseConfigured:!!pool}));return;
 }
 // Never expose finance data without an authenticated API.
 res.writeHead(404);res.end(JSON.stringify({error:'Not found'}));
});
server.listen(port,()=>console.log('MARS API listening on '+port));
const shutdown=async()=>{server.close();if(pool)await pool.end();};
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
