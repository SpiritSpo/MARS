import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,createSessionToken,sessionDigest,sessionCookie,clearSessionCookie,canReadFinance} from '../src/auth.js';
test('password hash is salted, verifiable and not plaintext',async()=>{
 const a=await hashPassword('long-password-12345');const b=await hashPassword('long-password-12345');
 assert.notEqual(a,b);assert.ok(!a.includes('long-password-12345'));
 assert.equal(await verifyPassword('long-password-12345',a),true);
 assert.equal(await verifyPassword('wrong-password',a),false);
 assert.equal(await verifyPassword('long-password-12345','broken'),false);
});
test('weak password rejected',async()=>{await assert.rejects(hashPassword('short'),/Password/);});
test('session token is random and cookie is inaccessible to browser JavaScript',()=>{
 const token=createSessionToken();assert.notEqual(token,createSessionToken());
 assert.equal(sessionDigest(token).length,64);
 assert.match(sessionCookie(token),/HttpOnly; SameSite=Strict; Secure/);
 assert.match(clearSessionCookie(),/Max-Age=0/);
});
test('only director and owner can view finance',()=>{
 for(const role of ['director','owner'])assert.equal(canReadFinance({id:'user_1',role}),true);
 for(const role of ['accountant','mechanic','dispatcher','operator'])assert.throws(()=>canReadFinance({id:'user_1',role}),/Forbidden/);
 assert.throws(()=>canReadFinance(null),/Forbidden/);
});
