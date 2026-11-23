(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const STORAGE = "minhaColecao.v1";
  const CONFIG = "minhaColecao.config.v1";
  const SORT_KEY = "minhaColecao.sort.v1";
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const emptyData = () => ({version:1,items:[],deleted:[],settings:{apiKeys:{tmdbKey:"",omdbKey:"",gbooksKey:""},updatedAt:null},updatedAt:new Date().toISOString()});

  const FALLBACK_LOGOS = {
    "amazon prime video": "https://image.tmdb.org/t/p/w92/pvske1MyAoymrs5bguRfVqYiM9a.jpg",
    "netflix": "https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg",
    "disney plus": "https://image.tmdb.org/t/p/w92/97yvRBw1GzX7fXprcF80er19ot.jpg",
    "max": "https://image.tmdb.org/t/p/w92/fksCUZ9QDWZMUwL2LgMtLckROUN.jpg",
    "globoplay": "https://image.tmdb.org/t/p/w92/7Cg8esVVXOijXAm1f1vrS7jVjcN.jpg",
    "apple tv+": "https://image.tmdb.org/t/p/w92/2E03IAZsX4ZaUqM7tXlctEPMGWS.jpg",
    "paramount+": "https://image.tmdb.org/t/p/w92/h5DcR0J2EESLitnhR8xLG1QymTE.jpg",
    "crunchyroll": "https://image.tmdb.org/t/p/w92/mXeC4TrcgdU6ltE9bCBCEORwSQR.jpg",
    "claro tv+": "https://image.tmdb.org/t/p/w92/hR9vWd8hWEVQKD6eOnBneKRFEW3.jpg",
    "mubi": "https://image.tmdb.org/t/p/w92/bVR4Z1LCHY7gidXAJF5pMa4QrDS.jpg"
  };

  let data = loadLocal();
  // URL do Cloudflare Worker (proxy do Google Books). Ex.: "https://livros.seu-usuario.workers.dev"
  // Se ficar vazio, o app consulta o Google Books diretamente (sujeito a limite de requisições).
  const BOOKS_PROXY = "";

  let activeView = "movie"; // "movie" | "tv" | "watched" | "book"
  let searchMode = "screen"; // "screen" (filmes/séries) | "book" (somente livros)
  let activeQuickFilter = null;
  let selectedSearch = new Map();
  let toastTimer;
  let lastDeleted = null;
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

  // Itens marcados como assistidos antes do recurso de ano: fixa a data atual de referência (updatedAt)
  function freezeWatchedAt(items){
    for(const it of items||[]){
      if(it.watched && !it.watchedAt)it.watchedAt=it.updatedAt||it.createdAt||null;
    }
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
      freezeWatchedAt(loaded.items);
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
  function highResPosterUrl(url){
    if(!url)return "";
    return String(url)
      .replace("https://image.tmdb.org/t/p/w500","https://image.tmdb.org/t/p/original")
      .replace("-M.jpg","-L.jpg")
      .replace("zoom=1","zoom=2");
  }
  function logoUrl(path){
    if(!path)return "";
    const str=String(path).trim();
    if(!str)return "";
    if(str.startsWith("http://")||str.startsWith("https://"))return str;
    return `https://image.tmdb.org/t/p/w92${str.startsWith("/")?str:`/${str}`}`;
  }

  function kindLabel(kind){
    return kind==="book"?"Livro":kind==="tv"?"Série":"Filme";
  }

  function kindEyebrow(kind){
    return kind==="book"?"LIVRO":kind==="tv"?"SÉRIE":"FILME";
  }

  function cleanProviderName(rawName=""){
    let name=String(rawName||"").trim();
    if(!name)return "";
    if(/amazon\s+channel/i.test(name) || /prime\s+video/i.test(name) || /^amazon\s+prime/i.test(name)){
      return "Amazon Prime Video";
    }
    name=name
      .replace(/\s+(standard|basic)\s+with\s+ads$/i,"")
      .replace(/\s+with\s+ads$/i,"")
      .replace(/\s+padrão\s+com\s+anúncios$/i,"")
      .replace(/\s+com\s+anúncios$/i,"")
      .trim();
    if(/^netflix/i.test(name))return "Netflix";
    if(/^disney\s*\+/i.test(name) || /^disney\s+plus/i.test(name))return "Disney Plus";
    if(/^hbo\s+max/i.test(name) || /^max$/i.test(name))return "Max";
    if(/^paramount\s*\+/i.test(name) || /^paramount\s+plus/i.test(name))return "Paramount+";
    if(/^apple\s+tv\s*\+?/i.test(name))return "Apple TV+";
    if(/^claro\s*(tv\+|video)/i.test(name))return "Claro tv+";
    return name;
  }

  function normalizeProviders(providers){
    if(!Array.isArray(providers))return [];
    const map=new Map();
    for(const p of providers){
      const rawName=typeof p==="string"?p.trim():(p?.name||p?.provider_name||"").trim();
      const name=cleanProviderName(rawName);
      if(!name)continue;
      const key=name.toLowerCase();
      const rawLogo=typeof p==="object" && p!==null ? (p.logo || p.logo_path || "") : "";
      const resolvedLogo=logoUrl(rawLogo) || FALLBACK_LOGOS[key] || "";
      const isExact=rawName.toLowerCase()===key;

      const existing=map.get(key);
      if(!existing){
        map.set(key,{name, logo:resolvedLogo, isExact});
      }else{
        if((!existing.logo && resolvedLogo) || (isExact && !existing.isExact && resolvedLogo)){
          existing.logo=resolvedLogo;
        }
        if(isExact)existing.isExact=true;
      }
    }
    return [...map.values()].map(({name,logo})=>({name,logo:logo||FALLBACK_LOGOS[name.toLowerCase()]||""}));
  }

  function hasValidProviderLogos(item){
    if(item.kind==="book")return true;
    if(!Array.isArray(item.providers))return false;
    if(item.providers.length===0)return Boolean(item.metaCheckedAt);
    return item.providers.every(p=>typeof p==="object" && p!==null && Boolean(p.logo));
  }

  function getBaseViewItems(){
    if(activeView==="watched")return data.items.filter(x=>x.watched && x.kind!=="book");
    if(activeView==="book")return data.items.filter(x=>x.kind==="book");
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
    const genreMap=new Map();

    for(const item of baseItems){
      if(Array.isArray(item.genres)){
        for(const g of item.genres){
          const clean=String(g||"").trim();
          if(!clean)continue;
          genreMap.set(clean,(genreMap.get(clean)||0)+1);
        }
      }
    }

    // a barra mostra apenas gêneros (filtro por streaming removido da interface)
    if(activeQuickFilter && !(activeQuickFilter.type==="genre" && genreMap.has(activeQuickFilter.value)))activeQuickFilter=null;

    const genres=[...genreMap.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],"pt-BR")).slice(0,10);

    if(!genres.length){
      container.hidden=true;
      container.innerHTML="";
      return;
    }

    container.hidden=false;
    const allActive=!activeQuickFilter;
    let html=`<button type="button" class="filter-pill ${allActive?"active":""}" data-filter-clear="1">Todos</button>`;

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
      list=list.filter(x=>`${x.title} ${x.year||""} ${x.author||""} ${x.notes||""}`.toLocaleLowerCase("pt-BR").includes(q));
    }

    list.sort((a,b)=>{
      if(activeView==="book" && Boolean(a.watched)!==Boolean(b.watched)){
        return Number(Boolean(a.watched)) - Number(Boolean(b.watched));
      }
      return sort==="title"?a.title.localeCompare(b.title,"pt-BR")
        :sort==="imdb"?(Number(b.imdb)||0)-(Number(a.imdb)||0)
        :sort==="myRating"?(b.myRating||0)-(a.myRating||0)
        :sort==="year"?(b.year||0)-(a.year||0)
        :activeView==="watched"?watchedTime(b)-watchedTime(a)
        :new Date(b.createdAt)-new Date(a.createdAt);
    });
    return list;
  }

  // Data em que foi assistido. Itens antigos (sem watchedAt) usam a última atualização como aproximação.
  function watchedTime(item){return new Date(item.watchedAt||item.updatedAt||item.createdAt||0).getTime()||0}
  function watchedYear(item){const t=watchedTime(item);return t?new Date(t).getFullYear():0}

  const MOOD_COLORS=["#bd91ff","#f77ca8","#ffc857","#57d6a1","#6fb1ff"];

  // Minutos por ano de um título: filme = ano em que foi marcado; série com episódios marcados = ano de cada episódio;
  // série concluída sem registro de episódios (antiga) = estimativa (duração × nº de episódios) no ano em que foi marcada.
  function yearContrib(item){
    const out=new Map();
    if(item.kind==="book")return out;
    const add=(y,m)=>{if(y)out.set(y,(out.get(y)||0)+m)};
    const log=getLog(item);
    if(item.kind==="tv"&&log.length){
      for(const x of log)add(new Date(x.at).getFullYear(),Number(x.min)||0);
    }else if(item.watched){
      add(watchedYear(item),totalMinutes(item));
    }
    return out;
  }

  // Resumo do ano: gêneros mais assistidos + tempo total
  function yearMood(year,members){
    const genres=new Map();
    let minutes=0,missing=0;
    for(const it of members){
      for(const g of (Array.isArray(it.genres)?it.genres:[])){
        const n=String(g||"").trim();
        if(n)genres.set(n,(genres.get(n)||0)+1);
      }
      const m=yearContrib(it).get(year)||0;
      if(m)minutes+=m;else missing++;
    }
    const top=[...genres.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"pt-BR")).slice(0,5);
    const bar=top.length?`<div class="mood-bar" aria-hidden="true">${top.map(([n,c],i)=>`<i style="flex:${c};background:${MOOD_COLORS[i]}" title="${escapeHtml(n)}: ${c}"></i>`).join("")}</div>`:"";
    const chips=top.slice(0,3).map(([n,c],i)=>`<span class="mood-chip"><i style="background:${MOOD_COLORS[i]}"></i>${escapeHtml(n)}<b>${c}</b></span>`).join("");
    let time="";
    if(minutes>0){
      const h=Math.floor(minutes/60),mm=minutes%60;
      const hours=h>0?` · ${h} h${mm?` ${mm} min`:""}`:"";
      const note=missing?`${missing} sem duração informada`:"";
      time=`<span class="mood-time" title="${note}">⏱ <b>${minutes.toLocaleString("pt-BR")}</b> min<small>${hours}${missing?" +":""}</small></span>`;
    }else if(members.some(x=>x.kind!=="book"&&x.tmdbId&&!x.runtime&&!x.runtimeCheckedAt)){
      time=`<span class="mood-time mood-loading">⏱ calculando duração…</span>`;
    }
    if(!chips&&!time)return "";
    return `<div class="year-mood">${chips?`<div class="mood-genres">${chips}</div>`:""}${time}${top.length?bar:""}</div>`;
  }

  function renderGrid(list){
    if(activeView!=="watched")return list.map(card).join("");
    const filtering=Boolean($("#search-input").value.trim()||activeQuickFilter);
    // sem filtros: o tempo do ano inclui também episódios de séries ainda em andamento
    const candidates=filtering?list:data.items.filter(x=>x.kind!=="book");
    const cardsByYear=new Map();
    for(const item of list){
      const y=watchedYear(item);
      if(!cardsByYear.has(y))cardsByYear.set(y,[]);
      cardsByYear.get(y).push(item);
    }
    const years=new Set(cardsByYear.keys());
    for(const it of candidates)for(const y of yearContrib(it).keys())years.add(y);
    return [...years].sort((a,b)=>b-a).map(y=>{
      const items=cardsByYear.get(y)||[];
      const members=y?candidates.filter(it=>yearContrib(it).has(y)):items;
      const label=y||"Sem data";
      const count=items.length?`${items.length} ${items.length===1?"título":"títulos"}`:"séries em andamento";
      return `<div class="year-divider"><div class="year-head" role="heading" aria-level="3"><span class="year-label">${label}</span><span class="year-count">${count}</span></div>${yearMood(y,members)}</div>${items.map(card).join("")}`;
    }).join("");
  }

  function stars(item){
    const current=item.myRating||0;
    return `<div class="stars" aria-label="Minha avaliação: ${current} de 5">${[1,2,3,4,5].map(n=>`<button class="star ${n<=current?"filled":""}" data-rate="${n}" data-id="${item.id}" aria-label="${n===current?"Remover avaliação":`Avaliar com ${n} estrelas`}">★</button>`).join("")}<span class="stars-label">${current?`${current}/5`:"Sua nota"}</span></div>`;
  }

  function card(item){
    const poster=item.poster?`<img class="poster" src="${escapeHtml(item.poster)}" alt="Pôster de ${escapeHtml(item.title)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="poster-placeholder">${escapeHtml(item.title.slice(0,1).toUpperCase())}</div>`;
    const kindBadge=activeView==="watched"?` · ${kindLabel(item.kind)}`:"";
    const noteIndicator=item.notes?`<span class="note-dot" title="${escapeHtml(item.notes)}">✎</span>`:"";
    const scoreLabel=item.kind==="book"?"Aval.":"IMDb";
    const doneRibbon=item.watched?`<span class="watched-ribbon">${item.kind==="book"?"✓ LIDO":"✓ ASSISTIDO"}</span>`:"";
    return `<article class="media-card ${item.watched && item.kind==="book"?"is-read":""}" data-card="${item.id}"><div class="poster-wrap" data-open="${item.id}">${poster}<span class="imdb-badge"><b>${scoreLabel}</b> ${item.imdb?Number(item.imdb).toFixed(1):"—"}</span>${doneRibbon}${epCardBadge(item)}<button class="card-menu" data-menu="${item.id}" aria-label="Opções de ${escapeHtml(item.title)}">⋯</button></div><div class="media-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div><div class="media-meta">${item.year||"Ano não informado"}${kindBadge}${noteIndicator}</div>${stars(item)}</article>`;
  }

  function render(){
    renderQuickFilters();
    const list=getItems();
    const pendingMovies=data.items.filter(x=>!x.watched && x.kind==="movie").length;
    const pendingSeries=data.items.filter(x=>!x.watched && x.kind==="tv").length;
    const totalBooks=data.items.filter(x=>x.kind==="book").length;
    const watchedTotal=data.items.filter(x=>x.watched && x.kind!=="book").length;

    $("#collection-grid").innerHTML=renderGrid(list);
    if(activeView==="watched")setTimeout(()=>ensureRuntimes(list),0);
    $("#movie-count").textContent=pendingMovies;
    $("#series-count").textContent=pendingSeries;
    $("#watched-count").textContent=watchedTotal;
    $("#book-count").textContent=totalBooks;
    $("#tab-movie-count").textContent=pendingMovies;
    $("#tab-tv-count").textContent=pendingSeries;
    $("#tab-book-count").textContent=totalBooks;

    const isWatched=activeView==="watched";
    const isBook=activeView==="book";
    $("#library-eyebrow").textContent=isWatched?"HISTÓRICO":isBook?"SUA ESTANTE":"EXPLORE SUA LISTA";
    $("#library-title").textContent=isWatched?"Já assisti":isBook?"Meus livros":"Minha biblioteca";

    const addBtn=$("#add-open");
    if(addBtn){
      addBtn.innerHTML=isBook?'<span>＋</span> Adicionar livro':'<span>＋</span> Adicionar título';
    }

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
      }else if(isBook){
        $("#empty-title").textContent="Sua próxima leitura começa aqui";
        $("#empty-copy").textContent="Busque e adicione os livros que você deseja ler nesta seção.";
        $("#empty-add").textContent="＋ Adicionar primeiro livro";
        $("#empty-add").hidden=false;
      }else{
        $("#empty-title").textContent="Sua próxima maratona começa aqui";
        $("#empty-copy").textContent="Adicione filmes e séries que você quer acompanhar. Eles ficarão organizados nesta biblioteca.";
        $("#empty-add").textContent="＋ Adicionar primeiro título";
        $("#empty-add").hidden=false;
      }
    }
  }

  function applyStatFilter(filter){
    $("#search-input").value="";
    activeQuickFilter=null;
    activeView=filter;
    render();
    // sem scrollIntoView: a página não deve "pular" ao trocar de categoria
  }

  function pickRandomTitle(){
    const pool=activeView==="book"?getItems().filter(x=>!x.watched):getItems();
    const list=pool.length?pool:getItems();
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
      author:item.author||"",
      year:item.year||null,
      poster:item.poster||"",
      overview:item.overview||"",
      overviewLanguage:item.overviewLanguage||"",
      overviewCheckedAt:item.overviewCheckedAt||null,
      providers:item.kind==="book"?[]:normalizeProviders(item.providers||[]),
      genres:Array.isArray(item.genres)?item.genres:[],
      trailerUrl:item.trailerUrl||"",
      runtime:item.runtime||null,
      episodes:item.episodes||null,
      runtimeCheckedAt:item.runtimeCheckedAt||null,
      studio:item.studio||"",
      notes:item.notes||"",
      metaCheckedAt:item.metaCheckedAt||null,
      imdb:item.imdb||null,
      imdbId:item.imdbId||"",
      imdbCheckedAt:item.imdbCheckedAt||null,
      imdbSource:item.imdbSource||"",
      tmdbId:item.tmdbId||null,
      bookId:item.bookId||"",
      openLibKey:item.openLibKey||"",
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
    if(item.kind==="book"){
      let bookHtml="";
      if(item.author){
        bookHtml+=`<p class="detail-provider"><strong>Autor(a):</strong> ${escapeHtml(item.author)}</p>`;
      }
      if(item.studio){
        bookHtml+=`<p class="detail-provider"><strong>Editora:</strong> ${escapeHtml(item.studio)}</p>`;
      }
      if(Array.isArray(item.genres) && item.genres.length){
        bookHtml+=`<p class="detail-genres">${item.genres.map(g=>`<span>${escapeHtml(g)}</span>`).join(" · ")}</p>`;
      }
      return bookHtml;
    }

    const providers=normalizeProviders(item.providers);
    let html="";
    if(providers.length){
      const badges=providers.map(p=>{
        const img=p.logo?`<img src="${escapeHtml(p.logo)}" alt="" class="provider-chip-logo" loading="lazy" onerror="this.style.display='none'">`:"";
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
    if(item.kind==="book"){
      const q=encodeURIComponent(`${item.title} ${item.author||""} livro resenha`.trim());
      return `https://www.youtube.com/results?search_query=${q}`;
    }
    if(item.trailerUrl)return item.trailerUrl;
    const q=encodeURIComponent(`${item.title} ${item.year||""} trailer legendado`.trim());
    return `https://www.youtube.com/results?search_query=${q}`;
  }

  // ===== Acompanhamento de episódios (séries) =====
  const get=id=>data.items.find(x=>x.id===id);
  const todayStr=()=>new Date().toISOString().slice(0,10);
  const epId=(s,e)=>`${s}:${e}`;
  const getLog=item=>Array.isArray(item.watchLog)?item.watchLog:[];
  const seasonList=item=>Array.isArray(item.seasons)?item.seasons:[];
  const tmdbKeyNow=()=>{const c=getConfig();return c.tmdbKey||data.settings?.apiKeys?.tmdbKey||""};
  const epViewSeason={},epPanelOpen={};
  let epBusy=false;

  function detailShowing(id){
    return $("#detail-dialog").open && !$("#inline-edit-form") && $("#detail-content [data-toggle-watched]")?.dataset.toggleWatched===id;
  }
  function rerenderDetailIf(id){const it=get(id);if(it&&detailShowing(id))renderDetail(it)}

  function epAvailable(season,ep){
    const t=todayStr();
    if(ep&&ep.a)return ep.a<=t;
    return !!(season.air&&season.air<=t);
  }
  function seasonAvailCount(item,season){
    const eps=item.seasonEps?.[season.n];
    if(eps)return eps.filter(ep=>epAvailable(season,ep)).length;
    return season.air&&season.air<=todayStr()?season.count:0;
  }
  // "Em dia": todas as temporadas já lançadas estão totalmente assistidas
  function isCaughtUp(item){
    const released=seasonList(item).filter(se=>se.air&&se.air<=todayStr());
    const log=getLog(item);
    if(!released.length||!log.length)return false;
    return released.every(se=>{
      const avail=seasonAvailCount(item,se);
      return log.filter(x=>x.s===se.n).length>=avail;
    });
  }
  function epProgress(item){
    if(item.kind!=="tv")return null;
    const log=getLog(item);
    if(!log.length)return null;
    const last=log.reduce((a,b)=>(b.s>a.s||(b.s===a.s&&b.e>a.e))?b:a);
    const season=seasonList(item).find(x=>x.n===last.s);
    return {s:last.s,count:log.filter(x=>x.s===last.s).length,total:season?season.count:0};
  }
  function epCardBadge(item){
    const p=epProgress(item);
    if(!p||item.watched)return "";
    const pct=p.total?Math.min(100,Math.round(p.count/p.total*100)):0;
    return `<span class="ep-badge">T${p.s} · ${p.count}${p.total?`/${p.total}`:" ep."}</span>${p.total?`<div class="ep-progress"><i style="width:${pct}%"></i></div>`:""}`;
  }

  async function fetchTvSeasons(key,tmdbId){
    const json=await fetchJsonTimeout(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${encodeURIComponent(key)}&language=pt-BR`,10000);
    const seasons=(json.seasons||[]).filter(x=>x.season_number>0&&x.episode_count>0)
      .map(x=>({n:x.season_number,count:x.episode_count,air:x.air_date||null}));
    return {seasons,status:json.status||"",rt:runtimeFromDetail("tv",json)};
  }
  async function fetchSeasonEps(key,tmdbId,n){
    const json=await fetchJsonTimeout(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${n}?api_key=${encodeURIComponent(key)}&language=pt-BR`,10000);
    return (json.episodes||[]).map(e=>({e:e.episode_number,r:e.runtime||null,t:e.name||"",a:e.air_date||null}));
  }
  async function ensureTvSeasons(item){
    if(item.kind!=="tv"||!item.tmdbId||seasonList(item).length)return false;
    const key=tmdbKeyNow();if(!key)return false;
    try{
      const r=await fetchTvSeasons(key,item.tmdbId);
      const cur=get(item.id);if(!cur||!r.seasons.length)return false;
      cur.seasons=r.seasons;cur.tvStatus=r.status;
      if(!cur.runtime&&r.rt.runtime){cur.runtime=r.rt.runtime;cur.episodes=r.rt.episodes;cur.runtimeCheckedAt=new Date().toISOString()}
      return true;
    }catch{return false}
  }
  async function ensureSeasonEps(item,n){
    if(get(item.id)?.seasonEps?.[n])return true;
    const key=tmdbKeyNow();if(!key||!item.tmdbId)return false;
    try{
      const eps=await fetchSeasonEps(key,item.tmdbId,n);
      const cur=get(item.id);if(!cur)return false;
      cur.seasonEps={...(cur.seasonEps||{}),[n]:eps};
      return true;
    }catch{return false}
  }
  function epMinutes(item,s,e){
    const ep=item.seasonEps?.[s]?.find(x=>x.e===e);
    return ep?.r||item.runtime||0;
  }

  // Grava o novo registro de episódios; conclui a série sozinha ao ficar em dia (ou a reabre se deixar de estar)
  function applyLog(id,newLog,note){
    const item=get(id);if(!item)return;
    const patch={watchLog:newLog};
    const caught=isCaughtUp({...item,watchLog:newLog});
    let finished=false;
    if(!item.watched&&caught){patch.watched=true;patch.watchedAt=new Date().toISOString();patch.completedByEpisodes=true;finished=true}
    else if(item.watched&&item.completedByEpisodes&&!caught){patch.watched=false;patch.watchedAt=null;patch.completedByEpisodes=false}
    updateItem(id,patch);
    toast(finished?"Última temporada lançada concluída! Série movida para Assistidos.":(note||"Progresso atualizado."));
  }

  async function markNextEpisode(id){
    if(epBusy)return;epBusy=true;
    try{
      let item=get(id);if(!item||item.kind!=="tv")return;
      if(!tmdbKeyNow()||!item.tmdbId){toast("Configure a chave TMDB em Ajustes para acompanhar episódios.");return}
      if(!seasonList(item).length){
        if(!await ensureTvSeasons(item)){toast("Não foi possível carregar as temporadas agora.");return}
        item=get(id);
      }
      const seen=new Set(getLog(item).map(x=>epId(x.s,x.e)));
      let target=null;
      for(const se of seasonList(item)){
        if(!(se.air&&se.air<=todayStr()))continue;
        if(!await ensureSeasonEps(item,se.n)){toast("Falha ao carregar a temporada. Tente novamente.");return}
        item=get(id);
        const next=(item.seasonEps[se.n]||[]).find(ep=>epAvailable(se,ep)&&!seen.has(epId(se.n,ep.e)));
        if(next){target={s:se.n,e:next.e};break}
      }
      if(!target){
        if(!item.watched&&isCaughtUp(item))applyLog(id,getLog(item));
        else toast("Você já assistiu a todos os episódios lançados.");
        return;
      }
      const entry={s:target.s,e:target.e,at:new Date().toISOString(),min:epMinutes(item,target.s,target.e)};
      applyLog(id,[...getLog(item),entry],`Temporada ${entry.s}, episódio ${entry.e} marcado.`);
    }finally{epBusy=false}
  }
  function undoLastEpisode(id){
    const item=get(id);if(!item)return;
    const log=getLog(item);if(!log.length)return;
    const last=log[log.length-1];
    applyLog(id,log.slice(0,-1),`Temporada ${last.s}, episódio ${last.e} desmarcado.`);
  }
  async function toggleEpisode(id,s,e,on){
    const item=get(id);if(!item)return;
    const log=getLog(item).filter(x=>!(x.s===s&&x.e===e));
    if(on)log.push({s,e,at:new Date().toISOString(),min:epMinutes(item,s,e)});
    applyLog(id,log);
  }
  async function markSeason(id,n,on){
    if(epBusy)return;epBusy=true;
    try{
      const item=get(id);if(!item)return;
      let log=getLog(item).filter(x=>x.s!==n);
      if(on){
        if(!await ensureSeasonEps(item,n)){toast("Falha ao carregar a temporada.");return}
        const cur=get(id),se=seasonList(cur).find(x=>x.n===n);
        const old=getLog(cur).filter(x=>x.s===n);
        const keep=new Map(old.map(x=>[x.e,x]));
        for(const ep of cur.seasonEps[n]||[]){
          if(se&&!epAvailable(se,ep))continue;
          log.push(keep.get(ep.e)||{s:n,e:ep.e,at:new Date().toISOString(),min:ep.r||cur.runtime||0});
        }
      }
      applyLog(id,log,on?`Temporada ${n} marcada como assistida.`:`Temporada ${n} desmarcada.`);
    }finally{epBusy=false}
  }
  async function loadSeasonView(id,n){
    const item=get(id);if(!item||item.seasonEps?.[n])return;
    if(await ensureSeasonEps(item,n)){saveLocal();rerenderDetailIf(id)}
  }

  function episodeSection(item){
    if(item.kind!=="tv"||!item.tmdbId)return "";
    const seasons=seasonList(item),log=getLog(item);
    const minutes=log.reduce((t,x)=>t+(x.min||0),0);
    const prog=epProgress(item);
    const summary=log.length
      ? `${log.length} ${log.length===1?"episódio assistido":"episódios assistidos"}${minutes?` · ${minutes.toLocaleString("pt-BR")} min`:""}${prog&&prog.total?` · Temporada ${prog.s}: ${prog.count} de ${prog.total}`:""}`
      : "Nenhum episódio marcado ainda";
    const sel=epViewSeason[item.id]||prog?.s||seasons[0]?.n||1;
    const open=epPanelOpen[item.id];
    let list="";
    if(open&&seasons.length){
      const eps=item.seasonEps?.[sel];
      const seen=new Set(log.map(x=>epId(x.s,x.e)));
      const se=seasons.find(x=>x.n===sel)||{n:sel};
      list=eps
        ? `<div class="ep-list">${eps.map(ep=>{
            const ok=epAvailable(se,ep);
            return `<label class="ep-row ${ok?"":"ep-future"}"><input type="checkbox" data-ep-check data-s="${sel}" data-e="${ep.e}" ${seen.has(epId(sel,ep.e))?"checked":""} ${ok?"":"disabled"}><span class="ep-num">E${ep.e}</span><span class="ep-title">${escapeHtml(ep.t||"Episódio "+ep.e)}</span><span class="ep-min">${ep.r?ep.r+" min":(ok?"":"em breve")}</span></label>`;
          }).join("")}</div>`
        : `<p class="field-hint">Carregando episódios…</p>`;
    }
    const options=seasons.map(x=>`<option value="${x.n}" ${x.n===sel?"selected":""}>Temporada ${x.n}</option>`).join("");
    return `<section class="ep-tracker">
      <div class="ep-head"><h3>Episódios</h3><span class="ep-summary">${summary}</span></div>
      <div class="ep-actions">
        <button type="button" class="primary-button" data-ep-next="${item.id}">＋ 1 episódio assistido</button>
        <button type="button" class="secondary-button" data-ep-undo="${item.id}" ${log.length?"":"disabled"}>↶ Desfazer último</button>
      </div>
      ${seasons.length?`<details class="ep-details" data-ep-details="${item.id}" ${open?"open":""}>
        <summary>Marcar por temporada</summary>
        <div class="ep-season-bar"><select data-ep-season="${item.id}" aria-label="Temporada">${options}</select>
          <button type="button" class="secondary-button" data-ep-season-all="${item.id}" data-s="${sel}">Marcar toda</button>
          <button type="button" class="secondary-button" data-ep-season-none="${item.id}" data-s="${sel}">Limpar</button></div>
        ${list}
      </details>`:`<p class="field-hint">Carregando temporadas…</p>`}
    </section>`;
  }

  let lightboxToken=0;
  function openPosterLightbox(src, alt="Capa ampliada"){
    if(!src)return;
    const dlg=$("#poster-lightbox");
    const img=$("#lightbox-img");
    if(!dlg || !img)return;
    const token=++lightboxToken;
    // 1) mostra já a capa pequena (que o navegador tem em cache), sem resquício da anterior
    img.removeAttribute("srcset");
    img.src=src;
    img.alt=alt;
    // 2) baixa a versão grande em segundo plano e troca só quando estiver pronta
    const hi=highResPosterUrl(src);
    if(hi && hi!==src){
      const loader=new Image();
      loader.onload=()=>{if(token===lightboxToken)img.src=hi};
      loader.src=hi; // se falhar, permanece a capa pequena
    }
    dlg.showModal();
  }

  function renderDetail(item, {editing=false, refreshing=false}={}){
    const poster=item.poster
      ? `<button type="button" class="detail-poster-btn" data-zoom-poster="${escapeHtml(item.poster)}" data-zoom-title="${escapeHtml(item.title)}" title="Ampliar capa" aria-label="Ver capa de ${escapeHtml(item.title)} em tela cheia"><img class="detail-poster" src="${escapeHtml(item.poster)}" alt="Pôster de ${escapeHtml(item.title)}"><span class="poster-zoom-badge" aria-hidden="true">⤢</span></button>`
      : `<div class="detail-poster poster-placeholder">${escapeHtml(item.title[0]||"?")}</div>`;
    const current=item.myRating||0;
    const clearBtn=current>0?`<button type="button" class="clear-stars-btn" data-detail-rate="0" data-id="${item.id}" title="Zerar estrelas" aria-label="Zerar estrelas">✕ Zerar</button>`:"";
    const trailerHref=getTrailerLink(item);
    const isBook=item.kind==="book";

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
                <option value="book" ${item.kind==="book"?"selected":""}>Livro</option>
              </select>
            </label>
            <label class="field-label full">Título
              <input id="edit-title" required maxlength="140" value="${escapeHtml(item.title)}">
            </label>
            <label class="field-label">Ano
              <input id="edit-year" type="number" min="1000" max="2100" value="${escapeHtml(item.year||"")}">
            </label>
            <label class="field-label">Nota (0 a 10)
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

    const synopsis=item.overview
      ? `<section class="detail-synopsis"><h3>Sinopse</h3><p>${escapeHtml(item.overview)}</p>${item.overviewLanguage&&item.overviewLanguage!=="pt-BR"?'<small class="synopsis-note">Sinopse no idioma original disponível.</small>':""}</section>`
      : `<section class="detail-synopsis"><h3>Sinopse</h3><p class="synopsis-muted">${item.tmdbId?"Carregando sinopse…":"Sinopse não disponível para este cadastro."}</p></section>`;

    const notesSection=`
      <section class="detail-notes">
        <label class="field-label" for="detail-note-input">Notas pessoais / Quem indicou</label>
        <div class="note-row">
          <input id="detail-note-input" type="text" maxlength="240" placeholder="Ex.: Indicação do João · Ler no fim de semana" value="${escapeHtml(item.notes||"")}" data-note-id="${item.id}">
          <button type="button" class="secondary-button note-save-btn" data-save-note="${item.id}">Salvar nota</button>
        </div>
      </section>`;

    const statusBadge=isBook
      ? (item.watched?"LIDO":"QUERO LER")
      : (item.watched?"ASSISTIDO":"QUERO ASSISTIR");

    const toggleLabel=isBook
      ? (item.watched?"↶ Marcar como não lido":"✓ Marcar como lido")
      : (item.watched?"↶ Marcar como não assistido":"✓ Marcar como assistido");

    const scorePrefix=isBook?"★ Avaliação":"★ IMDb";
    const videoBtnLabel=isBook?"▶ Resenhas":"▶ Trailer";

    $("#detail-content").innerHTML=`
      <div class="detail-layout">
        ${poster}
        <div class="detail-info">
          <p class="eyebrow">${kindEyebrow(item.kind)} · ${statusBadge}</p>
          <h2>${escapeHtml(item.title)}</h2>
          <p>${item.year||"Ano não informado"}</p>
          ${renderWhereToWatch(item)}
          <div class="detail-rating-row">
            <div class="detail-rating">${scorePrefix} ${item.imdb?Number(item.imdb).toFixed(1):"Sem nota"}</div>
            <a class="trailer-btn" href="${escapeHtml(trailerHref)}" target="_blank" rel="noopener noreferrer">${videoBtnLabel}</a>
          </div>
          ${runtimeLine(item)?`<p class="detail-runtime">${runtimeLine(item)}</p>`:""}
          <p>Minha avaliação</p>
          <div class="detail-stars">${[1,2,3,4,5].map(n=>`<button type="button" class="star ${n<=current?"filled":""}" data-detail-rate="${n}" data-id="${item.id}" aria-label="${n===current?"Zerar estrelas":`${n} estrelas`}">★</button>`).join("")}${clearBtn}</div>
        </div>
      </div>
      ${episodeSection(item)}
      ${synopsis}
      ${notesSection}
      <div class="detail-actions">
        <button type="button" class="secondary-button" data-toggle-watched="${item.id}">${toggleLabel}</button>
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

  // Duração: filme = minutos totais; série = minutos por episódio + nº de episódios
  function runtimeFromDetail(kind,d){
    if(!d)return {runtime:null,episodes:null};
    if(kind==="movie")return {runtime:Number(d.runtime)||null,episodes:null};
    const ep=(Array.isArray(d.episode_run_time)?d.episode_run_time.find(n=>n>0):0)||d.last_episode_to_air?.runtime||d.next_episode_to_air?.runtime||null;
    return {runtime:ep?Number(ep):null,episodes:Number(d.number_of_episodes)||null};
  }
  function applyRuntime(target,meta){
    if(meta && meta.runtime){
      target.runtime=meta.runtime;
      target.episodes=meta.episodes||null;
      target.runtimeCheckedAt=new Date().toISOString();
    }
  }
  async function fetchRuntimeInfo(key,kind,tmdbId){
    const res=await fetchJsonTimeout(`https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${encodeURIComponent(key)}&language=pt-BR`,10000);
    return runtimeFromDetail(kind,res);
  }
  function totalMinutes(item){
    if(item.kind==="book"||!item.runtime)return 0;
    return item.kind==="tv"?item.runtime*(item.episodes||1):item.runtime;
  }
  function formatMinutes(n){return `${Number(n).toLocaleString("pt-BR")} ${Number(n)===1?"minuto":"minutos"}`}
  function runtimeLine(item){
    if(item.kind==="book"||!item.runtime)return "";
    if(item.kind==="tv"){
      const eps=item.episodes?` · ${item.episodes} ${item.episodes===1?"episódio":"episódios"}`:"";
      return `⏱ ${item.runtime} min por episódio${eps}`;
    }
    return `⏱ ${formatMinutes(item.runtime)}`;
  }

  // Preenche a duração de títulos antigos (cadastrados antes deste recurso), em segundo plano.
  let runtimeBusy=false;
  async function ensureRuntimes(items){
    const cfg=getConfig(),key=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey;
    if(!key||runtimeBusy)return;
    const todo=items.filter(x=>x.kind!=="book"&&x.tmdbId&&!x.runtime&&!x.runtimeCheckedAt);
    if(!todo.length)return;
    runtimeBusy=true;
    let changed=false;
    try{
      for(const it of todo){
        try{
          const info=await fetchRuntimeInfo(key,it.kind,it.tmdbId);
          const cur=data.items.find(x=>x.id===it.id);
          if(cur){ // não altera updatedAt: é só um dado derivado
            cur.runtime=info.runtime;cur.episodes=info.episodes;cur.runtimeCheckedAt=new Date().toISOString();
            changed=true;
          }
        }catch{/* sem rede/limite: tenta de novo mais tarde */}
      }
    }finally{runtimeBusy=false}
    if(changed){
      saveLocal();
      const d=$("#detail-dialog");
      if(d?.open){
        const openId=$("#detail-content [data-toggle-watched]")?.dataset.toggleWatched;
        if(openId)rerenderDetailIf(openId);
      }
    }
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
    let rt={runtime:null,episodes:null};

    if(detailResPt && detailResPt.ok){
      const d=await detailResPt.json();
      rt=runtimeFromDetail(kind,d);
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
        if(!rt.runtime)rt=runtimeFromDetail(kind,dEn);
      }
    }

    let providers=[];
    if(provRes && provRes.ok){
      const pJson=await provRes.json();
      const br=pJson.results?.BR;
      const flatrate=br?.flatrate||[];
      providers=normalizeProviders(flatrate);
    }

    return {overview, language, providers, studio, genres, trailerUrl, runtime:rt.runtime, episodes:rt.episodes};
  }

  async function fetchOpenLibrarySynopsis(item){
    if(!item.openLibKey || item.overview)return;
    try{
      const json=await fetchJsonTimeout(`https://openlibrary.org${item.openLibKey}.json`,8000);
      const desc=typeof json.description==="string"?json.description:(json.description?.value||"");
      if(desc){
        item.overview=desc;
        item.overviewLanguage="en";
        item.overviewCheckedAt=new Date().toISOString();
      }
    }catch{}
  }

  async function refreshBookMetadata(item){
    try{
      const books=await searchBooksOnly(item.title);
      const hit=books[0];
      if(!hit){
        if($("#detail-dialog").open)renderDetail(item);
        toast("Livro não encontrado para atualizar.");
        return;
      }
      if(!hit.overview && hit.openLibKey){
        await fetchOpenLibrarySynopsis(hit);
      }
      const current=data.items.find(x=>x.id===item.id);
      if(!current)return;
      current.overview=hit.overview||current.overview||"";
      current.overviewLanguage=hit.overview?hit.overviewLanguage:(current.overviewLanguage||"");
      current.overviewCheckedAt=new Date().toISOString();
      current.author=hit.author||current.author||"";
      current.studio=hit.studio||current.studio||"";
      current.genres=hit.genres?.length?hit.genres:(current.genres||[]);
      if(!current.poster && hit.poster)current.poster=hit.poster;
      if(!current.imdb && hit.imdb)current.imdb=hit.imdb;
      current.metaCheckedAt=new Date().toISOString();
      current.updatedAt=new Date().toISOString();
      saveLocal();
      if($("#detail-dialog").open)renderDetail(current);
      toast("Dados do livro atualizados.");
    }catch{
      if($("#detail-dialog").open)renderDetail(item);
      toast("Falha ao atualizar os dados do livro.");
    }
  }

  async function loadItemMetadata(item, {force=false}={}){
    if(item.kind==="book"){
      if(force)await refreshBookMetadata(item);
      return;
    }
    if(!item.tmdbId && !force)return;
    const validLogos=hasValidProviderLogos(item);
    const needsOverview=force || (!item.overview && !item.overviewCheckedAt);
    const needsMeta=force || !item.metaCheckedAt || !validLogos;
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
        applyRuntime(current,meta);
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
    if(item.kind!=="book" && !item.runtime && !item.runtimeCheckedAt)ensureRuntimes([item]);
    if(item.kind==="tv" && item.tmdbId && !seasonList(item).length){ensureTvSeasons(item).then(ok=>{if(ok){saveLocal();rerenderDetailIf(id)}})}
    if(item.kind!=="book" && ((!item.overview && !item.overviewCheckedAt) || !item.metaCheckedAt || !hasValidProviderLogos(item))){
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
    if(item.kind==="book" || item.imdbCheckedAt || !tmdbKey || !omdbKey || !item.tmdbId)return false;
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
    const subset=results.slice(0,20);
    await Promise.allSettled(subset.map(async (r,idx)=>{
      if(r.kind==="book")return;
      const updated=await fetchImdbRatingForItem(r,tmdbKey,omdbKey);
      if(!updated || batchId!==searchBatchId)return;
      const badgeEl=$(`[data-search-imdb="${idx}"]`);
      if(badgeEl){
        badgeEl.innerHTML=`<b>IMDb</b> ★ ${r.imdb?Number(r.imdb).toFixed(1):"—"}`;
      }
    }));
  }

  function normBookKey(title="", author=""){
    const t=String(title).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
    const a=String(author).toLowerCase().split(",")[0].normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
    return `${t}:${a}`;
  }

  function parseGoogleBook(vol, rankIndex=0){
    const info=vol.volumeInfo||{};
    const links=info.imageLinks||{};
    let thumb=(links.extraLarge||links.large||links.medium||links.thumbnail||links.smallThumbnail||"").replace(/^http:/i,"https:");
    if(thumb)thumb=thumb.replace(/&edge=curl/gi,"");
    const avg=Number(info.averageRating)||0;
    const rating10=avg>0?(avg*2).toFixed(1):"";
    const lang=String(info.language||"").toLowerCase();
    const author=Array.isArray(info.authors)?info.authors.join(", "):"";
    const fullTitle=info.subtitle ? `${info.title}: ${info.subtitle}` : (info.title||"");
    return {
      kind:"book",
      title:fullTitle,
      baseTitle:info.title||"",
      author,
      year:String(info.publishedDate||"").slice(0,4),
      poster:thumb,
      imdb:rating10,
      imdbId:"",
      imdbCheckedAt:new Date().toISOString(),
      imdbSource:rating10?"Google Books":"",
      tmdbId:null,
      bookId:vol.id||"",
      openLibKey:"",
      overview:info.description||"",
      overviewLanguage:info.description?(lang.startsWith("pt")?"pt-BR":lang):"pt-BR",
      providers:[],
      genres:Array.isArray(info.categories)?info.categories:[],
      trailerUrl:"",
      studio:info.publisher||"",
      metaCheckedAt:new Date().toISOString(),
      googleRank:rankIndex
    };
  }

  function parseOpenLibraryDoc(doc){
    const coverId=doc.cover_i;
    const poster=coverId?`https://covers.openlibrary.org/b/id/${coverId}-M.jpg`:"";
    const avg=Number(doc.ratings_average)||0;
    const rating10=avg>0?(avg*2).toFixed(1):"";
    const firstSentence=Array.isArray(doc.first_sentence)?doc.first_sentence[0]:(doc.first_sentence||"");
    const author=Array.isArray(doc.author_name)?doc.author_name.slice(0,2).join(", "):"";
    return {
      kind:"book",
      title:doc.title||"",
      baseTitle:doc.title||"",
      author,
      year:doc.first_publish_year?String(doc.first_publish_year):"",
      poster,
      imdb:rating10,
      imdbId:"",
      imdbCheckedAt:new Date().toISOString(),
      imdbSource:rating10?"Open Library":"",
      tmdbId:null,
      bookId:doc.key||`${doc.title}-${doc.first_publish_year||""}`,
      openLibKey:doc.key||"",
      overview:firstSentence||"",
      overviewLanguage:firstSentence?"en":"pt-BR",
      providers:[],
      genres:Array.isArray(doc.subject)?doc.subject.slice(0,4):[],
      trailerUrl:"",
      studio:Array.isArray(doc.publisher)?doc.publisher[0]:"",
      metaCheckedAt:new Date().toISOString(),
      googleRank:999
    };
  }

  // fetch com tempo limite: evita que uma API lenta trave a busca inteira
  async function fetchJsonTimeout(url, ms=8000){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),ms);
    try{
      const res=await fetch(url,{signal:ctrl.signal});
      if(!res.ok){const err=new Error(`HTTP ${res.status}`);err.status=res.status;throw err}
      return await res.json();
    }finally{
      clearTimeout(timer);
    }
  }

  // Retorna {items, failed, status}. "failed" diferencia erro de rede/limite de "nenhum resultado".
  // Estratégia econômica (evita estourar o limite sem chave): 1 busca livre; só faz a 2ª
  // (título exato) se a 1ª não trouxer o título procurado.
  async function fetchGoogleBooksDirect(query){
    const cfg=getConfig();
    const gKey=cfg.gbooksKey||data.settings?.apiKeys?.gbooksKey||"";
    const root="https://www.googleapis.com/books/v1/volumes";
    const common="&maxResults=20&printType=books";
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    let lastStatus=0;

    const cacheGet=k=>{try{const o=JSON.parse(localStorage.getItem("bkcache:"+k)||"null");return o&&Date.now()-o.t<6*3600e3?o.v:null}catch{return null}};
    const cacheSet=(k,v)=>{try{localStorage.setItem("bkcache:"+k,JSON.stringify({t:Date.now(),v}))}catch{
      try{Object.keys(localStorage).filter(x=>x.startsWith("bkcache:")).forEach(x=>localStorage.removeItem(x))}catch{}
    }};

    // qs recebe só o texto da consulta ("q"); monta a URL conforme usar proxy ou Google direto
    const run=async qText=>{
      const cached=cacheGet(qText);
      if(cached)return cached;
      let urls;
      if(BOOKS_PROXY){
        urls=[`${BOOKS_PROXY.replace(/\/$/,"")}/?q=${encodeURIComponent(qText)}`];
      }else{
        const qs=`q=${encodeURIComponent(qText)}${common}`;
        urls=gKey?[`${root}?${qs}&key=${encodeURIComponent(gKey)}`,`${root}?${qs}`]:[`${root}?${qs}`];
      }
      let lastErr;
      for(const url of urls){
        for(let attempt=0;attempt<2;attempt++){
          try{
            const json=await fetchJsonTimeout(url,10000);
            const items=json.items||[];
            cacheSet(qText,items);
            return items;
          }catch(e){
            lastErr=e;lastStatus=e.status||0;
            const transient=!e.status||e.status===429||e.status>=500;
            if(transient&&attempt===0){await sleep(900);continue}
            break;
          }
        }
        if(!(lastErr&&(lastErr.status===400||lastErr.status===403)))break;
      }
      throw lastErr;
    };

    const norm=t=>String(t||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
    const q=norm(query);
    const score=vol=>{
      const t=norm(vol.volumeInfo?.title);
      if(t===q)return 0;
      if(t.startsWith(q))return 1;
      if(t.includes(q))return 2;
      return 3;
    };

    const seen=new Set(),vols=[];
    const add=list=>{for(const v of list){if(v.id&&!seen.has(v.id)){seen.add(v.id);vols.push(v)}}};
    let anyOk=false;

    const digits=query.replace(/[-\s]/g,"");
    const isIsbn=/^(\d{9}[\dXx]|\d{13})$/.test(digits);
    try{add(await run(isIsbn?`isbn:${digits}`:query));anyOk=true}catch{}
    if(!isIsbn && !vols.some(v=>score(v)<=2)){
      try{add(await run(`intitle:${query}`));anyOk=true}catch{}
    }
    if(!anyOk)return {items:[],failed:true,status:lastStatus};

    const items=vols
      .map((vol,idx)=>({vol,idx,sc:score(vol)}))
      .sort((x,y)=>x.sc-y.sc||x.idx-y.idx)
      .map((o,i)=>parseGoogleBook(o.vol,i))
      .filter(b=>b.title);
    return {items,failed:false,status:0};
  }

  async function searchOpenLibrary(query){
    try{
      const url=`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=15&fields=key,title,author_name,first_publish_year,cover_i,ratings_average,publisher,subject,first_sentence`;
      const json=await fetchJsonTimeout(url,8000);
      return {items:(json.docs||[]).map(parseOpenLibraryDoc).filter(b=>b.title),failed:false};
    }catch{
      return {items:[],failed:true};
    }
  }

  function mergeBookLists(gbList, olList){
    const merged=[];
    const byKey=new Map();
    const fill=(existing,item)=>{
      if(!existing.poster && item.poster)existing.poster=item.poster;
      if(!existing.overview && item.overview){
        existing.overview=item.overview;
        existing.overviewLanguage=item.overviewLanguage;
      }
      if(!existing.imdb && item.imdb)existing.imdb=item.imdb;
      if(!existing.year && item.year)existing.year=item.year;
      if(!existing.studio && item.studio)existing.studio=item.studio;
      if(!existing.openLibKey && item.openLibKey)existing.openLibKey=item.openLibKey;
    };
    // Ordem do Google primeiro; Open Library complementa capas/sinopses e adiciona o que faltar
    for(const item of [...gbList,...olList]){
      const key=normBookKey(item.baseTitle||item.title, item.author);
      const existing=byKey.get(key);
      if(existing)fill(existing,item);
      else{byKey.set(key,item);merged.push(item)}
    }
    return merged.slice(0,30);
  }

  // onPartial(lista) é chamado assim que a primeira fonte responde, sem esperar a mais lenta.
  async function searchBooksOnly(query, onPartial){
    let gb={items:[],failed:false},ol={items:[],failed:false},gbDone=false,olDone=false;
    const notify=()=>{
      if(onPartial&&(gbDone||olDone)){
        const list=mergeBookLists(gb.items,ol.items);
        if(list.length)onPartial(list);
      }
    };
    await Promise.all([
      fetchGoogleBooksDirect(query).then(r=>{gb=r;gbDone=true;notify()}),
      searchOpenLibrary(query).then(r=>{ol=r;olDone=true;notify()})
    ]);
    const list=mergeBookLists(gb.items,ol.items);
    if(!list.length && gb.failed){
      // O Google falhou: não dá para afirmar que o livro "não existe" — mostra o motivo real.
      const why=gb.status===429?"limite de consultas atingido (HTTP 429)":gb.status?`erro HTTP ${gb.status}`:"sem resposta/tempo esgotado";
      throw new Error(`Google Livros indisponível: ${why}. Aguarde um instante e tente novamente, ou use o cadastro manual.`);
    }
    return list;
  }

  async function searchTitles(){
    const cfg=getConfig(),key=cfg.tmdbKey||data.settings?.apiKeys?.tmdbKey,query=$("#title-search").value.trim();
    $("#add-error").textContent="";$("#search-results").innerHTML="";
    if(!query){$("#add-error").textContent="Digite o nome de um título.";return}

    $("#search-title-button").disabled=true;$("#search-title-button").textContent="Buscando...";
    const currentBatch=++searchBatchId;

    try{
      let resolved=[];

      if(searchMode==="book"){
        resolved=await searchBooksOnly(query,partial=>{
          // mostra os primeiros resultados assim que chegarem (somente se esta ainda é a busca atual)
          if(currentBatch!==searchBatchId)return;
          selectedSearch.clear();
          $("#search-results")._results=partial;
          renderSearchResults();
        });
        if(currentBatch!==searchBatchId)return;
      }else{
        if(!key){
          $("#add-error").textContent="Configure sua chave API do TMDB em Ajustes ou use o cadastro manual.";
          return;
        }
        const endpoints=["movie","tv"];
        const responses=await Promise.all(endpoints.map(async endpoint=>{
          const url=`https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(key)}&language=pt-BR&query=${encodeURIComponent(query)}&include_adult=false`;
          const res=await fetch(url);
          if(!res.ok)throw new Error(res.status===401?"Chave TMDB inválida.":"Não foi possível consultar o TMDB.");
          return {kind:endpoint,json:await res.json()};
        }));

        resolved=responses.flatMap(({kind,json})=>(json.results||[]).map(r=>{
          const vote=Number(r.vote_average)||0;
          return {
            kind,
            title:kind==="movie"?(r.title||r.original_title):(r.name||r.original_name),
            author:"",
            year:(r.release_date||r.first_air_date||"").slice(0,4),
            poster:posterUrl(r.poster_path),
            imdb:vote>0?vote.toFixed(1):"",
            imdbId:"",
            imdbCheckedAt:null,
            imdbSource:vote>0?"TMDB":"",
            tmdbId:r.id,
            bookId:"",
            openLibKey:"",
            overview:r.overview||"",
            overviewLanguage:r.overview?"pt-BR":"",
            providers:[],
            genres:[],
            trailerUrl:"",
            studio:"",
            popularity:Number(r.popularity)||0
          };
        })).filter(r=>r.title).sort((a,b)=>b.popularity-a.popularity);
      }

      if(!resolved.length){
        $("#search-results").innerHTML='<p class="field-hint">Nenhum resultado encontrado. Tente outro nome ou cadastre manualmente.</p>';
        return;
      }

      if(searchMode!=="book")selectedSearch.clear(); // em livros, preserva seleção feita durante o carregamento parcial
      $("#search-results")._results=resolved;
      renderSearchResults();
      if(searchMode!=="book"){
        enrichSearchImdbRatings(resolved,currentBatch);
      }
    }catch(e){
      $("#add-error").textContent=e.message||"Erro na busca.";
    }finally{
      $("#search-title-button").disabled=false;$("#search-title-button").textContent="Buscar";
    }
  }

  function searchKey(item){
    return item.kind==="book" ? `book:${item.bookId||item.title}` : `${item.kind}:${item.tmdbId}`;
  }

  function renderSearchResults(){
    const results=$("#search-results")._results||[];
    $("#search-results").innerHTML=results.map((r,i)=>{
      const key=searchKey(r),chosen=selectedSearch.has(key),exists=isAlreadyAdded(r);
      const poster=r.poster?`<img class="poster" src="${escapeHtml(r.poster)}" alt="Pôster de ${escapeHtml(r.title)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="poster-placeholder">${escapeHtml(r.title.slice(0,1).toUpperCase())}</div>`;
      const ratingText=r.imdb?Number(r.imdb).toFixed(1):"—";
      const scoreTag=r.kind==="book"?"Aval.":"IMDb";
      const selectLabel=exists?"✓ Na lista":chosen?"✓ Selecionado":(r.kind==="book"?"＋ Quero ler":"＋ Selecionar");
      const subMeta=r.kind==="book" && r.author
        ? `${r.year||"Ano n/d"} · ${r.author}`
        : `${r.year||"Ano não informado"} · ${kindLabel(r.kind)}${exists?" · Já na biblioteca":""}`;
      return `<article class="media-card search-result-card ${chosen?"selected":""} ${exists?"already-added":""}">
        <div class="poster-wrap search-poster-wrap" data-search-open="${i}" role="button" tabindex="0" aria-label="Ver sinopse de ${escapeHtml(r.title)}">
          ${poster}
          <span class="imdb-badge"><b>${kindEyebrow(r.kind)}</b> ${r.year||"—"}</span>
          <span class="search-poster-hint">⌕ Sinopse</span>
          <span class="imdb-badge search-imdb-badge" data-search-imdb="${i}"><b>${scoreTag}</b> ★ ${ratingText}</span>
        </div>
        <div class="media-title" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</div>
        <div class="media-meta" title="${escapeHtml(subMeta)}">${escapeHtml(subMeta)}</div>
        <button type="button" class="search-select-btn ${chosen?"selected":""} ${exists?"disabled":""}" data-result="${i}" aria-pressed="${chosen}" ${exists?"disabled":""}>${selectLabel}</button>
      </article>`;
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
        if(result.kind==="book"){
          if(!result.overview && result.openLibKey){
            await fetchOpenLibrarySynopsis(result);
          }
        }else{
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
              applyRuntime(result,meta);
              result.metaCheckedAt=new Date().toISOString();
            }catch{}
          }
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

  function openAdd(){
    searchMode = activeView==="book" ? "book" : "screen";
    selectedSearch.clear();
    $("#add-error").textContent="";
    $("#search-results").innerHTML="";
    $("#search-results")._results=[];
    $("#selection-bar").hidden=true;
    $("#add-selected").disabled=true;
    $("#add-selected").textContent="Adicionar selecionados";
    $("#manual-section").open=false;

    if(searchMode==="book"){
      $("#search-page-eyebrow").textContent="ADICIONAR À ESTANTE";
      $("#search-page-title").textContent="Buscar livros";
      $("#search-input-label").textContent="Nome do livro ou autor";
      $("#title-search").placeholder="Ex.: O Hobbit ou Dom Casmurro";
      $("#search-mode-hint").textContent="Busca no Google Livros (título, autor ou ISBN).";
      $("#manual-kind").value="book";
    }else{
      $("#search-page-eyebrow").textContent="ADICIONAR À BIBLIOTECA";
      $("#search-page-title").textContent="Buscar filmes e séries";
      $("#search-input-label").textContent="Nome do filme ou série";
      $("#title-search").placeholder="Ex.: Interestelar";
      $("#search-mode-hint").textContent="A busca consulta filmes e séries simultaneamente. Configure sua chave TMDB em Ajustes.";
      $("#manual-kind").value=activeView==="tv"?"tv":"movie";
    }

    document.body.classList.add("search-page-active");
    $("#search-page").hidden=false;
    $("#library-section").hidden=true;
    $(".stats").hidden=true;
    $("#title-search").focus();
  }

  function closeSearchPage(){document.body.classList.remove("search-page-active");$("#search-page").hidden=true;$("#library-section").hidden=false;$(".stats").hidden=false;selectedSearch.clear();render()}

  async function openSearchDetail(index){
    const item=$("#search-results")._results?.[index];
    if(!item)return;
    const renderSearchPreview=()=>{
      const poster=item.poster
        ? `<button type="button" class="detail-poster-btn" data-zoom-poster="${escapeHtml(item.poster)}" data-zoom-title="${escapeHtml(item.title)}" title="Ampliar capa" aria-label="Ver capa em tela cheia"><img class="detail-poster" src="${escapeHtml(item.poster)}" alt="Pôster de ${escapeHtml(item.title)}"><span class="poster-zoom-badge" aria-hidden="true">⤢</span></button>`
        : `<div class="detail-poster poster-placeholder">${escapeHtml(item.title[0]||"?")}</div>`;
      const synopsisText=item.overview||(item.metaCheckedAt?"Sinopse não disponível.":"Carregando sinopse…");
      const langNote=item.overview&&item.overviewLanguage&&item.overviewLanguage!=="pt-BR"?'<small class="synopsis-note">Sinopse no idioma original disponível.</small>':"";
      const scorePrefix=item.kind==="book"?"★ Avaliação":"★ IMDb";
      const imdbRating=item.imdb?`${scorePrefix} ${Number(item.imdb).toFixed(1)}`:`${scorePrefix} Sem nota`;
      const trailerHref=getTrailerLink(item);
      const videoBtnLabel=item.kind==="book"?"▶ Resenhas":"▶ Trailer";
      $("#detail-content").innerHTML=`<div class="detail-layout">${poster}<div class="detail-info"><p class="eyebrow">${kindEyebrow(item.kind)}</p><h2>${escapeHtml(item.title)}</h2><p>${item.year||"Ano não informado"}</p>${renderWhereToWatch(item)}<div class="detail-rating-row"><div class="detail-rating">${imdbRating}</div><a class="trailer-btn" href="${escapeHtml(trailerHref)}" target="_blank" rel="noopener noreferrer">${videoBtnLabel}</a></div></div></div><section class="detail-synopsis"><h3>Sinopse</h3><p class="${item.overview?"":"synopsis-muted"}">${escapeHtml(synopsisText)}</p>${langNote}</section>`;
    };
    renderSearchPreview();
    $("#detail-dialog").showModal();

    if(item.kind==="book"){
      if(!item.overview && item.openLibKey){
        await fetchOpenLibrarySynopsis(item);
        if($("#detail-dialog").open)renderSearchPreview();
      }
      return;
    }

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
          applyRuntime(item,meta);
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

  function fillSettings(){
    const c=getConfig();
    $("#gh-owner").value=c.owner||"";
    $("#gh-repo").value=c.repo||"";
    $("#gh-branch").value=c.branch||"main";
    $("#gh-path").value=c.path||"data.json";
    $("#gh-token").value=c.token||"";
    $("#tmdb-key").value=c.tmdbKey||data.settings?.apiKeys?.tmdbKey||"";
    $("#omdb-key").value=c.omdbKey||data.settings?.apiKeys?.omdbKey||"";
    if($("#gbooks-key"))$("#gbooks-key").value=c.gbooksKey||data.settings?.apiKeys?.gbooksKey||"";
    setSyncState(c.owner&&c.repo&&c.token?"connected":"",c.owner&&c.repo&&c.token?"GitHub configurado":"Somente neste dispositivo");
  }
  function saveSettings(){const c=getConfig();Object.assign(c,{owner:$("#gh-owner").value.trim(),repo:$("#gh-repo").value.trim(),branch:$("#gh-branch").value.trim()||"main",path:$("#gh-path").value.trim()||"data.json",token:$("#gh-token").value.trim()});setConfig(c);setSyncState(c.owner&&c.repo&&c.token?"connected":"",c.owner&&c.repo&&c.token?"GitHub configurado":"Somente neste dispositivo");toast("Configurações do GitHub salvas neste dispositivo.");}
  function saveApiKeys(){
    const c=getConfig();
    c.tmdbKey=$("#tmdb-key").value.trim();
    c.omdbKey=$("#omdb-key").value.trim();
    c.gbooksKey=$("#gbooks-key")?$("#gbooks-key").value.trim():"";
    setConfig(c);
    data.settings={...(data.settings||{}),apiKeys:{tmdbKey:c.tmdbKey,omdbKey:c.omdbKey,gbooksKey:c.gbooksKey},updatedAt:new Date().toISOString()};
    saveLocal();
    toast(c.owner&&c.repo&&c.token?"Chaves salvas. Sincronizando com o repositório privado…":"Chaves salvas neste dispositivo. Configure o GitHub para sincronizá-las.");
  }
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
        map.set(item.id,{...item,providers:item.kind==="book"?[]:normalizeProviders(item.providers)});
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
    const localHas=!!(localKeys.tmdbKey||localKeys.omdbKey||localKeys.gbooksKey),remoteHas=!!(remoteKeys.tmdbKey||remoteKeys.omdbKey||remoteKeys.gbooksKey);
    let chosen;
    if(localHas&&remoteHas)chosen=new Date(ls.updatedAt||0)>=new Date(rs.updatedAt||0)?ls:rs;
    else if(localHas)chosen=ls;
    else if(remoteHas)chosen=rs;
    else chosen=new Date(ls.updatedAt||0)>=new Date(rs.updatedAt||0)?ls:rs;
    return {
      version:1,
      items:(()=>{const arr=[...map.values()];freezeWatchedAt(arr);return arr})(),
      deleted:pruneDeleted([...deleted.values()]),
      settings:{apiKeys:{tmdbKey:chosen?.apiKeys?.tmdbKey||"",omdbKey:chosen?.apiKeys?.omdbKey||"",gbooksKey:chosen?.apiKeys?.gbooksKey||""},updatedAt:chosen?.updatedAt||null},
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
      const legacyKeys={tmdbKey:c.tmdbKey||"",omdbKey:c.omdbKey||"",gbooksKey:c.gbooksKey||""};
      if((legacyKeys.tmdbKey||legacyKeys.omdbKey||legacyKeys.gbooksKey)&&!data.settings?.updatedAt){
        data.settings={apiKeys:legacyKeys,updatedAt:new Date().toISOString()};
      }
      const initialMerged=mergeData(data,initialRemote.data);
      const merged=await writeWithShaRetry(c,initialMerged);
      data=merged;
      localStorage.setItem(STORAGE,JSON.stringify(data));
      const updatedConfig=getConfig();
      updatedConfig.tmdbKey=data.settings?.apiKeys?.tmdbKey||"";
      updatedConfig.omdbKey=data.settings?.apiKeys?.omdbKey||"";
      updatedConfig.gbooksKey=data.settings?.apiKeys?.gbooksKey||"";
      setConfig(updatedConfig);
      if($("#tmdb-key"))$("#tmdb-key").value=updatedConfig.tmdbKey;
      if($("#omdb-key"))$("#omdb-key").value=updatedConfig.omdbKey;
      if($("#gbooks-key"))$("#gbooks-key").value=updatedConfig.gbooksKey;
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
    const views=["movie","tv","watched","book"];
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
      // rola só o slider horizontal de categorias (celular), nunca a página
      const activeStat=$(`.stat-action[data-stat-filter="${activeView}"]`);
      const slider=activeStat?.parentElement;
      if(activeStat&&slider&&slider.scrollWidth>slider.clientWidth){
        slider.scrollTo({left:activeStat.offsetLeft-(slider.clientWidth-activeStat.offsetWidth)/2,behavior:"smooth"});
      }
    };

    [area, emptyArea].forEach(el=>{
      if(!el)return;
      el.addEventListener("touchstart",onStart,{passive:true});
      el.addEventListener("touchend",onEnd,{passive:true});
    });
  }

  function restoreSortPreference(){
    const savedSort=localStorage.getItem(SORT_KEY);
    const select=$("#sort-select");
    if(select && savedSort && [...select.options].some(o=>o.value===savedSort)){
      select.value=savedSort;
    }
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

    $("#poster-lightbox")?.addEventListener("click",()=>{
      $("#poster-lightbox").close();
    });
    // limpa a imagem ao fechar e invalida downloads pendentes (evita mostrar a capa antiga na próxima abertura)
    $("#poster-lightbox")?.addEventListener("close",()=>{
      lightboxToken++;
      const im=$("#lightbox-img");
      if(im)im.removeAttribute("src");
    });

    $$(".tab").forEach(b=>b.onclick=()=>{activeView=b.dataset.kind;activeQuickFilter=null;render()});
    $$(".stat-action").forEach(b=>{b.onclick=()=>applyStatFilter(b.dataset.statFilter)});
    $("#search-input").oninput=render;
    $("#sort-select").onchange=()=>{
      localStorage.setItem(SORT_KEY,$("#sort-select").value);
      render();
    };

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

    $("#detail-content").addEventListener("change",e=>{
      const chk=e.target.closest("[data-ep-check]");
      if(chk){
        const id=$("#detail-content [data-ep-details]")?.dataset.epDetails;
        if(id)toggleEpisode(id,Number(chk.dataset.s),Number(chk.dataset.e),chk.checked);
        return;
      }
      const sel=e.target.closest("[data-ep-season]");
      if(sel){
        const id=sel.dataset.epSeason,n=Number(sel.value);
        epViewSeason[id]=n;
        rerenderDetailIf(id);
        loadSeasonView(id,n);
      }
    });
    $("#detail-content").addEventListener("toggle",e=>{
      const d=e.target.closest?.("[data-ep-details]");
      if(!d)return;
      const id=d.dataset.epDetails;
      const was=!!epPanelOpen[id];
      epPanelOpen[id]=d.open;
      if(was===d.open)return; // evita laço: o próprio re-render recria o <details>
      if(d.open){
        const it=get(id),n=epViewSeason[id]||epProgress(it)?.s||seasonList(it)[0]?.n||1;
        loadSeasonView(id,n);
        rerenderDetailIf(id);
      }
    },true);
    $("#detail-content").addEventListener("click",e=>{
      const zoomBtn=e.target.closest("[data-zoom-poster]");
      if(zoomBtn){
        openPosterLightbox(zoomBtn.dataset.zoomPoster,zoomBtn.dataset.zoomTitle);
        return;
      }
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
          updateItem(item.id,{watched:nextWatched,watchedAt:nextWatched?new Date().toISOString():null,completedByEpisodes:false});
          if(item.kind==="book"){
            toast(nextWatched?"Livro marcado como lido.":"Livro marcado como não lido.");
          }else{
            toast(nextWatched?"Movido para Assistidos.":"Retornado para sua lista.");
          }
        }
        return;
      }
      const epNext=e.target.closest("[data-ep-next]");
      if(epNext){markNextEpisode(epNext.dataset.epNext);return}
      const epUndo=e.target.closest("[data-ep-undo]");
      if(epUndo){undoLastEpisode(epUndo.dataset.epUndo);return}
      const epAll=e.target.closest("[data-ep-season-all]");
      if(epAll){markSeason(epAll.dataset.epSeasonAll,Number(epAll.dataset.s),true);return}
      const epNone=e.target.closest("[data-ep-season-none]");
      if(epNone){markSeason(epNone.dataset.epSeasonNone,Number(epNone.dataset.s),false);return}
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

  restoreSortPreference();
  events();
  render();
  if("serviceWorker"in navigator&&location.protocol!=="file:")window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  const cfg=getConfig();
  if(cfg.owner&&cfg.repo&&cfg.token){
    setSyncState("connected","GitHub configurado");
    setTimeout(()=>syncGitHub(false), 1500);
  }
})();