import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,register,post } from './support.mjs';
import { flagHash } from '../apps/api/src/security.mjs';
test('public catalog omits flags and images; authentication uses cookies and enforces origin',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const c=await f.app.inject('/api/challenges');assert.equal(c.json().challenges.length,5);assert.ok(!c.body.includes('flag_hash'));assert.ok(!c.body.includes('sigmactf/'));
  assert.equal((await f.app.inject({method:'POST',url:'/api/auth/register',payload:{username:'player',password:'password123456'}})).statusCode,403);
  assert.equal((await f.app.inject('/api/me')).statusCode,401);
  const user=await register(f);const me=await f.app.inject({url:'/api/me',headers:{cookie:user.cookie}});assert.equal(me.json().aura,0);
  const duplicate=await post(f,user,'/api/auth/register',{username:'SIGMA_PLAYER',password:'another long password'});assert.equal(duplicate.statusCode,409);
  const login=await post(f,user,'/api/auth/login',{username:'SIGMA_PLAYER',password:'correct horse battery sigma'});assert.equal(login.statusCode,200);assert.match(login.headers['set-cookie'],/HttpOnly/);assert.match(login.headers['set-cookie'],/SameSite=Strict/);
  assert.equal((await post(f,user,'/api/auth/login',{username:'sigma_player',password:'wrong password 123'})).statusCode,401);
});
test('flag scoring is idempotent, first blood is unique, and rate limit rejects sixth check',async t=>{
  const f=await fixture();t.after(()=>f.close());const user=await register(f);const path='/api/challenges/baby-rsa/submit';
  assert.equal((await post(f,user,path,{flag:'wrong'})).json().correct,false);
  const result=(await post(f,user,path,{flag:'sigma{cube_root_rizz}'})).json();assert.equal(result.awarded,100);assert.equal(result.firstBlood,true);
  assert.equal((await post(f,user,path,{flag:'sigma{cube_root_rizz}'})).json().awarded,0);
  await post(f,user,path,{flag:'wrong'});await post(f,user,path,{flag:'wrong'});
  const limited=await post(f,user,path,{flag:'wrong'});assert.equal(limited.statusCode,429);assert.ok(Number(limited.headers['retry-after'])>0);
  const other=await register(f,'another_sigma');assert.equal((await post(f,other,path,{flag:'sigma{cube_root_rizz}'})).json().firstBlood,false);
  const board=(await f.app.inject('/api/scoreboard')).json();assert.equal(board.players.length,2);assert.equal(board.players[0].aura,100);assert.equal(board.firstBloods.length,1);
});
test('spawn applies resource policy, unique networks, flag ownership, and single-instance replacement',async t=>{
  const f=await fixture();t.after(()=>f.close());const user=await register(f),other=await register(f,'other_player');
  const created=await post(f,user,'/api/challenges/ping-of-ohio/spawn');assert.equal(created.statusCode,201,created.body);
  const spec=f.docker.specs[0];assert.equal(spec.HostConfig.Memory,67108864);assert.equal(spec.HostConfig.MemorySwap,67108864);assert.equal(spec.HostConfig.NanoCpus,250000000);assert.equal(spec.HostConfig.PidsLimit,50);assert.equal(spec.HostConfig.ReadonlyRootfs,true);assert.deepEqual(spec.HostConfig.CapDrop,['ALL']);assert.equal(spec.User,'10001:10001');assert.equal(spec.HostConfig.Binds,undefined);assert.match(spec.HostConfig.Tmpfs['/tmp'],/noexec/);assert.deepEqual(spec.HostConfig.Dns,['127.0.0.1']);
  assert.ok(spec.Env.some(e=>e.startsWith('EXPIRES_EPOCH=')));
  const flag=spec.Env.find(e=>e.startsWith('FLAG=')).slice(5);assert.ok(!created.body.includes(flag));
  assert.equal((await post(f,other,'/api/challenges/ping-of-ohio/submit',{flag})).json().correct,false);
  assert.equal((await post(f,user,'/api/challenges/ping-of-ohio/submit',{flag})).json().awarded,100);
  const next=await post(f,user,'/api/challenges/sigma-overflow/spawn');assert.equal(next.statusCode,201,next.body);assert.match(next.json().instance.endpoint,/nc localhost 30000/);assert.equal(f.docker.containers.size,1);assert.equal(f.docker.nets.size,1);
  assert.equal((await f.pool.query("SELECT * FROM challenge_instances WHERE status='running'")).rows.length,1);
});
test('expired instances cannot submit and janitor removes expired and orphan resources',async t=>{
  const f=await fixture();t.after(()=>f.close());const user=await register(f);await post(f,user,'/api/challenges/ping-of-ohio/spawn');
  const flag=f.docker.specs[0].Env[0].slice(5);await f.pool.query("UPDATE challenge_instances SET expires_at=now()-interval '1 second'");
  assert.equal((await post(f,user,'/api/challenges/ping-of-ohio/submit',{flag})).json().correct,false);
  assert.equal((await f.app.inject({url:'/api/instances/current',headers:{cookie:user.cookie}})).json().instance,null);
  await f.orchestrator.reap();assert.equal(f.docker.containers.size,0);assert.equal(f.docker.nets.size,0);
  await f.docker.createNetwork('orphan');await f.docker.create('orphan',{Labels:{'sigma.instance':'orphan'}});await f.orchestrator.reap();assert.equal(f.docker.containers.size,0);assert.equal(f.docker.nets.size,0);
});
test('failed Docker start rolls back reservation and compensates created resources',async t=>{
  const f=await fixture();t.after(()=>f.close());const user=await register(f);f.docker.failStart=true;
  const response=await post(f,user,'/api/challenges/ping-of-ohio/spawn');assert.equal(response.statusCode,500);assert.ok(!response.body.includes('Injected'));
  assert.equal(f.docker.containers.size,0);assert.equal(f.docker.nets.size,0);assert.equal((await f.pool.query('SELECT * FROM challenge_instances')).rows.length,0);
});
test('capacity and firewall gates fail closed; static challenges cannot spawn',async t=>{
  const f=await fixture({maxInstances:1});t.after(()=>f.close());const user=await register(f),other=await register(f,'second_user');
  assert.equal((await post(f,user,'/api/challenges/baby-rsa/spawn')).statusCode,400);
  assert.equal((await post(f,user,'/api/challenges/ping-of-ohio/spawn')).statusCode,201);
  assert.equal((await post(f,other,'/api/challenges/ping-of-ohio/spawn')).statusCode,503);
  f.cfg.firewallConfirmed=false;assert.equal((await post(f,other,'/api/challenges/ping-of-ohio/spawn')).statusCode,503);
});
test('cleanup failure retains active record for retry; flags are HMAC protected',async t=>{
  const f=await fixture();t.after(()=>f.close());const user=await register(f);await post(f,user,'/api/challenges/ping-of-ohio/spawn');
  f.docker.failRemove=true;await assert.rejects(()=>f.orchestrator.stop(user.id));assert.equal((await f.pool.query("SELECT * FROM challenge_instances WHERE status='running'")).rows.length,1);
  f.docker.failRemove=false;await f.orchestrator.stop(user.id);assert.equal(f.docker.containers.size,0);
  assert.notEqual(flagHash('sigma{x}','secret-one'),flagHash('sigma{x}','secret-two'));
});
