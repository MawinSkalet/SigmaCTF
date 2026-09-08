import { randomBytes, randomUUID } from 'node:crypto';
import { transaction } from '../db.mjs';
import { ApiError, flagHash } from '../security.mjs';
import { containerSpec } from './docker.mjs';
const LOCK = 736244;
export class Orchestrator {
  constructor(pool, docker, cfg) { Object.assign(this,{pool,docker,cfg}); }
  async locked(work) {
    return transaction(this.pool, async db => { await db.query('SELECT pg_advisory_xact_lock($1)',[LOCK]); return work(db); });
  }
  async cleanup(instance) {
    // Deterministic names cover a crash between Docker creation and database persistence.
    await this.docker.remove(instance.container_id || `sigma-${instance.id}`);
    const network=instance.network_id || `sigma-${instance.id}`;
    try { await this.docker.disconnect(network,'sigmactf-traefik'); }
    catch(error) { if (![400,404].includes(error.dockerStatus)) throw error; }
    await this.docker.removeNetwork(network);
  }
  async terminate(db, instance) {
    await this.cleanup(instance);
    await db.query("UPDATE challenge_instances SET status='terminated',terminated_at=now() WHERE id=$1",[instance.id]);
  }
  async spawn(userId, challengeId) {
    if (!this.cfg.firewallConfirmed) throw new ApiError(503,'Sandbox launching is disabled until the host firewall is configured.');
    let created;
    try {
      return await this.locked(async db => {
        const challenge=(await db.query('SELECT * FROM challenges WHERE id=$1 AND enabled=true',[challengeId])).rows[0];
        if (!challenge) throw new ApiError(404,'Challenge not found');
        if (challenge.delivery==='static') throw new ApiError(400,'This challenge has a downloadable artifact.');
        // Images are server-controlled from the database and never accepted in request payloads.
        if (!challenge.image || !/^[a-zA-Z0-9_./:-]+$/.test(challenge.image)) throw new ApiError(503,'Challenge image is not configured.');
        const active=(await db.query("SELECT * FROM challenge_instances WHERE status IN ('starting','running')")).rows;
        for (const item of active.filter(i=>i.user_id===userId)) await this.terminate(db,item);
        const others=active.filter(i=>i.user_id!==userId);
        if (others.length>=this.cfg.maxInstances) throw new ApiError(503,'Kitchen is full. Try again shortly.');
        const slot=Array.from({length:51},(_,i)=>i).find(p=>!others.some(i=>i.network_slot===p));
        if(slot===undefined) throw new ApiError(503,'No sandbox networks are available.');
        const tcpPort=challenge.delivery==='tcp' ? Array.from({length:51},(_,i)=>30000+i).find(p=>!others.some(i=>i.tcp_port===p)) : null;
        if (challenge.delivery==='tcp' && !tcpPort) throw new ApiError(503,'No TCP ports are available.');
        const id=randomUUID(), flag=`sigma{${randomBytes(24).toString('hex')}}`;
        const expiresAt=new Date(Date.now()+this.cfg.ttlSeconds*1000).toISOString();
        const route=`s${id.replaceAll('-','')}`;
        const endpoint=challenge.delivery==='http'
          ? `${this.cfg.https?'https':'http'}://${route}.${this.cfg.domain}${[80,443].includes(this.cfg.webPort)?'':`:${this.cfg.webPort}`}`
          : `nc ${this.cfg.tcpHost} ${tcpPort}`;
        created={id};
        await db.query("INSERT INTO challenge_instances(id,user_id,challenge_id,flag_hash,status,endpoint,tcp_port,expires_at,network_slot) VALUES($1,$2,$3,$4,'starting',$5,$6,$7,$8)",[id,userId,challengeId,flagHash(flag,this.cfg.flagSecret),endpoint,tcpPort,expiresAt,slot]);
        const network=await this.docker.createNetwork(id,slot); created.network_id=network.Id;
        await this.docker.connect(network.Id,'sigmactf-traefik',slot);
        const container=await this.docker.create(id,containerSpec({id,challenge,flag,network:`sigma-${id}`,tcpPort,cfg:this.cfg,expiresAt,slot}));
        created.container_id=container.Id;
        await this.docker.start(container.Id);
        await db.query("UPDATE challenge_instances SET container_id=$2,network_id=$3,status='running' WHERE id=$1",[id,container.Id,network.Id]);
        return {id,challenge_id:challengeId,status:'running',endpoint,expires_at:expiresAt};
      });
    } catch(error) {
      if (created) try { await this.cleanup(created); } catch { /* Reconciler retries labeled orphans. */ }
      throw error;
    }
  }
  stop(userId) {
    return this.locked(async db => {
      const rows=(await db.query("SELECT * FROM challenge_instances WHERE user_id=$1 AND status IN ('starting','running')",[userId])).rows;
      for (const instance of rows) await this.terminate(db,instance);
    });
  }
  forceStop(instanceId) {
    return this.locked(async db => {
      const rows=(await db.query("SELECT * FROM challenge_instances WHERE id=$1 AND status IN ('starting','running')",[instanceId])).rows;
      for (const instance of rows) await this.terminate(db,instance);
    });
  }
  reap() {
    return this.locked(async db => {
      const instances=(await db.query("SELECT * FROM challenge_instances WHERE status IN ('starting','running')")).rows;
      const containers=await this.docker.list();
      const alive=new Set(containers.filter(c=>c.State==='running').map(c=>c.Labels['sigma.instance']));
      for (const i of instances) {
        if (new Date(i.expires_at)<=new Date() || !alive.has(i.id)) await this.terminate(db,i);
      }
      const retained=new Set(instances.filter(i=>new Date(i.expires_at)>new Date() && alive.has(i.id)).map(i=>i.id));
      for (const c of containers) if (!retained.has(c.Labels['sigma.instance'])) await this.docker.remove(c.Id);
      for (const n of await this.docker.networks()) if (!retained.has(n.Labels['sigma.instance'])) {
        await this.cleanup({id:n.Labels['sigma.instance'],network_id:n.Id});
      }
    });
  }
}
