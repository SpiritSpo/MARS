import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createAuthHandler} from '../src/auth-handler.js';
function req(body){const r=Readable.from([Buffer.from(JSON.stringify(body))]);r.method='POST';r.url='/auth/login';r.headers={};r.socket={remoteAddress:'127.0.0.1'};return r;}
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v},writeHead(code,h){this.status=code;Object.assign(this.headers,h)},end(s){this.body=JSON.parse(s)}};}
test('login handler returns 429 after five failed attempts and does not query DB again',async()=>{
 let queries=0;
 const pool={query:async()=>{queries++;return {rows:[]}}};
 const handler=createAuthHandler(pool).handle;
 for(let i=0;i<5;i++){const out=res();await handler(req({login:'director',password:'incorrect'}),out);assert.equal(out.status,401);}
 const out=res();await handler(req({login:'director',password:'incorrect'}),out);
 assert.equal(out.status,429);
 assert.equal(queries,5);
 assert.ok(Number(out.headers['Retry-After'])>0);
});
