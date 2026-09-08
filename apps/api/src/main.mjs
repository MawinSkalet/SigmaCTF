import pg from 'pg';
import { createClient } from 'redis';
import { config } from './config.mjs';
import { migrate } from './db.mjs';
import { Docker } from './orchestrator/docker.mjs';
import { Orchestrator } from './orchestrator/index.mjs';
import { redisLimiter } from './rate-limit.mjs';
import { createApp } from './app.mjs';
const cfg=config();
const pool=new pg.Pool({connectionString:cfg.databaseUrl,max:8,connectionTimeoutMillis:10000});
const redis=createClient({url:cfg.redisUrl});
redis.on('error',e=>console.error('Redis unavailable:',e.message));
await redis.connect();
await migrate(pool,cfg);
const orchestrator=new Orchestrator(pool,new Docker(cfg.dockerUrl),cfg);
let app, timer, reaping=false;
if(process.env.ROLE==='janitor') {
  const reap=async()=>{if(reaping)return;reaping=true;try{await orchestrator.reap();}catch(e){console.error('Reaper failed:',e.message);}finally{reaping=false;}};
  await reap(); timer=setInterval(reap,60000);
} else {
  app=await createApp({pool,cfg,orchestrator,limit:redisLimiter(redis),logger:{redact:['req.headers.cookie','req.headers.authorization']}});
  await app.listen({host:'0.0.0.0',port:cfg.port});
}
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,async()=>{clearInterval(timer);await app?.close();await redis.quit();await pool.end();process.exit(0);});
