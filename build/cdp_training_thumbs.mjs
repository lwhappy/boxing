/* v5: 1280x720 (16:9) viewport, chrome hidden, native scene framing */
import fs from 'node:fs';
const BASE='http://127.0.0.1:8958', PORT=process.env.CDP_PORT||'9333', OUT='/tmp/thumbs5';
fs.mkdirSync(OUT,{recursive:true});
const ver=await(await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws=new WebSocket(ver.webSocketDebuggerUrl); let idc=0; const pend=new Map();
const send=(m,p={},s)=>{const id=++idc;const msg={id,method:m,params:p};if(s)msg.sessionId=s;ws.send(JSON.stringify(msg));return new Promise((r,j)=>pend.set(id,{r,j}));};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const{r,j}=pend.get(m.id);pend.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
ws.onopen=async()=>{
  const{targetInfos}=await send('Target.getTargets');const t=targetInfos.find(x=>x.type==='page');
  const sid=(await send('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;
  await send('Runtime.enable',{},sid);await send('Page.enable',{},sid);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:2,mobile:false},sid);
  const ev=async(x)=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true},sid);if(r.exceptionDetails)return 'ERR '+(r.exceptionDetails.exception?.description||'').slice(0,200);return r.result.value;};
  const shot=async(n)=>{const s=await send('Page.captureScreenshot',{format:'jpeg',quality:82},sid);fs.writeFileSync(`${OUT}/${n}.jpg`,Buffer.from(s.data,'base64'));console.log('shot',n);};

  /* sim */
  await send('Page.navigate',{url:`${BASE}/training/simulator/`},sid);
  for(let i=0;i<60;i++){await sleep(300);if(await ev(`!!window.__sim`)===true)break;}
  await sleep(2500);
  await ev(`for (const s of ['.hud-top','#nodes','.panel','#ad-slot','#adSlot','#loader','#hint','.site-foot']) document.querySelectorAll(s).forEach(e=>e.style.setProperty('display','none','important')); true`);
  await ev(`window.__sim.play('rear-hook')`);
  const taps=[320,420,480,540,620]; let si=0;
  for(const w of taps){await sleep(si===0?320:90);await shot(`sim-${si++}`);}

  /* punch-demo */
  await send('Page.navigate',{url:`${BASE}/training/punch-demo/`},sid);
  for(let i=0;i<80;i++){await sleep(300);if(await ev(`!!(window.__fight&&window.__fight.ready)`)===true)break;}
  await sleep(1500);
  await ev(`window.__fight.playPunch('cross')`);
  await sleep(520);
  await ev(`document.querySelectorAll('.fight-sound,.fight-orbit-hint,.fight-loading,#attackbar,.fight-bar,.site-head,.breadcrumbs,.site-foot,.fight-main>h1,.fight-note').forEach(e=>e.style.setProperty('display','none','important')); document.body.style.background='#0d1117'; true`);
  const pd=[0,90,90,90]; let pi=0;
  for(const w of pd){await sleep(w);await shot(`pd-${pi++}`);}
  const r=JSON.parse(await ev(`(()=>{const b=document.getElementById('fight-canvas').getBoundingClientRect();return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height});})()`));
  console.log('pd canvas', JSON.stringify(r));

  /* bvk fullscreen */
  await send('Page.navigate',{url:`${BASE}/training/boxing-vs-kickboxing/`},sid);
  for(let i=0;i<90;i++){await sleep(300);if(await ev(`!!window.__bvk`)===true)break;}
  await sleep(1800);
  await ev(`document.getElementById('bvk-replay').click(); true`);
  await sleep(900);
  await ev(`document.querySelectorAll('.site-head,.breadcrumbs,.fight-note,.site-foot,.fight-loading,.fight-error,.fight-orbit-hint,.bvk-replay,.fight-message').forEach(e=>e.style.setProperty('display','none','important')); document.body.style.background='#0b0d12'; true`);
  await sleep(300);
  for(const t2 of [2.37,5.78,8.95]){await ev(`window.__bvk.stepTo(${t2})`);await sleep(100);await shot(`bvk-${t2}`);}

  /* bb fullscreen */
  await send('Page.navigate',{url:`${BASE}/training/benefits-of-boxing/`},sid);
  for(let i=0;i<90;i++){await sleep(300);if(await ev(`!!window.__bb`)===true)break;}
  await sleep(1800);
  await ev(`document.getElementById('bb-replay').click(); true`);
  await sleep(1400);
  await ev(`document.querySelectorAll('.site-head,.breadcrumbs,.bb-article,.site-foot,.bb-loading,.bb-error,.bb-stage-ui,.bb-orbit-hint').forEach(e=>e.style.setProperty('display','none','important')); const h=document.querySelector('.bb-hero'); if(h){h.style.visibility='hidden';} document.getElementById('bb-stage').style.visibility='visible'; document.body.style.background='#0b0d12'; true`);
  await sleep(300);
  for(const t2 of [4.05,6.05,10.72]){await ev(`window.__bb.stepTo(${t2})`);await sleep(100);await shot(`bb-${t2}`);}
  console.log('DONE'); process.exit(0);
};
