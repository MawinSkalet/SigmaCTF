import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ApiError, flagHash, equalHash, hashPassword, verifyPassword } from './security.mjs';
import { transaction } from './db.mjs';
export async function createApp({pool,cfg,orchestrator,limit,logger=false}) {
  const app=Fastify({logger,bodyLimit:8192,trustProxy:false});
  await app.register(cookie);
  await app.register(helmet);
  await app.register(jwt,{secret:cfg.jwtSecret,cookie:{cookieName:'sigma_session',signed:false}});
  app.setErrorHandler((error,request,reply)=>{
    const code=error.statusCode || 500;
    if(code>=500) request.log.error({err:error},'Request failed');
    reply.code(code).send({error:code>=500 && !(error instanceof ApiError)?'The kitchen is unavailable. Try again shortly.':error.message});
  });
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('Cache-Control','no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      // Required even on sign-in to prevent login CSRF. CLI clients must set Origin too.
      if(req.headers.origin!==cfg.appOrigin) throw new ApiError(403,'Invalid request origin');
    }
  });
  const auth=async req=>{ try { await req.jwtVerify({onlyCookie:true}); } catch { throw new ApiError(401,'Sign in to enter the arena.'); } };
  const throttle=async(req,reply,key,max,seconds)=>{
    const r=await limit(key,max,seconds);
    if(!r.allowed) { reply.header('Retry-After',String(r.retryAfter)); throw new ApiError(429,max===5?'Chill your rizz. Max 5 checks/min':'Too many attempts. Try again later.'); }
  };
  const setSession=(reply,id)=>reply.setCookie('sigma_session',app.jwt.sign({sub:id},{expiresIn:'8h'}),{httpOnly:true,secure:cfg.secure,sameSite:'strict',path:'/api',maxAge:28800});
  app.get('/api/health',async()=>{ await pool.query('SELECT 1'); return {status:'ok',release:cfg.imageTag}; });
  const credentials={type:'object',additionalProperties:false,required:['username','password'],properties:{username:{type:'string',pattern:'^[A-Za-z0-9_]{3,24}$'},password:{type:'string',minLength:12,maxLength:128}}};
  app.post('/api/auth/register',{schema:{body:credentials}},async(req,reply)=>{
    await throttle(req,reply,`auth:${req.ip}`,15,900);
    const id=randomUUID();
    const passwordHash=await hashPassword(req.body.password);
    try { await pool.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)',[id,req.body.username,passwordHash]); }
    catch(e) { if(e.code==='23505') throw new ApiError(409,'That handle is already taken.'); throw e; }
    setSession(reply,id); reply.code(201); return {id,username:req.body.username};
  });
  app.post('/api/auth/login',{schema:{body:credentials}},async(req,reply)=>{
    await throttle(req,reply,`auth:${req.ip}`,15,900);
    const user=(await pool.query('SELECT * FROM users WHERE lower(username)=lower($1)',[req.body.username])).rows[0];
    // Run scrypt for unknown accounts as well.
    const ok=await verifyPassword(req.body.password,user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if(!user || !ok) throw new ApiError(401,'Handle or password is incorrect.');
    setSession(reply,user.id); return {id:user.id,username:user.username};
  });
  app.post('/api/auth/logout',async(req,reply)=>{ reply.clearCookie('sigma_session',{path:'/api'}); return {ok:true}; });
  app.get('/api/me',{preHandler:auth},async req=>{
    const user=(await pool.query('SELECT id,username FROM users WHERE id=$1',[req.user.sub])).rows[0];
    if(!user) throw new ApiError(401,'Account not found.');
    const solves=(await pool.query('SELECT challenge_id,points FROM solves WHERE user_id=$1',[user.id])).rows;
    return {...user,aura:solves.reduce((sum,s)=>sum+s.points,0),solves:solves.map(s=>s.challenge_id)};
  });
  app.get('/api/challenges',async()=>({challenges:(await pool.query(`SELECT c.id,c.name,c.category,c.description,c.tier,c.points,c.delivery,c.artifact,
    (SELECT count(*)::int FROM solves s WHERE s.challenge_id=c.id) AS solve_count
    FROM challenges c WHERE c.enabled=true ORDER BY c.points,c.id`)).rows}));
  app.get('/api/scoreboard',async()=>({players:(await pool.query(`SELECT u.username,sum(s.points)::int AS aura,count(*)::int AS solves,max(s.solved_at) AS last_solve
    FROM users u JOIN solves s ON s.user_id=u.id GROUP BY u.id,u.username ORDER BY aura DESC,last_solve ASC,u.username ASC LIMIT 100`)).rows,
    firstBloods:(await pool.query(`SELECT u.username,c.name,s.solved_at FROM solves s JOIN users u ON u.id=s.user_id JOIN challenges c ON c.id=s.challenge_id WHERE s.first_blood=true ORDER BY s.solved_at DESC LIMIT 5`)).rows}));
  app.get('/api/instances/current',{preHandler:auth},async req=>({instance:(await pool.query("SELECT id,challenge_id,status,endpoint,expires_at FROM challenge_instances WHERE user_id=$1 AND status='running' AND expires_at>now()",[req.user.sub])).rows[0] || null}));
  app.post('/api/challenges/:id/spawn',{preHandler:auth},async(req,reply)=>{
    await throttle(req,reply,`spawn:${req.user.sub}`,3,60);
    reply.code(201); return {instance:await orchestrator.spawn(req.user.sub,req.params.id)};
  });
  app.delete('/api/instances/current',{preHandler:auth},async req=>{ await orchestrator.stop(req.user.sub); return {ok:true}; });
  app.post('/api/challenges/:id/submit',{preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['flag'],properties:{flag:{type:'string',minLength:1,maxLength:256}}}}},async(req,reply)=>{
    await throttle(req,reply,`flag:${req.user.sub}`,5,60);
    return transaction(pool,async db=>{
      const c=(await db.query('SELECT * FROM challenges WHERE id=$1 AND enabled=true FOR UPDATE',[req.params.id])).rows[0];
      if(!c) throw new ApiError(404,'Challenge not found');
      if((await db.query('SELECT 1 FROM solves WHERE user_id=$1 AND challenge_id=$2',[req.user.sub,c.id])).rows.length) return {correct:true,alreadySolved:true,awarded:0,message:'Already restored. Your Aura is safe.'};
      const hash=c.delivery==='static'?c.flag_hash:(await db.query("SELECT flag_hash FROM challenge_instances WHERE user_id=$1 AND challenge_id=$2 AND status='running' AND expires_at>now()",[req.user.sub,c.id])).rows[0]?.flag_hash;
      if(!equalHash(hash,flagHash(req.body.flag.trim(),cfg.flagSecret))) return {correct:false,awarded:0,message:'Skill Issue. You are Cooked (-0 Aura)'};
      const firstBlood=(await db.query('SELECT 1 FROM solves WHERE challenge_id=$1 LIMIT 1',[c.id])).rows.length===0;
      await db.query('INSERT INTO solves(user_id,challenge_id,points,first_blood) VALUES($1,$2,$3,$4)',[req.user.sub,c.id,c.points,firstBlood]);
      return {correct:true,firstBlood,awarded:c.points,message:`+${c.points} Aura Restored. Sigma Move!`};
    });
  });
  app.get('/api/challenges/:id/artifact',async(req,reply)=>{
    const c=(await pool.query('SELECT artifact FROM challenges WHERE id=$1 AND enabled=true',[req.params.id])).rows[0];
    if(!c?.artifact || !/^[a-z0-9.-]+$/.test(c.artifact)) throw new ApiError(404,'Artifact not found');
    let data; try { data=await readFile(new URL(`../artifacts/${c.artifact}`,import.meta.url)); }
    catch { throw new ApiError(503,'Artifact is missing. Build the backend image to generate the Linux binaries.'); }
    reply.header('Content-Disposition',`attachment; filename="${c.artifact}"`).type('application/octet-stream'); return data;
  });
  return app;
}
