/* Open-Meteo forecast adapter and an explicitly uncalibrated viewing index. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/suncalc.js'));
  else root.SZUSkyCore=factory(root.SunCalc);
})(globalThis,function(SunCalc){
  'use strict';
  const VERSION=1,TTL=60*60*1000,MAX_AGE=6*60*60*1000;
  const LOCATIONS=[
    {id:'yuehai',name:'粤海 · 深圳湾',latitude:22.533,longitude:113.932},
    {id:'qianhai',name:'前海石公园',latitude:22.522,longitude:113.888},
    {id:'xiwan',name:'西湾红树林',latitude:22.621,longitude:113.831},
    {id:'lixin',name:'立新湖',latitude:22.681,longitude:113.822},
    {id:'shiyan',name:'石岩湖',latitude:22.683,longitude:113.915}
  ];
  const WEATHER_FIELDS=['cloud_cover_low','cloud_cover_mid','cloud_cover_high','visibility','precipitation_probability','precipitation','weather_code'];
  const numeric=n=>typeof n==='number'&&Number.isFinite(n);
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
  const valid=(n,a,b)=>numeric(n)&&n>=a&&n<=b?n:null;
  const dateKey=(now=Date.now())=>new Date(+now+8*3600000).toISOString().slice(0,10);
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
    let before=-1;
    for(let i=0;i<times.length;i++){
      const t=timeEpoch(times[i]);if(t===null)return null;
      if(t===time)return numeric(values[i])?values[i]:null;
      if(t>time){
        if(before<0||!numeric(values[before])||!numeric(values[i]))return null;
        const start=timeEpoch(times[before]);if(t-start>10800)return null;
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
  function score(input){
    const low=valid(input.low,0,100),mid=valid(input.mid,0,100),high=valid(input.high,0,100);
    if([low,mid,high].some(x=>x===null))return {value:null,label:'云层数据不足',reason:'暂不评分，避免把缺失值当晴天。',missing:['云层'],risk:false};
    const pathLow=valid(input.pathLow,0,100),pathMid=valid(input.pathMid,0,100),vis=valid(input.visibility,0,200000),aod=valid(input.aod,0,10),rain=valid(input.rain,0,500),prob=valid(input.rainProbability,0,100);
    const missing=[];
    if(pathLow===null||pathMid===null)missing.push('太阳方向云量');
    if(vis===null)missing.push('能见度');if(aod===null)missing.push('AOD');if(rain===null||prob===null)missing.push('降雨');
    // Heuristic weights, not a fitted probability, radiative-transfer model or official forecast.
    const canvas=1-(1-high/100)*(1-.65*mid/100);
    const litCloud=clamp(canvas/.55)*(canvas>.9?.85:1);
    const localWindow=(1-low/100)**1.4*(1-.35*mid/100);
    const pathWindow=(pathLow===null||pathMid===null) ? .72 : .3+.7*(1-pathLow/100)**1.2*(1-.45*pathMid/100);
    const clarity=vis===null ? .8 : .6+.4*clamp((vis/1000-2)/18);
    const aerosol=aod===null ? .9 : aod<=.15?1:aod<=.6?1-(aod-.15)/.45*.18:clamp(.82-(aod-.6)*.42,.25,.82);
    const rainfall=(rain===null?1:rain>=3?.25:rain>=1?.5:rain>=.2?.8:1)*(prob===null?1:prob>=70?.7:prob>=40?.85:1);
    let raw=100*(.03+.97*litCloud)*localWindow*pathWindow*clarity*aerosol*rainfall;
    const thunder=[95,96,99].includes(input.code),risk=thunder||(rain!==null&&rain>=3);
    if(risk)raw=Math.min(raw,10);if(missing.length)raw=Math.min(raw,65);
    const value=Math.round(clamp(raw,0,95));
    const label=value>=65?'可以期待':value>=40?'值得留意':value>=20?'顺路看看':'霞色可能较淡';
    const reason=thunder?'预报有雷雨信号，出门先看深圳气象预警。':rain!==null&&rain>=1?'这段时间有降雨信号，不建议只为追霞远行。':low>=65?'低云偏多，可能遮住天色。':pathLow!==null&&pathLow>=65?'太阳方向云偏多，霞光可能被挡住。':canvas<.12?'中高云偏少，可能更适合看淡色夕照。':aod!==null&&aod>.8?'气溶胶偏多，天空通透度有限。':vis!==null&&vis<5000?'能见度偏低，远处霞色可能受影响。':'有一些中高云可映出颜色，仍要看临近日落的变化。';
    return {value,label,reason,missing,risk};
  }
  function buildDay(base,pathMorning,pathEvening,air,date,location){
    const times=astronomy(date,location);
    // Daily API time is preferred for the weather sampling time; photography windows stay geometric.
    const daily=base?.daily,i=daily?.time?.findIndex(t=>dateKey(timeEpoch(t)*1000)===date);
    for(const mode of ['sunrise','sunset']){const n=i>=0?timeEpoch(daily[mode]?.[i]):null;if(numeric(n))times[mode]=n;}
    times.sunriseGlow[1]=times.sunrise;times.sunsetGlow[0]=times.sunset;
    const event=(mode,path)=>{
      const time=times[mode],input={
        low:sample(base,'cloud_cover_low',time),mid:sample(base,'cloud_cover_mid',time),high:sample(base,'cloud_cover_high',time),
        pathLow:sample(path,'cloud_cover_low',time),pathMid:sample(path,'cloud_cover_mid',time),visibility:sample(base,'visibility',time),aod:sample(air,'aerosol_optical_depth',time),
        rain:windowMax(base,'precipitation',time),rainProbability:windowMax(base,'precipitation_probability',time),code:sample(base,'weather_code',time)
      };
      return {mode,time,golden:times[mode+'Golden'],blue:times[mode+'Blue'],glow:times[mode+'Glow'],arrive:time-35*60,input,score:score(input)};
    };
    return {date,sunrise:event('sunrise',pathMorning),sunset:event('sunset',pathEvening)};
  }
  function build(weather,air,location,now=Date.now()){
    const list=Array.isArray(weather)?weather:[weather];
    if(!list[0]?.hourly?.time?.length)throw new Error('Missing weather series');
    const days=dateList(now).map(date=>buildDay(list[0],list[1],list[2],air,date,location));
    if(days.every(d=>d.sunrise.score.value===null&&d.sunset.score.value===null))throw new Error('Missing current forecast dates');
    return {version:VERSION,locationId:location.id,fetchedAt:+now,days,model:'NOAA GFS',aerosolModel:'CAMS global'};
  }
  function cacheStatus(data,location,now=Date.now()){
    if(!data||data.version!==VERSION||data.locationId!==location.id||!numeric(data.fetchedAt)||data.fetchedAt>+now+60000||!Array.isArray(data.days))return 'invalid';
    if(!data.days.every(d=>d&&/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&['sunrise','sunset'].every(mode=>{
      const event=d[mode],s=event?.score;
      return s&&event.input&&Array.isArray(s.missing)&&s.missing.every(x=>typeof x==='string')&&(s.value===null||valid(s.value,0,100)!==null)&&Array.isArray(event.glow)&&event.glow.length===2&&event.glow.every(numeric)&&numeric(event.time);
    })))return 'invalid';
    if(!dateList(now).every(date=>data.days.some(d=>d.date===date)))return 'invalid';
    const age=+now-data.fetchedAt;if(age>MAX_AGE)return 'expired';return age<=TTL?'fresh':'stale';
  }
  return {VERSION,TTL,MAX_AGE,LOCATIONS,dateKey,dateList,clock,astronomy,destination,pointsFor,urls,sample,windowMax,score,build,cacheStatus,numeric};
});
