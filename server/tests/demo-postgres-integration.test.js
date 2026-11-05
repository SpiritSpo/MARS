import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createDemoStore} from '../src/demo-store.js';
import {applyDemoAction,demoTotals} from '../src/demo-domain.js';

test('PostgreSQL demo state persists and failed actions roll back', {skip: !process.env.MARS_TEST_DATABASE_URL}, async () => {
 const pool = new pg.Pool({connectionString:process.env.MARS_TEST_DATABASE_URL});
 const schema = 'mars_ci_' + process.pid;
 const admin = await pool.connect();
 try {
  await admin.query('CREATE SCHEMA "'+schema+'"');
  await admin.query('SET search_path TO "'+schema+'"');
  await admin.query(await readFile(new URL('../migrations/004_demo_state.sql',import.meta.url),'utf8'));
  const scoped = new pg.Pool({connectionString:process.env.MARS_TEST_DATABASE_URL,options:'-c search_path='+schema});
  try {
   const store = createDemoStore(scoped);
   await store.update(s=>applyDemoAction(s,'accountant',{type:'addTransaction',machineId:'JCB-DEMO-01',kind:'expense',amount:1234}));
   assert.equal(demoTotals(await createDemoStore(scoped).read()).expenses,43234);
   await assert.rejects(()=>store.update(()=>{throw Error('rollback test')}));
   assert.equal(demoTotals(await createDemoStore(scoped).read()).expenses,43234);
   const second = new pg.Pool({connectionString:process.env.MARS_TEST_DATABASE_URL,options:'-c search_path='+schema});
   try {assert.equal(demoTotals(await createDemoStore(second).read()).expenses,43234)}
   finally {await second.end()}
  } finally {await scoped.end()}
 } finally {
  await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');
  admin.release();
  await pool.end();
 }
});
