import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoginLimiter} from '../src/login-limiter.js';
test('blocks after five failures and expires after window',()=>{
 let now=0;const l=createLoginLimiter({clock:()=>now});
 for(let i=0;i<5;i++){assert.equal(l.check('ip|user').allowed,true);l.fail('ip|user');}
 assert.equal(l.check('ip|user').allowed,false);
 now=900001;assert.equal(l.check('ip|user').allowed,true);
});
test('isolates keys and clears after successful login',()=>{
 const l=createLoginLimiter({maxAttempts:1});
 l.fail('a');assert.equal(l.check('a').allowed,false);
 assert.equal(l.check('b').allowed,true);l.clear('a');assert.equal(l.check('a').allowed,true);
});
