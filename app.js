/* 深大出走 · three real views, browser-local data, no business API */
(() => {
  'use strict';
  const $=(s,root=document)=>root.querySelector(s);
  const $$=(s,root=document)=>[...root.querySelectorAll(s)];
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl=url=>{try{const u=new URL(url);return /^https?:$/.test(u.protocol)?esc(u.href):'#';}catch{return '#';}};
  const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const localDate=(date=new Date())=>{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const part=type=>parts.find(p=>p.type===type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  let today=localDate();
  const types={nature:'自然绿地',campus:'校园走走',market:'超市与市场',food:'街巷逛吃',culture:'文化生活'};
  const categories={all:'全部',sunset:'看晚霞',walk:'散步',run:'慢跑',sea:'海边',green:'绿地',food:'逛吃',culture:'文化',campus:'校园'};
  const skyRegions={yuehai:'粤海·深圳湾',qianhai:'前海石',xiwan:'西湾红树林',lixin:'立新湖',shiyan:'石岩湖'};
  const defaults={category:'all',query:'',commute:'any',budget:'any',date:today,skyRegion:'all',forecastMode:'',lowCommerce:true,noReserve:false,readyOnly:false,sort:'recommended'};
  const preferenceKeys=['commute','budget','lowCommerce','noReserve','readyOnly'];
  const storageKey='szu-slow-days:v1',recommendationKey='szu-slow-days:last-recommendation',historyKey='szu-flow-v2';
  let glassEnabled=true;try{glassEnabled=localStorage.getItem('szu-glass:v1')!=='off';}catch{}
  document.body.setAttribute('data-glass',glassEnabled?'on':'off');
  let stored={};
  try{stored=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{}
  const readSet=value=>new Set(Array.isArray(value)?value.filter(x=>typeof x==='string'):[]);
  const bookmarks=readSet(stored.saved),familiar=readSet(stored.familiar),tried=readSet(stored.tried);
  function cleanFilters(value={}){
    return {
      category:Object.hasOwn(categories,value.category)?value.category:'all',
      skyRegion:value.category==='sunset'&&Object.hasOwn(skyRegions,value.skyRegion)?value.skyRegion:'all',
      forecastMode:['sunrise','sunset'].includes(value.forecastMode)?value.forecastMode:'',
      query:typeof value.query==='string'?value.query.slice(0,80):'',
      commute:['any','30','45','60','90','120'].includes(String(value.commute))?String(value.commute):'any',
      budget:['any','30','60','120'].includes(String(value.budget))?String(value.budget):'any',
      date:/^\d{4}-\d{2}-\d{2}$/.test(value.date||'')&&value.date>=today?value.date:today,
      lowCommerce:value.lowCommerce!==false,noReserve:value.noReserve===true,readyOnly:value.readyOnly===true,
      sort:['recommended','near','cheap'].includes(value.sort)?value.sort:'recommended'
    };
  }
  const state={view:'discover',explore:cleanFilters({...defaults,...stored.explorePreferences}),limit:12,savedLimit:12};
  const viewScroll={discover:0,explore:0,saved:0};
  let places=[],photos=[],photoMap=new Map(),placeMap=new Map(),recommendationIds=[],eventsReady=false,initializing=false;
  let overlay=null,draft=null,pendingFilterApply=null,returnFocus=null,returnGuideId=null,toastTimer,undoAction=null,isComposing=false,closingOverlay=false;

  function persist(){
    const explorePreferences=Object.fromEntries(preferenceKeys.map(k=>[k,state.explore[k]]));
    try{localStorage.setItem(storageKey,JSON.stringify({...stored,explorePreferences,saved:[...bookmarks],familiar:[...familiar],tried:[...tried]}));}catch{toast('浏览器未允许保存，本次仍可使用');}
  }
  function toast(message,undo=null){
    const target=overlay?$(`#${overlay}-dialog`):document.body;
    if($('#toast').parentNode!==target)target.appendChild($('#toast'));
    clearTimeout(toastTimer);$('#toast-text').textContent=message;$('#toast').hidden=false;
    undoAction=undo;$('#undo-save').hidden=!undo;
    toastTimer=setTimeout(()=>{$('#toast').hidden=true;undoAction=null;},undo?6000:2600);
  }
  const nameOf=p=>p.officialName||p.name;
  const mins=n=>n>=60&&n%60===0?`${n/60}小时`:`${n}分钟`;
  const duration=range=>range[0]===range[1]?mins(range[0]):range[1]>120&&range.every(n=>n%30===0)?`${range[0]/60}–${range[1]/60}小时`:`${range[0]}–${range[1]}分钟`;
  const compactDuration=range=>duration(range).replaceAll('分钟','分');
  const fare=range=>range[0]===range[1]?`¥${range[0]}`:`¥${range[0]}–${range[1]}`;
  const runDistance=p=>p.runInfo?`${p.runInfo.distanceKm[0]}${p.runInfo.distanceKm[0]===p.runInfo.distanceKm[1]?'':'–'+p.runInfo.distanceKm[1]} km`:'';
  const dateTime=value=>value?value.replace('T',' ').replace(/:00(?:\+08:00|Z)?$/,'').replace(/\+08:00$/,''):'';
  function shortIntro(p){
    const text=String(p.lead||p.playTitle||'').trim(),first=text.match(/^[^。！？]+[。！？]?/)?.[0]||text;
    return first.length<=52?first:first.slice(0,51).replace(/[，、；：]$/,'')+'…';
  }
  function dayStatus(p,date=today){
    const s=p.schedule||{},from=new Date(`${date}T00:00:00+08:00`),until=new Date(`${date}T23:59:59+08:00`);
    const end=s.end?new Date(s.end):s.start?new Date(`${s.start.slice(0,10)}T23:59:59+08:00`):null,start=s.start?new Date(s.start):null;
    if(end&&end<(date===today?new Date():from))return {code:'expired',label:'活动已结束',actionable:false};
    if(start&&!s.end&&date===today&&start<=new Date())return {code:'started',label:'已开场 · 入场看主办方安排',actionable:false};
    if(s.deadline&&new Date(s.deadline)<new Date())return {code:'deadline',label:'报名已截止',actionable:false};
    if(start&&start>until)return {code:'future',label:`${s.start.slice(5,10).replace('-','/')} 场次`,actionable:false};
    const dow=new Date(`${date}T12:00:00+08:00`).getUTCDay();
    if((s.closedDays||[]).includes(dow)||(s.weekendsOnly&&![0,6].includes(dow)))return {code:'closed',label:'所选日期不开放',actionable:false};
    if((s.verifyWeekdays||[]).includes(dow))return {code:'calendar',label:'先查当日预约日历',actionable:false};
    if(p.availability==='verify')return {code:'verify',label:'参与条件待核实',actionable:false};
    if(p.access.kind==='event'&&!start)return {code:'calendar',label:'查看本期排期',actionable:false};
    if(p.access.kind==='member')return {code:'member',label:'须邀请或特定条件',actionable:false};
    if(p.access.kind==='event')return {code:'event',label:'当日活动 · 先查名额',actionable:true};
    if(p.access.kind==='reserve')return {code:'reserve',label:'需预约或登记',actionable:true};
    return {code:'open',label:'常规可去',actionable:true};
  }
  function match(p,filters=state.explore){
    const c=filters.category;
    if(c==='sunset'&&!p.sunset)return false;
    if(c==='sunset'&&filters.skyRegion&&filters.skyRegion!=='all'&&p.sunset?.region!==filters.skyRegion)return false;
    if(filters.lowCommerce&&p.curation?.commerce==='high')return false;
    if(c==='run'&&p.activity!=='run')return false;
    if(c==='walk'&&p.activity==='run')return false;
    if(c==='sea'&&!p.moods.includes('sea'))return false;
    if(c==='green'&&!['nature','campus'].includes(p.type))return false;
    if(c==='food'&&!['food','market'].includes(p.type))return false;
    if(c==='culture'&&p.type!=='culture')return false;
    if(c==='campus'&&p.type!=='campus')return false;
    if(filters.commute!=='any'&&p.travel[1]>+filters.commute)return false;
    if(filters.budget!=='any'&&(p.costPending||p.cost[1]>+filters.budget))return false;
    if(filters.noReserve&&p.access.kind!=='open')return false;
    if(filters.readyOnly&&!dayStatus(p,filters.date).actionable)return false;
    const words=filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if(words.length){
      const terms=[nameOf(p),p.name,p.playTitle,p.district,types[p.type],p.lead,p.description,...p.spots.map(s=>s.name),p.sunset?'晚霞 黄昏 夕照 余晖':'',p.sunset?.kind==='sunset'?'日落 夕阳':'',p.activity==='run'?'慢跑 跑步 绿道':'散步',p.moods.includes('sea')?'海边 看海 海风':'',p.moods.includes('lake')?'湖边 湖畔':'',p.type==='campus'?'学校 大学 校园':'',p.type==='food'?'美食 小吃 逛吃':''].join(' ').toLocaleLowerCase();
      if(!words.every(w=>terms.includes(w)))return false;
    }
    return true;
  }
  function score(p){return (p.type==='nature'?70:p.type==='campus'?55:35)-p.travel[1]*.35+(p.moods.includes('green')?8:0)-(p.activity==='run'?8:0)-(p.curation?.commerce==='high'?35:p.curation?.commerce==='mixed'?6:0);}
  function ordered(items,filters=state.explore){
    return [...items].sort((a,b)=>{
      const availability=+dayStatus(b,filters.date).actionable-+dayStatus(a,filters.date).actionable;
      if(availability)return availability;
      if(filters.sort==='near')return a.travel[1]-b.travel[1]||a.cost[1]-b.cost[1];
      if(filters.sort==='cheap')return a.cost[1]-b.cost[1]||a.travel[1]-b.travel[1];
      return score(b)-score(a)||nameOf(a).localeCompare(nameOf(b),'zh-CN');
    });
  }
  function shuffled(items){
    const out=[...items];
    for(let i=out.length-1;i>0;i--){
      let j;
      if(globalThis.crypto?.getRandomValues){const limit=Math.floor(4294967296/(i+1))*(i+1),value=new Uint32Array(1);do{crypto.getRandomValues(value);}while(value[0]>=limit);j=value[0]%(i+1);}
      else j=Math.floor(Math.random()*(i+1));
      [out[i],out[j]]=[out[j],out[i]];
    }
    return out;
  }
  function recommendations(force=false){
    const group=p=>p.discoveryGroup||p.areaId;
    const pool=places.filter(p=>dayStatus(p,today).actionable&&p.curation?.discovery!==false&&p.curation?.commerce!=='high'),n=Math.min(3,new Set(pool.map(group)).size);
    if(!force&&recommendationIds.length===n&&recommendationIds.every(id=>pool.some(p=>p.id===id)))return recommendationIds.map(id=>placeMap.get(id));
    let previous=recommendationIds;
    if(!previous.length){try{const value=JSON.parse(localStorage.getItem(recommendationKey)||'[]');if(Array.isArray(value))previous=value;}catch{}}
    const old=new Set(previous),fresh=pool.filter(p=>!old.has(p.id));
    const candidates=shuffled(new Set(fresh.map(group)).size>=n?fresh:pool),out=[],areas=new Set();
    const add=p=>{if(p&&!areas.has(group(p))&&out.length<n){out.push(p);areas.add(group(p));}};
    candidates.filter(p=>p.type==='nature').slice(0,2).forEach(add);
    add(candidates.find(p=>p.type!=='nature'&&!areas.has(group(p))));
    candidates.forEach(add);
    recommendationIds=shuffled(out).map(p=>p.id);
    try{localStorage.setItem(recommendationKey,JSON.stringify(recommendationIds));}catch{}
    return recommendationIds.map(id=>placeMap.get(id));
  }
  function selectedPhotos(p){return (p.photoIds||[]).map(id=>photoMap.get(id)).filter(Boolean);}
  function photoInfo(p){const ph=selectedPhotos(p)[0];return {photo:ph||null,reference:!!ph&&!!p.photoReference,caption:p.photoNote||ph?.caption||'实景待补'};}
  function media(p,guide=false,eager=false){
    const {photo,reference,caption}=photoInfo(p);
    if(!photo)return `<div class="place-placeholder tone-${esc(p.type)}" role="img" aria-label="${esc(nameOf(p))}，实景照片待补">${icon(p.type==='nature'?'leaf':p.type==='culture'?'book':p.type==='food'||p.type==='market'?'food':'pin')}<small>实景待补</small></div>`;
    const variants=!guide&&(photo.variants||[]).length?photo.variants:null;
    const src=variants?variants[0].file:photo.file;
    const responsive=variants?` srcset="${variants.map(v=>`${esc(v.file)} ${v.width}w`).join(', ')}" sizes="(max-width:350px) 89px, (max-width:760px) 106px, 100px"`:'';
    return `<img src="${esc(src)}"${responsive} width="${photo.width}" height="${photo.height}" alt="${esc(caption)}" loading="${eager?'eager':'lazy'}" decoding="async">${guide?`<span class="guide-photo-caption">${esc(caption)}</span>`:reference?'<span class="photo-reference">同片区参考图</span>':''}`;
  }
  function amapLinks(p,platform){
    if(!platform){const ua=navigator.userAgent||'';platform=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1)?'ios':/Android/i.test(ua)?'android':'web';}
    const raw=String(p.mapKeyword||p.entrance||nameOf(p)).trim(),destination=/深圳/.test(raw)?raw:'深圳 '+raw;
    const source=encodeURIComponent('深大出走'),name=encodeURIComponent(destination),web='https://uri.amap.com/search?keyword='+name+'&city='+encodeURIComponent('深圳')+'&view=map&callnative=0';
    return {destination,web,native:platform!=='web',primary:platform==='ios'?'iosamap://path?sourceApplication='+source+'&dname='+name+'&dev=0&t=1&m=0':platform==='android'?'androidamap://poi?sourceApplication='+source+'&keywords='+name+'&dev=0':web};
  }
  function saveButton(p,guide=false){const yes=bookmarks.has(p.id);return `<button type="button" class="save-button" data-save="${esc(p.id)}" aria-label="${yes?'取消想去：':'收藏想去：'}${esc(nameOf(p))}" aria-pressed="${yes}">${icon('heart')}<span>${yes?'已想去':'想去'}</span></button>`;}
  function mapAction(p,guide=false){
    if(p.navigation?.kind==='verify')return `<a class="${guide?'primary-button':'map-link'}" href="${safeUrl(p.navigation.url||p.access.url)}" target="_blank" rel="noopener noreferrer">${esc(p.navigation.label||'先确认集合点')} ↗</a>`;
    return `<a class="${guide?'primary-button':'map-link'}" data-map href="${esc(amapLinks(p).primary)}" aria-label="高德导航到${esc(p.entrance)}">${icon('nav')}${guide?'打开高德导航':'高德导航'}</a>`;
  }
  function entryLinks(p){
    if(p.navigation?.kind==='verify')return `<a href="${safeUrl(p.navigation.url||p.access.url)}" target="_blank" rel="noopener noreferrer">${esc(p.navigation.label)} ↗</a>`;
    return `<a href="${safeUrl(amapLinks(p).web)}" target="_blank" rel="noopener noreferrer">高德网页版 ↗</a>${(p.mapAlternatives||[]).length?`<div class="map-alternatives"><span>也可以选</span>${p.mapAlternatives.map(a=>`<a data-map href="${esc(amapLinks({...p,mapKeyword:a.keyword,entrance:a.name}).primary)}">${esc(a.name)} ${icon('nav')}</a>`).join('')}</div>`:''}`;
  }
  function card(p,index=0,date=today){
    const status=dayStatus(p,date),map=amapLinks(p);
    return `<article class="place-card" data-place="${esc(p.id)}"><a class="card-open" href="#place=${encodeURIComponent(p.id)}" data-guide="${esc(p.id)}"><div class="card-image">${media(p,false,index===0)}</div><div class="card-info"><div class="card-kicker"><span>${esc(p.district)}</span><span>${p.activity==='run'?'慢跑 · '+runDistance(p):esc(types[p.type])}</span></div><h3>${esc(nameOf(p))}${icon('arrow')}</h3>${p.sunset?'<small class="sunset-badge">可看晚霞</small>':''}<p class="card-lead">${esc(shortIntro(p))}</p><div class="card-facts"><span>单程约 ${compactDuration(p.travel)}</span><span class="fare">${p.costPending?'费用待核':fare(p.cost)}</span></div><small class="card-stay">建议停留 ${duration(p.stay)}</small>${status.code!=='open'?`<p class="card-condition">${esc(status.label)}</p>`:p.travel[1]>90?'<p class="card-condition">较远，留足往返时间</p>':''}</div></a><div class="card-footer">${saveButton(p)}${mapAction(p)}</div></article>`;
  }
  function appliedFilters(filters=state.explore){
    return [filters.skyRegion&&filters.skyRegion!=='all'&&['skyRegion',skyRegions[filters.skyRegion]+'附近'],filters.lowCommerce&&['lowCommerce','避开强商业'],filters.commute!=='any'&&['commute',`单程${filters.commute}分内`],filters.budget!=='any'&&['budget',`¥${filters.budget}以内`],filters.date!==today&&['date',`${filters.date.slice(5).replace('-','/')}出发`],filters.noReserve&&['noReserve','无需预约'],filters.readyOnly&&['readyOnly','排除已结束／待核实']].filter(Boolean);
  }
  function syncNav(){
    $$('[data-nav]').forEach(el=>{if(el.dataset.nav===state.view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    const savedCount=places.filter(p=>bookmarks.has(p.id)).length;
    $$('[data-saved-count]').forEach(el=>{el.textContent=savedCount;el.hidden=savedCount===0;});
    $('#library-count').textContent=places.length;$('#explore-library-count').textContent=`${places.length}项收录`;
    for(const view of ['discover','explore','saved'])$(`#${view}-view`).hidden=state.view!==view;
  }
  function renderExplore(){
    const f=state.explore,matches=ordered(places.filter(p=>match(p,f)),f),active=appliedFilters(f);
    if($('#search').value!==f.query)$('#search').value=f.query;
    $('#clear-search').hidden=!f.query;$('#sort').value=f.sort;
    $$('[data-category]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.category===f.category)));
    $('#filter-count').textContent=active.length;$('#filter-count').hidden=!active.length;
    $('#result-count').textContent=`${matches.length}处`;
    $('#active-filters').hidden=!active.length;
    $('#active-filters').innerHTML=active.map(([key,label])=>`<button type="button" class="active-filter" data-remove-filter="${key}" aria-label="移除筛选：${esc(label)}">${esc(label)}${icon('close')}</button>`).join('');
    const sunsetNote=f.category==='sunset'?'<span>选开阔的天色，不保证每天有霞。建议日落前30–45分钟到，按当季日落时间安排。</span>':'';
    $('#search-summary').hidden=!f.query.trim()&&!sunsetNote;$('#search-summary').innerHTML=(f.query.trim()?`“<strong>${esc(f.query.trim())}</strong>”的搜索结果`:'')+sunsetNote;
    $('#sunset-context').hidden=f.category!=='sunset'&&f.forecastMode!=='sunrise';
    $('#sunset-context-text').textContent=f.forecastMode==='sunrise'?'早场请先核对开园与首班车':f.skyRegion!=='all'?`${skyRegions[f.skyRegion]}附近 · 片区评分仅供参考`:'先看看这三天的晚霞评分';
    $('#explore-grid').innerHTML=matches.slice(0,state.limit).map((p,i)=>card(p,i,f.date)).join('');
    $('#explore-empty').hidden=matches.length>0;$('#load-more').hidden=matches.length<=state.limit;
    $('#load-more').textContent=`再看看更多 · 还有${Math.max(0,matches.length-state.limit)}处`;
  }
  function renderSaved(){
    // A collection is independent of exploration, including its search and date.
    const saved=[...bookmarks].reverse().map(id=>placeMap.get(id)).filter(Boolean);
    $('#saved-total').textContent=`${saved.length}处`;$('#saved-note').hidden=!saved.length;$('#saved-empty').hidden=saved.length>0;
    $('#saved-grid').innerHTML=saved.map((p,i)=>card(p,i,today)).join('');
  }
  function render(){
    syncNav();
    if(state.view==='discover'){
      const recs=recommendations();$('#recommend-grid').innerHTML=recs.map((p,i)=>card(p,i,today)).join('');
      $('#shuffle').disabled=places.filter(p=>dayStatus(p,today).actionable&&p.curation?.discovery!==false&&p.curation?.commerce!=='high').length<=recs.length;
    }else if(state.view==='explore')renderExplore();else renderSaved();
  }
  function snapshot(override={}){return {marker:historyKey,view:state.view,explore:{...state.explore},limit:state.limit,scrollY:window.scrollY||0,overlay:null,...override};}
  const baseUrl=()=>location.href.split('#')[0];
  const viewUrl=view=>`${baseUrl()}#${view}`;
  function recordCurrent(){if(history.state?.marker===historyKey){const y=overlay?history.state.scrollY:window.scrollY||0;viewScroll[state.view]=y;history.replaceState(snapshot({overlay:history.state.overlay,scrollY:y}),'',location.href);}}
  function replaceRoute(){history.replaceState(snapshot(),'',viewUrl(state.view));}
  function restorePosition(y=0){requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'instant'}));}
  function hideOverlays(){document.body.appendChild($('#toast'));for(const id of ['guide-dialog','filter-dialog','about-dialog'])if($(`#${id}`).open)$(`#${id}`).close();overlay=null;draft=null;document.body.classList.remove('modal-open');}
  function focusReturn(){
    if(returnFocus?.isConnected){returnFocus.focus({preventScroll:true});return;}
    const cardLink=returnGuideId&&$$('[data-guide]',$(`#${state.view}-view`)).find(el=>el.dataset.guide===returnGuideId);
    if(cardLink){cardLink.focus({preventScroll:true});return;}
    $(`#${state.view==='saved'?'saved':state.view==='explore'?'explore':'discover'}-title`).focus({preventScroll:true});
  }
  function showOverlay(type){overlay=type;document.body.classList.add('modal-open');$(`#${type}-dialog`).appendChild($('#toast'));$(`#${type}-dialog`).showModal();$(`#${type}-dialog`).scrollTop=0;}
  function restoreRoute(entry){
    closingOverlay=false;
    const previousOverlay=overlay;hideOverlays();
    if(entry?.marker===historyKey){state.view=['discover','explore','saved'].includes(entry.view)?entry.view:'discover';state.explore=cleanFilters(entry.explore);state.limit=Math.max(12,Number(entry.limit)||12);}
    else {state.view=location.hash==='#saved'?'saved':['#explore','#running'].includes(location.hash)?'explore':'discover';if(location.hash==='#running')state.explore={...defaults,category:'run'};}
    if(pendingFilterApply){state.explore=cleanFilters({...state.explore,...pendingFilterApply});state.limit=12;pendingFilterApply=null;replaceRoute();persist();}
    viewScroll[state.view]=entry?.scrollY||0;
    render();restorePosition(entry?.scrollY||0);
    if(entry?.overlay?.type==='guide'&&placeMap.has(entry.overlay.id))showGuide(entry.overlay.id,entry.overlay.date||today);
    else if(entry?.overlay?.type==='filter')prepareFilters(false);
    else if(entry?.overlay?.type==='about')showAbout(false);
    else if(previousOverlay)focusReturn();
  }
  function navigate(view,{reset=false,preset=null,focusSearch=false}={}){
    if(!['discover','explore','saved'].includes(view))return;
    recordCurrent();hideOverlays();
    if(reset)state.explore={...defaults,lowCommerce:state.explore.lowCommerce};
    if(preset){state.explore={...defaults,lowCommerce:state.explore.lowCommerce,category:preset==='near'?'all':preset,commute:preset==='near'?'45':'any'};state.limit=12;}
    const changed=state.view!==view||reset||preset;
    const y=reset||preset||state.view===view?0:viewScroll[view]||0;
    state.view=view;render();
    if(changed)history.pushState(snapshot({scrollY:y}),'',viewUrl(view));else replaceRoute();
    window.scrollTo({top:y,behavior:'instant'});persist();
    if(focusSearch)$('#search').focus({preventScroll:true});
    else $(`#${view==='discover'?'discover':view==='saved'?'saved':'explore'}-title`).focus({preventScroll:true});
  }
  function editExplore(patch){if(patch.category&&patch.category!==state.explore.category)patch={skyRegion:'all',forecastMode:'',...patch};state.explore=cleanFilters({...state.explore,...patch});state.limit=12;renderExplore();replaceRoute();persist();}
  function resetExplore(){editExplore({...defaults});$('#search').focus({preventScroll:true});}
  function prepareFilters(push=true){
    if(overlay)return;
    if(push){recordCurrent();returnFocus=document.activeElement;returnGuideId=null;history.pushState(snapshot({overlay:{type:'filter'}}),'',viewUrl(state.view));}
    draft={...state.explore};
    for(const el of $$('[data-draft]')){const key=el.dataset.draft;if(el.type==='radio')el.checked=el.value===draft[key];else if(el.type==='checkbox')el.checked=draft[key];else el.value=draft[key];}
    $('#trip-date').min=today;updateDraftCount();showOverlay('filter');
  }
  function updateDraftCount(){if(draft)$('#apply-filters').textContent=`查看 ${places.filter(p=>match(p,draft)).length} 处`;}
  function closeOverlay(apply=false){
    if(!overlay||closingOverlay)return;
    if(apply&&overlay==='filter')pendingFilterApply={...draft};
    if(history.state?.marker===historyKey&&history.state.overlay){closingOverlay=true;history.back();}
    else {const next=pendingFilterApply;pendingFilterApply=null;hideOverlays();if(next){state.explore=cleanFilters(next);state.limit=12;render();persist();}replaceRoute();focusReturn();}
  }
  function openGuide(id){
    if(!placeMap.has(id)||overlay)return;
    recordCurrent();returnFocus=document.activeElement;returnGuideId=id;
    const date=state.view==='explore'?state.explore.date:today;
    history.pushState(snapshot({overlay:{type:'guide',id,date}}),'',`${baseUrl()}#place=${encodeURIComponent(id)}`);
    showGuide(id,date);
  }
  function runGuide(p){const r=p.runInfo;if(!r)return '';return `<section class="run-guide"><div class="run-heading"><h3>这段怎么跑</h3><strong>${runDistance(p)}</strong></div><p>${esc(r.startEnd)}</p><small>${esc(r.routeType)} · 建议累计跑量，可随时折返</small></section>`;}
  function sunsetGuide(p){
    if(!p.sunset)return '';
    const s=p.sunset;
    return `<section class="sunset-guide"><div>${icon('sunset')}<h3>看晚霞</h3><span>${s.kind==='sunset'?'夕照与晚霞':'天色与余晖'}</span></div><strong>${esc(s.spot)}</strong><p>${esc(s.note)}</p></section>`;
  }
  function guide(p,date=today){
    const status=dayStatus(p,date),map=amapLinks(p),r=p.runInfo;
    return `<div class="guide-top">${media(p,true,true)}<button type="button" class="icon-button" data-close-overlay aria-label="返回列表">${icon('back')}</button><button type="button" class="share-button" data-share="${esc(p.id)}">分享</button></div><div class="guide-main"><p class="guide-kicker">${esc(p.district)} · ${p.activity==='run'?'轻松慢跑 · '+runDistance(p):esc(types[p.type])}</p><h2 id="guide-title">${esc(nameOf(p))}</h2><p class="guide-lead">${esc(shortIntro(p))}</p><div class="guide-summary"><div><small>单程 · 约</small><strong>${duration(p.travel)}</strong></div><div><small>建议停留</small><strong>${duration(p.stay)}</strong></div><div><small>人均 · 约</small><strong>${p.costPending?'费用待核':fare(p.cost)}</strong></div></div>${status.code!=='open'?`<div class="guide-prerequisite"><strong>${esc(status.label)}</strong><span>${esc(status.code==='expired'?'本场已结束，留作下次灵感':status.code==='future'?'留意具体场次与报名名额':p.type==='campus'?'先确认入校、图书馆与餐饮权限':'出发前确认当天开放与参与条件')}</span>${p.access.url?`<br><a href="${safeUrl(p.access.url)}" target="_blank" rel="noopener noreferrer">查看官方信息 ↗</a>`:''}</div>`:''}<div class="guide-entry"><span>${r?'起跑接入点':'从这里开始'}</span><strong>${esc(p.entrance)}</strong>${entryLinks(p)}</div>${sunsetGuide(p)}${r?runGuide(p):`<div class="guide-stops"><span>值得停一停</span>${p.spots.slice(0,3).map(s=>`<div><strong>${esc(s.name)}</strong><p>${esc(String(s.text||'').length>64?String(s.text).slice(0,63)+'…':s.text||'')}</p></div>`).join('')}</div>`}
      <details class="practical-details"><summary>交通与现场情况</summary>${p.curation?`<p><strong>体验取向</strong>${esc(p.curation.note)}</p>`:''}${p.sunset?`<p><strong>晚霞返程</strong>${esc(p.sunset.leave)}</p><p>晚霞资料核对：${esc(p.sunset.checked)}。按当季日落时间提前30–45分钟到场，不保证每天有霞。</p>`:''}<p><strong>交通</strong>${esc(p.transport)}</p><p><strong>费用</strong>${esc(p.costNote)}</p><p><strong>开放</strong>${esc(p.access.text)}</p>${p.schedule.start?`<p>场次：${esc(dateTime(p.schedule.start))}${p.schedule.end?' — '+esc(dateTime(p.schedule.end)):''}</p>`:''}${p.schedule.deadline?`<p>报名截止：${esc(dateTime(p.schedule.deadline))}</p>`:''}${p.schedule.note?`<p>${esc(p.schedule.note)}</p>`:''}${r?`<p><strong>跑法</strong>${r.turnPoints.map(t=>esc(typeof t==='string'?t:t.name)).join(' → ')}</p><p>${esc(r.distanceNote)}</p>${Object.entries({surface:'路面',grade:'坡度',shade:'遮阴',crossings:'路口',crowd:'人流',bestTime:'时段',support:'补水与厕所'}).filter(([k])=>r[k]).map(([k,label])=>`<p><strong>${label}</strong>${esc(r[k])}</p>`).join('')}<p>${esc(r.evidenceLimits)}</p>`:Object.entries({shade:'遮阴',seats:'可坐',crowd:'人流',terrain:'坡度'}).map(([k,label])=>`<p><strong>${label}</strong>${esc(p.comfort[k])}</p>`).join('')}${p.tips.length?`<p><strong>留意</strong>${p.tips.map(esc).join(' ')}</p>`:''}${p.nearby.length?`<p><strong>顺路</strong>${p.nearby.map(n=>esc(n.name)).join(' · ')}</p>`:''}<div class="experience-history"><label><input type="checkbox" data-familiar="${esc(p.areaId)}" ${familiar.has(p.areaId)?'checked':''}>熟悉这个地方</label><label><input type="checkbox" data-tried="${esc(p.id)}" ${tried.has(p.id)?'checked':''}>体验过这个玩法</label></div></details>
      <details class="source-details"><summary>资料与照片来源 · ${esc(p.checked)}</summary>${selectedPhotos(p).length>1?`<div class="guide-photo-strip">${selectedPhotos(p).slice(1,3).map(ph=>`<figure><img src="${esc(ph.file)}" alt="${esc(ph.caption)}" loading="lazy"><figcaption>${esc(ph.caption)}</figcaption></figure>`).join('')}</div>`:''}${p.sources.map(s=>`<div class="source-item"><a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>${s.evidence?`<p>${esc(s.evidence)}</p>`:''}</div>`).join('')}<p>${esc(p.sourceEvidence)}交通和费用为估算，以当天实际信息为准。</p>${selectedPhotos(p).map(ph=>`<p>照片：${esc(ph.caption)} · ${esc(ph.author)} · <a href="${safeUrl(ph.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(ph.license)}</a> · <a href="${safeUrl(ph.sourceUrl)}" target="_blank" rel="noopener noreferrer">原图</a>。${esc(ph.changes||'缩放与裁切')}</p>`).join('')}${!selectedPhotos(p).length?'<p>尚未取得对应点位的可用实景，封面为文字占位。</p>':''}</details></div><div class="guide-footer">${saveButton(p,true)}${mapAction(p,true)}</div>`;
  }
  function showGuide(id,date){$('#guide-content').innerHTML=guide(placeMap.get(id),date);showOverlay('guide');}
  function showAbout(push=true){
    if(overlay)return;
    if(push){recordCurrent();returnFocus=document.activeElement;returnGuideId=null;history.pushState(snapshot({overlay:{type:'about'}}),'',viewUrl(state.view));}
    $('#photo-credits').innerHTML=photos.map(ph=>`<div class="credit-row"><img src="${esc(ph.file)}" alt="${esc(ph.caption)}" loading="lazy"><div><strong>${esc(ph.caption)}</strong><p>${esc(ph.author)} · <a href="${safeUrl(ph.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(ph.license)}</a> · <a href="${safeUrl(ph.sourceUrl)}" target="_blank" rel="noopener noreferrer">原图</a></p><p>${esc(ph.changes||'缩放与版式裁切')}</p></div></div>`).join('');
    showOverlay('about');
  }
  function updateSavedButtons(id){
    const p=placeMap.get(id),yes=bookmarks.has(id);
    const activeSave=!overlay&&state.view==='saved'&&document.activeElement?.dataset.save;
    const oldIndex=activeSave?$$('[data-save]',$('#saved-grid')).findIndex(el=>el.dataset.save===activeSave):-1;
    for(const el of $$('[data-save]'))if(el.dataset.save===id){el.setAttribute('aria-pressed',String(yes));el.setAttribute('aria-label',`${yes?'取消想去：':'收藏想去：'}${nameOf(p)}`);el.innerHTML=icon('heart')+`<span>${yes?'已想去':'想去'}</span>`;}
    syncNav();if(state.view==='saved'){renderSaved();if(activeSave){const buttons=$$('[data-save]',$('#saved-grid'));const next=buttons.find(el=>el.dataset.save===activeSave)||buttons[Math.min(Math.max(0,oldIndex),buttons.length-1)];(next||$('#saved-title')).focus({preventScroll:true});}}
  }
  function save(id){
    if(!placeMap.has(id))return;
    if(bookmarks.has(id)){
      const order=[...bookmarks];bookmarks.delete(id);persist();updateSavedButtons(id);
      toast('已移出想去',()=>{bookmarks.clear();for(const item of order)bookmarks.add(item);persist();updateSavedButtons(id);toast('已恢复到想去');});
    }else {bookmarks.add(id);persist();updateSavedButtons(id);toast('已加入想去');}
  }
  async function share(id){
    const url=`${baseUrl()}#place=${encodeURIComponent(id)}`,title=`深大出走 · ${nameOf(placeMap.get(id))}`;
    try{if(navigator.share){await navigator.share({title,url});}else {await navigator.clipboard.writeText(url);toast('路线链接已复制');}}
    catch(error){if(error.name!=='AbortError')toast('可复制浏览器地址栏中的链接');}
  }
  function initEvents(){
    if(eventsReady)return;eventsReady=true;
    $('#glass-effect').checked=glassEnabled;
    $('#glass-effect').addEventListener('change',e=>{glassEnabled=e.target.checked;document.body.setAttribute('data-glass',glassEnabled?'on':'off');try{localStorage.setItem('szu-glass:v1',glassEnabled?'on':'off');}catch{}});
    $('#search-form').addEventListener('submit',e=>{e.preventDefault();$('#search').blur();});
    $('#search').addEventListener('compositionstart',()=>{isComposing=true;});
    $('#search').addEventListener('compositionend',e=>{isComposing=false;editExplore({query:e.target.value});});
    $('#search').addEventListener('input',e=>{if(!isComposing)editExplore({query:e.target.value});});
    $('#clear-search').addEventListener('click',()=>{editExplore({query:''});$('#search').focus({preventScroll:true});});
    $('#sort').addEventListener('change',e=>editExplore({sort:e.target.value}));
    $('#open-filters').addEventListener('click',()=>prepareFilters());
    $('#filter-form').addEventListener('change',e=>{const el=e.target;if(!draft||!el.dataset.draft)return;if(el.type==='date'&&(!el.value||!el.validity.valid))return;draft[el.dataset.draft]=el.type==='checkbox'?el.checked:el.value;updateDraftCount();});
    $('#filter-form').addEventListener('submit',e=>{e.preventDefault();closeOverlay(true);});
    $('#reset-filter-draft').addEventListener('click',()=>{if(!draft)return;const {category,query,sort}=draft;draft={...defaults,category,query,sort};for(const el of $$('[data-draft]')){if(el.type==='radio')el.checked=el.value===draft[el.dataset.draft];else if(el.type==='checkbox')el.checked=draft[el.dataset.draft];else el.value=draft[el.dataset.draft];}updateDraftCount();});
    $('#reset-explore').addEventListener('click',resetExplore);
    $('#load-more').addEventListener('click',()=>{const y=window.scrollY;state.limit+=12;renderExplore();replaceRoute();window.scrollTo({top:y,behavior:'instant'});});
    $('#shuffle').addEventListener('click',()=>{recommendations(true);render();toast('换了一组，慢慢挑');});
    $('#undo-save').addEventListener('click',()=>{const undo=undoAction;undoAction=null;if(undo)undo();});
    document.addEventListener('click',e=>{
      const el=e.target.closest('a,button');if(!el)return;
      const modified=e.metaKey||e.ctrlKey||e.shiftKey||e.altKey;
      if(el.classList.contains('skip-link')){e.preventDefault();$('#main').focus();return;}
      if(el.dataset.save){save(el.dataset.save);return;}
      if(el.dataset.guide){if(modified)return;e.preventDefault();openGuide(el.dataset.guide);return;}
      if(el.hasAttribute('data-close-overlay')){closeOverlay();return;}
      if(el.hasAttribute('data-start-search')){navigate('explore',{reset:true,focusSearch:true});return;}
      if(el.hasAttribute('data-retry-data')){init();return;}
      if(el.hasAttribute('data-home-top')){navigate('discover');return;}
      if(el.hasAttribute('data-sky-open')){navigate('discover');$('#sky-title').focus({preventScroll:true});window.scrollTo({top:$('#sky-card').getBoundingClientRect().top+window.scrollY-90,behavior:'instant'});return;}
      if(el.dataset.preset){navigate('explore',{preset:el.dataset.preset});return;}
      if(el.dataset.category){editExplore({category:el.dataset.category});return;}
      if(el.dataset.removeFilter){const key=el.dataset.removeFilter;editExplore({[key]:key==='lowCommerce'?false:defaults[key]});return;}
      if(el.hasAttribute('data-about')){showAbout();return;}
      if(el.dataset.share){share(el.dataset.share);return;}
      if(el.dataset.nav){if(modified)return;e.preventDefault();navigate(el.dataset.nav,{reset:el.hasAttribute('data-browse-all')});}
    });
    $('#guide-dialog').addEventListener('change',e=>{const el=e.target;if(el.dataset.familiar){el.checked?familiar.add(el.dataset.familiar):familiar.delete(el.dataset.familiar);persist();}if(el.dataset.tried){el.checked?tried.add(el.dataset.tried):tried.delete(el.dataset.tried);persist();}});
    for(const id of ['guide-dialog','filter-dialog','about-dialog']){
      const dialog=$(`#${id}`);
      dialog.addEventListener('cancel',e=>{e.preventDefault();closeOverlay();});
      dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeOverlay();});
    }
    window.addEventListener('popstate',e=>restoreRoute(e.state));
    window.addEventListener('pagehide',recordCurrent);
    const refreshDay=()=>{if(document.visibilityState==='hidden'||!places.length)return;const next=localDate();if(next===today)return;const previous=today;today=next;defaults.date=next;if(state.explore.date===previous||state.explore.date<next)state.explore.date=next;recommendationIds=[];render();replaceRoute();persist();};
    document.addEventListener('visibilitychange',refreshDay);window.addEventListener('pageshow',refreshDay);
    document.addEventListener('szu:sky-routes',e=>{
      const category=e.detail?.category==='sea'?'sea':'sunset',date=cleanFilters({date:e.detail?.date}).date;
      navigate('explore',{preset:category});editExplore({date,skyRegion:category==='sunset'&&Object.hasOwn(skyRegions,e.detail?.locationId)?e.detail.locationId:'all',forecastMode:e.detail?.mode||''});
    });
  }
  async function init(){
    if(initializing)return;initializing=true;initEvents();let loadTimer;
    $('#data-status').hidden=true;
    try{
      const fetchJson=async path=>{const r=await fetch(path,{cache:'no-cache'});if(!r.ok)throw new Error(`HTTP ${r.status}: ${path}`);return r.json();};
      const [areas,experiences,images]=await Promise.race([Promise.all([fetchJson('data/areas.json'),fetchJson('data/experiences.json'),fetchJson('data/photos.json')]),new Promise((resolve,reject)=>{loadTimer=setTimeout(()=>reject(new Error('路线资料加载超时')),12000);})]);
      const areaMap=new Map(areas.map(a=>[a.id,a]));photos=images;photoMap=new Map(photos.map(p=>[p.id,p]));
      places=experiences.map(e=>({...areaMap.get(e.areaId),activity:'walk',...e,...(e.placeOverrides||{})}));placeMap=new Map(places.map(p=>[p.id,p]));
      try{history.scrollRestoration='manual';}catch{}
      initEvents();
      if(history.state?.marker===historyKey)restoreRoute(history.state);
      else {
        const hash=location.hash;let directId=null;
        if(hash.startsWith('#place=')){try{directId=decodeURIComponent(hash.slice(7));}catch{}}
        else if(hash==='#saved')state.view='saved';
        else if(['#running','#explore'].includes(hash)){state.view='explore';if(hash==='#running')state.explore={...defaults,category:'run'};}
        history.replaceState(snapshot({scrollY:0}),'',viewUrl(state.view));render();
        if(directId&&placeMap.has(directId))openGuide(directId);
        else if(directId)toast('这条分享路线已找不到，先看看其他去处');
      }
      persist();
      window.SZU={get places(){return places},get state(){return {view:state.view,explore:{...state.explore},limit:state.limit}},dayStatus,match,photoInfo};
    }catch(error){console.error(error);$('#data-status').hidden=false;$('#data-status').innerHTML='<span>路线资料暂时没加载好，已存的想去清单仍在本机。</span><button type="button" data-retry-data>重新加载</button>';$('#recommend-grid').innerHTML='';}
    finally{clearTimeout(loadTimer);initializing=false;}
  }
  init();
})();
