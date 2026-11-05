import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthHandler} from '../src/auth-handler.js';
import {Readable} from 'node:stream';

function request(path,cookie='') {
 const req=Readable.from([]);
 req.method='GET';req.url=path;req.headers={cookie};
 return req;
}
function response(){
 return {status:0,body:null,headers:{},setHeader(k,v){this.headers[k]=v},
 writeHead(status,headers){this.status=status;this.headers={...this.headers,...headers}},
 end(data){this.body=JSON.parse(data)}};
}
function database(role){
 return {async query(sql){
  if(sql.includes('FROM mars_sessions'))return {rows:role?[{id:'user_123',role}]:[]};
  throw Error('Unexpected database query');
 }};
}
const validCookie='mars_session='+('a'.repeat(64));
for(const [role,expected] of [[null,401],['dispatcher',403],['mechanic',403],['operator',403],['accountant',403],['director',200],['owner',200]]){
 test('finance access-check role '+String(role),async()=>{
  const handler=createAuthHandler(database(role));
  const res=response();
  await handler(request('/finance/access-check',validCookie),res);
  assert.equal(res.status,expected);
  assert.equal(res.headers['Cache-Control'],'no-store');
 });
}
test('finance rejects missing session before database lookup',async()=>{
 const handler=createAuthHandler({async query(){throw Error('Database should not be called')}});
 const res=response();await handler(request('/finance/access-check'),res);
 assert.equal(res.status,401);
});
test('finance rejects malformed session before database lookup',async()=>{
 const handler=createAuthHandler({async query(){throw Error('Database should not be called')}});
 const res=response();await handler(request('/finance/access-check','mars_session=bad'),res);
 assert.equal(res.status,401);
});
