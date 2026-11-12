(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const STORAGE = "minhaColecao.v1";
  const CONFIG = "minhaColecao.config.v1";
  const emptyData = () => ({version:1,items:[],settings:{apiKeys:{tmdbKey:"",omdbKey:""},updatedAt:null},updatedAt:new Date().toISOString()});
  let data = loadLocal();
  let activeKind = "movie";
  let addKind = "movie";
  let selectedSearch = null;
  let toastTimer;
  let syncInProgress = false;
  let syncTimer;

  function loadLocal(){try{const stored=JSON.parse(localStorage.getItem(STORAGE)||"{}");return {...emptyData(),...stored,settings:{...emptyData().settings,...(stored.settings||{}),apiKeys:{...emptyData().settings.apiKeys,...(stored.settings?.apiKeys||{})}}}}catch{return emptyData()}}
  function saveLocal(){data.updatedAt=new Date().toISOString();localStorage.setItem(STORAGE,JSON.stringify(data));render();const c=getConfig();if(c.owner&&c.repo&&c.token){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncGitHub(false),1800)}}
  function getConfig(){try{return JSON.parse(localStorage.getItem(CONFIG)||"{}")}catch{return {}}}
  function setConfig(v){localStorage.setItem(CONFIG,JSON.stringify(v))}
  function uid(){return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`}
  function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
  function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2800)}
  function setSyncState(state,label){const el=$("#sync-indicator");el.className="sync-indicator "+state;el.querySelector("span").textContent=label}
  function posterUrl(path){return path?`https://image.tmdb.org/t/p/w500${path}`:""}
  function getItems(){const q=$("#search-input").value.trim().toLocaleLowerCase("pt-BR"),status=$("#status-filter").value,sort=$("#sort-select").value;
    let list=data.items.filter(x=>x.kind===activeKind);
    if(q)list=list.filter(x=>`${x.title} ${x.year||""}`.toLocaleLowerCase("pt-BR").includes(q));
    if(status==="watched")list=list.filter(x=>x.watched);if(status==="pending")list=list.filter(x=>!x.watched);
    list.sort((a,b)=>sort==="title"?a.title.localeCompare(b.title,"pt-BR"):sort==="imdb"?(Number(b.imdb)||0)-(Number(a.imdb)||0):sort==="myRating"?(b.myRating||0)-(a.myRating||0):sort==="year"?(b.year||0)-(a.year||0):new Date(b.createdAt)-new Date(a.createdAt));
    return list;
  }
  function stars(item){return `<div class="stars" aria-label="Minha avaliação: ${item.myRating||0} de 5">${[1,2,3,4,5].map(n=>`<button class="star ${n<=(item.myRating||0)?"filled":""}" data-rate="${n}" data-id="${item.id}" aria-label="Avaliar com ${n} estrelas">★</button>`).join("")}<span class="stars-label">${item.myRating?`${item.myRating}/5`:"Sua nota"}</span></div>`}
  function card(item){const poster=item.poster?`<img class="poster" src="${escapeHtml(item.poster)}" alt="Pôster de ${escapeHtml(item.title)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="poster-placeholder">${escapeHtml(item.title.slice(0,1).toUpperCase())}</div>`;
    return `<article class="media-card" data-card="${item.id}"><div class="poster-wrap" data-open="${item.id}">${poster}<span class="imdb-badge"><b>IMDb</b> ${item.imdb?Number(item.imdb).toFixed(1):"—"}</span>${item.watched?'<span class="watched-ribbon">✓ ASSISTIDO</span>':""}<button class="card-menu" data-menu="${item.id}" aria-label="Opções de ${escapeHtml(item.title)}">⋯</button></div><div class="media-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div><div class="media-meta">${item.year||"Ano não informado"}</div>${stars(item)}</article>`;
  }
  function render(){const list=getItems();$("#collection-grid").innerHTML=list.map(card).join("");$("#empty-state").classList.toggle("visible",list.length===0);$("#movie-count").textContent=data.items.filter(x=>x.kind==="movie").length;$("#series-count").textContent=data.items.filter(x=>x.kind==="tv").length;$("#watched-count").textContent=data.items.filter(x=>x.watched).length;$("#tab-movie-count").textContent=data.items.filter(x=>x.kind==="movie").length;$("#tab-tv-count").textContent=data.items.filter(x=>x.kind==="tv").length;$$(".tab").forEach(b=>{const active=b.dataset.kind===activeKind;b.classList.toggle("active",active);b.setAttribute("aria-selected",String(active))})}
  function addItem(item){if(data.items.some(x=>x.kind===item.kind&&x.title.toLowerCase()===item.title.toLowerCase()&&String(x.year||"")===String(item.year||""))){toast("Esse título já está na sua lista.");return}
    const now=new Date().toISOString();data.items.push({id:uid(),kind:item.kind,title:item.title,year:item.year||null,poster:item.poster||"",imdb:item.imdb||null,imdbId:item.imdbId||"",imdbCheckedAt:item.imdbCheckedAt||null,imdbSource:item.imdbSource||"",tmdbId:item.tmdbId||null,watched:false,myRating:0,createdAt:now,updatedAt:now});saveLocal();$("#add-dialog").close();$("#add-form").reset();$("#search-results").innerHTML="";selectedSearch=null;toast("Título adicionado à sua biblioteca.");}
  function openDetail(id){const item=data.items.find(x=>x.id===id);if(!item)return;const poster=item.poster?`<img class="detail-poster" src="${escapeHtml(item.poster)}" alt="">`:`<div class="detail-poster poster-placeholder">${escapeHtml(item.title[0])}</div>`;
    $("#detail-content").innerHTML=`<div class="detail-layout">${poster}<div class="detail-info"><p class="eyebrow">${item.kind==="movie"?"FILME":"SÉRIE"} · ${item.watched?"ASSISTIDO":"QUERO ASSISTIR"}</p><h2>${escapeHtml(item.title)}</h2><p>${item.year||"Ano não informado"}</p><div class="detail-rating">★ IMDb ${item.imdb?Number(item.imdb).toFixed(1):"Sem nota"}</div><p>Minha avaliação</p><div class="detail-stars">${[1,2,3,4,5].map(n=>`<button class="star ${n<=(item.myRating||0)?"filled":""}" data-detail-rate="${n}" data-id="${item.id}" aria-label="${n} estrelas">★</button>`).join("")}</div><div class="detail-actions"><button class="secondary-button" data-toggle-watched="${item.id}">${item.watched?"↶ Marcar como não assistido":"✓ Marcar como assistido"}</button><button class="secondary-button" data-edit="${item.id}">Editar</button><button class="secondary-button" data-delete="${item.id}">Excluir</button></div></div></div>`;
    $("#detail-dialog").showModal();}
  function updateItem(id,patch){const i=data.items.findIndex(x=>x.id===id);if(i<0)return;data.items[i]={...data.items[i],...patch,updatedAt:new Date().toISOString()};saveLocal();openDetail(id)}
  async function searchTitles(){const cfg=getConfig(),key=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey,query=$("#title-search").value.trim();$("#add-error").textContent="";$("#search-results").innerHTML="";
    if(!query){$("#add-error").textContent="Digite o nome de um título.";return}if(!key){$("#add-error").textContent="Configure sua chave API do TMDB em Ajustes ou use o cadastro manual.";return}
    $("#search-title-button").disabled=true;$("#search-title-button").textContent="Buscando...";
    try{const endpoint=addKind==="movie"?"movie":"tv";const url=`https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(key)}&language=pt-BR&query=${encodeURIComponent(query)}&include_adult=false`;const res=await fetch(url);if(!res.ok)throw new Error(res.status===401?"Chave TMDB inválida.":"Não foi possível consultar o TMDB.");const json=await res.json();const results=(json.results||[]).slice(0,8);
      if(!results.length){$("#search-results").innerHTML='<p class="field-hint">Nenhum resultado encontrado. Tente outro nome ou cadastre manualmente.</p>';return}
      const resolved=results.map(r=>({kind:addKind,title:addKind==="movie"?(r.title||r.original_title):(r.name||r.original_name),year:(r.release_date||r.first_air_date||"").slice(0,4),poster:posterUrl(r.poster_path),imdb:"",imdbId:"",tmdbId:r.id}));
      $("#search-results").innerHTML=resolved.map((r,i)=>`<button type="button" class="result-item" data-result="${i}">${r.poster?`<img src="${escapeHtml(r.poster)}" alt="">`:'<span class="result-thumb"></span>'}<span><strong>${escapeHtml(r.title)}</strong><small>${r.year||"Ano desconhecido"} · selecionar para consultar nota IMDb</small></span><span class="result-add">＋</span></button>`).join("");$("#search-results")._results=resolved;
    }catch(e){$("#add-error").textContent=e.message||"Erro na busca."}finally{$("#search-title-button").disabled=false;$("#search-title-button").textContent="Buscar"}}
  async function tmdbExternalId(key,kind,id){try{const r=await fetch(`https://api.themoviedb.org/3/${kind}/${id}/external_ids?api_key=${encodeURIComponent(key)}`);if(!r.ok)return "";const j=await r.json();return j.imdb_id||""}catch{return""}}
  async function selectSearchResult(button,index){const result=$("#search-results")._results?.[index];if(!result)return;button.disabled=true;button.querySelector(".result-add").textContent="…";const cfg=getConfig(),tmdbKey=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey,omdbKey=cfg.omdbKey||data.settings?.apiKeys?.omdbKey;let imdbId="",imdb="",checkedAt=null;
    try{if(omdbKey&&tmdbKey){imdbId=await tmdbExternalId(tmdbKey,result.kind,result.tmdbId);if(imdbId){const response=await fetch(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(omdbKey)}`);if(response.ok){const omdb=await response.json();if(omdb.Response==="True"&&omdb.imdbRating&&omdb.imdbRating!=="N/A")imdb=omdb.imdbRating;checkedAt=new Date().toISOString()}}}
      addItem({...result,imdb,imdbId,imdbCheckedAt:checkedAt,imdbSource:imdb?"OMDb":""});
    }catch(e){addItem({...result,imdb,imdbId,imdbCheckedAt:checkedAt,imdbSource:imdb?"OMDb":""});toast("Título adicionado. Não foi possível consultar a nota IMDb agora.")}
  }
  function openAdd(){selectedSearch=null;$("#add-error").textContent="";$("#search-results").innerHTML="";$("#add-dialog").showModal();$("#title-search").focus()}
  function fillSettings(){const c=getConfig();$("#gh-owner").value=c.owner||"";$("#gh-repo").value=c.repo||"";$("#gh-branch").value=c.branch||"main";$("#gh-path").value=c.path||"data.json";$("#gh-token").value=c.token||"";$("#tmdb-key").value=c.tmdbKey||data.settings?.apiKeys?.tmdbKey||"";$("#omdb-key").value=c.omdbKey||data.settings?.apiKeys?.omdbKey||"";setSyncState(c.owner&&c.repo&&c.token?"connected":"",c.owner&&c.repo&&c.token?"GitHub configurado":"Somente neste dispositivo")}
  function saveSettings(){const c=getConfig();Object.assign(c,{owner:$("#gh-owner").value.trim(),repo:$("#gh-repo").value.trim(),branch:$("#gh-branch").value.trim()||"main",path:$("#gh-path").value.trim()||"data.json",token:$("#gh-token").value.trim()});setConfig(c);setSyncState(c.owner&&c.repo&&c.token?"connected":"",c.owner&&c.repo&&c.token?"GitHub configurado":"Somente neste dispositivo");toast("Configurações do GitHub salvas neste dispositivo.");}
  function saveApiKeys(){const c=getConfig();c.tmdbKey=$("#tmdb-key").value.trim();c.omdbKey=$("#omdb-key").value.trim();setConfig(c);data.settings={...(data.settings||{}),apiKeys:{tmdbKey:c.tmdbKey,omdbKey:c.omdbKey},updatedAt:new Date().toISOString()};saveLocal();toast(c.owner&&c.repo&&c.token?"Chaves salvas. Sincronizando com o repositório privado…":"Chaves salvas neste dispositivo. Configure o GitHub para sincronizá-las.");}
  function ghHeaders(token){return {"Authorization":`Bearer ${token}`,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}}
  function b64encode(str){const bytes=new TextEncoder().encode(str);let binary="";bytes.forEach(b=>binary+=String.fromCharCode(b));return btoa(binary)}
  function b64decode(b64){const binary=atob(b64.replace(/\n/g,""));const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return new TextDecoder().decode(bytes)}
  async function remoteRead(c){
    const path=c.path.split("/").map(encodeURIComponent).join("/");
    const url=`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}?ref=${encodeURIComponent(c.branch)}&nocache=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const r=await fetch(url,{method:"GET",headers:{...ghHeaders(c.token),"Cache-Control":"no-cache","Pragma":"no-cache"},cache:"no-store"});
    if(r.status===404)return {data:emptyData(),sha:null};
    if(!r.ok){const detail=await r.json().catch(()=>({}));throw new Error(`Falha ao ler data.json (GitHub ${r.status}): ${detail.message||"verifique repositório, branch e permissões."}`)}
    const j=await r.json();
    if(!j.sha||!j.content)throw new Error("O GitHub não retornou o SHA ou o conteúdo de data.json.");
    return {data:JSON.parse(b64decode(j.content)),sha:j.sha};
  }
  function mergeData(local,remote){const map=new Map();[...(remote.items||[]),...(local.items||[])].forEach(item=>{const old=map.get(item.id);if(!old||new Date(item.updatedAt||item.createdAt||0)>=new Date(old.updatedAt||old.createdAt||0))map.set(item.id,item)});const deleted=new Map();[...(remote.deleted||[]),...(local.deleted||[])].forEach(entry=>{const old=deleted.get(entry.id);if(!old||new Date(entry.deletedAt)>new Date(old.deletedAt))deleted.set(entry.id,entry)});for(const [id,entry] of deleted){const item=map.get(id);if(item&&new Date(entry.deletedAt)>=new Date(item.updatedAt||item.createdAt||0))map.delete(id)}
    const ls=local.settings||{},rs=remote.settings||{},localKeys=ls.apiKeys||{},remoteKeys=rs.apiKeys||{};const localHas=!!(localKeys.tmdbKey||localKeys.omdbKey),remoteHas=!!(remoteKeys.tmdbKey||remoteKeys.omdbKey);let chosen;
    if(localHas&&remoteHas)chosen=new Date(ls.updatedAt||0)>=new Date(rs.updatedAt||0)?ls:rs;else if(localHas)chosen=ls;else if(remoteHas)chosen=rs;else chosen=new Date(ls.updatedAt||0)>=new Date(rs.updatedAt||0)?ls:rs;
    return {version:1,items:[...map.values()],deleted:[...deleted.values()],settings:{apiKeys:{tmdbKey:chosen?.apiKeys?.tmdbKey||"",omdbKey:chosen?.apiKeys?.omdbKey||""},updatedAt:chosen?.updatedAt||null},updatedAt:new Date().toISOString()}}
  async function remoteWrite(c,payload,sha){
    const path=c.path.split("/").map(encodeURIComponent).join("/");
    const url=`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}`;
    const body={message:"Atualiza biblioteca pessoal",content:b64encode(JSON.stringify(payload,null,2)),branch:c.branch};
    if(sha)body.sha=sha;
    const r=await fetch(url,{method:"PUT",headers:{...ghHeaders(c.token),"Content-Type":"application/json","Cache-Control":"no-cache"},cache:"no-store",body:JSON.stringify(body)});
    if(!r.ok){const j=await r.json().catch(()=>({}));const error=new Error(`GitHub ${r.status}: ${j.message||`Falha ao gravar no GitHub (${r.status}).`}`);error.status=r.status;throw error}
    return r.json();
  }
  function validateGitHub(c){if(!c.owner||!c.repo||!c.token)throw new Error("Preencha usuário, repositório privado e token nas configurações.");}
  function isShaConflict(error){
    const message=String(error?.message||error||"");
    return error?.status===409 || error?.status===422 || /sha|409|422|does not match|already exists|must be a blob|reference update failed/i.test(message);
  }
  function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
  async function writeWithShaRetry(c, initialPayload){
    let payload=initialPayload;
    let lastError=null;
    for(let attempt=0;attempt<12;attempt++){
      const latest=await remoteRead(c);
      payload=mergeData(payload,latest.data);
      try{
        await remoteWrite(c,payload,latest.sha);
        return payload;
      }catch(error){
        lastError=error;
        if(!isShaConflict(error)||attempt===11)throw error;
        await wait(Math.min(8000,700*(attempt+1))+Math.floor(Math.random()*400));
      }
    }
    throw lastError||new Error("Não foi possível atualizar data.json após várias tentativas.");
  }
  async function syncGitHub(testOnly=false){
    if(syncInProgress){toast("Já existe uma sincronização em andamento.");return}
    syncInProgress=true;
    const c=getConfig();
    try{
      validateGitHub(c);
      setSyncState("busy","Conectando ao GitHub...");
      $("#sync-message").textContent="Conectando...";
      const initialRemote=await remoteRead(c);
      if(testOnly){
        setSyncState("connected","GitHub conectado");
        $("#sync-message").textContent="Conexão e leitura funcionando.";
        toast("Conexão com o GitHub validada.");
        return;
      }
      const legacyKeys={tmdbKey:c.tmdbKey||"",omdbKey:c.omdbKey||""};
      if((legacyKeys.tmdbKey||legacyKeys.omdbKey)&&!data.settings?.updatedAt){
        data.settings={apiKeys:legacyKeys,updatedAt:new Date().toISOString()};
      }
      const initialMerged=mergeData(data,initialRemote.data);
      const merged=await writeWithShaRetry(c,initialMerged);
      data=merged;
      localStorage.setItem(STORAGE,JSON.stringify(data));
      const updatedConfig=getConfig();
      updatedConfig.tmdbKey=data.settings?.apiKeys?.tmdbKey||"";
      updatedConfig.omdbKey=data.settings?.apiKeys?.omdbKey||"";
      setConfig(updatedConfig);
      if($("#tmdb-key"))$("#tmdb-key").value=updatedConfig.tmdbKey;
      if($("#omdb-key"))$("#omdb-key").value=updatedConfig.omdbKey;
      render();
      setSyncState("connected","Sincronizado com GitHub");
      $("#sync-message").textContent=`Sincronizado em ${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}.`;
      toast("Biblioteca sincronizada com o GitHub.");
    }catch(e){
      setSyncState("","Falha na sincronização");
      $("#sync-message").textContent=e.message;
      toast(e.message);
    }finally{
      syncInProgress=false;
    }
  }
  function exportData(){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="minha-colecao-backup.json";a.click();URL.revokeObjectURL(a.href)}
  async function importData(file){try{const parsed=JSON.parse(await file.text());if(!Array.isArray(parsed.items))throw new Error("Arquivo não parece ser um backup válido.");data=mergeData(data,parsed);saveLocal();toast("Backup importado.");}catch(e){toast(e.message)}}
  function events(){
    $("#add-open").onclick=openAdd;$("#empty-add").onclick=openAdd;$("#settings-open").onclick=()=>{fillSettings();$("#settings-dialog").showModal()};
    $$(".close-dialog").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));$("#cancel-add").onclick=()=>$("#add-dialog").close();
    $$(".tab").forEach(b=>b.onclick=()=>{activeKind=b.dataset.kind;render()});
    $("#search-input").oninput=render;$("#status-filter").onchange=render;$("#sort-select").onchange=render;
    $$(".kind-choice").forEach(b=>b.onclick=()=>{$$(".kind-choice").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");addKind=b.dataset.addKind});
    $("#search-title-button").onclick=searchTitles;$("#title-search").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchTitles()}});
    $("#search-results").addEventListener("click",e=>{const b=e.target.closest("[data-result]");if(!b)return;selectSearchResult(b,Number(b.dataset.result))});
    $("#add-form").addEventListener("submit",e=>{e.preventDefault();const title=$("#manual-title").value.trim();if(!title){$("#add-error").textContent="Informe o título.";return}addItem({kind:addKind,title,year:Number($("#manual-year").value)||null,imdb:Number($("#manual-imdb").value)||null,imdbSource:$("#manual-imdb").value.trim()?"manual":"",poster:$("#manual-poster").value.trim()})});
    $("#collection-grid").addEventListener("click",e=>{const rate=e.target.closest("[data-rate]");if(rate){const item=data.items.find(x=>x.id===rate.dataset.id);if(item){item.myRating=Number(rate.dataset.rate);item.updatedAt=new Date().toISOString();saveLocal()}return}const menu=e.target.closest("[data-menu]");if(menu){openDetail(menu.dataset.menu);return}const open=e.target.closest("[data-open]");if(open)openDetail(open.dataset.open)});
    $("#detail-content").addEventListener("click",e=>{const rate=e.target.closest("[data-detail-rate]");if(rate){updateItem(rate.dataset.id,{myRating:Number(rate.dataset.detailRate)});return}const toggle=e.target.closest("[data-toggle-watched]");if(toggle){const item=data.items.find(x=>x.id===toggle.dataset.toggleWatched);if(item)updateItem(item.id,{watched:!item.watched});toast(item?.watched?"Marcado como não assistido.":"Marcado como assistido.");return}const del=e.target.closest("[data-delete]");if(del){if(confirm("Excluir este título da sua biblioteca?")){data.deleted=data.deleted||[];data.deleted.push({id:del.dataset.delete,deletedAt:new Date().toISOString()});data.items=data.items.filter(x=>x.id!==del.dataset.delete);saveLocal();$("#detail-dialog").close();toast("Título excluído.")}return}const edit=e.target.closest("[data-edit]");if(edit){const item=data.items.find(x=>x.id===edit.dataset.edit);if(!item)return;const title=prompt("Título:",item.title);if(title===null)return;const year=prompt("Ano:",item.year||"");if(year===null)return;const imdb=prompt("Nota IMDb (0 a 10):",item.imdb||"");if(imdb===null)return;const poster=prompt("URL da capa:",item.poster||"");if(poster===null)return;updateItem(item.id,{title:title.trim()||item.title,year:Number(year)||null,imdb:Number(imdb)||null,poster});toast("Título atualizado.")}});
    $("#save-settings").onclick=saveSettings;$("#save-api-keys").onclick=saveApiKeys;$("#test-sync").onclick=()=>{saveSettings();syncGitHub(true)};$("#sync-now").onclick=()=>{saveSettings();syncGitHub(false)};$("#export-data").onclick=exportData;$("#import-data").onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);e.target.value=""};
    $("#settings-form").addEventListener("submit",e=>e.preventDefault());$("#detail-form").addEventListener("submit",e=>e.preventDefault());
  }
  events();render();
  if("serviceWorker"in navigator&&location.protocol!=="file:")window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  const cfg=getConfig();if(cfg.owner&&cfg.repo&&cfg.token){setSyncState("connected","GitHub configurado");syncGitHub(false)}
})();