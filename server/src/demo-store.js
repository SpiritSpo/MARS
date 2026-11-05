import {demoSeed} from './demo-domain.js';
// Dedicated DEMO state, never mixed with real finance tables.
export function createDemoStore(pool){
 if(!pool?.connect)throw Error('Database pool required');
 return {
  async read(){
   const result=await pool.query('SELECT state FROM mars_demo_state WHERE id=1');
   return result.rows[0]?.state??structuredClone(demoSeed);
  },
  async update(transform){
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    await client.query('INSERT INTO mars_demo_state(id,state) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING',[JSON.stringify(demoSeed)]);
    const result=await client.query('SELECT state FROM mars_demo_state WHERE id=1 FOR UPDATE');
    const next=await transform(result.rows[0].state);
    await client.query('UPDATE mars_demo_state SET state=$1::jsonb,updated_at=NOW() WHERE id=1',[JSON.stringify(next)]);
    await client.query('COMMIT');
    return next;
   }catch(e){await client.query('ROLLBACK');throw e}
   finally{client.release()}
  }
 };
}
