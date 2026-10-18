/* 深大出走 · buildless, no analytics or business API */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? esc(u.href) : '#'; } catch { return '#'; } };
  const bands = { daily:'日常休闲', half:'半天', day:'全天' };
  const types = { nature:'自然与绿地', campus:'校园走走', market:'市场与超市', food:'街巷风味', culture:'文化生活' };
  const moods = { sea:'海风与落日', green:'树荫与绿意', lake:'湖畔发呆', campus:'换个校园', food:'逛逛吃吃', art:'文化与灵感' };
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const today = localDate();
  const defaults = {activity:'all',band:'all',mood:'all',budget:'any',commute:'any',allowReserve:true,directOnly:false};
  const storageKey = 'szu-slow-days:v1';
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* private storage may be unavailable */ }
  const state = { ...defaults, ...stored.filters, date:today, search:'', view:'all', sort:'fit', page:12, batch:0, mobileTab:'recommend' };
  const bookmarks = new Set(Array.isArray(stored.saved) ? stored.saved : []);
  const familiar = new Set(Array.isArray(stored.familiar) ? stored.familiar : []);
  const tried = new Set(Array.isArray(stored.tried) ? stored.tried : []);
  let places = [], photos = [], photoMap = new Map(), guideId = null, returnFocus = null, toastTimer;
  let recommendationCache = {key:'',ids:[]};
  const recommendationKey = 'szu-slow-days:last-recommendation';

  function persist() {
    const filters = Object.fromEntries(Object.keys(defaults).map(k => [k,state[k]]));
    try { localStorage.setItem(storageKey, JSON.stringify({filters,saved:[...bookmarks],familiar:[...familiar],tried:[...tried]})); } catch { toast('当前浏览器未允许保存；本次仍可使用'); }
  }
  function toast(text) { const el = $('#toast'); el.textContent = text; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'),2700); }
  function mins(value) { return value % 60 === 0 && value >= 60 ? `${value/60}小时` : `${value}分钟`; }
  function duration(range) { return range[0] === range[1] ? mins(range[0]) : range[1] <= 120 || range.some(n=>n%30) ? `${range[0]}–${range[1]}分钟` : `${range[0]/60}–${range[1]/60}小时`; }
  function fare(range) { return range[0] === range[1] ? `¥${range[0]}` : `¥${range[0]}–${range[1]}`; }
  const nameOf = p => p.officialName || p.name;
  const labelOf = p => `${nameOf(p)}${p.playTitle?' · '+p.playTitle:''}`;
  const runDistance = p => p.runInfo ? `${p.runInfo.distanceKm[0]}${p.runInfo.distanceKm[0]===p.runInfo.distanceKm[1]?'':'–'+p.runInfo.distanceKm[1]} km` : '';
  function dateTime(value) { if (!value) return ''; return value.replace('T',' ').replace(/:00(?:\+08:00|Z)?$/,'').replace(/\+08:00$/,''); }
  function dayStatus(p) {
    const s = p.schedule || {}, from = new Date(`${state.date}T00:00:00+08:00`), until = new Date(`${state.date}T23:59:59+08:00`);
    const end = s.end ? new Date(s.end) : s.start ? new Date(`${s.start.slice(0,10)}T23:59:59+08:00`) : null, start = s.start ? new Date(s.start) : null;
    const expiryCheck = state.date === today ? new Date() : from;
    if (end && end < expiryCheck) return {code:'expired',label:'活动已结束',actionable:false};
    if (s.deadline && new Date(s.deadline) < new Date()) return {code:'deadline',label:'报名已截止',actionable:false};
    if (start && start > until) return {code:'future',label:`${String(s.start).slice(5,10).replace('-','/')} 场次`,actionable:false};
    const dow = new Date(`${state.date}T12:00:00+08:00`).getDay();
    if ((s.closedDays || []).includes(dow) || (s.weekendsOnly && ![0,6].includes(dow))) return {code:'closed',label:'所选日期不开放',actionable:false};
    if ((s.verifyWeekdays || []).includes(dow)) return {code:'calendar',label:'先查当日预约日历',actionable:false};
    if (p.availability === 'verify') return {code:'verify',label:'先核实参与条件',actionable:false};
    if (p.access.kind === 'event' && !start) return {code:'calendar',label:'查看本期排期',actionable:false};
    if (p.access.kind === 'member') return {code:'member',label:'须邀请／特定条件',actionable:false};
    if (p.access.kind === 'event') return {code:'event',label:'当日活动 · 先查名额',actionable:true};
    if (p.access.kind === 'reserve') return {code:'reserve',label:'需预约／登记',actionable:true};
    return {code:'open',label:'常规可去',actionable:true};
  }
  function match(p) {
    if (state.activity !== 'all' && p.activity !== state.activity) return false;
    if (state.band !== 'all' && p.band !== state.band) return false;
    if (state.mood !== 'all' && !(state.mood === 'campus' ? p.type === 'campus' : p.moods.includes(state.mood))) return false;
    if (state.budget !== 'any' && (p.costPending || p.cost[1] > +state.budget)) return false;
    if (state.commute !== 'any' && p.travel[1] > +state.commute) return false;
    if (!state.allowReserve && p.access.kind !== 'open') return false;
    if (state.directOnly && !dayStatus(p).actionable) return false;
    if (state.search && ![p.name,nameOf(p),p.playTitle,p.activity==='run'?'慢跑 跑步 绿道': '',p.district,types[p.type],bands[p.band],p.lead,p.description,...p.spots.map(x => x.name)].join(' ').toLowerCase().includes(state.search.toLowerCase())) return false;
    return true;
  }
  function score(p) { return (p.type === 'nature' ? 120 : p.type === 'campus' ? 90 : 60) - p.travel[1] * .32 - p.cost[1] * .05 + (p.moods.includes('green') ? 8 : 0) + ({'lixiang-shade':8,'talent-liuhua':18,'xili-lake-section':9}[p.id]||0) + (p.activity==='run' ? state.activity==='run' ? (p.runInfo.priority||0) : -22 : 0); }
  function sorted(items) {
    return [...items].sort((a,b) => {
      const action = +dayStatus(b).actionable - +dayStatus(a).actionable;
      if (action) return action;
      if (state.sort === 'near') return a.travel[1]-b.travel[1] || a.cost[1]-b.cost[1];
      if (state.sort === 'cheap') return a.cost[1]-b.cost[1] || a.travel[1]-b.travel[1];
      return score(b)-score(a) || a.name.localeCompare(b.name,'zh-CN');
    });
  }
  function selectedPhotos(p) { return (p.photoIds || []).map(id => photoMap.get(id)).filter(Boolean); }
  function photoInfo(p) {
    const exact = selectedPhotos(p);
    if (exact.length) return {photo:exact[0],reference:!!p.photoReference,caption:p.photoNote||exact[0].caption};
    return {photo:null,reference:false,caption:'实景待补'};
  }
  function shortIntro(p) {
    const text=String(p.lead||p.playTitle||'').trim();
    const first=text.match(/^[^。！？]+[。！？]?/)?.[0]||text;
    return first.length<=52?first:first.slice(0,51).replace(/[，、；：]$/,'')+'…';
  }
  function amapLinks(p, platform) {
    if (!platform) {
      const ua=navigator.userAgent||'';
      platform=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1)?'ios':/Android/i.test(ua)?'android':'web';
    }
    const raw=String(p.mapKeyword||p.entrance||nameOf(p)).trim();
    const destination=/深圳/.test(raw)?raw:'深圳 '+raw;
    const source=encodeURIComponent('深大出走'), name=encodeURIComponent(destination);
    const web='https://uri.amap.com/search?keyword='+name+'&city='+encodeURIComponent('深圳')+'&view=map&callnative=0';
    const primary=platform==='ios'?'iosamap://path?sourceApplication='+source+'&dname='+name+'&dev=0&t=1&m=0':platform==='android'?'androidamap://poi?sourceApplication='+source+'&keywords='+name+'&dev=0':web;
    return {primary,web,native:platform==='ios'||platform==='android',destination};
  }
  function media(p, {guide=false,eager=false}={}) {
    const {photo,reference,caption}=photoInfo(p);
    if(!photo) return '<div class="place-placeholder tone-'+esc(p.type)+'" role="img" aria-label="'+esc(nameOf(p))+'，实景照片待补"><span class="placeholder-symbol" aria-hidden="true">'+(p.type==='nature'?'〰':p.type==='campus'?'⌂':p.type==='culture'?'✳':'◒')+'</span><span>'+esc(p.district)+' / '+esc(types[p.type])+'</span><strong>'+esc(nameOf(p))+'</strong><small>实景待补</small></div>';
    return '<img src="'+esc(photo.file)+'" alt="'+esc(caption)+'" loading="'+(eager?'eager':'lazy')+'" decoding="async"><span class="'+(guide?'guide-hero-caption':'image-caption')+(reference?' reference':'')+'">'+esc(caption)+'</span>';
  }
  function card(p,index,recommend=false) {
    const saved=bookmarks.has(p.id), map=amapLinks(p), status=dayStatus(p);
    return `<article class="place-card" data-place="${esc(p.id)}">
      <button class="bookmark" type="button" data-save="${esc(p.id)}" aria-label="${saved?'取消想去：':'收藏想去：'}${esc(nameOf(p))}" aria-pressed="${saved}">${saved?'♥':'♡'}</button>
      <a class="card-image-link" href="#place=${encodeURIComponent(p.id)}" data-guide="${esc(p.id)}" tabindex="-1" aria-hidden="true">${media(p,{eager:recommend&&index===0})}</a>
      <div class="card-body"><div class="card-kicker"><span>${esc(p.district)}</span><span class="dot"></span><span>${p.activity==='run'?'慢跑 · '+runDistance(p):esc(types[p.type])}</span><span class="band-tag">${bands[p.band]}</span></div>
      <h3><a class="card-title-link" href="#place=${encodeURIComponent(p.id)}" data-guide="${esc(p.id)}">${esc(nameOf(p))}</a></h3><p class="card-lead">${esc(shortIntro(p))}</p>
      <div class="card-stats"><div><span>单程 · 约</span><strong>${duration(p.travel)}</strong></div><div><span>停留</span><strong>${duration(p.stay)}</strong></div><div><span>人均 · 约</span><strong>${p.costPending?'待核':fare(p.cost)}</strong></div></div>
      ${status.code!=='open'?'<p class="card-condition">'+esc(status.label)+'</p>':p.travel[1]>90?'<p class="card-condition">较远，留足往返时间</p>':''}
      <div class="card-bottom"><a class="guide-link" href="#place=${encodeURIComponent(p.id)}" data-guide="${esc(p.id)}">看看详情 <span aria-hidden="true">↗</span></a><a class="map-button" href="${esc(map.primary)}" data-map aria-label="高德导航到${esc(p.entrance)}"><svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m17 3-5 14-3-6-6-3 14-5Z"/></svg>高德导航</a></div></div></article>`;
  }

  function syncControls() {
    $$('[data-activity]').forEach(el => {el.classList.toggle('active',el.dataset.activity===state.activity);el.setAttribute('aria-pressed',String(el.dataset.activity===state.activity));});
    $$('[data-mobile-nav]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.mobileNav===state.mobileTab)));
    $$('[data-band]').forEach(el => { el.classList.toggle('active',el.dataset.band === state.band); el.setAttribute('aria-pressed',String(el.dataset.band === state.band)); });
    $$('[data-mood]').forEach(el => { el.classList.toggle('active',el.dataset.mood === state.mood); el.setAttribute('aria-pressed',String(el.dataset.mood === state.mood)); });
    for (const id of ['budget','commute','sort']) $(`#${id}`).value = state[id];
    $('#allow-reserve').checked = state.allowReserve; $('#direct-only').checked = state.directOnly; $('#trip-date').value = state.date; $('#search').value = state.search;
    $$('[data-view]').forEach(el => {el.classList.toggle('active',el.dataset.view === state.view);el.setAttribute('aria-pressed',String(el.dataset.view === state.view));});
    $('#saved-count').textContent = bookmarks.size; $('#tab-saved-count').textContent = bookmarks.size; $('#mobile-saved-count').textContent=bookmarks.size; $('#total-count').textContent = places.filter(p=>state.activity==='all'||p.activity===state.activity).length;
    $('#all-tab-label').textContent=state.activity==='run'?'全部跑线':state.activity==='walk'?'散步与生活':'所有去处';
    $('#filter-summary').textContent=[state.budget==='any'?'预算不限':`¥${state.budget}以内`,state.commute==='any'?'通勤不限':`${state.commute}分钟内`,(!state.allowReserve||state.directOnly||state.date!==today)&&'含参与条件'].filter(Boolean).join(' · ');
  }
  function shuffled(items) {
    const out=[...items];
    for(let i=out.length-1;i>0;i--) {
      let j;
      if(globalThis.crypto?.getRandomValues) {
        const limit=Math.floor(4294967296/(i+1))*(i+1), value=new Uint32Array(1);
        do { crypto.getRandomValues(value); } while(value[0]>=limit);
        j=value[0]%(i+1);
      } else j=Math.floor(Math.random()*(i+1));
      [out[i],out[j]]=[out[j],out[i]];
    }
    return out;
  }
  function recommendations(items) {
    const pool=items.filter(p=>dayStatus(p).actionable), n=Math.min(3,pool.length);
    $('#shuffle').disabled=pool.length<=n;
    const key=JSON.stringify([Object.keys(defaults).map(k=>state[k]),state.date,state.search,state.batch,pool.map(p=>p.id)]);
    if(key===recommendationCache.key) return recommendationCache.ids.map(id=>pool.find(p=>p.id===id)).filter(Boolean);
    let previous=recommendationCache.ids;
    if(!previous.length) {try{const ids=JSON.parse(localStorage.getItem(recommendationKey)||'[]');if(Array.isArray(ids))previous=ids;}catch{}}
    const old=new Set(previous), fresh=shuffled(pool.filter(p=>!old.has(p.id))), repeated=shuffled(pool.filter(p=>old.has(p.id)));
    const available=fresh.length>=n?fresh:[...fresh,...repeated], out=[];
    // Random people and places, with the original preference for nature plus a little everyday life.
    if(state.mood==='all'&&state.activity!=='run'&&fresh.length>=n) {
      out.push(...available.filter(p=>p.type==='nature').slice(0,2));
      const life=available.find(p=>p.type!=='nature');if(life)out.push(life);
    }
    for(const p of available)if(out.length<n&&!out.includes(p))out.push(p);
    const result=shuffled(out.slice(0,n));
    recommendationCache={key,ids:result.map(p=>p.id)};
    try{localStorage.setItem(recommendationKey,JSON.stringify(recommendationCache.ids));}catch{}
    return result;
  }

  function render() {
    syncControls();
    const matches = places.filter(match);
    $('#filter-match-count').textContent=`${matches.length} 项符合条件`;
    $('#recommend-title').textContent=state.activity==='run'?'今天，跑这一段？':'今天，去这里？';
    $('#explore-title').textContent=state.activity==='run'?'全部慢跑路线':'全部去处';
    $('#run-selection-note').hidden=state.activity!=='run';
    const recs = recommendations(matches);
    $('#recommend-grid').innerHTML = recs.length ? recs.map((p,i) => card(p,i,true)).join('') : '<div class="empty-state" style="grid-column:1/-1"><h3>这一天，暂时没有合适的可参与推荐</h3><p>调整交通、主题或日期，也可以在下方收藏待排期的灵感。</p><button class="primary-button" type="button" data-show-all>放宽条件看看</button></div>';
    $('#recommend-summary').textContent=recs.length?'随机选了 '+recs.length+' 处，喜欢就出发。':'放宽一点条件，再看看。';
    const catalog = sorted(matches.filter(p => state.view !== 'saved' || bookmarks.has(p.id)));
    $('#catalog-grid').innerHTML = catalog.slice(0,state.page).map((p,i) => card(p,i)).join('');
    $('#result-count').textContent = `${catalog.length} 处`; $('#empty-state').hidden = catalog.length > 0; $('#load-more').hidden = catalog.length <= state.page;
    if (!catalog.length) {
      $('#empty-state h3').textContent = state.view === 'saved' && !bookmarks.size ? '先留下一点想去的心情' : '给条件留一点余地';
      $('#empty-state p').textContent = state.view === 'saved' && !bookmarks.size ? '点卡片上的爱心，把喜欢的去处留给下一次空闲。' : '试试更长的交通时间，或换一种想看的风景。';
    }
    const conditions = [state.activity!=='all'&&(state.activity==='run'?'轻松慢跑':'散步与生活'),state.band!=='all'&&bands[state.band],state.mood!=='all'&&moods[state.mood],state.budget!=='any'&&`人均上限 ¥${state.budget}`,state.commute!=='any'&&`单程上限 ${state.commute} 分钟`,!state.allowReserve&&'无需预约',state.directOnly&&'明确可去',state.search&&`搜索“${state.search}”`].filter(Boolean);
    $('#active-conditions').innerHTML = conditions.length ? `${esc(conditions.join(' / '))} <button class="text-button" data-show-all type="button" style="margin-left:10px">查看完整 ${places.length} 项</button>` : `全部 ${places.length} 项 · 熟悉的、新发现的，都在这里`;
    persist();
  }
  function changed() {state.batch=0;state.page=12;state.mobileTab=state.view==='saved'?'saved':state.activity==='run'?'run':'recommend';render();}
  function showAll() {Object.assign(state,defaults,{commute:'any',search:'',view:'all',page:12,batch:0,mobileTab:'all'});render();}
  function navigate(mode) {
    if(mode==='all') showAll();
    else if(mode==='saved') {Object.assign(state,{view:'saved',search:'',page:12,batch:0,mobileTab:mode});render();}
    else {state.view='all';state.mobileTab=mode;if(mode==='run'){state.activity='run';state.mood='all';state.search='';state.batch=0;state.page=12;}render();}
    history.replaceState(null,'',location.pathname+location.search+({run:'#running',saved:'#saved',all:'#explore',recommend:'#recommendations'}[mode]));
    $(mode==='recommend'?'#recommendations':'#explore').scrollIntoView({behavior:'auto'});
  }
  function save(id) {
    const p=places.find(p=>p.id===id); if(!p)return;
    if(bookmarks.has(id)){bookmarks.delete(id);toast('已从想去清单移除');}else{bookmarks.add(id);toast('已收藏，留给下一次空闲');}
    persist();
    $$(`[data-save="${id}"]`).forEach(el=>{const yes=bookmarks.has(id);el.textContent=el.classList.contains('bookmark')?(yes?'♥':'♡'):(yes?'♥ 已加入想去':'♡ 加入想去');el.setAttribute('aria-pressed',String(yes));el.setAttribute('aria-label',`${yes?'取消想去：':'收藏想去：'}${labelOf(p)}`);});$('#saved-count').textContent=bookmarks.size;$('#tab-saved-count').textContent=bookmarks.size;$('#mobile-saved-count').textContent=bookmarks.size;
    if(state.view==='saved') render();
  }
  function runGuide(p) {
    const r=p.runInfo;if(!r)return '';
    return `<section class="run-guide"><div class="run-guide-heading"><h3>这段怎么跑</h3><strong>${runDistance(p)}</strong></div><p class="run-start-end">${esc(r.startEnd)}</p><p class="run-compact-note">${esc(r.routeType)} · 建议累计跑量，可随时折返</p></section>`;
  }
  function guide(p) {
    const status=dayStatus(p), map=amapLinks(p), r=p.runInfo;
    const needsCheck=status.code!=='open';
    return `<div class="guide-close-row"><button class="dialog-close" type="button" data-close="guide" aria-label="关闭指南">×</button></div><div class="guide-hero">${media(p,{guide:true,eager:true})}</div>
      <div class="guide-main"><p class="guide-kicker">${esc(p.district)} · ${p.activity==='run'?'慢跑路线':esc(types[p.type])} · ${bands[p.band]}</p><h2 id="guide-title">${esc(nameOf(p))}</h2><p class="guide-lead">${esc(shortIntro(p))}</p>
      <div class="guide-actions"><a href="${esc(map.primary)}" data-map>高德导航 ↗</a><button data-save="${esc(p.id)}" type="button" aria-pressed="${bookmarks.has(p.id)}" aria-label="${bookmarks.has(p.id)?'取消想去：':'收藏想去：'}${esc(nameOf(p))}">${bookmarks.has(p.id)?'♥ 已收藏':'♡ 收藏'}</button></div>
      <div class="guide-summary"><div><small>单程 · 约</small><strong>${duration(p.travel)}</strong></div><div><small>停留</small><strong>${duration(p.stay)}</strong></div><div><small>人均 · 约</small><strong>${p.costPending?'费用待核':fare(p.cost)}</strong></div></div>
      <div class="guide-entry"><span>${r?'起跑接入点':'导航入口'}</span><strong>${esc(p.entrance)}</strong><a href="${safeUrl(map.web)}" target="_blank" rel="noopener noreferrer">用网页版 ↗</a></div>
      ${r?runGuide(p):'<div class="guide-stops"><span>值得停一停</span>'+p.spots.slice(0,3).map(s=>'<strong>'+esc(s.name)+'</strong>').join('')+'</div>'}
      ${needsCheck?'<div class="guide-prerequisite"><strong>'+esc(status.label)+'</strong><span>'+esc(p.type==='campus'?'先确认入校、图书馆及餐饮权限':status.code==='expired'?'本场已结束，留作下次灵感':status.code==='future'?'留意场次日期与报名名额':'出发前请核实当天条件')+'</span>'+(p.access.url?'<a href="'+safeUrl(p.access.url)+'" target="_blank" rel="noopener noreferrer">官方信息 ↗</a>':'')+'</div>':''}
      <details class="practical-details"><summary>出发信息 · 路况、开放与费用</summary>
        <p><strong>交通</strong>${esc(p.transport)}</p><p><strong>费用</strong>${esc(p.costNote)}</p><p><strong>开放</strong>${esc(p.access.text)}</p>
        ${p.schedule.start?'<p>场次：'+esc(dateTime(p.schedule.start))+(p.schedule.end?' — '+esc(dateTime(p.schedule.end)):'')+'</p>':''}${p.schedule.deadline?'<p>报名截止：'+esc(dateTime(p.schedule.deadline))+'</p>':''}${p.schedule.note?'<p>'+esc(p.schedule.note)+'</p>':''}
        ${r?'<p><strong>跑法</strong>'+r.turnPoints.map(t=>esc(typeof t==='string'?t:t.name)).join(' → ')+'</p><p>'+esc(r.distanceNote)+'</p>'+Object.entries({surface:'路面',grade:'坡度',shade:'遮阴',crossings:'路口',crowd:'人流',bestTime:'时段',support:'补水与厕所'}).filter(([k])=>r[k]).map(([k,label])=>'<p><strong>'+label+'</strong>'+esc(r[k])+'</p>').join('')+'<p>'+esc(r.evidenceLimits)+'</p>':Object.entries({shade:'遮阴',seats:'可坐',crowd:'人流',terrain:'坡度'}).map(([k,label])=>'<p><strong>'+label+'</strong>'+esc(p.comfort[k])+'</p>').join('')}
        ${p.tips.length?'<p><strong>留意</strong>'+p.tips.map(t=>esc(t)).join(' ')+'</p>':''}${p.nearby.length?'<p><strong>顺路</strong>'+p.nearby.map(n=>esc(n.name)).join(' · ')+'</p>':''}
        <div class="experience-history"><label><input type="checkbox" data-familiar="${esc(p.areaId)}" ${familiar.has(p.areaId)?'checked':''}>熟悉这个地方</label><label><input type="checkbox" data-tried="${esc(p.id)}" ${tried.has(p.id)?'checked':''}>体验过这个玩法</label></div><button class="text-button" type="button" data-share="${esc(p.id)}">复制指南链接 ↗</button>
      </details>
      <details class="source-details"><summary>来源与照片 · ${esc(p.checked)}</summary>${selectedPhotos(p).length>1?'<div class="guide-photo-strip">'+selectedPhotos(p).slice(1,3).map(ph=>'<figure><img src="'+esc(ph.file)+'" alt="'+esc(ph.caption)+'" loading="lazy"><figcaption>'+esc(ph.caption)+'</figcaption></figure>').join('')+'</div>':''}${p.sources.map(s=>'<div class="source-item"><a href="'+safeUrl(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title)+' ↗</a>'+(s.evidence?'<p>'+esc(s.evidence)+'</p>':'')+'</div>').join('')}<p>${esc(p.sourceEvidence)}交通与费用为估算，以当日实际信息为准。</p>${selectedPhotos(p).map(ph=>'<p>照片：'+esc(ph.caption)+' · '+esc(ph.author)+' · <a href="'+safeUrl(ph.licenseUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(ph.license)+'</a> · <a href="'+safeUrl(ph.sourceUrl)+'" target="_blank" rel="noopener noreferrer">原图</a>。'+esc(ph.changes||'缩放与裁切')+'</p>').join('')}${!selectedPhotos(p).length?'<p>未取得对应点位的可用实景，封面为文字占位。</p>':''}</details></div>`;
  }

  function openGuide(id,updateHash=true) {
    const p=places.find(p=>p.id===id);if(!p)return;
    returnFocus=document.activeElement; guideId=id; $('#guide-content').innerHTML=guide(p);
    if(!$('#guide-dialog').open) $('#guide-dialog').showModal();
    document.body.classList.add('modal-open');$('#guide-dialog').scrollTop=0;
    if(updateHash) history.pushState({place:id},'',`#place=${encodeURIComponent(id)}`);
  }
  function closeGuide(updateHash=true) {
    if($('#guide-dialog').open) $('#guide-dialog').close();guideId=null;document.body.classList.remove('modal-open');
    if(updateHash&&location.hash.startsWith('#place=')) history.replaceState(null,'',location.pathname+location.search+(state.activity==='run'?'#running':'#explore'));
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  }
  function credits() {
    $('#photo-credits').innerHTML=photos.map(ph=>`<div class="credit-row"><img src="${esc(ph.file)}" alt="${esc(ph.caption)}" loading="lazy"><div><strong>${esc(ph.caption)}</strong><p>${esc(ph.author)} · <a href="${safeUrl(ph.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(ph.license)}</a> · <a href="${safeUrl(ph.sourceUrl)}" target="_blank" rel="noopener noreferrer">原图页面 ↗</a></p><p>${esc(ph.changes||'缩放与版式裁切')}</p></div></div>`).join('');
    $('#credits-dialog').showModal();document.body.classList.add('modal-open');
  }
  function initEvents() {
    $('#filters').addEventListener('submit',e=>e.preventDefault());
    $('#filters').addEventListener('reset',e=>{e.preventDefault();Object.assign(state,defaults,{date:today});changed();toast('已恢复默认条件');});
    $('#filters').addEventListener('click',e=>{const b=e.target.closest('[data-band]'),m=e.target.closest('[data-mood]'),a=e.target.closest('[data-activity]');if(b){state.band=b.dataset.band;changed();}if(m){state.mood=m.dataset.mood;changed();}if(a){state.activity=a.dataset.activity;state.view='all';changed();}});
    for(const id of ['budget','commute']) $(`#${id}`).addEventListener('change',e=>{state[id]=e.target.value;changed();});
    for(const [id,key] of [['allow-reserve','allowReserve'],['direct-only','directOnly']]) $(`#${id}`).addEventListener('change',e=>{state[key]=e.target.checked;changed();});
    $('#trip-date').min=today;
    $('#trip-date').addEventListener('change',e=>{if(e.target.value&&e.target.validity.valid){state.date=e.target.value;changed();}});
    $('#filter-refine').open=false;
    $('#shuffle').addEventListener('click',()=>{state.batch++;render();toast('换了一批，筛选条件已保留');});
    $('#search').addEventListener('input',e=>{state.search=e.target.value.trim();state.page=12;render();$('#search').focus({preventScroll:true});});
    $('#sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
    $$('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;state.page=12;state.mobileTab=state.view==='saved'?'saved':state.activity==='run'?'run':'all';render();history.replaceState(null,'',location.pathname+location.search+(state.view==='saved'?'#saved':state.activity==='run'?'#running':'#explore'));}));
    $('#saved-nav').addEventListener('click',()=>navigate('saved'));
    $('#run-nav').addEventListener('click',()=>navigate('run'));
    $$('[data-mobile-nav]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.mobileNav)));
    $('[data-filter-shortcut]').addEventListener('click',()=>{$('.chooser').scrollIntoView({behavior:'auto'});$('#chooser-title').focus({preventScroll:true});});
    $('.site-header nav a[href="#explore"]').addEventListener('click',e=>{e.preventDefault();navigate('all');});
    $('#empty-reset').addEventListener('click',showAll);
    $('#load-more').addEventListener('click',()=>{state.page+=12;render();});
    document.addEventListener('click',async e=>{
      const saveButton=e.target.closest('[data-save]');if(saveButton){save(saveButton.dataset.save);return;}
      const link=e.target.closest('[data-guide]');if(link){e.preventDefault();openGuide(link.dataset.guide);return;}
      if(e.target.closest('[data-show-all]')){showAll();return;}
      if(e.target.closest('[data-credits]')){credits();return;}
      if(e.target.closest('[data-close="guide"]')){closeGuide();return;}
      if(e.target.closest('[data-close="credits"]')){$('#credits-dialog').close();if(!guideId)document.body.classList.remove('modal-open');return;}
      const share=e.target.closest('[data-share]');if(share){try{await navigator.clipboard.writeText(`${location.origin}${location.pathname}#place=${encodeURIComponent(share.dataset.share)}`);toast('指南链接已复制');}catch{toast('可复制浏览器地址栏中的指南链接');}}
    });
    $('#guide-dialog').addEventListener('change',e=>{if(e.target.dataset.familiar){e.target.checked?familiar.add(e.target.dataset.familiar):familiar.delete(e.target.dataset.familiar);persist();}if(e.target.dataset.tried){e.target.checked?tried.add(e.target.dataset.tried):tried.delete(e.target.dataset.tried);persist();}});
    $('#guide-dialog').addEventListener('cancel',e=>{e.preventDefault();closeGuide();});
    $('#credits-dialog').addEventListener('close',()=>{if(!guideId)document.body.classList.remove('modal-open');});
    for(const id of ['guide-dialog','credits-dialog']) $(`#${id}`).addEventListener('click',e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){id==='guide-dialog'?closeGuide():$('#credits-dialog').close();}}});
    window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#place=')){try{openGuide(decodeURIComponent(location.hash.slice(7)),false);}catch{}}else{if(guideId)closeGuide(false);if(location.hash==='#running')navigate('run');else if(location.hash==='#saved')navigate('saved');}});
  }
  async function init() {
    try {
      const fetchJson=async path=>{const r=await fetch(path,{cache:'no-cache'});if(!r.ok)throw new Error(`HTTP ${r.status}: ${path}`);return r.json();};
      const [areas,experiences,images]=await Promise.all([fetchJson('data/areas.json'),fetchJson('data/experiences.json'),fetchJson('data/photos.json')]);
      const areaMap=new Map(areas.map(a=>[a.id,a]));photos=images;photoMap=new Map(photos.map(p=>[p.id,p]));
      places=experiences.map(e=>({...areaMap.get(e.areaId),activity:'walk',...e,...(e.placeOverrides||{})}));
      const validIds=new Set(places.map(p=>p.id));for(const id of bookmarks)if(!validIds.has(id))bookmarks.delete(id);
      if(location.hash==='#running')Object.assign(state,{activity:'run',mood:'all',mobileTab:'run'});
      else if(location.hash==='#saved')Object.assign(state,{view:'saved',mobileTab:'saved'});
      initEvents();render();
      if(location.hash.startsWith('#place='))openGuide(decodeURIComponent(location.hash.slice(7)),false);
      else if(location.hash==='#running')navigate('run');
      else if(location.hash==='#saved')navigate('saved');
      // Pure helpers made available for local verification without a second recommendation implementation.
      window.SZU={get places(){return places},get state(){return {...state}},dayStatus,match,photoInfo};
    } catch(error) {
      console.error(error);$('#recommend-grid').innerHTML='<p role="alert">去处资料暂时没有加载成功，请刷新页面再试。</p>';
    }
  }
  init();
})();
