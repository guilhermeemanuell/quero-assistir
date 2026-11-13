(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const STORAGE = "minhaColecao.v1";
  const CONFIG = "minhaColecao.config.v1";
  const emptyData = () => ({version:1,items:[],settings:{apiKeys:{tmdbKey:"",omdbKey:""},updatedAt:null},updatedAt:new Date().toISOString()});
  let data = loadLocal();
  let activeView = "movie"; // "movie" | "tv" | "watched"
  let selectedSearch = new Map();
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

  function getItems(){
    const q=$("#search-input").value.trim().toLocaleLowerCase("pt-BR");
    const sort=$("#sort-select").value;
    let list;
    if(activeView==="watched"){
      list=data.items.filter(x=>x.watched);
    }else{
      list=data.items.filter(x=>!x.watched && x.kind===activeView);
    }
    if(q)list=list.filter(x=>`${x.title} ${x.year||""}`.toLocaleLowerCase("pt-BR").includes(q));
    list.sort((a,b)=>sort==="title"?a.title.localeCompare(b.title,"pt-BR"):sort==="imdb"?(Number(b.imdb)||0)-(Number(a.imdb)||0):sort==="myRating"?(b.myRating||0)-(a.myRating||0):sort==="year"?(b.year||0)-(a.year||0):new Date(b.createdAt)-new Date(a.createdAt));
    return list;
  }

  function stars(item){
    const current=item.myRating||0;
    return `<div class="stars" aria-label="Minha avaliação: ${current} de 5">${[1,2,3,4,5].map(n=>`<button class="star ${n<=current?"filled":""}" data-rate="${n}" data-id="${item.id}" aria-label="${n===current?"Remover avaliação":`Avaliar com ${n} estrelas`}">★</button>`).join("")}<span class="stars-label">${current?`${current}/5`:"Sua nota"}</span></div>`;
  }

  function card(item){
    const poster=item.poster?`<img class="poster" src="${escapeHtml(item.poster)}" alt="Pôster de ${escapeHtml(item.title)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="poster-placeholder">${escapeHtml(item.title.slice(0,1).toUpperCase())}</div>`;
    const kindBadge=activeView==="watched"?` · ${item.kind==="movie"?"Filme":"Série"}`:"";
    return `<article class="media-card" data-card="${item.id}"><div class="poster-wrap" data-open="${item.id}">${poster}<span class="imdb-badge"><b>IMDb</b> ${item.imdb?Number(item.imdb).toFixed(1):"—"}</span>${item.watched?'<span class="watched-ribbon">✓ ASSISTIDO</span>':""}<button class="card-menu" data-menu="${item.id}" aria-label="Opções de ${escapeHtml(item.title)}">⋯</button></div><div class="media-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div><div class="media-meta">${item.year||"Ano não informado"}${kindBadge}</div>${stars(item)}</article>`;
  }

  function render(){
    const list=getItems();
    const pendingMovies=data.items.filter(x=>!x.watched && x.kind==="movie").length;
    const pendingSeries=data.items.filter(x=>!x.watched && x.kind==="tv").length;
    const watchedTotal=data.items.filter(x=>x.watched).length;

    $("#collection-grid").innerHTML=list.map(card).join("");
    $("#movie-count").textContent=pendingMovies;
    $("#series-count").textContent=pendingSeries;
    $("#watched-count").textContent=watchedTotal;
    $("#tab-movie-count").textContent=pendingMovies;
    $("#tab-tv-count").textContent=pendingSeries;

    const isWatched=activeView==="watched";
    $("#library-eyebrow").textContent=isWatched?"HISTÓRICO DE ASSISTIDOS":"EXPLORE SUA LISTA";
    $("#library-title").textContent=isWatched?"Já assisti":"Minha biblioteca";

    $$(".tab").forEach(b=>{
      const active=b.dataset.kind===activeView;
      b.classList.toggle("active",active);
      b.setAttribute("aria-selected",String(active));
    });
    $$(".stat-action").forEach(b=>{
      b.classList.toggle("active-stat",b.dataset.statFilter===activeView);
    });

    $("#empty-state").classList.toggle("visible",list.length===0);
    if(list.length===0){
      if(isWatched){
        $("#empty-title").textContent="Nenhum título assistido ainda";
        $("#empty-copy").textContent="Quando você marcar um filme ou série como assistido, ele aparecerá aqui.";
        $("#empty-add").hidden=true;
      }else{
        $("#empty-title").textContent="Sua próxima maratona começa aqui";
        $("#empty-copy").textContent="Adicione filmes e séries que você quer assistir. Eles ficarão organizados nesta biblioteca.";
        $("#empty-add").hidden=false;
      }
    }
  }

  function applyStatFilter(filter, scroll=true){
    $("#search-input").value="";
    activeView=filter;
    render();
    if(scroll)$("#library-section")?.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function isAlreadyAdded(item){return data.items.some(x=>x.kind===item.kind&&x.title.toLowerCase()===item.title.toLowerCase()&&String(x.year||"")===String(item.year||""))}
  function addItem(item,{keepDialog=false,silent=false}={}){if(isAlreadyAdded(item)){if(!silent)toast("Esse título já está na sua lista.");return false}
    const now=new Date().toISOString();data.items.push({id:uid(),kind:item.kind,title:item.title,year:item.year||null,poster:item.poster||"",overview:item.overview||"",overviewLanguage:item.overviewLanguage||"",overviewCheckedAt:item.overviewCheckedAt||null,providers:item.providers||[],studio:item.studio||"",metaCheckedAt:item.metaCheckedAt||null,imdb:item.imdb||null,imdbId:item.imdbId||"",imdbCheckedAt:item.imdbCheckedAt||null,imdbSource:item.imdbSource||"",tmdbId:item.tmdbId||null,watched:false,myRating:0,createdAt:now,updatedAt:now});saveLocal();if(!keepDialog){selectedSearch.clear()}if(!silent)toast("Título adicionado à sua biblioteca.");return true;}

  function renderWhereToWatch(item){
    const providers=Array.isArray(item.providers)?item.providers:[];
    if(providers.length){
      return `<p class="detail-provider"><strong>Onde assistir:</strong> ${escapeHtml(providers.join(", "))}</p>`;
    }
    if(item.studio){
      return `<p class="detail-provider"><strong>Produtora:</strong> ${escapeHtml(item.studio)}</p>`;
    }
    if(item.tmdbId && !item.metaCheckedAt){
      return `<p class="detail-provider detail-provider-muted">Buscando onde assistir…</p>`;
    }
    return "";
  }

  function renderDetail(item){
    const poster=item.poster?`<img class="detail-poster" src="${escapeHtml(item.poster)}" alt="Pôster de ${escapeHtml(item.title)}">`:`<div class="detail-poster poster-placeholder">${escapeHtml(item.title[0])}</div>`;
    const synopsis=item.overview?`<section class="detail-synopsis"><h3>Sinopse</h3><p>${escapeHtml(item.overview)}</p>${item.overviewLanguage&&item.overviewLanguage!=="pt-BR"?'<small class="synopsis-note">Sinopse no idioma disponível no TMDB.</small>':""}</section>`:`<section class="detail-synopsis"><h3>Sinopse</h3><p class="synopsis-muted">${item.tmdbId?"Carregando sinopse…":"Sinopse não disponível para este cadastro."}</p></section>`;
    const current=item.myRating||0;
    const clearBtn=current>0?`<button type="button" class="clear-stars-btn" data-detail-rate="0" data-id="${item.id}" title="Zerar estrelas" aria-label="Zerar estrelas">✕ Zerar</button>`:"";
    $("#detail-content").innerHTML=`<div class="detail-layout">${poster}<div class="detail-info"><p class="eyebrow">${item.kind==="movie"?"FILME":"SÉRIE"} · ${item.watched?"ASSISTIDO":"QUERO ASSISTIR"}</p><h2>${escapeHtml(item.title)}</h2><p>${item.year||"Ano não informado"}</p>${renderWhereToWatch(item)}<div class="detail-rating">★ IMDb ${item.imdb?Number(item.imdb).toFixed(1):"Sem nota"}</div><p>Minha avaliação</p><div class="detail-stars">${[1,2,3,4,5].map(n=>`<button type="button" class="star ${n<=current?"filled":""}" data-detail-rate="${n}" data-id="${item.id}" aria-label="${n===current?"Zerar estrelas":`${n} estrelas`}">★</button>`).join("")}${clearBtn}</div></div></div>${synopsis}<div class="detail-actions"><button type="button" class="secondary-button" data-toggle-watched="${item.id}">${item.watched?"↶ Marcar como não assistido":"✓ Marcar como assistido"}</button><button type="button" class="secondary-button" data-edit="${item.id}">Editar</button><button type="button" class="secondary-button" data-delete="${item.id}">Excluir</button></div>`;
  }

  async function fetchTmdbMetadata(key, kind, tmdbId){
    const base=`https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${encodeURIComponent(key)}`;
    const [detailResPt, provRes]=await Promise.all([
      fetch(`${base}&language=pt-BR`).catch(()=>null),
      fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}/watch/providers?api_key=${encodeURIComponent(key)}`).catch(()=>null)
    ]);
    let overview="", language="";
    let studio="";
    if(detailResPt && detailResPt.ok){
      const d=await detailResPt.json();
      overview=d.overview||"";
      if(overview)language="pt-BR";
      const companies=d.production_companies||[];
      const networks=d.networks||[];
      if(companies.length)studio=companies[0].name;
      else if(networks.length)studio=networks[0].name;
    }
    if(!overview){
      const detailResEn=await fetch(`${base}&language=en-US`).catch(()=>null);
      if(detailResEn && detailResEn.ok){
        const dEn=await detailResEn.json();
        overview=dEn.overview||"";
        if(overview)language="en-US";
        if(!studio){
          const companies=dEn.production_companies||[];
          const networks=dEn.networks||[];
          if(companies.length)studio=companies[0].name;
          else if(networks.length)studio=networks[0].name;
        }
      }
    }
    let providers=[];
    if(provRes && provRes.ok){
      const pJson=await provRes.json();
      const br=pJson.results?.BR;
      const flatrate=br?.flatrate||[];
      providers=[...new Set(flatrate.map(p=>p.provider_name).filter(Boolean))];
    }
    return {overview, language, providers, studio};
  }

  async function loadItemMetadata(item){
    if(!item.tmdbId)return;
    const needsOverview=!item.overview && !item.overviewCheckedAt;
    const needsMeta=!item.metaCheckedAt;
    if(!needsOverview && !needsMeta)return;

    const cfg=getConfig(),key=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey;
    if(!key){
      const note=$("#detail-content .synopsis-muted");
      if(note)note.textContent="Configure sua chave API do TMDB em Ajustes para carregar a sinopse.";
      const provNote=$("#detail-content .detail-provider-muted");
      if(provNote)provNote.remove();
      return;
    }
    try{
      const meta=await fetchTmdbMetadata(key,item.kind,item.tmdbId);
      const current=data.items.find(x=>x.id===item.id);
      if(!current)return;
      if(needsOverview){
        current.overview=meta.overview||"";
        current.overviewLanguage=meta.overview?meta.language:"";
        current.overviewCheckedAt=new Date().toISOString();
      }
      if(needsMeta){
        current.providers=meta.providers||[];
        current.studio=meta.studio||"";
        current.metaCheckedAt=new Date().toISOString();
      }
      current.updatedAt=new Date().toISOString();
      saveLocal();
      if($("#detail-dialog").open && $("#detail-content").innerHTML.includes(`data-id="${item.id}"`)){
        renderDetail(current);
      }
    }catch{
      if($("#detail-dialog").open){
        const note=$("#detail-content .synopsis-muted");
        if(note)note.textContent="Não foi possível carregar a sinopse agora.";
        const provNote=$("#detail-content .detail-provider-muted");
        if(provNote)provNote.remove();
      }
    }
  }

  function openDetail(id){
    const item=data.items.find(x=>x.id===id);
    if(!item)return;
    renderDetail(item);
    $("#detail-dialog").showModal();
    if((!item.overview && !item.overviewCheckedAt) || !item.metaCheckedAt){
      loadItemMetadata(item);
    }
  }

  function updateItem(id,patch){
    const i=data.items.findIndex(x=>x.id===id);
    if(i<0)return;
    data.items[i]={...data.items[i],...patch,updatedAt:new Date().toISOString()};
    saveLocal();
    if($("#detail-dialog").open)openDetail(id);
  }

  async function searchTitles(){const cfg=getConfig(),key=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey,query=$("#title-search").value.trim();$("#add-error").textContent="";$("#search-results").innerHTML="";
    if(!query){$("#add-error").textContent="Digite o nome de um título.";return}if(!key){$("#add-error").textContent="Configure sua chave API do TMDB em Ajustes ou use o cadastro manual.";return}
    $("#search-title-button").disabled=true;$("#search-title-button").textContent="Buscando...";
    try{
      const endpoints=["movie","tv"];
      const responses=await Promise.all(endpoints.map(async endpoint=>{const url=`https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(key)}&language=pt-BR&query=${encodeURIComponent(query)}&include_adult=false`;const res=await fetch(url);if(!res.ok)throw new Error(res.status===401?"Chave TMDB inválida.":"Não foi possível consultar o TMDB.");return {kind:endpoint,json:await res.json()}}));
      const resolved=responses.flatMap(({kind,json})=>(json.results||[]).map(r=>({kind,title:kind==="movie"?(r.title||r.original_title):(r.name||r.original_name),year:(r.release_date||r.first_air_date||"").slice(0,4),poster:posterUrl(r.poster_path),imdb:"",imdbId:"",tmdbId:r.id,overview:r.overview||"",overviewLanguage:r.overview?"pt-BR":"",providers:[],studio:"",popularity:Number(r.popularity)||0}))).filter(r=>r.title).sort((a,b)=>b.popularity-a.popularity);
      if(!resolved.length){$("#search-results").innerHTML='<p class="field-hint">Nenhum resultado encontrado. Tente outro nome ou cadastre manualmente.</p>';return}
      selectedSearch.clear();$("#search-results")._results=resolved;renderSearchResults();
    }catch(e){$("#add-error").textContent=e.message||"Erro na busca."}finally{$("#search-title-button").disabled=false;$("#search-title-button").textContent="Buscar"}}

  async function tmdbExternalId(key,kind,id){try{const r=await fetch(`https://api.themoviedb.org/3/${kind}/${id}/external_ids?api_key=${encodeURIComponent(key)}`);if(!r.ok)return "";const j=await r.json();return j.imdb_id||""}catch{return""}}
  function searchKey(item){return `${item.kind}:${item.tmdbId}`}
  function renderSearchResults(){const results=$("#search-results")._results||[];$("#search-results").innerHTML=results.map((r,i)=>{const key=searchKey(r),chosen=selectedSearch.has(key),exists=isAlreadyAdded(r);const poster=r.poster?`<img class="poster" src="${escapeHtml(r.poster)}" alt="Pôster de ${escapeHtml(r.title)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="poster-placeholder">${escapeHtml(r.title.slice(0,1).toUpperCase())}</div>`;return `<article class="media-card search-result-card ${chosen?"selected":""} ${exists?"already-added":""}"><div class="poster-wrap search-poster-wrap" data-search-open="${i}" role="button" tabindex="0" aria-label="Ver sinopse de ${escapeHtml(r.title)}">${poster}<span class="imdb-badge"><b>${r.kind==="movie"?"FILME":"SÉRIE"}</b> ${r.year||"—"}</span><button type="button" class="search-select ${chosen?"selected":""} ${exists?"disabled":""}" data-result="${i}" aria-pressed="${chosen}" ${exists?"disabled":""}>${exists?"✓ Já adicionado":chosen?"✓ Selecionado":"＋ Selecionar"}</button><span class="search-poster-hint">⌕ Ver sinopse</span></div><div class="media-title" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</div><div class="media-meta">${r.year||"Ano não informado"} · ${r.kind==="movie"?"Filme":"Série"}${exists?" · Já na biblioteca":""}</div></article>`}).join("");$("#selected-count").textContent=`${selectedSearch.size} selecionado(s)`;$("#add-selected").disabled=selectedSearch.size===0;$("#selection-bar").hidden=results.length===0;}
  function toggleSearchResult(index){const result=$("#search-results")._results?.[index];if(!result||isAlreadyAdded(result))return;const key=searchKey(result);if(selectedSearch.has(key))selectedSearch.delete(key);else selectedSearch.set(key,result);renderSearchResults();}
  async function addSelectedResults(){if(!selectedSearch.size)return;const button=$("#add-selected"),selected=[...selectedSearch.values()];button.disabled=true;button.textContent="Adicionando…";let added=0,skipped=0;const cfg=getConfig(),tmdbKey=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey,omdbKey=cfg.omdbKey||data.settings?.apiKeys?.omdbKey;
    try{for(const result of selected){let imdbId="",imdb="",checkedAt=null;try{if(omdbKey&&tmdbKey){imdbId=await tmdbExternalId(tmdbKey,result.kind,result.tmdbId);if(imdbId){const response=await fetch(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(omdbKey)}`);if(response.ok){const omdb=await response.json();if(omdb.Response==="True"&&omdb.imdbRating&&omdb.imdbRating!=="N/A")imdb=omdb.imdbRating;checkedAt=new Date().toISOString()}}}}catch{}
        if(addItem({...result,imdb,imdbId,imdbCheckedAt:checkedAt,imdbSource:imdb?"OMDb":""},{keepDialog:true,silent:true}))added++;else skipped++;}
      selectedSearch.clear();renderSearchResults();toast(`${added} título(s) adicionado(s)${skipped?`; ${skipped} já estava(m) na biblioteca`:""}.`);
      if(added>0){closeSearchPage();$("#search-results").innerHTML="";$("#selection-bar").hidden=true;$("#manual-form").reset();}
    }finally{button.disabled=selectedSearch.size===0;button.textContent="Adicionar selecionados";}}
  function openAdd(){selectedSearch.clear();$("#add-error").textContent="";$("#search-results").innerHTML="";$("#search-results")._results=[];$("#selection-bar").hidden=true;$("#add-selected").disabled=true;$("#add-selected").textContent="Adicionar selecionados";$("#manual-section").open=false;document.body.classList.add("search-page-active");$("#search-page").hidden=false;$("#library-section").hidden=true;$(".hero").hidden=true;$(".stats").hidden=true;$("#title-search").focus()}
  function closeSearchPage(){document.body.classList.remove("search-page-active");$("#search-page").hidden=true;$("#library-section").hidden=false;$(".hero").hidden=false;$(".stats").hidden=false;selectedSearch.clear();render()}

  async function openSearchDetail(index){
    const item=$("#search-results")._results?.[index];
    if(!item)return;
    const renderSearchPreview=()=>{
      const poster=item.poster?`<img class="detail-poster" src="${escapeHtml(item.poster)}" alt="Pôster de ${escapeHtml(item.title)}">`:`<div class="detail-poster poster-placeholder">${escapeHtml(item.title[0]||"?")}</div>`;
      const synopsisText=item.overview||(item.metaCheckedAt?"Sinopse não disponível.":"Carregando sinopse…");
      const langNote=item.overview&&item.overviewLanguage&&item.overviewLanguage!=="pt-BR"?'<small class="synopsis-note">Disponível em inglês no TMDB; não há tradução PT-BR cadastrada.</small>':"";
      $("#detail-content").innerHTML=`<div class="detail-layout">${poster}<div class="detail-info"><p class="eyebrow">${item.kind==="movie"?"FILME":"SÉRIE"}</p><h2>${escapeHtml(item.title)}</h2><p>${item.year||"Ano não informado"}</p>${renderWhereToWatch(item)}</div></div><section class="detail-synopsis"><h3>Sinopse</h3><p class="${item.overview?"":"synopsis-muted"}">${escapeHtml(synopsisText)}</p>${langNote}</section>`;
    };
    renderSearchPreview();
    $("#detail-dialog").showModal();
    if(item.metaCheckedAt)return;
    const cfg=getConfig(),key=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey;
    if(!key){
      item.metaCheckedAt=new Date().toISOString();
      if(!item.overview)item.overview="Configure sua chave API do TMDB em Ajustes para carregar a sinopse.";
      renderSearchPreview();
      return;
    }
    try{
      const meta=await fetchTmdbMetadata(key,item.kind,item.tmdbId);
      if(!item.overview && meta.overview){
        item.overview=meta.overview;
        item.overviewLanguage=meta.language;
      }
      item.providers=meta.providers||[];
      item.studio=meta.studio||"";
      item.metaCheckedAt=new Date().toISOString();
      if($("#detail-dialog").open)renderSearchPreview();
    }catch{
      item.metaCheckedAt=new Date().toISOString();
      if($("#detail-dialog").open)renderSearchPreview();
    }
  }

  function fillSettings(){const c=getConfig();$("#gh-owner").value=c.owner||"";$("#gh-repo").value=c.repo||"";$("#gh-branch").value=c.branch||"main";$("#gh-path").value=c.path||"data.json";$("#gh-token").value=c.token||"";$("#tmdb-key").value=c.tmdbKey||data.settings?.apiKeys?.tmdbKey||"";$("#omdb-key").value=c.omdbKey||data.settings?.apiKeys?.omdbKey||"";setSyncState(c.owner&&c.repo&&c.token?"connected":"",c.owner&&c.repo&&c.token?"GitHub configurado":"Somente neste dispositivo")}
  function saveSettings(){const c=getConfig();Object.assign(c,{owner:$("#gh-owner").value.trim(),repo:$("#gh-repo").value.trim(),branch:$("#gh-branch").value.trim()||"main",path:$("#gh-path").value.trim()||"data.json",token:$("#gh-token").value.trim()});setConfig(c);setSyncState(c.owner&&c.repo&&c.token?"connected":"",c.owner&&c.repo&&c.token?"GitHub configurado":"Somente neste dispositivo");toast("Configurações do GitHub salvas neste dispositivo.");}
  function saveApiKeys(){const c=getConfig();c.tmdbKey=$("#tmdb-key").value.trim();c.omdbKey=$("#omdb-key").value.trim();setConfig(c);data.settings={...(data.settings||{}),apiKeys:{tmdbKey:c.tmdbKey,omdbKey:c.omdbKey},updatedAt:new Date().toISOString()};saveLocal();toast(c.owner&&c.repo&&c.token?"Chaves salvas. Sincronizando com o repositório privado…":"Chaves salvas neste dispositivo. Configure o GitHub para sincronizá-las.");}
  function ghHeaders(token){return {"Authorization":`Bearer ${token}`,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}}
  function b64encode(str){const bytes=new TextEncoder().encode(str);let binary="";bytes.forEach(b=>binary+=String.fromCharCode(b));return btoa(binary)}
  function b64decode(b64){const binary=atob(b64.replace(/\n/g,""));const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return new TextDecoder().decode(bytes)}
  async function remoteRead(c){
    const path=c.path.split("/").map(encodeURIComponent).join("/");
    const url=`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}?ref=${encodeURIComponent(c.branch)}&nocache=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let r;
    try {
      r=await fetch(url,{method:"GET",headers:ghHeaders(c.token),cache:"no-store"});
    } catch(error) {
      throw new Error(`Falha de comunicação durante a leitura do data.json (GET). O navegador não conseguiu concluir a requisição ao GitHub. Detalhe: ${error?.message||"erro de rede/CORS"}`);
    }
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
    let r;
    try {
      r=await fetch(url,{method:"PUT",headers:{...ghHeaders(c.token),"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify(body)});
    } catch(error) {
      throw new Error(`Falha de comunicação durante a gravação do data.json (PUT). O navegador não conseguiu concluir a requisição ao GitHub. Detalhe: ${error?.message||"erro de rede/CORS"}`);
    }
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

  function setupSwipeSlider(){
    const area=$("#collection-grid");
    const emptyArea=$("#empty-state");
    const views=["movie","tv","watched"];
    let startX=0, startY=0, tracking=false;

    const onStart=(e)=>{
      if(e.touches.length!==1)return;
      if(e.target.closest("input,select,button"))return;
      startX=e.touches[0].clientX;
      startY=e.touches[0].clientY;
      tracking=true;
    };

    const onEnd=(e)=>{
      if(!tracking || !e.changedTouches.length)return;
      tracking=false;
      const dx=e.changedTouches[0].clientX - startX;
      const dy=e.changedTouches[0].clientY - startY;
      if(Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy)*1.3)return;
      const currentIdx=views.indexOf(activeView);
      const nextIdx=dx < 0
        ? (currentIdx + 1) % views.length
        : (currentIdx - 1 + views.length) % views.length;
      activeView=views[nextIdx];
      render();
    };

    [area, emptyArea].forEach(el=>{
      if(!el)return;
      el.addEventListener("touchstart",onStart,{passive:true});
      el.addEventListener("touchend",onEnd,{passive:true});
    });
  }

  function events(){
    $("#add-open").onclick=openAdd;$("#empty-add").onclick=openAdd;$("#search-back").onclick=closeSearchPage;$("#settings-open").onclick=()=>{fillSettings();$("#settings-dialog").showModal()};
    $$(".close-dialog").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));

    // Fechar modais ao clicar fora (no backdrop)
    $$("dialog").forEach(dlg=>{
      dlg.addEventListener("click",(e)=>{
        if(e.target===dlg)dlg.close();
      });
    });

    $$(".tab").forEach(b=>b.onclick=()=>{activeView=b.dataset.kind;render()});
    $$(".stat-action").forEach(b=>{b.onclick=()=>applyStatFilter(b.dataset.statFilter)});
    $("#search-input").oninput=render;$("#sort-select").onchange=render;
    $("#search-title-button").onclick=searchTitles;$("#title-search").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchTitles()}});
    $("#search-results").addEventListener("click",e=>{const select=e.target.closest("[data-result]");if(select){e.stopPropagation();toggleSearchResult(Number(select.dataset.result));return}const poster=e.target.closest("[data-search-open]");if(poster)openSearchDetail(Number(poster.dataset.searchOpen))});$("#search-results").addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.matches("[data-search-open]")){e.preventDefault();openSearchDetail(Number(e.target.dataset.searchOpen))}});$("#add-selected").onclick=addSelectedResults;
    $("#manual-form").addEventListener("submit",e=>{e.preventDefault();const title=$("#manual-title").value.trim();if(!title){$("#add-error").textContent="Informe o título.";return}if(addItem({kind:$("#manual-kind").value||"movie",title,year:Number($("#manual-year").value)||null,imdb:Number($("#manual-imdb").value)||null,imdbSource:$("#manual-imdb").value.trim()?"manual":"",poster:$("#manual-poster").value.trim()},{keepDialog:true})){closeSearchPage();$("#manual-form").reset()}});

    $("#collection-grid").addEventListener("click",e=>{
      const rate=e.target.closest("[data-rate]");
      if(rate){
        const item=data.items.find(x=>x.id===rate.dataset.id);
        if(item){
          const clicked=Number(rate.dataset.rate);
          item.myRating=(item.myRating===clicked)?0:clicked;
          item.updatedAt=new Date().toISOString();
          saveLocal();
        }
        return;
      }
      const menu=e.target.closest("[data-menu]");
      if(menu){openDetail(menu.dataset.menu);return}
      const open=e.target.closest("[data-open]");
      if(open)openDetail(open.dataset.open);
    });

    $("#detail-content").addEventListener("click",e=>{
      const rate=e.target.closest("[data-detail-rate]");
      if(rate){
        const item=data.items.find(x=>x.id===rate.dataset.id);
        if(item){
          const clicked=Number(rate.dataset.detailRate);
          const nextRating=(clicked===0 || item.myRating===clicked)?0:clicked;
          updateItem(item.id,{myRating:nextRating});
        }
        return;
      }
      const toggle=e.target.closest("[data-toggle-watched]");
      if(toggle){
        const item=data.items.find(x=>x.id===toggle.dataset.toggleWatched);
        if(item){
          const nextWatched=!item.watched;
          updateItem(item.id,{watched:nextWatched});
          toast(nextWatched?"Movido para Assistidos.":"Retornado para sua lista.");
        }
        return;
      }
      const del=e.target.closest("[data-delete]");
      if(del){if(confirm("Excluir este título da sua biblioteca?")){data.deleted=data.deleted||[];data.deleted.push({id:del.dataset.delete,deletedAt:new Date().toISOString()});data.items=data.items.filter(x=>x.id!==del.dataset.delete);saveLocal();$("#detail-dialog").close();toast("Título excluído.")}return}
      const edit=e.target.closest("[data-edit]");
      if(edit){const item=data.items.find(x=>x.id===edit.dataset.edit);if(!item)return;const title=prompt("Título:",item.title);if(title===null)return;const year=prompt("Ano:",item.year||"");if(year===null)return;const imdb=prompt("Nota IMDb (0 a 10):",item.imdb||"");if(imdb===null)return;const poster=prompt("URL da capa:",item.poster||"");if(poster===null)return;updateItem(item.id,{title:title.trim()||item.title,year:Number(year)||null,imdb:Number(imdb)||null,poster});toast("Título atualizado.")}
    });

    $("#save-settings").onclick=saveSettings;$("#save-api-keys").onclick=saveApiKeys;$("#test-sync").onclick=()=>{saveSettings();syncGitHub(true)};$("#sync-now").onclick=()=>{saveSettings();syncGitHub(false)};$("#export-data").onclick=exportData;$("#import-data").onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);e.target.value=""};
    $("#settings-form").addEventListener("submit",e=>e.preventDefault());$("#detail-form").addEventListener("submit",e=>e.preventDefault());
    setupSwipeSlider();
  }
  events();render();
  if("serviceWorker"in navigator&&location.protocol!=="file:")window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  const cfg=getConfig();if(cfg.owner&&cfg.repo&&cfg.token){setSyncState("connected","GitHub configurado");syncGitHub(false)}
})();