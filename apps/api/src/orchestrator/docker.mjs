export class Docker {
  constructor(url) { this.url = url; }
  async call(path, method='GET', body) {
    const result = await fetch(`${this.url}${path}`, {method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    if (result.status===404 && method==='DELETE') return null;
    if (!result.ok) { const error=new Error(`Docker ${method} ${path.split('?')[0]} failed (${result.status})`); error.dockerStatus=result.status; throw error; }
    const text=await result.text(); return text ? JSON.parse(text) : null;
  }
  createNetwork(id, slot) { return this.call('/networks/create','POST',{
    Name:`sigma-${id}`,Driver:'bridge',Internal:true,EnableIPv6:false,
    Labels:{'sigma.managed':'true','sigma.instance':id},
    IPAM:{Config:[{Subnet:`172.30.${slot}.0/29`}]},
    Options:{'com.docker.network.bridge.name':`sg${id.replaceAll('-','').slice(0,11)}`,'com.docker.network.bridge.gateway_mode_ipv4':'isolated'}
  }); }
  connect(network, container, slot) { return this.call(`/networks/${network}/connect`,'POST',{Container:container,EndpointConfig:{IPAMConfig:{IPv4Address:`172.30.${slot}.2`}}}); }
  disconnect(network, container) { return this.call(`/networks/${network}/disconnect`,'POST',{Container:container,Force:true}); }
  create(id, spec) { return this.call(`/containers/create?name=sigma-${id}`,'POST',spec); }
  start(id) { return this.call(`/containers/${id}/start`,'POST'); }
  remove(id) { return this.call(`/containers/${id}?force=true`,'DELETE'); }
  removeNetwork(id) { return this.call(`/networks/${id}`,'DELETE'); }
  list() { return this.call(`/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({label:['sigma.managed=true']}))}`); }
  networks() { return this.call(`/networks?filters=${encodeURIComponent(JSON.stringify({label:['sigma.managed=true']}))}`); }
}
export function containerSpec({id, challenge, flag, network, tcpPort, cfg, expiresAt, slot}) {
  const route=`s${id.replaceAll('-','')}`;
  const labels={'sigma.managed':'true','sigma.instance':id,'sigma.expires':expiresAt,
    'traefik.enable':'true','traefik.docker.network':network};
  if(challenge.delivery==='http') Object.assign(labels,{
    [`traefik.http.routers.${route}.rule`]:`Host(\`${route}.${cfg.domain}\`)`,
    [`traefik.http.routers.${route}.entrypoints`]:'web',
    [`traefik.http.services.${route}.loadbalancer.server.port`]:String(challenge.port)
  });
  else Object.assign(labels,{
    [`traefik.tcp.routers.${route}.rule`]:'HostSNI(`*`)',
    [`traefik.tcp.routers.${route}.entrypoints`]:`p${tcpPort}`,
    [`traefik.tcp.services.${route}.loadbalancer.server.port`]:String(challenge.port)
  });
  return {Image:challenge.image,User:'10001:10001',Env:[`FLAG=${flag}`,`EXPIRES_EPOCH=${Math.floor(new Date(expiresAt).getTime()/1000)}`],Labels:labels,
    ExposedPorts:{[`${challenge.port}/tcp`]:{}},
    HostConfig:{Memory:64*1024*1024,MemorySwap:64*1024*1024,NanoCpus:250000000,PidsLimit:50,
      ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],
      Tmpfs:{'/tmp':'rw,noexec,nosuid,nodev,size=16m,mode=1777'},
      NetworkMode:network,Dns:['127.0.0.1'],PublishAllPorts:false,
      RestartPolicy:{Name:'no'},LogConfig:{Type:'json-file',Config:{'max-size':'1m','max-file':'1'}}},
    NetworkingConfig:{EndpointsConfig:{[network]:{IPAMConfig:{IPv4Address:`172.30.${slot}.3`}}}}};
}
