import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { randomUUID, randomBytes } from 'node:crypto';
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
      const allowedOrigins = [cfg.appOrigin, 'http://localhost:8080', 'http://ctf.localhost:8080', 'http://127.0.0.1:8080'];
      if(!allowedOrigins.includes(req.headers.origin)) throw new ApiError(403,'Invalid request origin');
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
    const isAdmin=Boolean(cfg.adminHandle && req.body.username.toLowerCase()===cfg.adminHandle.toLowerCase());
    try { await pool.query('INSERT INTO users(id,username,password_hash,is_admin) VALUES($1,$2,$3,$4)',[id,req.body.username,passwordHash,isAdmin]); }
    catch(e) { if(e.code==='23505') throw new ApiError(409,'That handle is already taken.'); throw e; }
    setSession(reply,id); reply.code(201); return {id,username:req.body.username};
  });
  app.post('/api/auth/login',{schema:{body:credentials}},async(req,reply)=>{
    await throttle(req,reply,`auth:${req.ip}`,15,900);
    const user=(await pool.query('SELECT * FROM users WHERE lower(username)=lower($1)',[req.body.username])).rows[0];
    const ok=await verifyPassword(req.body.password,user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if(!user || !ok) throw new ApiError(401,'Handle or password is incorrect.');
    if(cfg.adminHandle && user.username.toLowerCase()===cfg.adminHandle.toLowerCase() && !user.is_admin) {
      await pool.query('UPDATE users SET is_admin=true WHERE id=$1',[user.id]);
    }
    setSession(reply,user.id); return {id:user.id,username:user.username};
  });
  app.post('/api/auth/logout',async(req,reply)=>{ reply.clearCookie('sigma_session',{path:'/api'}); return {ok:true}; });

  app.get('/api/auth/providers',async()=>({
    google:Boolean(cfg.googleClientId && cfg.googleClientSecret)
  }));

  app.get('/api/auth/google',async(req,reply)=>{
    if(!cfg.googleClientId || !cfg.googleClientSecret) throw new ApiError(503,'Google OAuth is not configured on this server.');
    const state=randomBytes(24).toString('hex');
    reply.setCookie('oauth_state',state,{httpOnly:true,secure:cfg.secure,sameSite:'lax',path:'/',maxAge:600});
    const redirectUri=cfg.secure ? `${cfg.appOrigin}/api/auth/google/callback` : `http://localhost:${cfg.webPort}/api/auth/google/callback`;
    const authUrl=`https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(cfg.googleClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('openid email profile')}&state=${state}&prompt=select_account`;
    return reply.redirect(authUrl);
  });

  app.get('/api/auth/google/callback',async(req,reply)=>{
    if(!cfg.googleClientId || !cfg.googleClientSecret) throw new ApiError(503,'Google OAuth is not configured on this server.');
    const {code,state}=req.query;
    const cookieState=req.cookies?.oauth_state;
    reply.clearCookie('oauth_state',{path:'/'});
    if(!state || !cookieState || state!==cookieState) throw new ApiError(400,'Invalid or expired OAuth state. Please try again.');
    if(!code) throw new ApiError(400,'Missing OAuth authorization code.');

    const redirectUri=cfg.secure ? `${cfg.appOrigin}/api/auth/google/callback` : `http://localhost:${cfg.webPort}/api/auth/google/callback`;
    const tokenRes=await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({
        code,client_id:cfg.googleClientId,client_secret:cfg.googleClientSecret,
        redirect_uri:redirectUri,grant_type:'authorization_code'
      })
    });
    if(!tokenRes.ok) throw new ApiError(401,'Failed to authenticate with Google.');
    const tokens=await tokenRes.json();

    const userRes=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{
      headers:{Authorization:`Bearer ${tokens.access_token}`}
    });
    if(!userRes.ok) throw new ApiError(401,'Failed to fetch Google profile.');
    const profile=await userRes.json();

    let user=(await pool.query('SELECT id,username,is_admin FROM users WHERE google_id=$1',[profile.sub])).rows[0];
    if(!user && profile.email) {
      user=(await pool.query('SELECT id,username,is_admin FROM users WHERE lower(email)=lower($1)',[profile.email])).rows[0];
      if(user) await pool.query('UPDATE users SET google_id=$1 WHERE id=$2',[profile.sub,user.id]);
    }
    if(!user) {
      let baseName=(profile.name || profile.email.split('@')[0] || 'sigma').replace(/[^A-Za-z0-9_]/g,'').slice(0,18);
      if(baseName.length<3) baseName=`user_${randomBytes(3).toString('hex')}`;
      let candidate=baseName;
      const exists=(await pool.query('SELECT 1 FROM users WHERE lower(username)=lower($1)',[candidate])).rows.length>0;
      if(exists) candidate=`${baseName.slice(0,14)}_${Math.floor(100+Math.random()*900)}`;
      const id=randomUUID();
      const isAdmin=Boolean(cfg.adminHandle && candidate.toLowerCase()===cfg.adminHandle.toLowerCase());
      const dummyPass=`oauth_google:${randomBytes(24).toString('hex')}`;
      await pool.query('INSERT INTO users(id,username,password_hash,is_admin,google_id,email) VALUES($1,$2,$3,$4,$5,$6)',
        [id,candidate,dummyPass,isAdmin,profile.sub,profile.email || null]);
      user={id,username:candidate,is_admin:isAdmin};
    }
    if(cfg.adminHandle && user.username.toLowerCase()===cfg.adminHandle.toLowerCase() && !user.is_admin) {
      await pool.query('UPDATE users SET is_admin=true WHERE id=$1',[user.id]);
    }
    setSession(reply,user.id);
    return reply.redirect('/');
  });
  const adminAuth=async req=>{
    await auth(req);
    const user=(await pool.query('SELECT is_admin FROM users WHERE id=$1',[req.user.sub])).rows[0];
    if(!user?.is_admin) throw new ApiError(403,'Root privileges required.');
  };
  app.get('/api/me',{preHandler:auth},async req=>{
    const user=(await pool.query('SELECT id,username,is_admin,team_id FROM users WHERE id=$1',[req.user.sub])).rows[0];
    if(!user) throw new ApiError(401,'Account not found.');
    let team=null;
    if(user.team_id){
      team=(await pool.query('SELECT id,name,join_code,created_by FROM teams WHERE id=$1',[user.team_id])).rows[0] || null;
      if(team){
        team.members=(await pool.query('SELECT id,username FROM users WHERE team_id=$1 ORDER BY username ASC',[team.id])).rows;
      }
    }
    const solves=(await pool.query('SELECT challenge_id,points FROM solves WHERE user_id=$1',[user.id])).rows;
    return {...user,team,aura:solves.reduce((sum,s)=>sum+s.points,0),solves:solves.map(s=>s.challenge_id)};
  });
  app.get('/api/announcements',async()=>({
    announcements:(await pool.query('SELECT id,title,content,created_at FROM announcements WHERE is_active=true ORDER BY created_at DESC LIMIT 10')).rows
  }));
  app.get('/api/challenges',async()=>({challenges:(await pool.query(`SELECT c.id,c.name,c.category,c.description,c.tier,c.points,c.delivery,c.artifact,
    (SELECT count(*)::int FROM solves s WHERE s.challenge_id=c.id) AS solve_count
    FROM challenges c WHERE c.enabled=true ORDER BY c.points,c.id`)).rows}));
  app.get('/api/scoreboard',async()=>({
    players:(await pool.query(`SELECT u.username,sum(s.points)::int AS aura,count(*)::int AS solves,max(s.solved_at) AS last_solve
      FROM users u JOIN solves s ON s.user_id=u.id GROUP BY u.id,u.username ORDER BY aura DESC,last_solve ASC,u.username ASC LIMIT 100`)).rows,
    teams:(await pool.query(`SELECT t.name,sum(s.points)::int AS aura,count(DISTINCT s.challenge_id)::int AS solves,max(s.solved_at) AS last_solve
      FROM teams t JOIN users u ON u.team_id=t.id JOIN solves s ON s.user_id=u.id GROUP BY t.id,t.name ORDER BY aura DESC,last_solve ASC,t.name ASC LIMIT 100`)).rows,
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
      const isCorrect=equalHash(hash,flagHash(req.body.flag.trim(),cfg.flagSecret));
      try {
        await db.query('INSERT INTO submissions(user_id,challenge_id,submitted_flag,correct) VALUES($1,$2,$3,$4)',[req.user.sub,c.id,req.body.flag.trim().slice(0,256),isCorrect]);
      } catch(e) {
        req.log?.warn?.(e,'Failed to log submission');
      }
      if(!isCorrect) return {correct:false,awarded:0,message:'Skill Issue. You are Cooked (-0 Aura)'};
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

  // --- Team Mode Endpoints ---
  app.get('/api/teams/my',{preHandler:auth},async req=>{
    const user=(await pool.query('SELECT team_id FROM users WHERE id=$1',[req.user.sub])).rows[0];
    if(!user?.team_id) return {team:null};
    const team=(await pool.query('SELECT id,name,join_code,created_by,created_at FROM teams WHERE id=$1',[user.team_id])).rows[0];
    if(!team) return {team:null};
    team.members=(await pool.query('SELECT id,username FROM users WHERE team_id=$1 ORDER BY username ASC',[team.id])).rows;
    return {team};
  });
  app.post('/api/teams/create',{preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['name'],properties:{name:{type:'string',minLength:3,maxLength:32,pattern:'^[A-Za-z0-9_ ]+$'}}}}},async req=>{
    const user=(await pool.query('SELECT team_id FROM users WHERE id=$1',[req.user.sub])).rows[0];
    if(user?.team_id) throw new ApiError(400,'You already belong to a squad.');
    const id=randomUUID(), code=Math.random().toString(36).slice(2,8).toUpperCase();
    try {
      await transaction(pool,async db=>{
        await db.query('INSERT INTO teams(id,name,join_code,created_by) VALUES($1,$2,$3,$4)',[id,req.body.name.trim(),code,req.user.sub]);
        await db.query('UPDATE users SET team_id=$1 WHERE id=$2',[id,req.user.sub]);
      });
      return {id,name:req.body.name.trim(),join_code:code};
    } catch(e) {
      if(e.code==='23505') throw new ApiError(409,'Team name is already claimed.');
      throw e;
    }
  });
  app.post('/api/teams/join',{preHandler:auth,schema:{body:{type:'object',additionalProperties:false,required:['join_code'],properties:{join_code:{type:'string',minLength:4,maxLength:16}}}}},async req=>{
    const user=(await pool.query('SELECT team_id FROM users WHERE id=$1',[req.user.sub])).rows[0];
    if(user?.team_id) throw new ApiError(400,'You already belong to a squad. Leave first.');
    const team=(await pool.query('SELECT id,name FROM teams WHERE upper(join_code)=upper($1)',[req.body.join_code.trim()])).rows[0];
    if(!team) throw new ApiError(404,'Invalid squad code.');
    await pool.query('UPDATE users SET team_id=$1 WHERE id=$2',[team.id,req.user.sub]);
    return {id:team.id,name:team.name};
  });
  app.post('/api/teams/leave',{preHandler:auth},async req=>{
    await pool.query('UPDATE users SET team_id=NULL WHERE id=$1',[req.user.sub]);
    return {ok:true};
  });

  // --- Admin Dashboard Endpoints ---
  app.get('/api/admin/overview',{preHandler:adminAuth},async()=>({
    users:(await pool.query('SELECT count(*)::int AS total FROM users')).rows[0].total,
    activeInstances:(await pool.query("SELECT count(*)::int AS total FROM challenge_instances WHERE status IN ('starting','running') AND expires_at>now()")).rows[0].total,
    solves:(await pool.query('SELECT count(*)::int AS total FROM solves')).rows[0].total,
    challenges:(await pool.query('SELECT count(*)::int AS total FROM challenges')).rows[0].total,
    submissions:(await pool.query('SELECT count(*)::int AS total FROM submissions')).rows[0].total,
    teams:(await pool.query('SELECT count(*)::int AS total FROM teams')).rows[0].total
  }));

  app.get('/api/admin/challenges',{preHandler:adminAuth},async()=>({
    challenges:(await pool.query(`SELECT c.id,c.name,c.category,c.description,c.tier,c.points,c.delivery,c.image,c.port,c.artifact,c.enabled,
      (c.flag_hash IS NOT NULL) AS has_flag,
      (SELECT count(*)::int FROM solves s WHERE s.challenge_id=c.id) AS solve_count
      FROM challenges c ORDER BY c.points,c.id`)).rows
  }));
  app.post('/api/admin/challenges',{preHandler:adminAuth,schema:{body:{type:'object',required:['id','name','category','description','points','delivery'],properties:{
    id:{type:'string',pattern:'^[a-z0-9-]+$'},name:{type:'string',minLength:2},category:{type:'string'},description:{type:'string'},
    tier:{type:'string'},points:{type:'integer',minimum:1},delivery:{type:'string',enum:['http','tcp','static']},image:{type:['string','null']},
    port:{type:['integer','null']},artifact:{type:['string','null']},flag:{type:['string','null']},enabled:{type:'boolean'}
  }}}},async(req,reply)=>{
    const b=req.body;
    const hash=b.flag ? flagHash(b.flag.trim(),cfg.flagSecret) : null;
    try {
      await pool.query(`INSERT INTO challenges(id,name,category,description,tier,points,delivery,image,port,artifact,flag_hash,enabled)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [b.id,b.name,b.category,b.description,b.tier || 'NPC Tier',b.points,b.delivery,b.image || null,b.port || null,b.artifact || null,hash,b.enabled !== false]);
      reply.code(201); return {ok:true,id:b.id};
    } catch(e) {
      if(e.code==='23505') throw new ApiError(409,'Challenge ID already exists.');
      throw e;
    }
  });
  app.put('/api/admin/challenges/:id',{preHandler:adminAuth,schema:{body:{type:'object',required:['name','category','description','points','delivery'],properties:{
    name:{type:'string',minLength:2},category:{type:'string'},description:{type:'string'},tier:{type:'string'},points:{type:'integer',minimum:1},
    delivery:{type:'string',enum:['http','tcp','static']},image:{type:['string','null']},port:{type:['integer','null']},
    artifact:{type:['string','null']},flag:{type:['string','null']},enabled:{type:'boolean'}
  }}}},async req=>{
    const b=req.body;
    let query,params;
    if(b.flag && b.flag.trim()) {
      const hash=flagHash(b.flag.trim(),cfg.flagSecret);
      query=`UPDATE challenges SET name=$1,category=$2,description=$3,tier=$4,points=$5,delivery=$6,image=$7,port=$8,artifact=$9,flag_hash=$10,enabled=$11 WHERE id=$12`;
      params=[b.name,b.category,b.description,b.tier || 'NPC Tier',b.points,b.delivery,b.image || null,b.port || null,b.artifact || null,hash,b.enabled !== false,req.params.id];
    } else {
      query=`UPDATE challenges SET name=$1,category=$2,description=$3,tier=$4,points=$5,delivery=$6,image=$7,port=$8,artifact=$9,enabled=$10 WHERE id=$11`;
      params=[b.name,b.category,b.description,b.tier || 'NPC Tier',b.points,b.delivery,b.image || null,b.port || null,b.artifact || null,b.enabled !== false,req.params.id];
    }
    const r=await pool.query(query,params);
    if(!r.rowCount) throw new ApiError(404,'Challenge not found');
    return {ok:true};
  });
  app.patch('/api/admin/challenges/:id/toggle',{preHandler:adminAuth},async req=>{
    const r=await pool.query('UPDATE challenges SET enabled = NOT enabled WHERE id=$1 RETURNING enabled',[req.params.id]);
    if(!r.rowCount) throw new ApiError(404,'Challenge not found');
    return {enabled:r.rows[0].enabled};
  });
  app.delete('/api/admin/challenges/:id',{preHandler:adminAuth},async req=>{
    await pool.query('DELETE FROM challenges WHERE id=$1',[req.params.id]);
    return {ok:true};
  });

  app.get('/api/admin/instances',{preHandler:adminAuth},async()=>({
    instances:(await pool.query(`SELECT ci.id,ci.user_id,u.username,ci.challenge_id,c.name AS challenge_name,ci.status,ci.endpoint,ci.tcp_port,ci.created_at,ci.expires_at
      FROM challenge_instances ci JOIN users u ON u.id=ci.user_id JOIN challenges c ON c.id=ci.challenge_id
      WHERE ci.status IN ('starting','running') AND ci.expires_at>now() ORDER BY ci.created_at DESC`)).rows
  }));
  app.delete('/api/admin/instances/:id',{preHandler:adminAuth},async req=>{
    await orchestrator.forceStop(req.params.id);
    return {ok:true};
  });

  app.get('/api/admin/submissions',{preHandler:adminAuth},async()=>({
    submissions:(await pool.query(`SELECT s.id,s.user_id,u.username,s.challenge_id,c.name AS challenge_name,s.submitted_flag,s.correct,s.created_at
      FROM submissions s JOIN users u ON u.id=s.user_id JOIN challenges c ON c.id=s.challenge_id
      ORDER BY s.created_at DESC LIMIT 100`)).rows
  }));

  app.get('/api/admin/announcements',{preHandler:adminAuth},async()=>({
    announcements:(await pool.query('SELECT * FROM announcements ORDER BY created_at DESC')).rows
  }));
  app.post('/api/admin/announcements',{preHandler:adminAuth,schema:{body:{type:'object',required:['title','content'],properties:{title:{type:'string',minLength:1},content:{type:'string',minLength:1}}}}},async(req,reply)=>{
    const r=await pool.query('INSERT INTO announcements(title,content,is_active) VALUES($1,$2,true) RETURNING *',[req.body.title.trim(),req.body.content.trim()]);
    reply.code(201); return r.rows[0];
  });
  app.patch('/api/admin/announcements/:id/toggle',{preHandler:adminAuth},async req=>{
    const r=await pool.query('UPDATE announcements SET is_active = NOT is_active WHERE id=$1 RETURNING is_active',[req.params.id]);
    if(!r.rowCount) throw new ApiError(404,'Announcement not found');
    return {is_active:r.rows[0].is_active};
  });
  app.delete('/api/admin/announcements/:id',{preHandler:adminAuth},async req=>{
    await pool.query('DELETE FROM announcements WHERE id=$1',[req.params.id]);
    return {ok:true};
  });

  app.get('/api/admin/users',{preHandler:adminAuth},async()=>({
    users:(await pool.query(`SELECT u.id,u.username,u.is_admin,u.created_at,t.name AS team_name,
      (SELECT count(*)::int FROM solves s WHERE s.user_id=u.id) AS solves,
      (SELECT coalesce(sum(s.points),0)::int FROM solves s WHERE s.user_id=u.id) AS aura
      FROM users u LEFT JOIN teams t ON t.id=u.team_id ORDER BY u.created_at ASC`)).rows
  }));
  app.patch('/api/admin/users/:id/role',{preHandler:adminAuth},async req=>{
    const r=await pool.query('UPDATE users SET is_admin = NOT is_admin WHERE id=$1 RETURNING is_admin',[req.params.id]);
    if(!r.rowCount) throw new ApiError(404,'User not found');
    return {is_admin:r.rows[0].is_admin};
  });

  return app;
}
