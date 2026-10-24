(function(){
  'use strict';
  const C=window.SZUSkyCore,host=document.getElementById('sky-card');
  if(!C||!host)return;
  const $=id=>document.getElementById(id),key='szu-sky:v1',cache=new Map(),pending=new Set();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let stored={};try{stored=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
  const state={location:C.LOCATIONS.find(p=>p.id===stored.location)||C.LOCATIONS[0],day:0,mode:'sunset',data:null,loading:false,error:'',stale:false};
  let request=0,detailsOpen=false;
  const time=n=>C.numeric(n)?C.clock(n*1000):'—';
  const range=a=>Array.isArray(a)&&a.length===2&&a.every(C.numeric)?`${time(a[0])}–${time(a[1])}`:'—';
  const number=(n,suffix='',digits=0)=>C.numeric(n)?`${n.toFixed(digits)}${suffix}`:'—';
  const asRange=(n,a,b)=>C.numeric(n)&&n>=a&&n<=b?n:null;
  function save(){try{localStorage.setItem(key,JSON.stringify({location:state.location.id,cache:Object.fromEntries(cache)}));}catch{}}
  function cached(location){
    let data=cache.get(location.id)||stored.cache?.[location.id];
    if(['fresh','stale'].includes(C.cacheStatus(data,location))){cache.set(location.id,data);return data;}
    return null;
  }
  function tabs(){
    $('sky-days').innerHTML=C.dateList().map((date,i)=>{
      const day=state.data?.days.find(d=>d.date===date),s=day?.[state.mode]?.score;
      return `<button type="button" role="tab" id="sky-day-${i}" data-sky-day="${i}" aria-controls="sky-content" aria-selected="${i===state.day}" tabindex="${i===state.day?'0':'-1'}"><strong>${['今天','明天','后天'][i]}</strong><span>${date.slice(5).replace('-','/')}</span><small>${C.numeric(s?.value)?s.value+'分':'待更新'}</small></button>`;
    }).join('');
    for(const button of host.querySelectorAll('[data-sky-mode]'))button.setAttribute('aria-pressed',String(button.dataset.skyMode===state.mode));
    $('sky-content').setAttribute('aria-labelledby','sky-day-'+state.day);
  }
  function render(){
    if(state.data&&!['fresh','stale'].includes(C.cacheStatus(state.data,state.location))){state.data=null;state.error='预报已过期，刷新后再看。';}
    $('sky-place').value=state.location.id;tabs();
    $('sky-refresh').disabled=state.loading;
    $('sky-refresh').setAttribute('aria-label',state.loading?'正在获取天气':'刷新天气数据');
    $('sky-refresh').classList.toggle('is-loading',state.loading);
    $('sky-content').setAttribute('aria-busy',String(state.loading));
    $('sky-kind').textContent=state.mode==='sunset'?'晚霞参考':'朝霞参考';
    const date=C.dateList()[state.day],day=state.data?.days.find(d=>d.date===date),event=day?.[state.mode];
    const peek=$('sky-peek-text'),peekTitle=$('sky-peek-title');
    if(peekTitle)peekTitle.textContent=state.location.name+'的天空';
    if(!event){
      if(peek)peek.textContent=state.loading?'三天朝晚霞 · 正在更新':'天气暂未更新 · 点击重试';
      $('sky-content').innerHTML=state.loading?'<div class="sky-empty" role="status"><span class="sky-loading-line"></span><p>正在看看这三天的云…</p></div>':`<div class="sky-empty" role="status"><strong>暂时没取到天气</strong><p>${esc(state.error||'稍后再试，散步路线照常可用。')}</p><button type="button" class="sky-retry" data-sky-retry>重新获取</button></div>`;
      $('sky-update').textContent=state.loading?'连接免费天气数据…':'天气未更新';$('sky-routes').hidden=true;return;
    }
    const s=event.score,input=event.input,isEvening=state.mode==='sunset',ended=event.glow[1]*1000<Date.now();
    const updateTime=C.clock(state.data.fetchedAt),isStale=state.stale||C.cacheStatus(state.data,state.location)==='stale';
    if(peek)peek.textContent=`${['今天','明天','后天'][state.day]}${isEvening?'晚霞':'朝霞'} ${C.numeric(s.value)?s.value+'分':'资料不足'} · ${ended?'时段已过':(isEvening?'日落 ':'日出 ')+time(event.time)}${state.loading?' · 更新中':isStale?' · 较早数据':''}${s.missing.length?' · 资料不全':''}`;
    $('sky-update').textContent=`获取于 ${updateTime}${state.loading?' · 正在刷新':isStale?' · 较早数据':''}${state.error?' · 刷新未成功':''}`;
    const grade=s.value===null?'muted':s.value>=65?'promising':s.value>=40?'hopeful':'soft';
    const status=ended?'<span class="sky-status">本次时段已过</span>':state.day===2?'<span class="sky-status">提前两天，变数较大</span>':isStale?'<span class="sky-status">旧预报参考</span>':'';
    const hint=ended?'看看明天，或把今天留给普通散步。':s.risk?'先确认预警和降雨变化，再决定是否出发。':`${isEvening?'建议':'参考到达'} ${time(event.arrive)} 前到附近${isEvening?'，慢慢等天色。':'，先确认开园与首班车。'}`;
    const val=C.numeric(s.value)?s.value:'—';
    const detailData=`<div class="sky-clouds"><div><span>高云</span><strong>${number(asRange(input.high,0,100),'%')}</strong></div><div><span>中云</span><strong>${number(asRange(input.mid,0,100),'%')}</strong></div><div><span>低云</span><strong>${number(asRange(input.low,0,100),'%')}</strong></div></div><div class="sky-data-row"><div><span>气溶胶 AOD</span><strong>${number(asRange(input.aod,0,10),'',2)}</strong></div><div><span>能见度</span><strong>${number(asRange(input.visibility,0,200000)===null?null:input.visibility/1000,' km',1)}</strong></div><div><span>降雨概率</span><strong>${number(asRange(input.rainProbability,0,100),'%')}</strong></div></div><p class="sky-data-caption">取${isEvening?'日落':'日出'}附近预报；AOD为550 nm整层气溶胶光学厚度，不是空气质量指数。</p><div class="sky-window"><span>霞光参考时段</span><strong>${range(event.glow)}</strong></div><p class="sky-limits">${esc(s.missing.length?'缺少 '+s.missing.join('、')+'，评分参考受限。':'云量与能见度来自GFS网格，AOD来自约45 km的CAMS全球网格。')} 无法分辨每一片云、楼宇或山体遮挡。</p>`;
    $('sky-content').innerHTML=`<div class="sky-result grade-${grade}"><div class="sky-score"><div><strong>${val}</strong><span>/ 100</span></div><p>${esc(s.label)}</p></div><div class="sky-readout">${status}<p>${esc(s.reason)}</p><small>${esc(hint)}</small></div></div><div class="sky-meter" role="meter" aria-label="${isEvening?'晚霞':'朝霞'}观赏参考指数" aria-valuemin="0" aria-valuemax="100" ${C.numeric(s.value)?`aria-valuenow="${s.value}"`:'aria-valuetext="数据不足"'}><span style="width:${C.numeric(s.value)?s.value:0}%"></span></div><div class="sky-time-grid"><div><span>金色时段 · 约</span><strong>${range(event.golden)}</strong></div><div class="sky-sun-time"><span>${isEvening?'日落':'日出'} · 约</span><strong>${time(event.time)}</strong></div><div><span>蓝调时段 · 约</span><strong>${range(event.blue)}</strong></div></div>${s.risk?'<a class="sky-weather-warning" href="https://weather.sz.gov.cn/" target="_blank" rel="noopener noreferrer">有降雨或雷雨信号，先看深圳气象预警 ↗</a>':''}<details class="sky-details" id="sky-details" ${detailsOpen?'open':''}><summary>云层与空气${s.missing.length?' · 资料不全':''}<svg class="icon" aria-hidden="true"><use href="#i-chevron"/></svg></summary>${detailData}</details><p class="sky-index-note">经验指数，非火烧云概率；临近${isEvening?'日落':'日出'}再看一次更有用。</p>`;
    const details=$('sky-details');details.addEventListener('toggle',()=>{detailsOpen=details.open;});
    $('sky-routes').hidden=false;$('sky-routes').textContent=isEvening?'挑一个晚霞去处':'看看海边去处';
    $('sky-routes').setAttribute('aria-label',`${state.location.name}，${date}，${isEvening?'查看晚霞去处':'查看海边去处，朝霞出行需确认朝向、开园与首班车'}`);
    $('sky-routes').dataset.skyRouteDate=date;$('sky-routes').dataset.skyRouteCategory=isEvening?'sunset':'sea';
    $('sky-routes').dataset.skyRouteEnded=String(ended);
  }
  async function fetchJson(url,timeout){
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout);pending.add(abort);
    try{const r=await fetch(url,{signal:abort.signal,credentials:'omit',cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);pending.delete(abort);}
  }
  async function load(force=false,rollover=0){
    const location=state.location,ticket=++request,startedAt=Date.now(),old=cached(location);
    for(const controller of pending)controller.abort();pending.clear();
    state.data=old;state.stale=!!old&&C.cacheStatus(old,location)==='stale';state.error='';
    if(old&&!force&&!state.stale){state.loading=false;render();return;}
    state.loading=true;render();
    const links=C.urls(location,startedAt);
    const [weather,air]=await Promise.allSettled([fetchJson(links.weather,10000),fetchJson(links.air,7000)]);
    if(ticket!==request)return;
    // A request spanning Beijing midnight covers yesterday's three days. Fetch the new set once.
    if(C.dateKey(startedAt)!==C.dateKey()&&rollover<1)return load(true,rollover+1);
    state.loading=false;
    if(weather.status==='fulfilled'){
      try{const data=C.build(weather.value,air.status==='fulfilled'?air.value:null,location);cache.set(location.id,data);state.data=data;state.stale=false;state.error='';save();}catch{state.error='天气数据不完整，稍后再试。';}
    }else state.error='天气服务暂时连不上，稍后再试。';
    // Never keep a six-hour-old or previous-day forecast looking current after a failed refresh.
    if(state.data&&!['fresh','stale'].includes(C.cacheStatus(state.data,location)))state.data=null;
    render();
  }
  function refresh(){if(state.loading)return;if(state.data&&Date.now()-state.data.fetchedAt<60000){$('sky-update').textContent='刚刚获取过，稍后再刷新即可';return;}return load(true);}
  $('sky-place').innerHTML=C.LOCATIONS.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('sky-place').addEventListener('change',e=>{const p=C.LOCATIONS.find(p=>p.id===e.target.value);if(!p)return;state.location=p;state.day=0;save();load();});
  $('sky-refresh').addEventListener('click',refresh);
  host.addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-sky-day')){state.day=Number(button.dataset.skyDay);render();$('sky-day-'+state.day).focus({preventScroll:true});}
    else if(button.dataset.skyMode){state.mode=button.dataset.skyMode;render();}
    else if(button.hasAttribute('data-sky-retry'))refresh();
  });
  $('sky-days').addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
    state.day=e.key==='Home'?0:e.key==='End'?2:(state.day+(e.key==='ArrowRight'?1:2))%3;render();$('sky-day-'+state.day).focus();
  });
  $('sky-routes').addEventListener('click',e=>{
    render();
    if(e.currentTarget.hidden)return;
    document.dispatchEvent(new CustomEvent('szu:sky-routes',{detail:{date:e.currentTarget.dataset.skyRouteDate,category:e.currentTarget.dataset.skyRouteCategory,locationId:state.location.id,locationName:state.location.name,mode:state.mode,ended:e.currentTarget.dataset.skyRouteEnded==='true'}}));
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){const status=C.cacheStatus(state.data,state.location);if(status!=='fresh'&&!state.loading)load();else render();}});
  setInterval(()=>{if(document.visibilityState==='visible'&&!state.loading){if(C.cacheStatus(state.data,state.location)!=='fresh')load();else render();}},10*60*1000);
  // Read-only contract for local integration tests; weather preferences are separate from bookmarks.
  window.SZUSky={get state(){return {location:state.location.id,day:state.day,mode:state.mode,loading:state.loading,date:C.dateList()[state.day]}},refresh};
  load();
})();
