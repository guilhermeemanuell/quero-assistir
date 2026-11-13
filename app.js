(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const STORAGE = "minhaColecao.v1";
  const CONFIG = "minhaColecao.config.v1";
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const emptyData = () => ({version:1,items:[],deleted:[],settings:{apiKeys:{tmdbKey:"",omdbKey:""},updatedAt:null},updatedAt:new Date().toISOString()});

  let data = loadLocal();
  let activeView = "movie"; // "movie" | "tv" | "watched"
  let activeQuickFilter = null; // { type: "provider" | "genre", value: string }
  let selectedSearch = new Map();
  let toastTimer;
  let lastDeleted = null; // { item, index, deletedEntryId }
  let syncInProgress = false;
  let syncTimer;
  let searchBatchId = 0;

  function pruneDeleted(list){
    if(!Array.isArray(list))return [];
    const cutoff = Date.now() - NINETY_DAYS_MS;
    return list.filter(entry => {
      if(!entry || !entry.id)return false;
      const t = new Date(entry.deletedAt || 0).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
  }

  function loadLocal(){
    try{
      const stored=JSON.parse(localStorage.getItem(STORAGE)||"{}");
      const loaded={
        ...emptyData(),
        ...stored,
        settings:{
          ...emptyData().settings,
          ...(stored.settings||{}),
          apiKeys:{...emptyData().settings.apiKeys,...(stored.settings?.apiKeys||{})}
        }
      };
      loaded.deleted = pruneDeleted(loaded.deleted);
      return loaded;
    }catch{
      return emptyData();
    }
  }

  function saveLocal(){
    data.deleted = pruneDeleted(data.deleted);
    data.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE,JSON.stringify(data));
    render();
    const c=getConfig();
    if(c.owner&&c.repo&&c.token){
      clearTimeout(syncTimer);
      syncTimer=setTimeout(()=>syncGitHub(false),1800);
    }
  }

  function getConfig(){try{return JSON.parse(localStorage.getItem(CONFIG)||"{}")}catch{return {}}}
  function setConfig(v){localStorage.setItem(CONFIG,JSON.stringify(v))}
  function uid(){return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`}
  function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

  function toast(message, {actionLabel="", onAction=null, duration=2800}={}){
    const el=$("#toast");
    if(actionLabel && typeof onAction==="function"){
      el.innerHTML=`<span>${escapeHtml(message)}</span><button type="button" class="toast-undo" id="toast-action-btn">${escapeHtml(actionLabel)}</button>`;
      const btn=$("#toast-action-btn");
      if(btn){
        btn.onclick=()=>{
          clearTimeout(toastTimer);
          el.classList.remove("show");
          onAction();
        };
      }
    }else{
      el.textContent=message;
    }
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove("show"),duration);
  }

  function setSyncState(state,label){const el=$("#sync-indicator");el.className="sync-indicator "+state;el.querySelector("span").textContent=label}
  function posterUrl(path){return path?`https://image.tmdb.org/t/p/w500${path}`:""}
  function logoUrl(path){return path?`https://image.tmdb.org/t/p/w92${path}`:""}

  function normalizeProviders(providers){
    if(!Array.isArray(providers))return [];
    const seen=new Set();
    const out=[];
    for(const p of providers){
      const name=typeof p==="string"?p.trim():(p?.name||p?.provider_name||"").trim();
      if(!name || seen.has(name.toLowerCase()))continue;
      seen.add(name.toLowerCase());
      const logo=typeof p==="object" && p!==null ? (p.logo|| (p.logo_path?logoUrl(p.logo_path):"") ) : "";
      out.push({name, logo});
    }
    return out;
  }

  function getBaseViewItems(){
    if(activeView==="watched")return data.items.filter(x=>x.watched);
    return data.items.filter(x=>!x.watched && x.kind===activeView);
  }

  function itemHasProvider(item, providerName){
    return normalizeProviders(item.providers).some(p=>p.name.toLowerCase()===providerName.toLowerCase());
  }

  function itemHasGenre(item, genreName){
    return Array.isArray(item.genres) && item.genres.some(g=>String(g).toLowerCase()===genreName.toLowerCase());
  }

  function renderQuickFilters(){
    const container=$("#quick-filters");
    if(!container)return;
    const baseItems=getBaseViewItems();
    const providerMap=new Map(); // name -> {name, logo, count}
    const genreMap=new Map(); // name -> count

    for(const item of baseItems){
      for(const p of normalizeProviders(item.providers)){
        const prev=providerMap.get(p.name)||{name:p.name,logo:p.logo,count:0};
        if(!prev.logo && p.logo)prev.logo=p.logo;
        prev.count++;
        providerMap.set(p.name,prev);
      }
      if(Array.isArray(item.genres)){
        for(const g of item.genres){
          const clean=String(g||"").trim();
          if(!clean)continue;
          genreMap.set(clean,(genreMap.get(clean)||0)+1);
        }
      }
    }

    // Verifica se o filtro rápido ativo ainda existe na categoria atual
    if(activeQuickFilter){
      const valid = activeQuickFilter.type==="provider"
        ? providerMap.has(activeQuickFilter.value)
        : genreMap.has(activeQuickFilter.value);
      if(!valid)activeQuickFilter=null;
    }

    const providers=[...providerMap.values()].sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name,"pt-BR"));
    const genres=[...genreMap.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],"pt-BR")).slice(0,10);

    if(!providers.length && !genres.length){
      container.hidden=true;
      container.innerHTML="";
      return;
    }

    container.hidden=false;
    const allActive=!activeQuickFilter;
    let html=`<button type="button" class="filter-pill ${allActive?"active":""}" data-filter-clear="1">Todos</button>`;

    for(const p of providers){
      const isAct=activeQuickFilter?.type==="provider" && activeQuickFilter.value===p.name;
      const icon=p.logo?`<img src="${escapeHtml(p.logo)}" alt="" class="pill-logo" loading="lazy">`:"";
      html+=`<button type="button" class="filter-pill ${isAct?"active":""}" data-filter-type="provider" data-filter-value="${escapeHtml(p.name)}">${icon}<span>${escapeHtml(p.name)}</span><small>${p.count}</small></button>`;
    }

    for(const [gName, gCount] of genres){
      const isAct=activeQuickFilter?.type==="genre" && activeQuickFilter.value===gName;
      html+=`<button type="button" class="filter-pill filter-pill-genre ${isAct?"active":""}" data-filter-type="genre" data-filter-value="${escapeHtml(gName)}"><span>${escapeHtml(gName)}</span><small>${gCount}</small></button>`;
    }

    container.innerHTML=html;
  }

  function getItems(){
    const q=$("#search-input").value.trim().toLocaleLowerCase("pt-BR");
    const sort=$("#sort-select").value;
    let list=getBaseViewItems();

    if(activeQuickFilter){
      if(activeQuickFilter.type==="provider"){
        list=list.filter(x=>itemHasProvider(x,activeQuickFilter.value));
      }else if(activeQuickFilter.type==="genre"){
        list=list.filter(x=>itemHasGenre(x,activeQuickFilter.value));
      }
    }

    if(q){
      list=list.filter(x=>`${x.title} ${x.year||""} ${x.notes||""}`.toLocaleLowerCase("pt-BR").includes(q));
    }

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
    const noteIndicator=item.notes?`<span class="note-dot" title="${escapeHtml(item.notes)}">✎</span>`:"";
    return `<article class="media-card" data-card="${item.id}"><div class="poster-wrap" data-open="${item.id}">${poster}<span class="imdb-badge"><b>IMDb</b> ${item.imdb?Number(item.imdb).toFixed(1):"—"}</span>${item.watched?'<span class="watched-ribbon">✓ ASSISTIDO</span>':""}<button class="card-menu" data-menu="${item.id}" aria-label="Opções de ${escapeHtml(item.title)}">⋯</button></div><div class="media-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div><div class="media-meta">${item.year||"Ano não informado"}${kindBadge}${noteIndicator}</div>${stars(item)}</article>`;
  }

  function render(){
    renderQuickFilters();
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

    const randomBtn=$("#random-pick");
    if(randomBtn)randomBtn.disabled=list.length===0;

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
      if(activeQuickFilter){
        $("#empty-title").textContent="Nenhum título para este filtro";
        $("#empty-copy").textContent="Toque em 'Todos' nas pílulas acima para voltar a ver sua lista completa.";
        $("#empty-add").hidden=true;
      }else if(isWatched){
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
    activeQuickFilter=null;
    activeView=filter;
    render();
    if(scroll)$("#library-section")?.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function pickRandomTitle(){
    const list=getItems();
    if(!list.length){
      toast("Não há títulos disponíveis nesta visualização para sortear.");
      return;
    }
    const chosen=list[Math.floor(Math.random()*list.length)];
    openDetail(chosen.id);
    toast(`Sorteado: ${chosen.title}`);
  }

  function isAlreadyAdded(item){return data.items.some(x=>x.kind===item.kind&&x.title.toLowerCase()===item.title.toLowerCase()&&String(x.year||"")===String(item.year||""))}
  function addItem(item,{keepDialog=false,silent=false}={}){
    if(isAlreadyAdded(item)){if(!silent)toast("Esse título já está na sua lista.");return false}
    const now=new Date().toISOString();
    data.items.push({
      id:uid(),
      kind:item.kind,
      title:item.title,
      year:item.year||null,
      poster:item.poster||"",
      overview:item.overview||"",
      overviewLanguage:item.overviewLanguage||"",
      overviewCheckedAt:item.overviewCheckedAt||null,
      providers:normalizeProviders(item.providers||[]),
      genres:Array.isArray(item.genres)?item.genres:[],
      trailerUrl:item.trailerUrl||"",
      studio:item.studio||"",
      notes:item.notes||"",
      metaCheckedAt:item.metaCheckedAt||null,
      imdb:item.imdb||null,
      imdbId:item.imdbId||"",
      imdbCheckedAt:item.imdbCheckedAt||null,
      imdbSource:item.imdbSource||"",
      tmdbId:item.tmdbId||null,
      watched:false,
      myRating:0,
      createdAt:now,
      updatedAt:now
    });
    saveLocal();
    if(!keepDialog){selectedSearch.clear()}
    if(!silent)toast("Título adicionado à sua biblioteca.");
    return true;
  }

  function renderWhereToWatch(item){
    const providers=normalizeProviders(item.providers);
    let html="";
    if(providers.length){
      const badges=providers.map(p=>{
        const img=p.logo?`<img src="${escapeHtml(p.logo)}" alt="" class="provider-chip-logo" loading="lazy">`:"";
        return `<span class="provider-chip">${img}<span>${escapeHtml(p.name)}</span></span>`;
      }).join("");
      html+=`<div class="detail-providers-wrap"><span class="detail-provider-label">Onde assistir:</span><div class="provider-chips">${badges}</div></div>`;
    }else if(item.studio){
      html+=`<p class="detail-provider"><strong>Produtora:</strong> ${escapeHtml(item.studio)}</p>`;
    }else if(item.tmdbId && !item.metaCheckedAt){
      html+=`<p class="detail-provider detail-provider-muted">Buscando onde assistir…</p>`;
    }
    if(Array.isArray(item.genres) && item.genres.length){
      html+=`<p class="detail-genres">${item.genres.map(g=>`<span>${escapeHtml(g)}</span>`).join(" · ")}</p>`;
    }
    return html;
  }

  function getTrailerLink(item){
    if(item.trailerUrl)return item.trailerUrl;
    const q=encodeURIComponent(`${item.title} ${item.year||""} trailer legendado`.trim());
    return `https://www.youtube.com/results?search_query=${q}`;
  }

  function renderDetail(item, {editing=false, refreshing=false}={}){
    const poster=item.poster?`<img class="detail-poster" src="${escapeHtml(item.poster)}" alt="Pôster de ${escapeHtml(item.title)}">`:`<div class="detail-poster poster-placeholder">${escapeHtml(item.title[0]||"?")}</div>`;
    const current=item.myRating||0;
    const clearBtn=current>0?`<button type="button" class="clear-stars-btn" data-detail-rate="0" data-id="${item.id}" title="Zerar estrelas" aria-label="Zerar estrelas">✕ Zerar</button>`:"";
    const trailerHref=getTrailerLink(item);

    if(editing){
      $("#detail-content").innerHTML=`
        <div class="detail-edit-header">
          <p class="eyebrow">EDITAR TÍTULO</p>
          <h2>${escapeHtml(item.title)}</h2>
        </div>
        <form id="inline-edit-form" class="inline-edit-form" data-edit-form="${item.id}">
          <div class="form-grid">
            <label class="field-label full">Tipo de título
              <select id="edit-kind">
                <option value="movie" ${item.kind==="movie"?"selected":""}>Filme</option>
                <option value="tv" ${item.kind==="tv"?"selected":""}>Série</option>
              </select>
            </label>
            <label class="field-label full">Título
              <input id="edit-title" required maxlength="140" value="${escapeHtml(item.title)}">
            </label>
            <label class="field-label">Ano
              <input id="edit-year" type="number" min="1888" max="2100" value="${escapeHtml(item.year||"")}">
            </label>
            <label class="field-label">Nota IMDb (0 a 10)
              <input id="edit-imdb" type="number" min="0" max="10" step="0.1" value="${escapeHtml(item.imdb||"")}">
            </label>
            <label class="field-label full">URL da capa
              <input id="edit-poster" type="url" placeholder="https://..." value="${escapeHtml(item.poster||"")}">
            </label>
            <label class="field-label full">Notas pessoais / Quem indicou
              <input id="edit-notes" maxlength="240" placeholder="Ex.: Indicação do João" value="${escapeHtml(item.notes||"")}">
            </label>
          </div>
          <div class="dialog-actions">
            <button type="button" class="secondary-button" data-cancel-edit="${item.id}">Cancelar</button>
            <button type="submit" class="primary-button">Salvar alterações</button>
          </div>
        </form>`;
      return;
    }

    const synopsis=item.overview?`<section class="detail-synopsis"><h3>Sinopse</h3><p>${escapeHtml(item.overview)}</p>${item.overviewLanguage&&item.overviewLanguage!=="pt-BR"?'<small class="synopsis-note">Sinopse no idioma disponível no TMDB.</small>':""}</section>`:`<section class="detail-synopsis"><h3>Sinopse</h3><p class="synopsis-muted">${item.tmdbId?"Carregando sinopse…":"Sinopse não disponível para este cadastro."}</p></section>`;

    const notesSection=`
      <section class="detail-notes">
        <label class="field-label" for="detail-note-input">Notas pessoais / Quem indicou</label>
        <div class="note-row">
          <input id="detail-note-input" type="text" maxlength="240" placeholder="Ex.: Indicação do João · Assistir com a família" value="${escapeHtml(item.notes||"")}" data-note-id="${item.id}">
          <button type="button" class="secondary-button note-save-btn" data-save-note="${item.id}">Salvar nota</button>
        </div>
      </section>`;

    $("#detail-content").innerHTML=`
      <div class="detail-layout">
        ${poster}
        <div class="detail-info">
          <p class="eyebrow">${item.kind==="movie"?"FILME":"SÉRIE"} · ${item.watched?"ASSISTIDO":"QUERO ASSISTIR"}</p>
          <h2>${escapeHtml(item.title)}</h2>
          <p>${item.year||"Ano não informado"}</p>
          ${renderWhereToWatch(item)}
          <div class="detail-rating-row">
            <div class="detail-rating">★ IMDb ${item.imdb?Number(item.imdb).toFixed(1):"Sem nota"}</div>
            <a class="trailer-btn" href="${escapeHtml(trailerHref)}" target="_blank" rel="noopener noreferrer">▶ Trailer</a>
          </div>
          <p>Minha avaliação</p>
          <div class="detail-stars">${[1,2,3,4,5].map(n=>`<button type="button" class="star ${n<=current?"filled":""}" data-detail-rate="${n}" data-id="${item.id}" aria-label="${n===current?"Zerar estrelas":`${n} estrelas`}">★</button>`).join("")}${clearBtn}</div>
        </div>
      </div>
      ${synopsis}
      ${notesSection}
      <div class="detail-actions">
        <button type="button" class="secondary-button" data-toggle-watched="${item.id}">${item.watched?"↶ Marcar como não assistido":"✓ Marcar como assistido"}</button>
        <button type="button" class="secondary-button" data-edit="${item.id}">Editar</button>
        <button type="button" class="secondary-button" data-refresh="${item.id}" ${refreshing?"disabled":""}>${refreshing?"↻ Atualizando…":"↻ Atualizar dados"}</button>
        <button type="button" class="secondary-button danger-button" data-delete="${item.id}">Excluir</button>
      </div>`;
  }

  function extractYoutubeTrailer(videosPayload){
    const list=videosPayload?.results||[];
    const yt=list.filter(v=>v.site==="YouTube" && v.key);
    const preferred=yt.find(v=>v.type==="Trailer" && v.official) || yt.find(v=>v.type==="Trailer") || yt.find(v=>v.type==="Teaser") || yt[0];
    return preferred ? `https://www.youtube.com/watch?v=${encodeURIComponent(preferred.key)}` : "";
  }

  async function fetchTmdbMetadata(key, kind, tmdbId){
    const base=`https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${encodeURIComponent(key)}&append_to_response=videos`;
    const [detailResPt, provRes]=await Promise.all([
      fetch(`${base}&language=pt-BR`).catch(()=>null),
      fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}/watch/providers?api_key=${encodeURIComponent(key)}`).catch(()=>null)
    ]);
    let overview="", language="";
    let studio="";
    let genres=[];
    let trailerUrl="";

    if(detailResPt && detailResPt.ok){
      const d=await detailResPt.json();
      overview=d.overview||"";
      if(overview)language="pt-BR";
      const companies=d.production_companies||[];
      const networks=d.networks||[];
      if(companies.length)studio=companies[0].name;
      else if(networks.length)studio=networks[0].name;
      if(Array.isArray(d.genres))genres=d.genres.map(g=>g.name).filter(Boolean);
      trailerUrl=extractYoutubeTrailer(d.videos);
    }

    if(!overview || !trailerUrl){
      const detailResEn=await fetch(`${base}&language=en-US`).catch(()=>null);
      if(detailResEn && detailResEn.ok){
        const dEn=await detailResEn.json();
        if(!overview && dEn.overview){
          overview=dEn.overview;
          language="en-US";
        }
        if(!studio){
          const companies=dEn.production_companies||[];
          const networks=dEn.networks||[];
          if(companies.length)studio=companies[0].name;
          else if(networks.length)studio=networks[0].name;
        }
        if(!genres.length && Array.isArray(dEn.genres)){
          genres=dEn.genres.map(g=>g.name).filter(Boolean);
        }
        if(!trailerUrl){
          trailerUrl=extractYoutubeTrailer(dEn.videos);
        }
      }
    }

    let providers=[];
    if(provRes && provRes.ok){
      const pJson=await provRes.json();
      const br=pJson.results?.BR;
      const flatrate=br?.flatrate||[];
      providers=normalizeProviders(flatrate);
    }

    return {overview, language, providers, studio, genres, trailerUrl};
  }

  async function loadItemMetadata(item, {force=false}={}){
    if(!item.tmdbId && !force)return;
    const hasObjectProviders=Array.isArray(item.providers) && item.providers.every(p=>typeof p==="object" && p!==null && "logo" in p);
    const needsOverview=force || (!item.overview && !item.overviewCheckedAt);
    const needsMeta=force || !item.metaCheckedAt || !hasObjectProviders;
    if(!needsOverview && !needsMeta)return;

    const cfg=getConfig(),tmdbKey=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey,omdbKey=cfg.omdbKey||data.settings?.apiKeys?.omdbKey;
    if(!tmdbKey){
      const note=$("#detail-content .synopsis-muted");
      if(note)note.textContent="Configure sua chave API do TMDB em Ajustes para carregar os dados.";
      const provNote=$("#detail-content .detail-provider-muted");
      if(provNote)provNote.remove();
      if(force)toast("Configure sua chave TMDB em Ajustes.");
      return;
    }

    try{
      let tmdbId=item.tmdbId;
      // Se o título foi cadastrado manualmente sem tmdbId e o usuário pediu Atualizar Dados, tenta localizar no TMDB
      if(!tmdbId && force){
        const searchUrl=`https://api.themoviedb.org/3/search/${item.kind}?api_key=${encodeURIComponent(tmdbKey)}&language=pt-BR&query=${encodeURIComponent(item.title)}&include_adult=false`;
        const sRes=await fetch(searchUrl);
        if(sRes.ok){
          const sJson=await sRes.json();
          const first=(sJson.results||[])[0];
          if(first){
            tmdbId=first.id;
            item.tmdbId=first.id;
            if(!item.poster && first.poster_path)item.poster=posterUrl(first.poster_path);
          }
        }
      }

      if(!tmdbId){
        if(force)toast("Título não encontrado no TMDB para atualizar.");
        return;
      }

      const meta=await fetchTmdbMetadata(tmdbKey,item.kind,tmdbId);
      const current=data.items.find(x=>x.id===item.id);
      if(!current)return;

      if(needsOverview || (force && meta.overview)){
        current.overview=meta.overview||current.overview||"";
        current.overviewLanguage=meta.overview?meta.language:(current.overviewLanguage||"");
        current.overviewCheckedAt=new Date().toISOString();
      }
      if(needsMeta){
        current.providers=meta.providers||[];
        current.studio=meta.studio||current.studio||"";
        current.genres=meta.genres?.length?meta.genres:(current.genres||[]);
        current.trailerUrl=meta.trailerUrl||current.trailerUrl||"";
        current.metaCheckedAt=new Date().toISOString();
      }
      if(force && omdbKey){
        current.imdbCheckedAt=null;
        await fetchImdbRatingForItem(current,tmdbKey,omdbKey);
      }

      current.updatedAt=new Date().toISOString();
      saveLocal();
      if($("#detail-dialog").open && $("#detail-content").innerHTML.includes(`data-id="${item.id}"`)){
        renderDetail(current);
      }
      if(force)toast("Dados do título atualizados.");
    }catch{
      if($("#detail-dialog").open){
        const note=$("#detail-content .synopsis-muted");
        if(note)note.textContent="Não foi possível carregar os metadados agora.";
        const provNote=$("#detail-content .detail-provider-muted");
        if(provNote)provNote.remove();
      }
      if(force)toast("Falha ao atualizar os dados agora.");
    }
  }

  function openDetail(id){
    const item=data.items.find(x=>x.id===id);
    if(!item)return;
    renderDetail(item);
    if(!$("#detail-dialog").open)$("#detail-dialog").showModal();
    const hasObjectProviders=Array.isArray(item.providers) && item.providers.every(p=>typeof p==="object" && p!==null && "logo" in p);
    if((!item.overview && !item.overviewCheckedAt) || !item.metaCheckedAt || !hasObjectProviders){
      loadItemMetadata(item);
    }
  }

  function updateItem(id,patch,{reopen=true}={}){
    const i=data.items.findIndex(x=>x.id===id);
    if(i<0)return;
    data.items[i]={...data.items[i],...patch,updatedAt:new Date().toISOString()};
    saveLocal();
    if(reopen && $("#detail-dialog").open)openDetail(id);
  }

  function deleteItemWithUndo(id){
    const index=data.items.findIndex(x=>x.id===id);
    if(index<0)return;
    const removedItem=data.items[index];
    const deletedAt=new Date().toISOString();
    data.deleted=data.deleted||[];
    data.deleted.push({id:removedItem.id,deletedAt});
    data.items.splice(index,1);
    lastDeleted={item:removedItem,index};
    saveLocal();
    $("#detail-dialog").close();

    toast(`"${removedItem.title}" excluído.`,{
      actionLabel:"Desfazer",
      duration:5200,
      onAction:()=>{
        if(!lastDeleted)return;
        const {item,index:restoreIdx}=lastDeleted;
        lastDeleted=null;
        data.deleted=(data.deleted||[]).filter(d=>d.id!==item.id);
        item.updatedAt=new Date().toISOString();
        const pos=Math.min(restoreIdx,data.items.length);
        data.items.splice(pos,0,item);
        saveLocal();
        toast("Exclusão desfeita.");
      }
    });
  }

  async function tmdbExternalId(key,kind,id){try{const r=await fetch(`https://api.themoviedb.org/3/${kind}/${id}/external_ids?api_key=${encodeURIComponent(key)}`);if(!r.ok)return "";const j=await r.json();return j.imdb_id||""}catch{return""}}

  async function fetchImdbRatingForItem(item, tmdbKey, omdbKey){
    if(item.imdbCheckedAt || !tmdbKey || !omdbKey || !item.tmdbId)return false;
    try{
      const imdbId=item.imdbId || await tmdbExternalId(tmdbKey,item.kind,item.tmdbId);
      item.imdbId=imdbId||"";
      if(imdbId){
        const res=await fetch(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(omdbKey)}`);
        if(res.ok){
          const omdb=await res.json();
          if(omdb.Response==="True" && omdb.imdbRating && omdb.imdbRating!=="N/A"){
            item.imdb=omdb.imdbRating;
            item.imdbSource="OMDb";
          }
        }
      }
      item.imdbCheckedAt=new Date().toISOString();
      return true;
    }catch{
      return false;
    }
  }

  async function enrichSearchImdbRatings(results, batchId){
    const cfg=getConfig();
    const tmdbKey=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey;
    const omdbKey=cfg.omdbKey||data.settings?.apiKeys?.omdbKey;
    if(!tmdbKey || !omdbKey)return;
    const subset=results.slice(0,18);
    await Promise.allSettled(subset.map(async (r,idx)=>{
      const updated=await fetchImdbRatingForItem(r,tmdbKey,omdbKey);
      if(!updated || batchId!==searchBatchId)return;
      const badgeEl=$(`[data-search-imdb="${idx}"]`);
      if(badgeEl){
        badgeEl.innerHTML=`<b>IMDb</b> ★ ${r.imdb?Number(r.imdb).toFixed(1):"—"}`;
      }
    }));
  }

  async function searchTitles(){
    const cfg=getConfig(),key=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey,query=$("#title-search").value.trim();
    $("#add-error").textContent="";$("#search-results").innerHTML="";
    if(!query){$("#add-error").textContent="Digite o nome de um título.";return}
    if(!key){$("#add-error").textContent="Configure sua chave API do TMDB em Ajustes ou use o cadastro manual.";return}
    $("#search-title-button").disabled=true;$("#search-title-button").textContent="Buscando...";
    const currentBatch=++searchBatchId;
    try{
      const endpoints=["movie","tv"];
      const responses=await Promise.all(endpoints.map(async endpoint=>{const url=`https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(key)}&language=pt-BR&query=${encodeURIComponent(query)}&include_adult=false`;const res=await fetch(url);if(!res.ok)throw new Error(res.status===401?"Chave TMDB inválida.":"Não foi possível consultar o TMDB.");return {kind:endpoint,json:await res.json()}}));
      const resolved=responses.flatMap(({kind,json})=>(json.results||[]).map(r=>{
        const vote=Number(r.vote_average)||0;
        return {
          kind,
          title:kind==="movie"?(r.title||r.original_title):(r.name||r.original_name),
          year:(r.release_date||r.first_air_date||"").slice(0,4),
          poster:posterUrl(r.poster_path),
          imdb:vote>0?vote.toFixed(1):"",
          imdbId:"",
          imdbCheckedAt:null,
          imdbSource:vote>0?"TMDB":"",
          tmdbId:r.id,
          overview:r.overview||"",
          overviewLanguage:r.overview?"pt-BR":"",
          providers:[],
          genres:[],
          trailerUrl:"",
          studio:"",
          popularity:Number(r.popularity)||0
        };
      })).filter(r=>r.title).sort((a,b)=>b.popularity-a.popularity);
      if(!resolved.length){$("#search-results").innerHTML='<p class="field-hint">Nenhum resultado encontrado. Tente outro nome ou cadastre manualmente.</p>';return}
      selectedSearch.clear();
      $("#search-results")._results=resolved;
      renderSearchResults();
      enrichSearchImdbRatings(resolved,currentBatch);
    }catch(e){
      $("#add-error").textContent=e.message||"Erro na busca.";
    }finally{
      $("#search-title-button").disabled=false;$("#search-title-button").textContent="Buscar";
    }
  }

  function searchKey(item){return `${item.kind}:${item.tmdbId}`}
  function renderSearchResults(){
    const results=$("#search-results")._results||[];
    $("#search-results").innerHTML=results.map((r,i)=>{
      const key=searchKey(r),chosen=selectedSearch.has(key),exists=isAlreadyAdded(r);
      const poster=r.poster?`<img class="poster" src="${escapeHtml(r.poster)}" alt="Pôster de ${escapeHtml(r.title)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="poster-placeholder">${escapeHtml(r.title.slice(0,1).toUpperCase())}</div>`;
      const ratingText=r.imdb?Number(r.imdb).toFixed(1):"—";
      return `<article class="media-card search-result-card ${chosen?"selected":""} ${exists?"already-added":""}"><div class="poster-wrap search-poster-wrap" data-search-open="${i}" role="button" tabindex="0" aria-label="Ver sinopse de ${escapeHtml(r.title)}">${poster}<span class="imdb-badge"><b>${r.kind==="movie"?"FILME":"SÉRIE"}</b> ${r.year||"—"}</span><span class="search-poster-hint">⌕ Ver sinopse</span><span class="imdb-badge search-imdb-badge" data-search-imdb="${i}"><b>IMDb</b> ★ ${ratingText}</span><button type="button" class="search-select ${chosen?"selected":""} ${exists?"disabled":""}" data-result="${i}" aria-pressed="${chosen}" ${exists?"disabled":""}>${exists?"✓ Já adicionado":chosen?"✓ Selecionado":"＋ Selecionar"}</button></div><div class="media-title" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</div><div class="media-meta">${r.year||"Ano não informado"} · ${r.kind==="movie"?"Filme":"Série"}${exists?" · Já na biblioteca":""}</div></article>`;
    }).join("");
    $("#selected-count").textContent=`${selectedSearch.size} selecionado(s)`;
    $("#add-selected").disabled=selectedSearch.size===0;
    $("#selection-bar").hidden=results.length===0;
  }

  function toggleSearchResult(index){
    const result=$("#search-results")._results?.[index];
    if(!result||isAlreadyAdded(result))return;
    const key=searchKey(result);
    if(selectedSearch.has(key))selectedSearch.delete(key);
    else selectedSearch.set(key,result);
    renderSearchResults();
  }

  async function addSelectedResults(){
    if(!selectedSearch.size)return;
    const button=$("#add-selected"),selected=[...selectedSearch.values()];
    button.disabled=true;button.textContent="Adicionando…";
    let added=0,skipped=0;
    const cfg=getConfig(),tmdbKey=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey,omdbKey=cfg.omdbKey||data.settings?.apiKeys?.omdbKey;
    try{
      for(const result of selected){
        await fetchImdbRatingForItem(result,tmdbKey,omdbKey);
        if(tmdbKey && !result.metaCheckedAt){
          try{
            const meta=await fetchTmdbMetadata(tmdbKey,result.kind,result.tmdbId);
            if(!result.overview && meta.overview){
              result.overview=meta.overview;
              result.overviewLanguage=meta.language;
            }
            result.providers=meta.providers||[];
            result.studio=meta.studio||"";
            result.genres=meta.genres||[];
            result.trailerUrl=meta.trailerUrl||"";
            result.metaCheckedAt=new Date().toISOString();
          }catch{}
        }
        if(addItem({
          ...result,
          imdb:result.imdb||null,
          imdbId:result.imdbId||"",
          imdbCheckedAt:result.imdbCheckedAt||null,
          imdbSource:result.imdbSource||""
        },{keepDialog:true,silent:true}))added++;
        else skipped++;
      }
      selectedSearch.clear();renderSearchResults();
      toast(`${added} título(s) adicionado(s)${skipped?`; ${skipped} já estava(m) na biblioteca`:""}.`);
      if(added>0){closeSearchPage();$("#search-results").innerHTML="";$("#selection-bar").hidden=true;$("#manual-form").reset();}
    }finally{
      button.disabled=selectedSearch.size===0;button.textContent="Adicionar selecionados";
    }
  }

  function openAdd(){selectedSearch.clear();$("#add-error").textContent="";$("#search-results").innerHTML="";$("#search-results")._results=[];$("#selection-bar").hidden=true;$("#add-selected").disabled=true;$("#add-selected").textContent="Adicionar selecionados";$("#manual-section").open=false;document.body.classList.add("search-page-active");$("#search-page").hidden=false;$("#library-section").hidden=true;$(".hero").hidden=true;$(".stats").hidden=true;$("#title-search").focus()}
  function closeSearchPage(){document.body.classList.remove("search-page-active");$("#search-page").hidden=true;$("#library-section").hidden=false;$(".hero").hidden=false;$(".stats").hidden=false;selectedSearch.clear();render()}

  async function openSearchDetail(index){
    const item=$("#search-results")._results?.[index];
    if(!item)return;
    const renderSearchPreview=()=>{
      const poster=item.poster?`<img class="detail-poster" src="${escapeHtml(item.poster)}" alt="Pôster de ${escapeHtml(item.title)}">`:`<div class="detail-poster poster-placeholder">${escapeHtml(item.title[0]||"?")}</div>`;
      const synopsisText=item.overview||(item.metaCheckedAt?"Sinopse não disponível.":"Carregando sinopse…");
      const langNote=item.overview&&item.overviewLanguage&&item.overviewLanguage!=="pt-BR"?'<small class="synopsis-note">Disponível em inglês no TMDB; não há tradução PT-BR cadastrada.</small>':"";
      const imdbRating=item.imdb?`★ IMDb ${Number(item.imdb).toFixed(1)}`:"★ IMDb Sem nota";
      const trailerHref=getTrailerLink(item);
      $("#detail-content").innerHTML=`<div class="detail-layout">${poster}<div class="detail-info"><p class="eyebrow">${item.kind==="movie"?"FILME":"SÉRIE"}</p><h2>${escapeHtml(item.title)}</h2><p>${item.year||"Ano não informado"}</p>${renderWhereToWatch(item)}<div class="detail-rating-row"><div class="detail-rating">${imdbRating}</div><a class="trailer-btn" href="${escapeHtml(trailerHref)}" target="_blank" rel="noopener noreferrer">▶ Trailer</a></div></div></div><section class="detail-synopsis"><h3>Sinopse</h3><p class="${item.overview?"":"synopsis-muted"}">${escapeHtml(synopsisText)}</p>${langNote}</section>`;
    };
    renderSearchPreview();
    $("#detail-dialog").showModal();

    const cfg=getConfig();
    const tmdbKey=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey;
    const omdbKey=cfg.omdbKey||data.settings?.apiKeys?.omdbKey;

    if(!tmdbKey){
      item.metaCheckedAt=new Date().toISOString();
      if(!item.overview)item.overview="Configure sua chave API do TMDB em Ajustes para carregar a sinopse.";
      renderSearchPreview();
      return;
    }

    try{
      const tasks=[];
      if(!item.metaCheckedAt){
        tasks.push(fetchTmdbMetadata(tmdbKey,item.kind,item.tmdbId).then(meta=>{
          if(!item.overview && meta.overview){
            item.overview=meta.overview;
            item.overviewLanguage=meta.language;
          }
          item.providers=meta.providers||[];
          item.studio=meta.studio||"";
          item.genres=meta.genres||[];
          item.trailerUrl=meta.trailerUrl||"";
          item.metaCheckedAt=new Date().toISOString();
        }));
      }
      if(!item.imdbCheckedAt && omdbKey){
        tasks.push(fetchImdbRatingForItem(item,tmdbKey,omdbKey).then(()=>{
          const badgeEl=$(`[data-search-imdb="${index}"]`);
          if(badgeEl){
            badgeEl.innerHTML=`<b>IMDb</b> ★ ${item.imdb?Number(item.imdb).toFixed(1):"—"}`;
          }
        }));
      }
      if(tasks.length){
        await Promise.allSettled(tasks);
        if($("#detail-dialog").open)renderSearchPreview();
      }
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
  function mergeData(local,remote){
    const map=new Map();
    [...(remote.items||[]),...(local.items||[])].forEach(item=>{
      const old=map.get(item.id);
      if(!old||new Date(item.updatedAt||item.createdAt||0)>=new Date(old.updatedAt||old.createdAt||0)){
        map.set(item.id,{...item,providers:normalizeProviders(item.providers)});
      }
    });
    const deleted=new Map();
    const combinedDeleted=pruneDeleted([...(remote.deleted||[]),...(local.deleted||[])]);
    combinedDeleted.forEach(entry=>{
      const old=deleted.get(entry.id);
      if(!old||new Date(entry.deletedAt)>new Date(old.deletedAt))deleted.set(entry.id,entry);
    });
    for(const [id,entry] of deleted){
      const item=map.get(id);
      if(item&&new Date(entry.deletedAt)>=new Date(item.updatedAt||item.createdAt||0))map.delete(id);
    }
    const ls=local.settings||{},rs=remote.settings||{},localKeys=ls.apiKeys||{},remoteKeys=rs.apiKeys||{};
    const localHas=!!(localKeys.tmdbKey||localKeys.omdbKey),remoteHas=!!(remoteKeys.tmdbKey||remoteKeys.omdbKey);
    let chosen;
    if(localHas&&remoteHas)chosen=new Date(ls.updatedAt||0)>=new Date(rs.updatedAt||0)?ls:rs;
    else if(localHas)chosen=ls;
    else if(remoteHas)chosen=rs;
    else chosen=new Date(ls.updatedAt||0)>=new Date(rs.updatedAt||0)?ls:rs;
    return {
      version:1,
      items:[...map.values()],
      deleted:pruneDeleted([...deleted.values()]),
      settings:{apiKeys:{tmdbKey:chosen?.apiKeys?.tmdbKey||"",omdbKey:chosen?.apiKeys?.omdbKey||""},updatedAt:chosen?.updatedAt||null},
      updatedAt:new Date().toISOString()
    };
  }
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
      if(e.target.closest("input,select,button,.quick-filters"))return;
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
      activeQuickFilter=null;
      render();
    };

    [area, emptyArea].forEach(el=>{
      if(!el)return;
      el.addEventListener("touchstart",onStart,{passive:true});
      el.addEventListener("touchend",onEnd,{passive:true});
    });
  }

  function events(){
    $("#add-open").onclick=openAdd;
    $("#empty-add").onclick=openAdd;
    $("#random-pick").onclick=pickRandomTitle;
    $("#search-back").onclick=closeSearchPage;
    $("#settings-open").onclick=()=>{fillSettings();$("#settings-dialog").showModal()};
    $$(".close-dialog").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));

    $$("dialog").forEach(dlg=>{
      dlg.addEventListener("click",(e)=>{
        if(e.target===dlg)dlg.close();
      });
    });

    $$(".tab").forEach(b=>b.onclick=()=>{activeView=b.dataset.kind;activeQuickFilter=null;render()});
    $$(".stat-action").forEach(b=>{b.onclick=()=>applyStatFilter(b.dataset.statFilter)});
    $("#search-input").oninput=render;
    $("#sort-select").onchange=render;

    $("#quick-filters").addEventListener("click",e=>{
      const clear=e.target.closest("[data-filter-clear]");
      if(clear){
        activeQuickFilter=null;
        render();
        return;
      }
      const pill=e.target.closest("[data-filter-type]");
      if(pill){
        const type=pill.dataset.filterType;
        const value=pill.dataset.filterValue;
        if(activeQuickFilter?.type===type && activeQuickFilter?.value===value){
          activeQuickFilter=null;
        }else{
          activeQuickFilter={type,value};
        }
        render();
      }
    });

    $("#search-title-button").onclick=searchTitles;
    $("#title-search").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchTitles()}});
    $("#search-results").addEventListener("click",e=>{const select=e.target.closest("[data-result]");if(select){e.stopPropagation();toggleSearchResult(Number(select.dataset.result));return}const poster=e.target.closest("[data-search-open]");if(poster)openSearchDetail(Number(poster.dataset.searchOpen))});
    $("#search-results").addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.matches("[data-search-open]")){e.preventDefault();openSearchDetail(Number(e.target.dataset.searchOpen))}});
    $("#add-selected").onclick=addSelectedResults;

    $("#manual-form").addEventListener("submit",e=>{
      e.preventDefault();
      const title=$("#manual-title").value.trim();
      if(!title){$("#add-error").textContent="Informe o título.";return}
      if(addItem({
        kind:$("#manual-kind").value||"movie",
        title,
        year:Number($("#manual-year").value)||null,
        imdb:Number($("#manual-imdb").value)||null,
        imdbSource:$("#manual-imdb").value.trim()?"manual":"",
        poster:$("#manual-poster").value.trim(),
        notes:$("#manual-notes")?.value.trim()||""
      },{keepDialog:true})){
        closeSearchPage();
        $("#manual-form").reset();
      }
    });

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
      const saveNoteBtn=e.target.closest("[data-save-note]");
      if(saveNoteBtn){
        const id=saveNoteBtn.dataset.saveNote;
        const input=$("#detail-note-input");
        if(input){
          updateItem(id,{notes:input.value.trim()},{reopen:false});
          toast("Nota pessoal salva.");
        }
        return;
      }
      const refreshBtn=e.target.closest("[data-refresh]");
      if(refreshBtn){
        const item=data.items.find(x=>x.id===refreshBtn.dataset.refresh);
        if(item){
          renderDetail(item,{refreshing:true});
          loadItemMetadata(item,{force:true});
        }
        return;
      }
      const del=e.target.closest("[data-delete]");
      if(del){
        deleteItemWithUndo(del.dataset.delete);
        return;
      }
      const edit=e.target.closest("[data-edit]");
      if(edit){
        const item=data.items.find(x=>x.id===edit.dataset.edit);
        if(item)renderDetail(item,{editing:true});
        return;
      }
      const cancelEdit=e.target.closest("[data-cancel-edit]");
      if(cancelEdit){
        const item=data.items.find(x=>x.id===cancelEdit.dataset.cancelEdit);
        if(item)renderDetail(item,{editing:false});
      }
    });

    $("#detail-content").addEventListener("keydown",e=>{
      if(e.key==="Enter" && e.target.id==="detail-note-input"){
        e.preventDefault();
        const id=e.target.dataset.noteId;
        updateItem(id,{notes:e.target.value.trim()},{reopen:false});
        toast("Nota pessoal salva.");
      }
    });

    $("#detail-content").addEventListener("submit",e=>{
      const form=e.target.closest("[data-edit-form]");
      if(!form)return;
      e.preventDefault();
      const id=form.dataset.editForm;
      const item=data.items.find(x=>x.id===id);
      if(!item)return;
      const title=$("#edit-title").value.trim()||item.title;
      const kind=$("#edit-kind").value||item.kind;
      const year=Number($("#edit-year").value)||null;
      const imdbVal=$("#edit-imdb").value.trim();
      const imdb=imdbVal!==""?Number(imdbVal):null;
      const poster=$("#edit-poster").value.trim();
      const notes=$("#edit-notes").value.trim();
      updateItem(id,{
        kind,
        title,
        year,
        imdb,
        imdbSource:imdbVal!==""?(item.imdbSource||"manual"):"",
        poster,
        notes
      });
      toast("Título atualizado.");
    });

    $("#save-settings").onclick=saveSettings;
    $("#save-api-keys").onclick=saveApiKeys;
    $("#test-sync").onclick=()=>{saveSettings();syncGitHub(true)};
    $("#sync-now").onclick=()=>{saveSettings();syncGitHub(false)};
    $("#export-data").onclick=exportData;
    $("#import-data").onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);e.target.value=""};
    $("#settings-form").addEventListener("submit",e=>e.preventDefault());
    setupSwipeSlider();
  }

  events();
  render();
  if("serviceWorker"in navigator&&location.protocol!=="file:")window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  const cfg=getConfig();
  if(cfg.owner&&cfg.repo&&cfg.token){
    setSyncState("connected","GitHub configurado");
    setTimeout(()=>syncGitHub(false), 1500);
  }
})();