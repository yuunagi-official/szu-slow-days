/* Open-Meteo forecast adapter and an explicitly uncalibrated viewing index. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/suncalc.js'));
  else root.SZUSkyCore=factory(root.SunCalc);
})(globalThis,function(SunCalc){
  'use strict';
  const VERSION=2,TTL=60*60*1000,MAX_AGE=6*60*60*1000;
  const LOCATIONS=[
    {id:'yuehai',name:'粤海 · 深圳湾',latitude:22.533,longitude:113.932},
    {id:'qianhai',name:'前海石公园',latitude:22.522,longitude:113.888},
    {id:'xiwan',name:'西湾红树林',latitude:22.621,longitude:113.831},
    {id:'lixin',name:'立新湖',latitude:22.681,longitude:113.822},
    {id:'shiyan',name:'石岩湖',latitude:22.683,longitude:113.915}
  ];
  const WEATHER_FIELDS=['cloud_cover_low','cloud_cover_mid','cloud_cover_high','visibility','precipitation_probability','precipitation','weather_code'];
  const WEATHER_CODES=new Set([0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]);
  const numeric=n=>typeof n==='number'&&Number.isFinite(n);
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
  const valid=(n,a,b)=>numeric(n)&&n>=a&&n<=b?n:null;
  const dateKey=(now=Date.now())=>{const d=new Date(+now+8*3600000);return numeric(+d)?d.toISOString().slice(0,10):'';};
  const clock=value=>numeric(+new Date(value))?new Date(+new Date(value)+8*3600000).toISOString().slice(11,16):'—';
  const epoch=d=>numeric(+d)?Math.round(+d/1000):null;
  function dateList(now=Date.now()){const day=Date.parse(dateKey(now)+'T12:00:00+08:00');return [0,1,2].map(i=>dateKey(day+i*86400000));}
  function astronomy(date,location){
    const noon=new Date(date+'T12:00:00+08:00');
    const t=SunCalc.getTimes(noon,location.latitude,location.longitude);
    const blue=SunCalc.getTimes(noon,location.latitude,location.longitude);
    // SunCalc's public custom-time API: photography convention, solar altitude -4°.
    // Registered once below; times are geometric estimates, not predicted colours.
    return {
      sunrise:epoch(t.sunrise),sunset:epoch(t.sunset),
      sunriseGolden:[epoch(blue.skyBlueMorning),epoch(t.goldenHourEnd)],
      sunsetGolden:[epoch(t.goldenHour),epoch(blue.skyBlueEvening)],
      sunriseBlue:[epoch(t.dawn),epoch(blue.skyBlueMorning)],
      sunsetBlue:[epoch(blue.skyBlueEvening),epoch(t.dusk)],
      sunriseGlow:[epoch(t.dawn),epoch(t.sunrise)],sunsetGlow:[epoch(t.sunset),epoch(t.dusk)]
    };
  }
  SunCalc.addTime(-4,'skyBlueMorning','skyBlueEvening');
  function destination(location,bearing,distance=60){
    const r=Math.PI/180,lat=location.latitude*r,lon=location.longitude*r,d=distance/6371,b=bearing*r;
    const y=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(b));
    const x=lon+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(y));
    return {latitude:+(y/r).toFixed(4),longitude:+(x/r).toFixed(4)};
  }
  function pointsFor(location,now=Date.now()){
    const t=astronomy(dateKey(now),location);
    const bearing=time=>(SunCalc.getPosition(new Date(time*1000),location.latitude,location.longitude).azimuth*180/Math.PI+180+360)%360;
    return [location,destination(location,bearing(t.sunrise)),destination(location,bearing(t.sunset))];
  }
  function urls(location,now=Date.now()){
    const points=pointsFor(location,now);
    const weather=new URL('https://api.open-meteo.com/v1/forecast');
    weather.search=new URLSearchParams({latitude:points.map(p=>p.latitude).join(','),longitude:points.map(p=>p.longitude).join(','),hourly:WEATHER_FIELDS.join(','),daily:'sunrise,sunset',timezone:'Asia/Shanghai',timeformat:'unixtime',forecast_days:'3',models:'gfs_seamless',cell_selection:'nearest'}).toString();
    const air=new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    air.search=new URLSearchParams({latitude:location.latitude,longitude:location.longitude,hourly:'aerosol_optical_depth',timezone:'Asia/Shanghai',timeformat:'unixtime',forecast_days:'3',domains:'cams_global'}).toString();
    return {weather:weather.href,air:air.href,points};
  }
  function timeEpoch(t){
    if(numeric(t))return t;
    if(typeof t!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t))return null;
    const value=Date.parse(/[Z+]|-\d\d:\d\d$/.test(t.slice(10))?t:t+'+08:00')/1000;
    return numeric(value)?value:null;
  }
  function sample(payload,field,time){
    const h=payload?.hourly,values=h?.[field],times=h?.time;
    if(!Array.isArray(times)||!Array.isArray(values)||values.length!==times.length||!numeric(time))return null;
    const epochs=times.map(timeEpoch);
    if(epochs.some((t,i)=>t===null||(i>0&&t<=epochs[i-1])))return null;
    let before=-1;
    for(let i=0;i<times.length;i++){
      const t=epochs[i];
      if(t===time)return numeric(values[i])?values[i]:null;
      if(t>time){
        if(before<0||!numeric(values[before])||!numeric(values[i]))return null;
        const start=epochs[before];if(t-start>10800)return null;
        // WMO codes are categorical: use the nearest hour, never interpolate a code.
        if(field==='weather_code')return time-start<=t-time?values[before]:values[i];
        return values[before]+(values[i]-values[before])*(time-start)/(t-start);
      }
      before=i;
    }
    return null;
  }
  function windowMax(payload,field,time){
    const values=[time-3600,time,time+3600].map(t=>sample(payload,field,t)).filter(numeric);
    return values.length?Math.max(...values):null;
  }
  function windowCode(payload,time){
    const codes=[time-3600,time,time+3600].map(t=>sample(payload,'weather_code',t));
    // A thunder/heavy-rain hour near the event must survive even if another hour is missing.
    return codes.find(n=>[95,96,99].includes(n))??codes.find(n=>[65,67,82].includes(n))??(codes.every(n=>WEATHER_CODES.has(n))?sample(payload,'weather_code',time):null);
  }
  function score(input){
    const low=valid(input.low,0,100),mid=valid(input.mid,0,100),high=valid(input.high,0,100);
    const pathLow=valid(input.pathLow,0,100),pathMid=valid(input.pathMid,0,100),vis=valid(input.visibility,0,200000),aod=valid(input.aod,0,10),rain=valid(input.rain,0,500),prob=valid(input.rainProbability,0,100);
    const thunder=[95,96,99].includes(input.code),heavyRain=[65,67,82].includes(input.code)||(rain!==null&&rain>=3),risk=thunder||heavyRain;
    const weatherReason=thunder?'预报有雷雨信号，出门先看深圳气象预警。':heavyRain?'这段时间有较强降雨信号，出门先看深圳气象预警。':null;
    const missing=[];
    if([low,mid,high].some(x=>x===null))missing.push('云层');
    if(pathLow===null||pathMid===null)missing.push('太阳方向云量');
    if(vis===null)missing.push('能见度');if(aod===null)missing.push('AOD');if(rain===null||prob===null||input.rainComplete===false||input.probabilityComplete===false)missing.push('降雨');
    if(!WEATHER_CODES.has(input.code)||input.codeComplete===false)missing.push('天气现象');
    if(missing.includes('云层'))return {value:null,label:'云层数据不足',reason:weatherReason||'暂不评分，避免把缺失值当晴天。',missing,risk};
    // Heuristic weights, not a fitted probability, radiative-transfer model or official forecast.
    const canvas=1-(1-high/100)*(1-.65*mid/100);
    const litCloud=clamp(canvas/.55)*(canvas>.9?.85:1);
    const localWindow=(1-low/100)**1.4*(1-.35*mid/100);
    const pathWindow=(pathLow===null||pathMid===null) ? .72 : .3+.7*(1-pathLow/100)**1.2*(1-.45*pathMid/100);
    const clarity=vis===null ? .8 : .6+.4*clamp((vis/1000-2)/18);
    const aerosol=aod===null ? .9 : aod<=.15?1:aod<=.6?1-(aod-.15)/.45*.18:clamp(.82-(aod-.6)*.42,.25,.82);
    const rainfall=(rain===null?1:rain>=3?.25:rain>=1?.5:rain>=.2?.8:1)*(prob===null?1:prob>=70?.7:prob>=40?.85:1);
    let raw=100*(.03+.97*litCloud)*localWindow*pathWindow*clarity*aerosol*rainfall;
    if(risk)raw=Math.min(raw,10);if(missing.length)raw=Math.min(raw,65);
    const value=Math.round(clamp(raw,0,95));
    const label=value>=65?'可以期待':value>=40?'值得留意':value>=20?'顺路看看':'霞色可能较淡';
    const reason=weatherReason||(rain!==null&&rain>=1?'这段时间有降雨信号，不建议只为追霞远行。':low>=65?'低云偏多，可能遮住天色。':pathLow!==null&&pathLow>=65?'太阳方向云偏多，霞光可能被挡住。':canvas<.12?'中高云偏少，可能更适合看淡色夕照。':aod!==null&&aod>.8?'气溶胶偏多，天空通透度有限。':vis!==null&&vis<5000?'能见度偏低，远处霞色可能受影响。':'有一些中高云可映出颜色，仍要看临近日出日落的变化。');
    return {value,label,reason,missing,risk};
  }
  function buildDay(base,pathMorning,pathEvening,air,date,location){
    const times=astronomy(date,location);
    // Daily API time is preferred for the weather sampling time; photography windows stay geometric.
    const daily=base?.daily,i=Array.isArray(daily?.time)?daily.time.findIndex(t=>{const n=timeEpoch(t);return n!==null&&dateKey(n*1000)===date;}):-1;
    for(const mode of ['sunrise','sunset']){const n=i>=0?timeEpoch(daily[mode]?.[i]):null;if(numeric(n)&&dateKey(n*1000)===date&&Math.abs(n-times[mode])<3600)times[mode]=n;}
    times.sunriseGlow[1]=times.sunrise;times.sunsetGlow[0]=times.sunset;
    const event=(mode,path)=>{
      const time=times[mode],input={
        low:sample(base,'cloud_cover_low',time),mid:sample(base,'cloud_cover_mid',time),high:sample(base,'cloud_cover_high',time),
        pathLow:sample(path,'cloud_cover_low',time),pathMid:sample(path,'cloud_cover_mid',time),visibility:sample(base,'visibility',time),aod:sample(air,'aerosol_optical_depth',time),
        rain:windowMax(base,'precipitation',time),rainProbability:windowMax(base,'precipitation_probability',time),code:windowCode(base,time),
        rainComplete:[-3600,0,3600].every(offset=>valid(sample(base,'precipitation',time+offset),0,500)!==null),
        probabilityComplete:[-3600,0,3600].every(offset=>valid(sample(base,'precipitation_probability',time+offset),0,100)!==null),
        codeComplete:[-3600,0,3600].every(offset=>WEATHER_CODES.has(sample(base,'weather_code',time+offset)))
      };
      return {mode,time,golden:times[mode+'Golden'],blue:times[mode+'Blue'],glow:times[mode+'Glow'],arrive:time-35*60,input,score:score(input)};
    };
    return {date,sunrise:event('sunrise',pathMorning),sunset:event('sunset',pathEvening)};
  }
  function build(weather,air,location,now=Date.now()){
    const list=Array.isArray(weather)?weather:[weather];
    if(!list[0]?.hourly?.time?.length)throw new Error('Missing weather series');
    const dates=dateList(now),covered=new Set(list[0].hourly.time.map(timeEpoch).filter(numeric).map(t=>dateKey(t*1000)));
    if(!dates.every(date=>covered.has(date)))throw new Error('Missing current forecast dates');
    const days=dates.map(date=>buildDay(list[0],list[1],list[2],air,date,location));
    // Missing cloud fields can coexist with valid rain/thunder warnings. Keep those warnings,
    // but reject a response with no usable weather data at any of the six events.
    if(!days.some(d=>['sunrise','sunset'].some(mode=>['low','mid','high','visibility','rain','code'].some(field=>numeric(d[mode].input[field])))))throw new Error('Missing weather values');
    return {version:VERSION,locationId:location.id,fetchedAt:+now,days,model:'NOAA GFS',aerosolModel:'CAMS global'};
  }
  function cacheStatus(data,location,now=Date.now()){
    if(!data||data.version!==VERSION||data.locationId!==location.id||!numeric(data.fetchedAt)||data.fetchedAt>+now+60000||!Array.isArray(data.days)||data.days.length!==3)return 'invalid';
    if(!data.days.every(d=>d&&/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&['sunrise','sunset'].every(mode=>{
      const event=d[mode],s=event?.score;
      const ordered=a=>Array.isArray(a)&&a.length===2&&a.every(numeric)&&a[0]<a[1]&&a.every(n=>dateKey(n*1000)===d.date);
      if(!s||!event.input||typeof event.input!=='object'||Array.isArray(event.input))return false;
      if(!['low','mid','high','pathLow','pathMid','visibility','aod','rain','rainProbability','code'].every(k=>event.input[k]===null||numeric(event.input[k]))||!['rainComplete','probabilityComplete','codeComplete'].every(k=>typeof event.input[k]==='boolean'))return false;
      const calculated=score(event.input);
      return event.mode===mode&&s.value===calculated.value&&s.label===calculated.label&&s.reason===calculated.reason&&s.risk===calculated.risk&&Array.isArray(s.missing)&&s.missing.length===calculated.missing.length&&s.missing.every((x,i)=>x===calculated.missing[i])&&['glow','golden','blue'].every(k=>ordered(event[k]))&&numeric(event.time)&&dateKey(event.time*1000)===d.date&&event.arrive===event.time-35*60;
    })))return 'invalid';
    if(!dateList(now).every(date=>data.days.some(d=>d.date===date)))return 'invalid';
    const age=+now-data.fetchedAt;if(age>MAX_AGE)return 'expired';return age<=TTL?'fresh':'stale';
  }
  return {VERSION,TTL,MAX_AGE,LOCATIONS,dateKey,dateList,clock,astronomy,destination,pointsFor,urls,sample,windowMax,windowCode,score,build,cacheStatus,numeric};
});
