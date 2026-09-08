import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createClient} from 'redis';
import {randomBytes} from 'node:crypto';
import {migrate} from '../apps/api/src/db.mjs';
import {createApp} from '../apps/api/src/app.mjs';
import {Orchestrator} from '../apps/api/src/orchestrator/index.mjs';
import {redisLimiter} from '../apps/api/src/rate-limit.mjs';
import {FakeDocker,testConfig,register,post} from './support.mjs';
test('real PostgreSQL lock contention and Redis atomic submission window', {skip:!process.env.DATABASE_TEST_URL||!process.env.REDIS_TEST_URL}, async()=>{
  const schema=`sigma_test_${randomBytes(8).toString('hex')}`;
  const admin=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,options:`-c search_path=${schema}`});
  const redis=createClient({url:process.env.REDIS_TEST_URL});await redis.connect();
  const cfg={...testConfig};let app;
  try {
    await migrate(pool,cfg);const docker=new FakeDocker(),orchestrator=new Orchestrator(pool,docker,cfg);
    const limit=redisLimiter(redis);app=await createApp({pool,cfg,orchestrator,limit});const f={app,pool,cfg};
    const user=await register(f,`p_${randomBytes(6).toString('hex')}`);
    const spawns=await Promise.all([post(f,user,'/api/challenges/ping-of-ohio/spawn'),post(f,user,'/api/challenges/ping-of-ohio/spawn')]);
    assert.ok(spawns.every(r=>r.statusCode===201));assert.equal(docker.containers.size,1);assert.equal((await pool.query("SELECT * FROM challenge_instances WHERE status='running'")).rows.length,1);
    const results=await Promise.all([post(f,user,'/api/challenges/baby-rsa/submit',{flag:'sigma{cube_root_rizz}'}),post(f,user,'/api/challenges/baby-rsa/submit',{flag:'sigma{cube_root_rizz}'})]);
    assert.equal(results.reduce((sum,r)=>sum+r.json().awarded,0),100);
    const key=`test:${schema}`;const limits=await Promise.all(Array.from({length:6},()=>limit(key,5,60)));assert.equal(limits.filter(x=>x.allowed).length,5);await redis.del(`sigma:rate:${key}`);
  }finally{await app?.close();await redis.quit();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
