import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createAuthHandler} from '../src/auth-handler.js';
import {hashPassword} from '../src/auth.js';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},writeHead(code,headers){this.status=code;Object.assign(this.headers,headers)},end(s){this.body=JSON.parse(s)}}}
function request(method,url,body,cookie){const r=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);r.method=method;r.url=url;r.headers={cookie};return r}
test('login, director access, logout and expired session',async()=>{
 const passwordHash=await hashPassword('strong-demo-password-2026');
 const tokens=new Map();let time=new Date('2026-11-05T12:00:00Z');
 const pool={query:async(sql,args)=>{
  if(sql.includes('FROM mars_users WHERE login'))return {rows:args[0]==='director'?[{id:'director_1',role:'director',password_hash:passwordHash}]:[]};
  if(sql.startsWith('INSERT INTO mars_sessions')){tokens.set(args[0],{id:args[1],expires:args[2]});return {rows:[]}};
  if(sql.includes('FROM mars_sessions s')){const t=tokens.get(args[0]);return {rows:t&&t.expires>args[1]?[{id:t.id,role:'director'}]:[]}};
  if(sql.startsWith('DELETE FROM mars_sessions')){tokens.delete(args[0]);return {rows:[]}};
  throw Error('Unexpected query '+sql);
 }};
 const handler=createAuthHandler(pool,{now:()=>time});
 let res=response();await handler.handle(request('GET','/finance/access-check'),res);assert.equal(res.status,401);
 res=response();await handler.handle(request('POST','/auth/login',{login:'director',password:'bad'}),res);assert.equal(res.status,401);
 res=response();await handler.handle(request('POST','/auth/login',{login:'director',password:'strong-demo-password-2026'}),res);assert.equal(res.status,200);
 const cookie=res.headers['Set-Cookie'];assert.match(cookie,/HttpOnly/);
 res=response();await handler.handle(request('GET','/finance/access-check',null,cookie),res);assert.equal(res.status,200);
 time=new Date('2026-11-05T21:00:00Z');
 res=response();await handler.handle(request('GET','/auth/me',null,cookie),res);assert.equal(res.status,401);
 res=response();await handler.handle(request('POST','/auth/logout',null,cookie),res);assert.equal(res.status,200);
});
test('non-director role cannot access finance',async()=>{
 const pool={query:async()=>({rows:[{id:'mechanic_1',role:'mechanic'}]})};
 const handler=createAuthHandler(pool);
 const res=response();await handler.handle(request('GET','/finance/access-check',null,'mars_session='+'a'.repeat(64)),res);
 assert.equal(res.status,403);
});
