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
  const defaults = {band:'all',mood:'all',budget:'any',commute:'any',allowReserve:true,directOnly:false};
  const storageKey = 'szu-slow-days:v1';
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* private storage may be unavailable */ }
  const state = { ...defaults, ...stored.filters, date:today, search:'', view:'all', sort:'fit', page:12, batch:0 };
  const bookmarks = new Set(Array.isArray(stored.saved) ? stored.saved : []);
  const familiar = new Set(Array.isArray(stored.familiar) ? stored.familiar : []);
  const tried = new Set(Array.isArray(stored.tried) ? stored.tried : []);
  let places = [], photos = [], photoMap = new Map(), guideId = null, returnFocus = null, toastTimer;

  function persist() {
    const filters = Object.fromEntries(Object.keys(defaults).map(k => [k,state[k]]));
    try { localStorage.setItem(storageKey, JSON.stringify({filters,saved:[...bookmarks],familiar:[...familiar],tried:[...tried]})); } catch { toast('当前浏览器未允许保存；本次仍可使用'); }
  }
  function toast(text) { const el = $('#toast'); el.textContent = text; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'),2700); }
  function mins(value) { return value % 60 === 0 && value >= 60 ? `${value/60}小时` : `${value}分钟`; }
  function duration(range) { return range[0] === range[1] ? mins(range[0]) : range[1] <= 120 || range.some(n=>n%30) ? `${range[0]}–${range[1]}分钟` : `${range[0]/60}–${range[1]/60}小时`; }
  function fare(range) { return range[0] === range[1] ? `¥${range[0]}` : `¥${range[0]}–${range[1]}`; }
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
    if (p.availability === 'verify') return {code:'verify',label:'先核实参与条件',actionable:false};
    if (p.access.kind === 'event' && !start) return {code:'calendar',label:'查看本期排期',actionable:false};
    if (p.access.kind === 'member') return {code:'member',label:'须邀请／特定条件',actionable:false};
    if (p.access.kind === 'event') return {code:'event',label:'当日活动 · 先查名额',actionable:true};
    if (p.access.kind === 'reserve') return {code:'reserve',label:'需预约／登记',actionable:true};
    return {code:'open',label:'常规可去',actionable:true};
  }
  function match(p) {
    if (state.band !== 'all' && p.band !== state.band) return false;
    if (state.mood !== 'all' && !(state.mood === 'campus' ? p.type === 'campus' : p.moods.includes(state.mood))) return false;
    if (state.budget !== 'any' && (p.costPending || p.cost[1] > +state.budget)) return false;
    if (state.commute !== 'any' && p.travel[1] > +state.commute) return false;
    if (!state.allowReserve && p.access.kind !== 'open') return false;
    if (state.directOnly && !dayStatus(p).actionable) return false;
    if (state.search && ![p.name,p.district,p.lead,p.description,...p.spots.map(x => x.name)].join(' ').toLowerCase().includes(state.search.toLowerCase())) return false;
    return true;
  }
  function score(p) { return (p.type === 'nature' ? 120 : p.type === 'campus' ? 90 : 60) - p.travel[1] * .32 - p.cost[1] * .05 + (p.moods.includes('green') ? 8 : 0) + ({'lixiang-shade':8,'talent-liuhua':18,'xili-lake-section':9}[p.id]||0); }
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
    if (exact.length) return {photo:exact[0],reference:false,caption:exact[0].caption};
    const districtIds = {南山:'bay-theatre',福田:'concert-hall',罗湖:'concert-hall',宝安:'bay-panorama',光明:'bay-panorama',龙华:'guanlan',龙岗:'cuhk-shenzhen',坪山:'msu-bit',盐田:'bay-park'};
    const fallback = photoMap.get(districtIds[p.district]) || photos[0];
    return {photo:fallback,reference:true,caption:`城市实景参考 · ${fallback?.caption || '深圳'}（非该点位）`};
  }
  function reason(p) {
    const status = dayStatus(p);
    if (!status.actionable || status.code !== 'open') return `<span class="status-tag">${esc(status.label)}</span>`;
    if (p.travel[1] > 90) return '<span class="travel-warning">远一点 · 留足往返时间</span>';
    if (tried.has(p.id)) return '体验过，也可以再去';
    if (familiar.has(p.areaId)) return '熟悉的地方 · 换个停留点';
    return state.mood !== 'all' ? esc(moods[state.mood] || '合这次的心情') : p.type === 'nature' ? '给自己一段自然里的时间' : p.type === 'campus' ? '去别人的日常里走走' : '换一种方式享受生活';
  }
  function card(p,index,recommend=false) {
    const {photo,reference,caption} = photoInfo(p), saved = bookmarks.has(p.id);
    return `<article class="place-card" data-place="${esc(p.id)}">
      <button class="bookmark" type="button" data-save="${esc(p.id)}" aria-label="${saved?'取消想去：':'收藏想去：'}${esc(p.name)}" aria-pressed="${saved}">${saved?'♥':'♡'}</button>
      <a class="card-image-link" href="#place=${encodeURIComponent(p.id)}" data-guide="${esc(p.id)}" tabindex="-1" aria-hidden="true"><img src="${esc(photo?.file || '')}" alt="${esc(caption)}" loading="${recommend && index === 0?'eager':'lazy'}" decoding="async"><span class="image-caption ${reference?'reference':''}">${esc(caption)}</span></a>
      <div class="card-body"><div class="card-kicker"><span>${esc(p.district)}</span><span class="dot"></span><span>${esc(types[p.type])}</span><span class="band-tag">${bands[p.band]}</span></div>
      <h3><a class="card-title-link" href="#place=${encodeURIComponent(p.id)}" data-guide="${esc(p.id)}">${esc(p.name)}</a></h3><p class="card-lead">${esc(p.lead)}</p>
      <div class="card-stats"><div><span>单程交通 · 估算</span><strong>${duration(p.travel)}</strong></div><div><span>建议停留</span><strong>${duration(p.stay)}</strong></div><div><span>人均花费</span><strong>${p.costPending?'费用待核':fare(p.cost)}</strong></div></div>
      <div class="card-bottom"><span class="match-reason">${reason(p)}</span><a class="guide-link" href="#place=${encodeURIComponent(p.id)}" data-guide="${esc(p.id)}">看看指南 ↗</a></div></div></article>`;
  }
  function syncControls() {
    $$('[data-band]').forEach(el => { el.classList.toggle('active',el.dataset.band === state.band); el.setAttribute('aria-pressed',String(el.dataset.band === state.band)); });
    $$('[data-mood]').forEach(el => { el.classList.toggle('active',el.dataset.mood === state.mood); el.setAttribute('aria-pressed',String(el.dataset.mood === state.mood)); });
    for (const id of ['budget','commute','sort']) $(`#${id}`).value = state[id];
    $('#allow-reserve').checked = state.allowReserve; $('#direct-only').checked = state.directOnly; $('#trip-date').value = state.date; $('#search').value = state.search;
    $$('[data-view]').forEach(el => {el.classList.toggle('active',el.dataset.view === state.view);el.setAttribute('aria-pressed',String(el.dataset.view === state.view));});
    $('#saved-count').textContent = bookmarks.size; $('#tab-saved-count').textContent = bookmarks.size; $('#total-count').textContent = places.length;
  }
  function recommendations(items) {
    let pool = sorted(items.filter(p => dayStatus(p).actionable && dayStatus(p).code !== 'expired'));
    if (!pool.length) { $('#shuffle').disabled = true; return []; }
    const n = Math.min(3,pool.length), start = state.batch * 3;
    if (state.mood === 'all') {
      const first = pool.filter(p => p.type === 'nature').slice(0,2);
      const lifestyle = pool.find(p => p.type !== 'nature');
      if (lifestyle) first.push(lifestyle);
      pool = [...first,...pool.filter(p => !first.includes(p))];
    }
    const out = Array.from({length:n},(_,i) => pool[(start+i)%pool.length]);
    $('#shuffle').disabled = pool.length <= n;
    return out;
  }
  function render() {
    syncControls();
    const matches = places.filter(match);
    const recs = recommendations(matches);
    $('#recommend-grid').innerHTML = recs.length ? recs.map((p,i) => card(p,i,true)).join('') : '<div class="empty-state" style="grid-column:1/-1"><h3>这一天，暂时没有合适的可参与推荐</h3><p>调整交通、主题或日期，也可以在下方收藏待排期的灵感。</p><button class="primary-button" type="button" data-show-all>放宽条件看看</button></div>';
    $('#recommend-summary').textContent = recs.length ? `${state.band==='all'?'不赶路的日常':bands[state.band]} · ${state.mood==='all'?'自然优先，也留一点生活的惊喜':moods[state.mood]}${state.commute==='any'?'':` · 单程不超过${state.commute}分钟`}` : '预约不代表有余票，出发前记得查看当天信息。';
    const catalog = sorted(matches.filter(p => state.view !== 'saved' || bookmarks.has(p.id)));
    $('#catalog-grid').innerHTML = catalog.slice(0,state.page).map((p,i) => card(p,i)).join('');
    $('#result-count').textContent = `${catalog.length} 处`; $('#empty-state').hidden = catalog.length > 0; $('#load-more').hidden = catalog.length <= state.page;
    if (!catalog.length) {
      $('#empty-state h3').textContent = state.view === 'saved' && !bookmarks.size ? '先留下一点想去的心情' : '给条件留一点余地';
      $('#empty-state p').textContent = state.view === 'saved' && !bookmarks.size ? '点卡片上的爱心，把喜欢的去处留给下一次空闲。' : '试试更长的交通时间，或换一种想看的风景。';
    }
    const conditions = [state.band!=='all'&&bands[state.band],state.mood!=='all'&&moods[state.mood],state.budget!=='any'&&`人均上限 ¥${state.budget}`,state.commute!=='any'&&`单程上限 ${state.commute} 分钟`,!state.allowReserve&&'无需预约',state.directOnly&&'明确可去',state.search&&`搜索“${state.search}”`].filter(Boolean);
    $('#active-conditions').innerHTML = conditions.length ? `${esc(conditions.join(' / '))} <button class="text-button" data-show-all type="button" style="margin-left:10px">查看完整 ${places.length} 项</button>` : `完整 ${places.length} 项 · 常见与新去处都在这里，按本次条件排序`;
    persist();
  }
  function changed() {state.batch=0;state.page=12;render();}
  function showAll() {Object.assign(state,defaults,{commute:'any',search:'',view:'all',page:12,batch:0});render();}
  function save(id) {
    const p=places.find(p=>p.id===id); if(!p)return;
    if(bookmarks.has(id)){bookmarks.delete(id);toast('已从想去清单移除');}else{bookmarks.add(id);toast('已收藏，留给下一次空闲');}
    persist();
    $$(`[data-save="${id}"]`).forEach(el=>{const yes=bookmarks.has(id);el.textContent=el.classList.contains('bookmark')?(yes?'♥':'♡'):(yes?'♥ 已加入想去':'♡ 加入想去');el.setAttribute('aria-pressed',String(yes));el.setAttribute('aria-label',`${yes?'取消想去：':'收藏想去：'}${p.name}`);});$('#saved-count').textContent=bookmarks.size;$('#tab-saved-count').textContent=bookmarks.size;
    if(state.view==='saved') render();
  }
  function guide(p) {
    const {photo,caption,reference}=photoInfo(p), status=dayStatus(p), pics=selectedPhotos(p).slice(1,3);
    const map=`https://uri.amap.com/search?keyword=${encodeURIComponent(p.entrance)}&city=${encodeURIComponent('深圳')}&view=map`;
    const special=status.actionable ? p.access.text : `${status.label}。${p.access.text}`;
    return `<div class="guide-hero"><img src="${esc(photo?.file)}" alt="${esc(caption)}"><span class="guide-hero-caption">${esc(caption)}${reference?' · 目的地精确照片待补':''}</span><button class="dialog-close" type="button" data-close="guide" aria-label="关闭指南">×</button></div>
      <div class="guide-main"><p class="guide-kicker">${esc(p.district)} · ${esc(types[p.type])} <span>／</span> ${bands[p.band]}</p><h2>${esc(p.name)}</h2><p class="guide-lead">${esc(p.lead)}</p>
      <div class="guide-actions"><a href="${safeUrl(map)}" target="_blank" rel="noopener noreferrer" data-map>导航到入口 ↗</a><button data-save="${esc(p.id)}" type="button" aria-pressed="${bookmarks.has(p.id)}" aria-label="${bookmarks.has(p.id)?'取消想去：':'收藏想去：'}${esc(p.name)}">${bookmarks.has(p.id)?'♥':'♡'} 加入想去</button><button type="button" data-share="${esc(p.id)}">复制这份指南</button></div>
      <div class="guide-summary"><div><small>单程交通 · 估算</small><strong>${duration(p.travel)}</strong><p>${p.travel[1]>90?'通勤较长，请预留往返余量':'从粤海校区校门到入口，含末段步行'}</p></div><div><small>现场建议停留</small><strong>${duration(p.stay)}</strong><p>不含往返交通，随心缩短或延长</p></div><div><small>人均花费 · 估算</small><strong>${p.costPending?'费用待核':fare(p.cost)}</strong><p>${esc(p.costNote)}</p></div></div>
      <p class="guide-description">${esc(p.description)}</p><section class="guide-section"><h3>两三个地方，就值得慢慢待着</h3><div class="spots">${p.spots.map((s,i)=>`<div class="spot"><span>0${i+1}</span><h4>${esc(s.name)}</h4><p>${esc(s.text)}</p></div>`).join('')}</div></section>
      <section class="guide-section"><h3>这里待着舒服吗</h3><div class="comfort-grid">${Object.entries({shade:'遮阴',seats:'可坐',crowd:'人流',terrain:'地面与坡度'}).map(([k,label])=>`<p><strong>${label}</strong><span>${esc(p.comfort[k])}</span></p>`).join('')}</div></section>
      <section class="guide-section"><h3>怎么到这里</h3><p class="guide-transport"><strong>导航入口：${esc(p.entrance)}</strong><br>${esc(p.transport)}</p></section>
      <section class="guide-section"><h3>出发前看一眼</h3><div class="access-note"><p><strong>${esc(status.label)}</strong> · ${esc(special)}</p>${p.schedule.start?`<p>场次：${esc(dateTime(p.schedule.start))}${p.schedule.end?' — '+esc(dateTime(p.schedule.end)):''}</p>`:''}${p.schedule.deadline?`<p>报名截止：${esc(dateTime(p.schedule.deadline))}</p>`:''}<p>${esc(p.schedule.note)}</p>${p.access.url?`<a href="${safeUrl(p.access.url)}" target="_blank" rel="noopener noreferrer">查看官方信息／报名入口 ↗</a>`:''}</div></section>
      <section class="guide-section"><h3>这些情况，可能会扫兴</h3><ul>${p.tips.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></section>
      ${p.nearby.length?`<section class="guide-section"><h3>还想多逛一会儿，再顺路选</h3><div class="nearby-list">${p.nearby.map(n=>`<div class="nearby-item"><strong>${esc(n.name)}</strong>${esc(n.text)}</div>`).join('')}</div></section>`:''}
      ${pics.length?`<div class="guide-photo-strip">${pics.map(ph=>`<figure><img src="${esc(ph.file)}" alt="${esc(ph.caption)}" loading="lazy"><figcaption>${esc(ph.caption)} · ${esc(ph.author)}</figcaption></figure>`).join('')}</div>`:''}
      <div class="experience-history"><label><input type="checkbox" data-familiar="${esc(p.areaId)}" ${familiar.has(p.areaId)?'checked':''}>我熟悉这个地方</label><label><input type="checkbox" data-tried="${esc(p.id)}" ${tried.has(p.id)?'checked':''}>我体验过这个玩法</label><p>分开记录：熟悉地点仍可遇见新的停留点和活动，不会因此被隐藏。</p></div>
      <details class="source-details"><summary>资料来源与照片 · 核验 ${esc(p.checked)}</summary>${p.sources.map(s=>`<a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`).join('')}<p>开放和参与条件参考管理方；环境描述结合中文公开记录。${esc(p.sourceEvidence)}交通及花费是编辑估算，不是实时导航或票务报价。</p>${(selectedPhotos(p).length?selectedPhotos(p):[photo]).filter(Boolean).map(ph=>`<p>照片：${esc(ph.caption)} · ${esc(ph.author)} · <a href="${safeUrl(ph.licenseUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline">${esc(ph.license)}</a> · <a href="${safeUrl(ph.sourceUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline">原图</a>。${esc(ph.changes||'展示有缩放与裁切')}</p>`).join('')}</details></div>`;
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
    if(updateHash&&location.hash.startsWith('#place=')) history.replaceState(null,'',location.pathname+location.search+'#explore');
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  }
  function credits() {
    $('#photo-credits').innerHTML=photos.map(ph=>`<div class="credit-row"><img src="${esc(ph.file)}" alt="${esc(ph.caption)}" loading="lazy"><div><strong>${esc(ph.caption)}</strong><p>${esc(ph.author)} · <a href="${safeUrl(ph.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(ph.license)}</a> · <a href="${safeUrl(ph.sourceUrl)}" target="_blank" rel="noopener noreferrer">原图页面 ↗</a></p><p>${esc(ph.changes||'缩放与版式裁切')}</p></div></div>`).join('');
    $('#credits-dialog').showModal();document.body.classList.add('modal-open');
  }
  function initEvents() {
    $('#filters').addEventListener('submit',e=>e.preventDefault());
    $('#filters').addEventListener('reset',e=>{e.preventDefault();Object.assign(state,defaults,{date:today});changed();toast('已恢复默认条件');});
    $('#filters').addEventListener('click',e=>{const b=e.target.closest('[data-band]'),m=e.target.closest('[data-mood]');if(b){state.band=b.dataset.band;changed();}if(m){state.mood=m.dataset.mood;changed();}});
    for(const id of ['budget','commute']) $(`#${id}`).addEventListener('change',e=>{state[id]=e.target.value;changed();});
    for(const [id,key] of [['allow-reserve','allowReserve'],['direct-only','directOnly']]) $(`#${id}`).addEventListener('change',e=>{state[key]=e.target.checked;changed();});
    $('#trip-date').min=today;
    $('#trip-date').addEventListener('change',e=>{if(e.target.value&&e.target.validity.valid){state.date=e.target.value;changed();}});
    $('#more-filters').addEventListener('click',()=>{const open=$('#extra-filters').hidden;$('#extra-filters').hidden=!open;$('#more-filters').setAttribute('aria-expanded',String(open));$('#more-filters span').textContent=open?'−':'＋';});
    $('#shuffle').addEventListener('click',()=>{state.batch++;render();toast('换了一批，筛选条件已保留');});
    $('#search').addEventListener('input',e=>{state.search=e.target.value.trim();state.page=12;render();$('#search').focus({preventScroll:true});});
    $('#sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
    $$('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;state.page=12;render();}));
    $('#saved-nav').addEventListener('click',()=>{state.view='saved';state.search='';state.page=12;render();$('#explore').scrollIntoView({behavior:'auto'});});
    $('.site-header nav a[href="#explore"]').addEventListener('click',()=>showAll());
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
    window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#place=')){try{openGuide(decodeURIComponent(location.hash.slice(7)),false);}catch{}}else if(guideId)closeGuide(false);});
  }
  async function init() {
    try {
      const fetchJson=async path=>{const r=await fetch(path);if(!r.ok)throw new Error(`HTTP ${r.status}: ${path}`);return r.json();};
      const [areas,experiences,images]=await Promise.all([fetchJson('data/areas.json'),fetchJson('data/experiences.json'),fetchJson('data/photos.json')]);
      const areaMap=new Map(areas.map(a=>[a.id,a]));photos=images;photoMap=new Map(photos.map(p=>[p.id,p]));
      places=experiences.map(e=>({...areaMap.get(e.areaId),...e,...(e.placeOverrides||{})}));
      const validIds=new Set(places.map(p=>p.id));for(const id of bookmarks)if(!validIds.has(id))bookmarks.delete(id);
      initEvents();render();
      if(location.hash.startsWith('#place='))openGuide(decodeURIComponent(location.hash.slice(7)),false);
      // Pure helpers made available for local verification without a second recommendation implementation.
      window.SZU={get places(){return places},get state(){return {...state}},dayStatus,match,photoInfo};
    } catch(error) {
      console.error(error);$('#recommend-grid').innerHTML='<p role="alert">去处资料暂时没有加载成功，请刷新页面再试。</p>';
    }
  }
  init();
})();
