import {createSessionToken,sessionDigest,sessionCookie,clearSessionCookie,verifyPassword,canReadFinance} from './auth.js';
import {createLoginLimiter} from './login-limiter.js';
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
const parseCookie=header=>Object.fromEntries(String(header||'').split(';').map(x=>x.trim().split('=').slice(0,2)).filter(x=>x.length===2));
async function readJson(req){
 const parts=[];let length=0;
 for await(const part of req){length+=part.length;if(length>4096)throw Error('Request too large');parts.push(part)}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw Error('Invalid JSON')}
}
export function createAuthHandler(pool,{secureCookies=true,now=()=>new Date()}={}){
 if(!pool||typeof pool.query!=='function')throw Error('Database required');
 const limiter=createLoginLimiter();
 async function currentUser(req){
  const token=parseCookie(req.headers.cookie).mars_session;
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const result=await pool.query(`SELECT u.id,u.role FROM mars_sessions s JOIN mars_users u ON u.id=s.user_id
   WHERE s.token_hash=$1 AND s.expires_at > $2 AND u.active=TRUE`,[sessionDigest(token),now()]);
  return result.rows[0]||null;
 }
 async function authHandler(req,res){
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/auth/login'&&req.method==='POST'){
   let body;
   try{body=await readJson(req)}catch{return json(res,400,{error:'Invalid request'})}
   if(typeof body.login!=='string'||body.login.length>100||typeof body.password!=='string'||body.password.length>1024)return json(res,400,{error:'Invalid request'});
   const key=String(req.socket?.remoteAddress||'unknown')+'|'+body.login.toLowerCase();
   const limit=limiter.check(key);
   if(!limit.allowed){res.setHeader('Retry-After',String(limit.retryAfter));return json(res,429,{error:'Too many attempts'});}
   const found=await pool.query('SELECT id,role,password_hash FROM mars_users WHERE login=$1 AND active=TRUE',[body.login]);
   const user=found.rows[0];
   if(!user||!await verifyPassword(body.password,user.password_hash)){limiter.fail(key);return json(res,401,{error:'Invalid credentials'});}
   limiter.clear(key);
   const token=createSessionToken();
   await pool.query('INSERT INTO mars_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)',[sessionDigest(token),user.id,new Date(now().getTime()+8*60*60*1000)]);
   res.setHeader('Set-Cookie',sessionCookie(token,{secure:secureCookies}));
   return json(res,200,{id:user.id,role:user.role});
  }
  if(path==='/auth/me'&&req.method==='GET'){
   const user=await currentUser(req);
   return user?json(res,200,user):json(res,401,{error:'Unauthorized'});
  }
  if(path==='/auth/logout'&&req.method==='POST'){
   const token=parseCookie(req.headers.cookie).mars_session;
   if(token&&/^[a-f0-9]{64}$/.test(token))await pool.query('DELETE FROM mars_sessions WHERE token_hash=$1',[sessionDigest(token)]);
   res.setHeader('Set-Cookie',clearSessionCookie({secure:secureCookies}));
   return json(res,200,{ok:true});
  }
  if(path==='/finance/report'&&req.method==='GET'){
   const user=await currentUser(req);
   try{canReadFinance(user)}catch{return json(res,user?403:401,{error:'Forbidden'})}
   const month=new URL(req.url,'http://localhost').searchParams.get('month');
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return json(res,400,{error:'Invalid month'});
   const result=await pool.query('SELECT machine_id,month,revenue,expenses,reported_profit FROM mars_finance_monthly WHERE month=$1 ORDER BY machine_id',[month]);
   return json(res,200,{month,rows:result.rows});
  }
  if(path==='/finance/access-check'&&req.method==='GET'){
   const user=await currentUser(req);
   try{canReadFinance(user)}catch{return json(res,user?403:401,{error:'Forbidden'})}
   return json(res,200,{access:true});
  }
  return json(res,404,{error:'Not found'});
 }
 return {handle:authHandler,currentUser};
}
