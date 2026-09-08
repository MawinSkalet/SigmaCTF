import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { migrate } from '../apps/api/src/db.mjs';
import { createApp } from '../apps/api/src/app.mjs';
import { Orchestrator } from '../apps/api/src/orchestrator/index.mjs';
export const testConfig={jwtSecret:'test-only-jwt-secret-'.repeat(3),flagSecret:'test-only-flag-secret-'.repeat(3),imagePrefix:'sigmactf',imageTag:'v1',domain:'localhost',appOrigin:'http://localhost:3000',webPort:8080,tcpHost:'localhost',maxInstances:10,ttlSeconds:900,secure:false,https:false,firewallConfirmed:true};
export async function testPool(){
  const db=new PGlite(); await db.waitReady;
  let tail=Promise.resolve();
  async function acquire(){let release;const next=new Promise(r=>{release=r;});const prev=tail;tail=next;await prev;return release;}
  const query=async(sql,args=[])=>{
    // PGlite embeds PostgreSQL in one process. Advisory locks are unnecessary here;
    // the adapter serializes transactions. Live PostgreSQL concurrency has a separate test.
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.includes('CREATE TABLE')){await db.exec(sql);return {rows:[]};}
    return db.query(sql,args);
  };
  return {query:async(...args)=>{const release=await acquire();try{return await query(...args);}finally{release();}},connect:async()=>{const release=await acquire();return {query,release};},end:()=>db.close()};
}
export class FakeDocker {
  constructor(){this.containers=new Map();this.nets=new Map();this.specs=[];this.failStart=false;this.failRemove=false;}
  async createNetwork(id){const Id=randomUUID();this.nets.set(Id,{Id,Labels:{'sigma.instance':id}});return {Id};}
  async connect(){} async disconnect(){}
  async create(id,spec){const Id=randomUUID();this.specs.push(spec);this.containers.set(Id,{Id,State:'created',Labels:spec.Labels,Name:`sigma-${id}`});return {Id};}
  async start(id){if(this.failStart)throw new Error('Injected Docker failure');this.containers.get(id).State='running';}
  async remove(id){if(this.failRemove)throw new Error('Injected remove failure');this.containers.delete(id);for(const [key,c]of this.containers)if(c.Name===id)this.containers.delete(key);}
  async removeNetwork(id){this.nets.delete(id);for(const [key,n]of this.nets)if(`sigma-${n.Labels['sigma.instance']}`===id)this.nets.delete(key);}
  async list(){return [...this.containers.values()];}async networks(){return [...this.nets.values()];}
}
export function memoryLimiter(){const counts=new Map();return async(key,max,seconds)=>{const now=Date.now();let e=counts.get(key);if(!e||e.until<=now)e={count:0,until:now+seconds*1000};e.count++;counts.set(key,e);return {allowed:e.count<=max,retryAfter:Math.ceil((e.until-now)/1000)};};}
export async function fixture(overrides={}){
  const cfg={...testConfig,...overrides},pool=await testPool(),docker=new FakeDocker();await migrate(pool,cfg);
  const orchestrator=new Orchestrator(pool,docker,cfg),app=await createApp({pool,cfg,orchestrator,limit:memoryLimiter()});
  return {cfg,pool,docker,orchestrator,app,close:async()=>{await app.close();await pool.end();}};
}
export async function register(f,name='sigma_player'){
  const r=await f.app.inject({method:'POST',url:'/api/auth/register',headers:{origin:f.cfg.appOrigin},payload:{username:name,password:'correct horse battery sigma'}});
  if(r.statusCode!==201)throw new Error(r.body);
  return {id:r.json().id,cookie:r.headers['set-cookie'].split(';')[0]};
}
export const post=(f,user,url,payload={})=>f.app.inject({method:'POST',url,headers:{origin:f.cfg.appOrigin,cookie:user.cookie},payload});
