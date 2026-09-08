// Explicit preview/test harness. Production main.mjs never imports these adapters.
import { fixture } from './support.mjs';
const f=await fixture({firewallConfirmed:false});
await f.app.listen({host:'127.0.0.1',port:4000});
console.log('Preview API: temporary embedded PostgreSQL; sandbox launching disabled. http://127.0.0.1:4000');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await f.close();process.exit(0);});
