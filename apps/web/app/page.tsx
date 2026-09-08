'use client';
import {useEffect,useRef,useState,FormEvent} from 'react';
import {
  Terminal,Flag,Trophy,ArrowUpRight,ArrowRight,ChevronRight,Globe,Code2,
  KeyRound,Radio,Box,Flame,Clock,Check,Download,LogOut,X,LoaderCircle,
  RotateCcw,ShieldCheck,Copy,Shield,Users,Trash2,Edit3,Plus,Power,
  Megaphone,Eye,EyeOff,CheckCircle2,XCircle,Activity
} from 'lucide-react';

type Challenge={
  id:string;name:string;category:string;description:string;tier:string;points:number;
  delivery:'http'|'tcp'|'static';artifact:string|null;solve_count:number;
  enabled?:boolean;image?:string|null;port?:number|null;has_flag?:boolean;
};
type Player={
  id:string;username:string;aura:number;solves:string[];is_admin?:boolean;team_id?:string|null;
  team?:{id:string;name:string;join_code:string;created_by:string;members?:{id:string;username:string}[]}|null;
};
type Instance={
  id:string;user_id?:string;username?:string;challenge_id:string;challenge_name?:string;
  status:string;endpoint:string;expires_at:string;created_at?:string;
};
type Board={
  players:{username:string;aura:number;solves:number}[];
  teams:{name:string;aura:number;solves:number}[];
  firstBloods:{username:string;name:string;solved_at:string}[];
};
type Submission={
  id:string;user_id:string;username:string;challenge_id:string;challenge_name:string;
  submitted_flag:string;correct:boolean;created_at:string;
};
type Announcement={id:string;title:string;content:string;is_active?:boolean;created_at:string};
type AdminOverview={users:number;activeInstances:number;solves:number;challenges:number;submissions:number;teams:number};
type AdminUser={id:string;username:string;is_admin:boolean;team_name:string|null;solves:number;aura:number;created_at:string};

const categories=['All challenges','Web','Pwn','Reverse','Crypto','Forensics'];
const icons:Record<string,typeof Globe>={Web:Globe,Pwn:Terminal,Reverse:Code2,Crypto:KeyRound,Forensics:Radio};

async function api(path:string,options:RequestInit={}){
  const headers:Record<string,string>=options.body?{'Content-Type':'application/json'}:{};
  if(options.headers)Object.assign(headers,options.headers);
  const response=await fetch(`/api${path}`,{...options,headers,credentials:'same-origin'});
  let data;try{data=await response.json();}catch{throw new Error('The arena is offline. Check the platform services.');}
  if(!response.ok)throw new Error(data.error || 'Request failed');return data;
}

function Countdown({expires}:{expires:string}){
  const [left,setLeft]=useState(Math.max(0,Math.ceil((new Date(expires).getTime()-Date.now())/1000)));
  useEffect(()=>{const t=setInterval(()=>setLeft(Math.max(0,Math.ceil((new Date(expires).getTime()-Date.now())/1000))),1000);return()=>clearInterval(t);},[expires]);
  return <span className={left<60?'danger':''}>{left===0?'Sent to the Void 💀':`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`}</span>;
}

export default function Arena(){
  const [catalog,setCatalog]=useState<Challenge[]>([]);
  const [player,setPlayer]=useState<Player|null>(null);
  const [board,setBoard]=useState<Board>({players:[],teams:[],firstBloods:[]});
  const [category,setCategory]=useState('All challenges');
  const [tab,setTab]=useState<'challenges'|'scoreboard'|'admin'>('challenges');
  const [boardMode,setBoardMode]=useState<'players'|'teams'>('players');
  const [instance,setInstance]=useState<Instance|null>(null);
  const [announcements,setAnnouncements]=useState<Announcement[]>([]);
  const [selected,setSelected]=useState<Challenge|null>(null);
  const [flag,setFlag]=useState('');
  const [busy,setBusy]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [authMode,setAuthMode]=useState<'register'|'login'>('register');
  const [authOpen,setAuthOpen]=useState(false);
  const [teamOpen,setTeamOpen]=useState(false);
  const [notice,setNotice]=useState<{text:string;good:boolean}|null>(null);

  // Admin State
  const [adminTab,setAdminTab]=useState<'overview'|'challenges'|'instances'|'submissions'|'announcements'|'users'>('overview');
  const [adminOverview,setAdminOverview]=useState<AdminOverview|null>(null);
  const [adminChallenges,setAdminChallenges]=useState<Challenge[]>([]);
  const [adminInstances,setAdminInstances]=useState<Instance[]>([]);
  const [adminSubmissions,setAdminSubmissions]=useState<Submission[]>([]);
  const [adminAnnouncements,setAdminAnnouncements]=useState<Announcement[]>([]);
  const [adminUsers,setAdminUsers]=useState<AdminUser[]>([]);
  const [chalModalOpen,setChalModalOpen]=useState(false);
  const [editingChal,setEditingChal]=useState<Challenge|null>(null);
  const [annModalOpen,setAnnModalOpen]=useState(false);

  const dialog=useRef<HTMLDialogElement>(null);
  const authDialog=useRef<HTMLDialogElement>(null);
  const teamDialog=useRef<HTMLDialogElement>(null);
  const chalDialog=useRef<HTMLDialogElement>(null);
  const annDialog=useRef<HTMLDialogElement>(null);

  const refresh=async()=>{
    try{
      const [c,b,a]=await Promise.all([api('/challenges'),api('/scoreboard'),api('/announcements')]);
      setCatalog(c.challenges);setBoard(b);setAnnouncements(a.announcements||[]);setError('');
    }
    catch(e){setError((e as Error).message);}finally{setLoading(false);}
  };

  const refreshPlayer=async()=>{
    try{
      const me=await api('/me');
      setPlayer(me);
      setInstance((await api('/instances/current')).instance);
    }catch{setPlayer(null);setInstance(null);}
  };

  const loadAdminData=async()=>{
    if(!player?.is_admin)return;
    try{
      if(adminTab==='overview'){setAdminOverview(await api('/admin/overview'));}
      else if(adminTab==='challenges'){setAdminChallenges((await api('/admin/challenges')).challenges);}
      else if(adminTab==='instances'){setAdminInstances((await api('/admin/instances')).instances);}
      else if(adminTab==='submissions'){setAdminSubmissions((await api('/admin/submissions')).submissions);}
      else if(adminTab==='announcements'){setAdminAnnouncements((await api('/admin/announcements')).announcements);}
      else if(adminTab==='users'){setAdminUsers((await api('/admin/users')).users);}
    }catch(e){toast((e as Error).message);}
  };

  useEffect(()=>{
    void refresh();void refreshPlayer();
    const t=setInterval(()=>{void refresh();void refreshPlayer();},15000);
    return()=>clearInterval(t);
  },[]);

  useEffect(()=>{if(tab==='admin')void loadAdminData();},[tab,adminTab,player?.is_admin]);
  useEffect(()=>{if(selected)dialog.current?.showModal();else dialog.current?.close();},[selected]);
  useEffect(()=>{if(authOpen)authDialog.current?.showModal();else authDialog.current?.close();},[authOpen]);
  useEffect(()=>{if(teamOpen)teamDialog.current?.showModal();else teamDialog.current?.close();},[teamOpen]);
  useEffect(()=>{if(chalModalOpen)chalDialog.current?.showModal();else chalDialog.current?.close();},[chalModalOpen]);
  useEffect(()=>{if(annModalOpen)annDialog.current?.showModal();else annDialog.current?.close();},[annModalOpen]);
  useEffect(()=>{if(notice){const t=setTimeout(()=>setNotice(null),7000);return()=>clearTimeout(t);}},[notice]);

  const toast=(text:string,good=false)=>setNotice({text,good});
  const choose=(c:Challenge)=>{setFlag('');setSelected(c);};
  const signIn=()=>{setSelected(null);setAuthOpen(true);};

  const spawn=async()=>{
    if(!player)return signIn();if(!selected)return;setBusy('spawn');
    try{setInstance((await api(`/challenges/${selected.id}/spawn`,{method:'POST',body:'{}'})).instance);toast('Cooked & Live 🔥',true);}
    catch(e){toast((e as Error).message);}finally{setBusy('');}
  };

  const stop=async()=>{
    setBusy('stop');
    try{await api('/instances/current',{method:'DELETE',body:'{}'});setInstance(null);toast('Sent to the Void 💀',true);}
    catch(e){toast((e as Error).message);}finally{setBusy('');}
  };

  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(!player)return signIn();if(!selected)return;setBusy('flag');
    try{
      const r=await api(`/challenges/${selected.id}/submit`,{method:'POST',body:JSON.stringify({flag})});
      toast(`${r.message}${r.firstBlood?' GIGACHAD BLOOD 🩸':''}`,r.correct);
      if(r.correct){setFlag('');await refreshPlayer();await refresh();}
    }catch(e){toast((e as Error).message);}finally{setBusy('');}
  };

  const authenticate=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const form=new FormData(e.currentTarget);setBusy('auth');
    try{
      await api(`/auth/${authMode}`,{method:'POST',body:JSON.stringify({username:form.get('username'),password:form.get('password')})});
      await refreshPlayer();setAuthOpen(false);toast('You’re in. Make your move.',true);
    }catch(e){toast((e as Error).message);}finally{setBusy('');}
  };

  // Team Functions
  const createTeam=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const form=new FormData(e.currentTarget);setBusy('team');
    try{
      await api('/teams/create',{method:'POST',body:JSON.stringify({name:form.get('name')})});
      await refreshPlayer();toast('Squad established! Invite your team.',true);
    }catch(e){toast((e as Error).message);}finally{setBusy('');}
  };

  const joinTeam=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const form=new FormData(e.currentTarget);setBusy('team');
    try{
      await api('/teams/join',{method:'POST',body:JSON.stringify({join_code:form.get('join_code')})});
      await refreshPlayer();toast('Joined squad successfully!',true);
    }catch(e){toast((e as Error).message);}finally{setBusy('');}
  };

  const leaveTeam=async()=>{
    if(!confirm('Leave your current squad?'))return;setBusy('team');
    try{await api('/teams/leave',{method:'POST',body:'{}'});await refreshPlayer();toast('Left squad.',true);}
    catch(e){toast((e as Error).message);}finally{setBusy('');}
  };

  // Admin Operations
  const toggleChallenge=async(id:string)=>{
    try{
      const res=await api(`/admin/challenges/${id}/toggle`,{method:'PATCH',body:'{}'});
      setAdminChallenges(prev=>prev.map(c=>c.id===id?{...c,enabled:res.enabled}:c));
      toast(`Challenge ${res.enabled?'Enabled':'Disabled'}.`,true);
      void refresh();
    }catch(e){toast((e as Error).message);}
  };

  const deleteChallenge=async(id:string)=>{
    if(!confirm(`Delete challenge "${id}"? This is irreversible.`))return;
    try{
      await api(`/admin/challenges/${id}`,{method:'DELETE',body:'{}'});
      setAdminChallenges(prev=>prev.filter(c=>c.id!==id));
      toast('Challenge obliterated.',true);
      void refresh();
    }catch(e){toast((e as Error).message);}
  };

  const saveChallenge=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const f=new FormData(e.currentTarget);setBusy('chal');
    const payload:Record<string,any>={
      name:f.get('name'),
      category:f.get('category'),
      description:f.get('description'),
      tier:f.get('tier'),
      points:Number(f.get('points')),
      delivery:f.get('delivery'),
      image:f.get('image')||null,
      port:f.get('port')?Number(f.get('port')):null,
      artifact:f.get('artifact')||null,
      flag:f.get('flag')||null,
      enabled:f.get('enabled')==='on'
    };
    try{
      if(editingChal){
        await api(`/admin/challenges/${editingChal.id}`,{method:'PUT',body:JSON.stringify(payload)});
        toast('Challenge updated.',true);
      }else{
        payload.id=f.get('id');
        await api('/admin/challenges',{method:'POST',body:JSON.stringify(payload)});
        toast('Challenge deployed to arena!',true);
      }
      setChalModalOpen(false);setEditingChal(null);
      void loadAdminData();void refresh();
    }catch(e){toast((e as Error).message);}finally{setBusy('');}
  };

  const forceKillInstance=async(id:string)=>{
    if(!confirm('Force terminate this instance immediately?'))return;
    try{
      await api(`/admin/instances/${id}`,{method:'DELETE',body:'{}'});
      setAdminInstances(prev=>prev.filter(i=>i.id!==id));
      toast('Container purged from Docker.',true);
      if(instance?.id===id)setInstance(null);
    }catch(e){toast((e as Error).message);}
  };

  const saveAnnouncement=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const f=new FormData(e.currentTarget);setBusy('ann');
    try{
      await api('/admin/announcements',{method:'POST',body:JSON.stringify({title:f.get('title'),content:f.get('content')})});
      setAnnModalOpen(false);toast('Broadcast dispatched to arena!',true);
      void loadAdminData();void refresh();
    }catch(e){toast((e as Error).message);}finally{setBusy('');}
  };

  const toggleAnnouncement=async(id:string)=>{
    try{
      const r=await api(`/admin/announcements/${id}/toggle`,{method:'PATCH',body:'{}'});
      setAdminAnnouncements(prev=>prev.map(a=>a.id===id?{...a,is_active:r.is_active}:a));
      void refresh();
    }catch(e){toast((e as Error).message);}
  };

  const deleteAnnouncement=async(id:string)=>{
    if(!confirm('Delete this broadcast?'))return;
    try{
      await api(`/admin/announcements/${id}`,{method:'DELETE',body:'{}'});
      setAdminAnnouncements(prev=>prev.filter(a=>a.id!==id));
      toast('Broadcast deleted.',true);
      void refresh();
    }catch(e){toast((e as Error).message);}
  };

  const toggleUserRole=async(id:string)=>{
    try{
      const r=await api(`/admin/users/${id}/role`,{method:'PATCH',body:'{}'});
      setAdminUsers(prev=>prev.map(u=>u.id===id?{...u,is_admin:r.is_admin}:u));
      toast(`User permissions updated (${r.is_admin?'ADMIN':'USER'}).`,true);
    }catch(e){toast((e as Error).message);}
  };

  const current=instance && new Date(instance.expires_at)>new Date()?instance:null;
  const filtered=catalog.filter(c=>category==='All challenges'||c.category===category);
  const solved=selected && player?.solves.includes(selected.id);

  return <div className="shell">
    <aside className="sidebar">
      <a href="/" className="brand" aria-label="SigmaCTF home"><span className="brand-mark">Σ</span><span>SIGMA<span className="green">CTF</span><small>CAPTURE THE FLAG</small></span></a>
      <div className="season"><span className="live-dot"/> THE ARENA IS YOURS <span>01</span></div>
      <nav aria-label="Main navigation">
        <p className="eyebrow">PLAYGROUND</p>
        <button className={tab==='challenges'?'nav-item active':'nav-item'} onClick={()=>setTab('challenges')}>
          <Flag size={18}/> Challenges <span className="nav-count">{catalog.length.toString().padStart(2,'0')}</span>
        </button>
        <button className={tab==='scoreboard'?'nav-item active':'nav-item'} onClick={()=>setTab('scoreboard')}>
          <Trophy size={18}/> Leaderboard <ChevronRight size={15}/>
        </button>
        {player?.is_admin&&<button className={tab==='admin'?'nav-item active':'nav-item'} onClick={()=>setTab('admin')}>
          <Shield size={18}/> Admin Hub <span className="admin-badge">ROOT</span>
        </button>}
      </nav>
      <div className="sidebar-note"><Terminal size={20}/><p>Less talk.<br/><strong>More flags.</strong></p><div className="mini-code">$ skill --issue<br/><span>command not found_</span></div></div>
      <div className="sidebar-bottom"><div className="status-line"><span className={error?'live-dot red':'live-dot'}/>{error?'API OFFLINE':'PRODUCTION ARENA'}</div><span className="muted">SIGMACTF / v2.0 PROD</span></div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumb">arena <span>/</span> <strong>{tab}</strong><span className="cursor">_</span></div>
        <div className="account">
          {player?<>
            <button className="team-chip" onClick={()=>setTeamOpen(true)} title="Manage Squad">
              <Users size={14}/> {player.team?player.team.name:'Solo (Join Squad)'}
            </button>
            <span className="aura-text">{player.aura} AURA</span>
            <span className="avatar">{player.username.slice(0,2).toUpperCase()}</span>
            <span className="username">{player.username}</span>
            <button className="icon-button" aria-label="Sign out" onClick={async()=>{try{await api('/auth/logout',{method:'POST',body:'{}'});setPlayer(null);setInstance(null);}catch(e){toast((e as Error).message);}}}><LogOut size={16}/></button>
          </>:<>
            <span className="guest-label">GUEST SESSION</span>
            <button className="small-button" onClick={signIn}>Enter the arena <ArrowUpRight size={15}/></button>
          </>}
        </div>
      </header>

      <main>
        {announcements.length>0&&<div className="announcement-bar">
          <Megaphone size={16}/><span className="badge">BROADCAST</span>
          <p><strong>{announcements[0].title}:</strong> {announcements[0].content}</p>
        </div>}

        {tab==='challenges'&&<>
          <div className="page-heading">
            <div>
              <div className="eyebrow green">// BREAK THINGS. BUILD AURA.</div>
              <h1>Choose your battleground.</h1>
              <p>Five disciplines. Zero hand-holding. Your next flag is waiting.</p>
            </div>
            <span className="outline-badge"><span className="live-dot"/> OPEN PRACTICE</span>
          </div>
          <div className="stats-grid">
            <div className="stat"><div><span>YOUR AURA</span><Flame size={17}/></div><strong className="purple">{player?.aura || 0}<small>AURA</small></strong><p>{player?'Your reputation, earned.':'Every sigma starts at zero.'}</p></div>
            <div className="stat"><div><span>FLAGS CAPTURED</span><Flag size={17}/></div><strong>{String(player?.solves.length || 0).padStart(2,'0')}<small>/ {String(catalog.length).padStart(2,'0')}</small></strong><div className="progress-track"><span style={{width:`${catalog.length?(player?.solves.length||0)/catalog.length*100:0}%`}}/></div></div>
            <div className="stat"><div><span>YOUR SANDBOX</span><Box size={17}/></div><strong className={current?'green':'muted'}>{current?'LIVE':'STANDBY'}<span className={current?'live-dot':'standby-dot'}/></strong><p>{current?<Countdown expires={current.expires_at}/>: 'Launch a challenge. Let it cook.'}</p></div>
          </div>
          <div className="catalog-toolbar">
            <div className="category-tabs" aria-label="Filter challenges">
              {categories.map(c=><button key={c} onClick={()=>setCategory(c)} aria-pressed={category===c} className={category===c?'selected':''}>{c}{c==='All challenges'&&<span>{catalog.length}</span>}</button>)}
            </div>
            <span className="results-count">{filtered.length} challenges</span>
          </div>
          {error?<div className="empty-state"><Terminal/><h2>The arena is offline.</h2><p>{error}</p><button className="small-button" onClick={()=>{setLoading(true);void refresh();}}>Retry connection <RotateCcw size={16}/></button></div>:loading?<div className="empty-state"><LoaderCircle className="spin"/><p>Loading the arena...</p></div>:<div className="challenge-grid">
            {filtered.map((c,index)=>{
              const Icon=icons[c.category]||Globe;const done=player?.solves.includes(c.id);const active=current?.challenge_id===c.id;
              return <button className={`challenge-card ${done?'solved-card':''}`} key={c.id} onClick={()=>choose(c)} aria-label={`Open ${c.name}`}>
                <div className="card-top">
                  <span className={`category-icon ${c.category.toLowerCase()}`}><Icon size={22}/></span>
                  <span className="tier">{c.tier==='Sigma Tier'&&<span className="gold">◆ </span>}{c.tier}</span>
                  <span className="card-number">/{String(index+1).padStart(2,'0')}</span>
                </div>
                <div className="category-label">{c.category.toUpperCase()} <span>•</span> {c.delivery==='static'?'FILE DOWNLOAD':c.delivery==='http'?'WEB INSTANCE':'TCP INSTANCE'}</div>
                <h2>{c.name}</h2>
                <p className="description">{c.description}</p>
                <div className="card-footer">
                  <strong className="purple">+{c.points} <span>Aura</span></strong>
                  <span>{done?<><Check size={14}/> Captured</>:active?<><span className="live-dot"/> Live</>:<>{c.solve_count} solves <ArrowUpRight size={17}/></>}</span>
                </div>
              </button>;
            })}
            <div className="manifesto-card"><div className="ascii-sigma">[ Σ ]</div><h2>Proof of skill.<br/>No proof of hype.</h2><p>Find the weakness.<br/>Capture the flag.<br/>Let the scoreboard talk.</p><span>STAY CURIOUS. STAY DANGEROUS.</span></div>
          </div>}
        </>}

        {tab==='scoreboard'&&<div className="scoreboard-panel">
          <div className="section-title">
            <Trophy size={18}/><h2>The Arena Leaderboard</h2>
            <div className="scoreboard-switch">
              <button className={boardMode==='players'?'active':''} onClick={()=>setBoardMode('players')}>Solo Hackers</button>
              <button className={boardMode==='teams'?'active':''} onClick={()=>setBoardMode('teams')}>Squads / Teams</button>
            </div>
            <span>LIVE / 15s</span>
          </div>
          {boardMode==='players'?(
            board.players.length?<div className="table-scroll"><table><thead><tr><th>RANK</th><th>PLAYER</th><th>FLAGS</th><th>AURA</th></tr></thead><tbody>{board.players.map((p,i)=><tr key={p.username} className={p.username===player?.username?'your-row':''}><td className={i===0?'gold':''}>{String(i+1).padStart(2,'0')}</td><td>{p.username}{i===0&&<Trophy className="gold" size={16}/>}</td><td>{p.solves}</td><td className="purple">{p.aura}</td></tr>)}</tbody></table></div>:<div className="empty-state"><Trophy className="gold"/><h2>The throne is empty.</h2><p>Capture a flag to claim the first spot.</p><button className="small-button" onClick={()=>setTab('challenges')}>Find a challenge <ArrowRight size={16}/></button></div>
          ):(
            board.teams?.length?<div className="table-scroll"><table><thead><tr><th>RANK</th><th>SQUAD</th><th>UNIQUE FLAGS</th><th>TEAM AURA</th></tr></thead><tbody>{board.teams.map((t,i)=><tr key={t.name} className={t.name===player?.team?.name?'your-row':''}><td className={i===0?'gold':''}>{String(i+1).padStart(2,'0')}</td><td>{t.name}{i===0&&<Trophy className="gold" size={16}/>}</td><td>{t.solves}</td><td className="purple">{t.aura}</td></tr>)}</tbody></table></div>:<div className="empty-state"><Users size={32}/><h2>No Squads On The Board</h2><p>Form a squad or capture flags to rank your team.</p></div>
          )}
        </div>}

        {tab==='admin'&&player?.is_admin&&<div className="admin-container">
          <div className="page-heading">
            <div>
              <div className="eyebrow green">// RESTRICTED ROOT AREA</div>
              <h1>Admin Operations Command</h1>
              <p>Manage challenges, oversee running sandboxes, inspect flag submissions, and publish broadcasts.</p>
            </div>
            <span className="outline-badge"><Shield size={14}/> SYSTEM ROOT</span>
          </div>

          <div className="admin-subnav">
            <button className={adminTab==='overview'?'active':''} onClick={()=>setAdminTab('overview')}><Activity size={15}/> Overview</button>
            <button className={adminTab==='challenges'?'active':''} onClick={()=>setAdminTab('challenges')}><Flag size={15}/> Challenges ({adminChallenges.length||catalog.length})</button>
            <button className={adminTab==='instances'?'active':''} onClick={()=>setAdminTab('instances')}><Box size={15}/> Live Sandboxes</button>
            <button className={adminTab==='submissions'?'active':''} onClick={()=>setAdminTab('submissions')}><Terminal size={15}/> Submissions Log</button>
            <button className={adminTab==='announcements'?'active':''} onClick={()=>setAdminTab('announcements')}><Megaphone size={15}/> Broadcasts</button>
            <button className={adminTab==='users'?'active':''} onClick={()=>setAdminTab('users')}><Users size={15}/> Users &amp; Roles</button>
          </div>

          {adminTab==='overview'&&<div className="admin-panel">
            <div className="admin-header-row"><h2>System Metrics</h2><button className="btn-action" onClick={loadAdminData}><RotateCcw size={14}/> Refresh</button></div>
            <div className="overview-metric-grid">
              <div className="overview-metric"><span>USERS <Users size={14}/></span><strong>{adminOverview?.users??'--'}</strong></div>
              <div className="overview-metric"><span>ACTIVE SANDBOXES <Box size={14}/></span><strong className="green">{adminOverview?.activeInstances??'--'}</strong></div>
              <div className="overview-metric"><span>SOLVES CAPTURED <Trophy size={14}/></span><strong className="purple">{adminOverview?.solves??'--'}</strong></div>
              <div className="overview-metric"><span>TOTAL CHALLENGES <Flag size={14}/></span><strong>{adminOverview?.challenges??'--'}</strong></div>
              <div className="overview-metric"><span>SUBMISSION ATTEMPTS <Terminal size={14}/></span><strong>{adminOverview?.submissions??'--'}</strong></div>
              <div className="overview-metric"><span>ACTIVE SQUADS <Users size={14}/></span><strong>{adminOverview?.teams??'--'}</strong></div>
            </div>
            <p className="muted" style={{font:'12px monospace'}}>Traefik Proxy: Operational • Isolation Engine: Strict • Janitor: Active (TTL 15m)</p>
          </div>}

          {adminTab==='challenges'&&<div className="admin-panel">
            <div className="admin-header-row">
              <h2>Challenge Catalog Management</h2>
              <button className="btn-action primary" onClick={()=>{setEditingChal(null);setChalModalOpen(true);}}><Plus size={15}/> Add Challenge</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>ID</th><th>NAME</th><th>CATEGORY</th><th>POINTS</th><th>DELIVERY</th><th>STATUS</th><th>ACTIONS</th></tr>
                </thead>
                <tbody>
                  {adminChallenges.map(c=><tr key={c.id}>
                    <td><code>{c.id}</code></td>
                    <td><strong>{c.name}</strong></td>
                    <td><span className="badge-pill purple">{c.category}</span></td>
                    <td className="purple">+{c.points}</td>
                    <td>{c.delivery.toUpperCase()}</td>
                    <td>{c.enabled!==false?<span className="badge-pill green"><CheckCircle2 size={12}/> ACTIVE</span>:<span className="badge-pill red"><XCircle size={12}/> DISABLED</span>}</td>
                    <td>
                      <div style={{display:'flex',gap:'6px',justifyContent:'flex-end'}}>
                        <button className="btn-action" onClick={()=>toggleChallenge(c.id)} title="Toggle Active">{c.enabled!==false?<EyeOff size={14}/>:<Eye size={14}/>}</button>
                        <button className="btn-action" onClick={()=>{setEditingChal(c);setChalModalOpen(true);}} title="Edit Challenge"><Edit3 size={14}/></button>
                        <button className="btn-action danger" onClick={()=>deleteChallenge(c.id)} title="Delete Challenge"><Trash2 size={14}/></button>
                      </div>
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </div>}

          {adminTab==='instances'&&<div className="admin-panel">
            <div className="admin-header-row">
              <h2>Live Sandbox Monitor</h2>
              <button className="btn-action" onClick={loadAdminData}><RotateCcw size={14}/> Refresh</button>
            </div>
            {adminInstances.length===0?<div className="empty-state"><Box size={28}/><h3>No Active Sandboxes</h3><p>Containers will appear here when players launch challenges.</p></div>:<div className="table-scroll">
              <table>
                <thead>
                  <tr><th>USER</th><th>CHALLENGE</th><th>ENDPOINT</th><th>EXPIRES IN</th><th>ACTION</th></tr>
                </thead>
                <tbody>
                  {adminInstances.map(inst=><tr key={inst.id}>
                    <td><strong>{inst.username}</strong></td>
                    <td>{inst.challenge_name||inst.challenge_id}</td>
                    <td><code>{inst.endpoint}</code></td>
                    <td><Countdown expires={inst.expires_at}/></td>
                    <td style={{textAlign:'right'}}>
                      <button className="btn-action danger" onClick={()=>forceKillInstance(inst.id)}><Power size={13}/> Force Kill</button>
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
          </div>}

          {adminTab==='submissions'&&<div className="admin-panel">
            <div className="admin-header-row">
              <h2>Submissions Audit Log (Last 100)</h2>
              <button className="btn-action" onClick={loadAdminData}><RotateCcw size={14}/> Refresh</button>
            </div>
            {adminSubmissions.length===0?<div className="empty-state"><Terminal size={28}/><h3>No Submissions Recorded</h3><p>Flag submission attempts will be logged here in real-time.</p></div>:<div className="table-scroll">
              <table>
                <thead>
                  <tr><th>TIME</th><th>PLAYER</th><th>CHALLENGE</th><th>SUBMITTED FLAG</th><th>RESULT</th></tr>
                </thead>
                <tbody>
                  {adminSubmissions.map(s=><tr key={s.id}>
                    <td style={{fontSize:'12px',color:'#8892a0'}}>{new Date(s.created_at).toLocaleTimeString()}</td>
                    <td><strong>{s.username}</strong></td>
                    <td>{s.challenge_name||s.challenge_id}</td>
                    <td><code>{s.submitted_flag}</code></td>
                    <td>{s.correct?<span className="badge-pill green">CORRECT</span>:<span className="badge-pill red">FAILED</span>}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
          </div>}

          {adminTab==='announcements'&&<div className="admin-panel">
            <div className="admin-header-row">
              <h2>Arena Broadcast Management</h2>
              <button className="btn-action primary" onClick={()=>setAnnModalOpen(true)}><Plus size={15}/> New Broadcast</button>
            </div>
            {adminAnnouncements.length===0?<div className="empty-state"><Megaphone size={28}/><h3>No Announcements</h3><p>Post updates or hints to all players in the arena.</p></div>:<div className="table-scroll">
              <table>
                <thead>
                  <tr><th>DATE</th><th>TITLE</th><th>CONTENT</th><th>STATUS</th><th>ACTIONS</th></tr>
                </thead>
                <tbody>
                  {adminAnnouncements.map(a=><tr key={a.id}>
                    <td style={{fontSize:'12px',color:'#8892a0'}}>{new Date(a.created_at).toLocaleDateString()}</td>
                    <td><strong>{a.title}</strong></td>
                    <td style={{maxWidth:'300px'}}>{a.content}</td>
                    <td>{a.is_active?<span className="badge-pill green">BROADCASTING</span>:<span className="badge-pill red">HIDDEN</span>}</td>
                    <td>
                      <div style={{display:'flex',gap:'6px',justifyContent:'flex-end'}}>
                        <button className="btn-action" onClick={()=>toggleAnnouncement(a.id)}>{a.is_active?<EyeOff size={14}/>:<Eye size={14}/>}</button>
                        <button className="btn-action danger" onClick={()=>deleteAnnouncement(a.id)}><Trash2 size={14}/></button>
                      </div>
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
          </div>}

          {adminTab==='users'&&<div className="admin-panel">
            <div className="admin-header-row">
              <h2>Player &amp; Role Management</h2>
              <button className="btn-action" onClick={loadAdminData}><RotateCcw size={14}/> Refresh</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>USER</th><th>SQUAD</th><th>SOLVES</th><th>AURA</th><th>ROLE</th><th>ACTION</th></tr>
                </thead>
                <tbody>
                  {adminUsers.map(u=><tr key={u.id}>
                    <td><strong>{u.username}</strong></td>
                    <td>{u.team_name||<span className="muted">Solo</span>}</td>
                    <td>{u.solves}</td>
                    <td className="purple">{u.aura}</td>
                    <td>{u.is_admin?<span className="badge-pill red">ADMIN</span>:<span className="badge-pill green">PLAYER</span>}</td>
                    <td style={{textAlign:'right'}}>
                      <button className={`btn-action ${u.is_admin?'danger':''}`} onClick={()=>toggleUserRole(u.id)}>
                        {u.is_admin?'Revoke Root':'Grant Root'}
                      </button>
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </div>}
        </div>}

        <div className="activity-bar">
          <span className="gold"><Flame size={16}/> FIRST BLOOD</span>
          {board.firstBloods.length?<p><strong>{board.firstBloods[0].username}</strong> claimed {board.firstBloods[0].name} <span className="gold">// GIGACHAD BLOOD 🩸</span></p>:<p>No first blood yet. <strong>Make the first move.</strong></p>}
          <button onClick={()=>setTab('scoreboard')} aria-label="View scoreboard"><ArrowUpRight size={18}/></button>
        </div>

        <footer>
          <span>BUILT FOR THE CURIOUS. OWN THE CHALLENGE.</span>
          <span><ShieldCheck size={14}/> ISOLATED SANDBOXES <span className="footer-divider">/</span> 15 MIN TTL</span>
        </footer>
      </main>
    </div>

    {/* Challenge Detail Modal */}
    <dialog ref={dialog} onCancel={()=>setSelected(null)} onClick={e=>{if(e.target===dialog.current)setSelected(null);}} aria-labelledby="challenge-title">
      {selected&&<div className="modal-content">
        <div className="modal-top">
          <span className="eyebrow green">{selected.category.toUpperCase()} / {selected.tier.toUpperCase()}</span>
          <button className="icon-button" onClick={()=>setSelected(null)} aria-label="Close challenge"><X size={20}/></button>
        </div>
        <h2 id="challenge-title">{selected.name}</h2>
        <div className="modal-meta"><span className="purple">+{selected.points} Aura</span><span>{selected.solve_count} solves</span></div>
        <p className="modal-description">{selected.description}</p>
        {selected.artifact&&<a className="download-button" href={`/api/challenges/${selected.id}/artifact`}><Download size={17}/> Download {selected.artifact}<ArrowUpRight size={16}/></a>}
        {selected.delivery!=='static'&&<div className="instance-box">
          {current?.challenge_id===selected.id?<>
            <div className="instance-title"><span className="green"><span className="live-dot"/> Cooked &amp; Live 🔥</span><button disabled={!!busy} className="text-button" onClick={stop}>Terminate</button></div>
            <div className="endpoint">
              {selected.delivery==='http'?<a href={current.endpoint} target="_blank" rel="noreferrer">Open challenge <ArrowUpRight size={16}/></a>:<code>{current.endpoint}</code>}
              <button aria-label="Copy connection" className="icon-button" onClick={async()=>{try{await navigator.clipboard.writeText(current.endpoint);toast('Connection copied.',true);}catch{toast('Copy unavailable. Select connection.');}}}><Copy size={16}/></button>
            </div>
            <div className="instance-clock"><Clock size={14}/><Countdown expires={current.expires_at}/></div>
          </>:<>
            <div className="sandbox-spec"><Box size={18}/><span>Private sandbox</span><span>15 minutes</span></div>
            {current&&<p className="replacement-note">Launching this challenge will terminate your current instance.</p>}
            <button className="primary-button" disabled={!!busy} onClick={spawn}>{busy==='spawn'?<><LoaderCircle size={18} className="spin"/> Cooking container...</>:<><Flame size={18}/> Let Him Cook <ArrowUpRight size={18}/></>}</button>
          </>}
        </div>}
        <form onSubmit={submit} className="flag-form">
          <label htmlFor="flag-input">{solved?'FLAG CAPTURED':'CAPTURE THE FLAG'}</label>
          <div className="flag-input-row">
            <Terminal size={18}/>
            <input id="flag-input" placeholder="sigma{your_flag_here}" value={flag} onChange={e=>setFlag(e.target.value)} required maxLength={256} disabled={!!solved} autoComplete="off"/>
            <button type="submit" disabled={!!busy||!!solved}>{solved?<Check size={18}/>:busy==='flag'?<LoaderCircle className="spin" size={18}/>:<ArrowRight size={18}/>}<span className="sr-only">Submit flag</span></button>
          </div>
          <p>{player?'5 checks per minute. Make them count.':'Sign in to launch instances and submit flags.'}</p>
        </form>
      </div>}
    </dialog>

    {/* Auth Modal */}
    <dialog ref={authDialog} onCancel={()=>setAuthOpen(false)} aria-labelledby="auth-title">
      <div className="modal-content">
        <div className="modal-top"><span className="eyebrow green">// IDENTIFY YOURSELF</span><button className="icon-button" onClick={()=>setAuthOpen(false)} aria-label="Close sign in"><X size={20}/></button></div>
        <h2 id="auth-title">{authMode==='register'?'Enter the arena.':'Welcome back.'}</h2>
        <p className="modal-description">Your handle. Your flags. Your Aura.</p>
        <form className="auth-form" onSubmit={authenticate}>
          <label htmlFor="username">HANDLE</label>
          <input id="username" name="username" required pattern="[A-Za-z0-9_]{3,24}" minLength={3} maxLength={24} autoComplete="username" placeholder="your_handle"/>
          <small>3–24 letters, numbers, or underscores.</small>
          <label htmlFor="password">PASSWORD</label>
          <input id="password" type="password" name="password" required minLength={12} maxLength={128} autoComplete={authMode==='register'?'new-password':'current-password'} placeholder="At least 12 characters"/>
          <button className="primary-button" disabled={!!busy}>{busy==='auth'?<LoaderCircle className="spin" size={18}/>:<>{authMode==='register'?'Create account':'Sign in'}<ArrowRight size={18}/></>}</button>
        </form>
        <button className="auth-switch" onClick={()=>setAuthMode(authMode==='register'?'login':'register')}>{authMode==='register'?'Already in the arena? Sign in':'New here? Create an account'}</button>
      </div>
    </dialog>

    {/* Squad / Team Modal */}
    <dialog ref={teamDialog} onCancel={()=>setTeamOpen(false)}>
      <div className="modal-content">
        <div className="modal-top"><span className="eyebrow green">// SQUAD OPERATIONS</span><button className="icon-button" onClick={()=>setTeamOpen(false)}><X size={20}/></button></div>
        {player?.team?<>
          <h2>Squad: {player.team.name}</h2>
          <p className="modal-description">Share your squad invite code with teammates to unite your Aura:</p>
          <div className="join-code-box">{player.team.join_code}</div>
          <div style={{margin:'20px 0'}}>
            <p className="eyebrow green">SQUAD MEMBERS</p>
            <ul style={{listStyle:'none',padding:0,font:'13px monospace'}}>
              {player.team.members?.map(m=><li key={m.id} style={{padding:'6px 0',borderBottom:'1px solid #202430',display:'flex',justifyContent:'space-between'}}>
                <span>{m.username}</span>{m.id===player.team?.created_by&&<span className="badge-pill gold">CAPTAIN</span>}
              </li>)}
            </ul>
          </div>
          <button className="btn-action danger" style={{width:'100%',justifyContent:'center'}} onClick={leaveTeam}>Leave Squad</button>
        </>:<>
          <h2>Team Up for Glory</h2>
          <p className="modal-description">Create a new squad or enter a team join code to compete together.</p>
          <form onSubmit={createTeam} style={{marginBottom:'24px'}}>
            <label className="eyebrow">CREATE SQUAD</label>
            <div style={{display:'flex',gap:'8px',marginTop:'8px'}}>
              <input name="name" required minLength={3} maxLength={32} placeholder="Squad Name (e.g. NeoHacks)" style={{flex:1,background:'#141620',border:'1px solid #333846',padding:'10px',color:'#fff',font:'13px monospace'}}/>
              <button type="submit" className="btn-action primary" disabled={!!busy}>Create</button>
            </div>
          </form>
          <form onSubmit={joinTeam}>
            <label className="eyebrow">JOIN EXISTING SQUAD</label>
            <div style={{display:'flex',gap:'8px',marginTop:'8px'}}>
              <input name="join_code" required minLength={4} maxLength={16} placeholder="6-character code" style={{flex:1,background:'#141620',border:'1px solid #333846',padding:'10px',color:'#fff',font:'13px monospace'}}/>
              <button type="submit" className="btn-action" disabled={!!busy}>Join</button>
            </div>
          </form>
        </>}
      </div>
    </dialog>

    {/* Add / Edit Challenge Modal */}
    <dialog ref={chalDialog} onCancel={()=>{setChalModalOpen(false);setEditingChal(null);}}>
      <div className="modal-content" style={{maxWidth:'650px'}}>
        <div className="modal-top">
          <span className="eyebrow green">// {editingChal?'EDIT CHALLENGE':'DEPLOY NEW CHALLENGE'}</span>
          <button className="icon-button" onClick={()=>{setChalModalOpen(false);setEditingChal(null);}}><X size={20}/></button>
        </div>
        <h2>{editingChal?editingChal.name:'New Arena Challenge'}</h2>
        <form onSubmit={saveChallenge}>
          <div className="grid-form">
            {!editingChal&&<div>
              <label>ID SLUG (e.g. web-admin-vault)</label>
              <input name="id" required pattern="^[a-z0-9-]+$" placeholder="unique-slug"/>
            </div>}
            <div>
              <label>CHALLENGE TITLE</label>
              <input name="name" required defaultValue={editingChal?.name||''} placeholder="The Forbidden Vault"/>
            </div>
            <div>
              <label>CATEGORY</label>
              <select name="category" defaultValue={editingChal?.category||'Web'}>
                {categories.filter(c=>c!=='All challenges').map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label>TIER</label>
              <select name="tier" defaultValue={editingChal?.tier||'NPC Tier'}>
                <option value="NPC Tier">NPC Tier</option>
                <option value="Sigma Tier">Sigma Tier</option>
                <option value="GigaChad Tier">GigaChad Tier</option>
              </select>
            </div>
            <div>
              <label>POINTS (AURA)</label>
              <input name="points" type="number" required min={10} max={1000} defaultValue={editingChal?.points||100}/>
            </div>
            <div>
              <label>DELIVERY TYPE</label>
              <select name="delivery" defaultValue={editingChal?.delivery||'http'}>
                <option value="http">HTTP (Web instance)</option>
                <option value="tcp">TCP (Pwn port)</option>
                <option value="static">Static (File download)</option>
              </select>
            </div>
            <div>
              <label>DOCKER IMAGE (e.g. mawin82560/challenge:v1)</label>
              <input name="image" defaultValue={editingChal?.image||''} placeholder="sigmactf/challenge:v1"/>
            </div>
            <div>
              <label>INTERNAL PORT (e.g. 8080)</label>
              <input name="port" type="number" defaultValue={editingChal?.port||8080}/>
            </div>
            <div>
              <label>ARTIFACT FILENAME (if static/binary)</label>
              <input name="artifact" defaultValue={editingChal?.artifact||''} placeholder="challenge.zip"/>
            </div>
            <div className="full">
              <label>PLAINTEXT FLAG (will be HMAC hashed)</label>
              <input name="flag" placeholder={editingChal?'Leave blank to keep existing flag':'sigma{your_secret_flag}'}/>
            </div>
            <div className="full">
              <label>CHALLENGE DESCRIPTION</label>
              <textarea name="description" required defaultValue={editingChal?.description||''} placeholder="Describe the mission and rules."/>
            </div>
            <div className="full" style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <input type="checkbox" name="enabled" id="enabled-toggle" defaultChecked={editingChal?.enabled!==false} style={{width:'auto'}}/>
              <label htmlFor="enabled-toggle" style={{margin:0}}>Enable challenge immediately upon saving</label>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-action" onClick={()=>{setChalModalOpen(false);setEditingChal(null);}}>Cancel</button>
            <button type="submit" className="btn-action primary" disabled={!!busy}>Save Challenge</button>
          </div>
        </form>
      </div>
    </dialog>

    {/* New Announcement Modal */}
    <dialog ref={annDialog} onCancel={()=>setAnnModalOpen(false)}>
      <div className="modal-content">
        <div className="modal-top"><span className="eyebrow green">// DISPATCH BROADCAST</span><button className="icon-button" onClick={()=>setAnnModalOpen(false)}><X size={20}/></button></div>
        <h2>New Arena Broadcast</h2>
        <form onSubmit={saveAnnouncement}>
          <div style={{margin:'15px 0'}}>
            <label className="eyebrow">TITLE / TOPIC</label>
            <input name="title" required placeholder="HINT RELEASED / SYSTEM NOTICE" style={{width:'100%',background:'#141620',border:'1px solid #333846',padding:'10px',color:'#fff',font:'13px monospace',marginTop:'6px'}}/>
          </div>
          <div style={{margin:'15px 0'}}>
            <label className="eyebrow">BROADCAST MESSAGE</label>
            <textarea name="content" required placeholder="Attention all sigmas..." style={{width:'100%',background:'#141620',border:'1px solid #333846',padding:'10px',color:'#fff',font:'13px monospace',minHeight:'80px',marginTop:'6px'}}/>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-action" onClick={()=>setAnnModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn-action primary" disabled={!!busy}>Publish Broadcast</button>
          </div>
        </form>
      </div>
    </dialog>

    {/* Toast Notifications */}
    {notice&&<div className={`toast ${notice.good?'good':'bad'}`} role="status">
      <span>{notice.good?<Check size={18}/>:<Terminal size={18}/>}</span>
      <p>{notice.text}</p>
      <button aria-label="Dismiss notification" onClick={()=>setNotice(null)}><X size={16}/></button>
    </div>}
  </div>;
}
