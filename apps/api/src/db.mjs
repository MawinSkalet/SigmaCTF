import { readFile } from 'node:fs/promises';
import { flagHash } from './security.mjs';
export const catalog = [
  ['ping-of-ohio','Ping of Ohio','Web','The network diagnostic tool has one job. Convince it to do yours. Find the flag in the environment.','NPC Tier',100,'http','web-ping-of-ohio',8080,null,null],
  ['sigma-overflow','Sigma Overflow','Pwn','A tiny buffer. A very big ego. Redirect execution to win() and claim the flag. Download the x86-64 ELF to inspect it.','Sigma Tier',300,'tcp','pwn-sigma-overflow',30001,'sigma-overflow',null],
  ['mewing-vault','Mewing Vault v1.0','Reverse','The vault checks every byte. Reverse its XOR ritual and recover the key. Linux x86-64 ELF.','NPC Tier',150,'static',null,null,'mewing-vault','sigma{xor_is_not_a_lock}'],
  ['baby-rsa','Baby RSA from Ohio','Crypto','Someone skipped the padding. A tiny public exponent might be all you need. Recover the message from output.txt.','NPC Tier',100,'static',null,null,'baby-rsa.txt','sigma{cube_root_rizz}'],
  ['phantom-rizz','Phantom Rizz in the Wire','Forensics','Nothing to see here. Just a few innocent pings. Reassemble the echo request payloads in capture order.','Sigma Tier',200,'static',null,null,'phantom-rizz.pcap','sigma{echoes_in_the_void}']
];
export async function migrate(pool, cfg) {
  await pool.query(await readFile(new URL('../migrations/001_init.sql', import.meta.url),'utf8'));
  for (const [id,name,category,description,tier,points,delivery,image,port,artifact,flag] of catalog) {
    await pool.query(`INSERT INTO challenges(id,name,category,description,tier,points,delivery,image,port,artifact,flag_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,description=excluded.description,image=excluded.image,flag_hash=excluded.flag_hash`,
    [id,name,category,description,tier,points,delivery,image ? `${cfg.imagePrefix}/${image}:${cfg.imageTag}` : null,port,artifact,flag ? flagHash(flag,cfg.flagSecret) : null]);
  }
}
export async function transaction(pool, work) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
