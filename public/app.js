"use strict";
const $=id=>document.getElementById(id),S={pcs:{},queue:[],idx:0,rtt:{}};
let toastT;const toast=m=>{const t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),2800)};
const fmt=s=>isFinite(s)?String(Math.floor(s/60)).padStart(2,"0")+":"+String(Math.floor(s%60)).padStart(2,"0"):"00:00";
const wsUrl=q=>(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws?"+q;
const serial=fn=>{let c=Promise.resolve();return e=>{c=c.then(()=>fn(e)).catch(x=>console.error(x))}};
const send=o=>S.ws&&S.ws.readyState===1&&S.ws.send(JSON.stringify(o));
async function ice(){try{return (await (await fetch("/api/ice")).json()).iceServers}catch(e){console.error(e);return [{urls:"stun:stun.l.google.com:19302"}]}}
function ensureAudio(){
 if(S.ctx)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC||!window.RTCPeerConnection)throw new Error("Browser lacks Web Audio or WebRTC");
 const c=S.ctx=new AC();S.audio=new Audio();S.audio.crossOrigin="anonymous";
 S.songG=c.createGain();S.micG=c.createGain();S.master=c.createGain();S.an=c.createAnalyser();S.an.fftSize=1024;S.dest=c.createMediaStreamDestination();
 c.createMediaElementSource(S.audio).connect(S.songG);S.songG.connect(S.master);S.micG.connect(S.master);S.master.connect(S.an);S.an.connect(S.dest);
 S.songG.connect(c.destination);S.vizAn=S.an;
 S.audio.onended=()=>{if(S.queue.length>1)load((S.idx+1)%S.queue.length,true)};S.audio.ontimeupdate=()=>{$("seek").value=S.audio.duration?S.audio.currentTime/S.audio.duration*100:0;$("time").textContent=fmt(S.audio.currentTime)+" / "+fmt(S.audio.duration)};
 S.audio.onplay=S.audio.onpause=()=>$("play").textContent=S.audio.paused?"▶":"⏸";
 S.audio.onerror=()=>toast("⚠ Unsupported or unreadable audio file");
}
function showHost(){["home"].forEach(i=>$(i).hidden=true);["room","player"].forEach(i=>$(i).hidden=false);renderQ()}
function renderQ(){const q=$("queue");q.innerHTML="";S.queue.forEach((f,i)=>{const li=document.createElement("li");li.textContent=f.name;li.className=i===S.idx?"cur":"";li.onclick=()=>load(i,true);q.appendChild(li)});$("title").textContent=S.queue[S.idx]?"🎵 "+S.queue[S.idx].name:"—"}
function load(i,play){if(!S.queue[i])return;S.idx=i;S.audio.src=S.queue[i].url;renderQ();if(play)S.audio.play().catch(e=>toast("⚠ "+e.message))}
function act(cmd,fromHost){
 if(!S.audio)return;
 if(cmd==="play")S.audio.play().catch(e=>toast("⚠ "+e.message));
 else if(cmd==="pause")S.audio.pause();
 else if(cmd==="next")load((S.idx+1)%S.queue.length,true);
 else if(cmd==="prev")load((S.idx-1+S.queue.length)%S.queue.length,true);
 if(["pause","next","prev"].includes(cmd))send({type:"ctl",cmd});
}
async function startRoom(){
 if(S.ws)return;$("status").textContent="Creating room...";
 const r=await fetch("/api/room",{method:"POST"});if(!r.ok)throw new Error("Could not create room");
 const {code,token}=await r.json();S.code=code;showHost();
 const d=$("code");d.textContent="";[...code].forEach((ch,i)=>setTimeout(()=>d.textContent+=ch,i*120));
 const ws=S.ws=new WebSocket(wsUrl(`code=${code}&role=host&token=${token}`));
 ws.onopen=()=>{$("live").textContent="LIVE";$("live").className="on";$("status").textContent="🟢 LIVE — waiting for listeners";toast("✓ Room created")};
 ws.onclose=()=>{Object.keys(S.pcs).forEach(dropPeer);$("live").textContent="OFFLINE";$("live").className="";$("status").textContent="Disconnected from server"};
 ws.onerror=()=>toast("⚠ WebSocket error");
 ws.onmessage=serial(async e=>{const m=JSON.parse(e.data);
  if(m.type==="peer-joined")await makePeer(m.id,m.name);
  else if(m.type==="answer"&&S.pcs[m.from])await S.pcs[m.from].pc.setRemoteDescription(m.sdp).catch(x=>toast("⚠ "+x.message));
  else if(m.type==="ice-candidate"&&S.pcs[m.from])await S.pcs[m.from].pc.addIceCandidate(m.c).catch(console.error);
  else if(m.type==="peer-left")dropPeer(m.id);
  else if(m.type==="request")act(m.cmd);
  else if(m.type==="download-request")sendFile(m.from);
  else if(m.type==="error")toast("⚠ "+m.error);});
}
async function makePeer(id,name){
 const pc=new RTCPeerConnection({iceServers:await ice()}),p=S.pcs[id]={pc,name,state:"connecting"};
 S.dest.stream.getAudioTracks().forEach(t=>pc.addTrack(t,S.dest.stream));
 const dc=p.dc=pc.createDataChannel("p");
 dc.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==="pong"){S.rtt[id]=Math.round(performance.now()-m.ts);renderDevs()}else if(m.t==="cancel"&&p.xfer)p.xfer.cancel=true};
 p.timer=setInterval(()=>{if(dc.readyState==="open")dc.send(JSON.stringify({t:"ping",ts:performance.now()}))},2000);
 pc.onicecandidate=e=>e.candidate&&send({type:"ice-candidate",to:id,c:e.candidate});
 pc.onconnectionstatechange=()=>{p.state=pc.connectionState;renderDevs()};
 await pc.setLocalDescription(await pc.createOffer());send({type:"offer",to:id,sdp:pc.localDescription});renderDevs();
}
function dropPeer(id){const p=S.pcs[id];if(!p)return;if(p.xfer)p.xfer.cancel=true;clearInterval(p.timer);p.dc.close();p.pc.close();delete S.pcs[id];delete S.rtt[id];renderDevs()}
function renderDevs(){const d=$("devices"),ids=Object.keys(S.pcs);d.innerHTML=`<b>CONNECTED DEVICES ${ids.filter(i=>S.pcs[i].state==="connected").length} / 8</b>`;
 ids.forEach(i=>{const p=S.pcs[i],r=S.rtt[i],q=r==null?"":r<80?"🟢 Excellent":r<200?"🟡 Fair":"🔴 Poor";const row=document.createElement("div");row.className="dev";row.textContent=`${p.name} — ${p.state}${r!=null?" · "+r+" ms "+q:""}`;
 const b=document.createElement("button");b.textContent="Remove";b.onclick=()=>send({type:"kick",to:i});row.appendChild(b);d.appendChild(row)})}
$("file").onchange=async e=>{
 const fs=[...e.target.files].filter(f=>f.type.startsWith("audio/")||/\.(mp3|wav|m4a|aac|ogg|webm)$/i.test(f.name));
 if(!fs.length)return toast("⚠ No supported audio file selected");
 try{ensureAudio();await S.ctx.resume();fs.forEach(f=>S.queue.push({name:f.name,url:URL.createObjectURL(f),file:f}));
  if(S.queue.length===fs.length){showHost();load(0,true)}else renderQ();await startRoom()}catch(x){toast("⚠ "+x.message);console.error(x)}};
$("uploadBtn").onclick=()=>$("file").click();
$("micBtn").onclick=async()=>{
 try{ensureAudio();await S.ctx.resume();
  if(S.micStream){S.micStream.getTracks().forEach(t=>t.stop());S.micSrc.disconnect();S.micStream=null;$("micBtn").textContent="🎙 Start Microphone";return toast("Microphone stopped")}
  S.micStream=await navigator.mediaDevices.getUserMedia({audio:true});
  S.micSrc=S.ctx.createMediaStreamSource(S.micStream);S.micSrc.connect(S.micG);S.micAn=S.ctx.createAnalyser();S.micAn.fftSize=512;S.micSrc.connect(S.micAn);
  S.micStream.getAudioTracks()[0].onended=()=>S.micStream&&$("micBtn").click();
  $("micBtn").textContent="⏹ Stop Microphone";toast("✓ Microphone enabled");
  if(!S.ws){showHost();await startRoom()}
 }catch(x){toast("⚠ Microphone: "+x.message)}};
$("micBtn").addEventListener("click",()=>{});
$("micGain").oninput=e=>S.micG&&(S.micG.gain.value=+e.target.value);
$("vol").oninput=e=>S.audio&&(S.audio.volume=+e.target.value);
$("seek").oninput=e=>S.audio&&S.audio.duration&&(S.audio.currentTime=e.target.value/100*S.audio.duration);
$("play").onclick=()=>act(S.audio&&S.audio.paused?"play":"pause");$("next").onclick=()=>act("next");$("prev").onclick=()=>act("prev");
const sendPerm=()=>send({type:"permission-update",guest:$("guestCtl").checked,dl:$("dlCtl").checked});
$("guestCtl").onchange=sendPerm;$("dlCtl").onchange=sendPerm;
$("copyBtn").onclick=()=>navigator.clipboard?.writeText(S.code).then(()=>toast("✓ Code copied"),()=>toast("⚠ Copy failed"));
$("shareBtn").onclick=()=>navigator.share?navigator.share({title:"SYNCWAVE Live Room",text:"Room Code: "+S.code}).catch(()=>{}):$("copyBtn").click();
// ducking
setInterval(()=>{if(!S.micAn||!S.micStream)return S.songG&&S.songG.gain.setTargetAtTime(1,S.ctx.currentTime,.3);
 const a=new Uint8Array(S.micAn.fftSize);S.micAn.getByteTimeDomainData(a);let s=0;for(const v of a)s+=((v-128)/128)**2;
 const talking=Math.sqrt(s/a.length)>.04;S.songG.gain.setTargetAtTime(talking?+$("duck").value:1,S.ctx.currentTime,talking?.1:.6)},100);
// guest
$("connectBtn").onclick=()=>{$("modal").hidden=false;$("codeIn").focus()};$("cancel").onclick=()=>$("modal").hidden=true;
$("codeIn").oninput=e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,6);
$("join").onclick=async()=>{if(S.joining)return;S.joining=true;try{await joinRoom()}catch(x){toast("⚠ "+x.message);$("jstat").textContent=""}finally{S.joining=false}};
async function joinRoom(){
 try{ensureAudio();S.ctx.resume()}catch(x){return toast("⚠ "+x.message)}
 const code=$("codeIn").value.replace(/\D/g,"");if(code.length!==6)return toast("⚠ Invalid room code");
 const js=$("jstat");js.textContent="Searching for room...";
 const r=await fetch("/api/room/"+code);if(!r.ok){js.textContent="";return toast("⚠ Room does not exist")}
 const info=await r.json();if(info.clients>=info.max){js.textContent="";return toast("⚠ ROOM FULL")}
 js.textContent="Room found. Establishing secure connection...";
 S.ws&&S.ws.close();
 const ws=S.ws=new WebSocket(wsUrl(`code=${code}&role=client&name=${encodeURIComponent($("name").value||"Guest "+Math.floor(Math.random()*90+10))}`));
 ws.onmessage=serial(async e=>{const m=JSON.parse(e.data);
  if(m.type==="room-joined"){$("modal").hidden=true;["home","room","player"].forEach(i=>$(i).hidden=true);$("guest").hidden=false;$("gctl").hidden=!m.guest;$("dlBtn").hidden=!m.dl;lock(m.lockMs)}
  else if(m.type==="offer")await onOffer(m);
  else if(m.type==="ice-candidate"&&S.cpc)await S.cpc.addIceCandidate(m.c).catch(console.error);
  else if(m.type==="lock-update")lock(m.lockMs);
  else if(m.type==="permission-update"){$("gctl").hidden=!m.guest;$("dlBtn").hidden=!m.dl}
  else if(m.type==="host-disconnected")ended("HOST DISCONNECTED");
  else if(m.type==="error")toast("⚠ "+m.error);});
 ws.onclose=ev=>{if(ev.code===4001)ended("Removed by host");else if(!$("guest").hidden&&$("home2").hidden)ended("Disconnected from server")};
 ws.onerror=()=>{js.textContent="";toast("⚠ Connection failed")};
}
async function onOffer(m){
 const pc=S.cpc=new RTCPeerConnection({iceServers:await ice()});
 pc.onicecandidate=e=>e.candidate&&send({type:"ice-candidate",c:e.candidate});
 pc.ondatachannel=e=>{const ch=S.cdc=e.channel;ch.binaryType="arraybuffer";ch.onclose=()=>{if(D){D=null;dlUi("");toast("⚠ Transfer interrupted")}};ch.onmessage=ev=>onDc(ch,ev.data)};
 pc.ontrack=e=>{const st=e.streams[0],a=S.ra=S.ra||new Audio();a.srcObject=st;
  S.vizAn=S.ctx.createAnalyser();S.vizAn.fftSize=1024;S.ctx.createMediaStreamSource(st).connect(S.vizAn);
  a.play().then(()=>{S.ctx.resume();$("tap").hidden=true;$("gstate").textContent="🟢 Connected"}).catch(()=>{$("tap").hidden=false;$("gstate").textContent="Audio blocked by browser"})};
 pc.onconnectionstatechange=()=>{const s=pc.connectionState;if(s==="failed")toast("⚠ WebRTC connection failed");if(s==="disconnected")$("gstate").textContent="Reconnecting..."};
 await pc.setRemoteDescription(m.sdp);await pc.setLocalDescription(await pc.createAnswer());send({type:"answer",sdp:pc.localDescription});
 clearInterval(S.rttT);S.rttT=setInterval(async()=>{try{const st=await pc.getStats();st.forEach(r=>{if(r.type==="candidate-pair"&&r.nominated&&r.currentRoundTripTime!=null)$("rtt").textContent=Math.round(r.currentRoundTripTime*1000)+" ms"})}catch(x){console.error(x)}},2000);
}
$("tap").onclick=async()=>{await S.ctx.resume();S.ra.play().then(()=>{$("tap").hidden=true;$("gstate").textContent="🟢 Connected"}).catch(x=>toast("⚠ "+x.message))};
document.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>send({type:"request",cmd:b.dataset.r}));
function lock(ms){clearInterval(S.lockT);if(ms<=0){$("lock").textContent="";return setGctl(false)}
 const end=Date.now()+ms;setGctl(true);S.lockT=setInterval(()=>{const l=Math.ceil((end-Date.now())/1000);if(l<=0){clearInterval(S.lockT);$("lock").textContent="Controls unlocked";setGctl(false)}else $("lock").textContent=`🔒 HOST CONTROL — locked for ${l}s`},250)}
const setGctl=v=>document.querySelectorAll("#gctl button").forEach(b=>b.disabled=v);
function ended(msg){$("gstate").textContent=msg;setGctl(true);$("home2").hidden=false;clearInterval(S.rttT);S.cpc&&S.cpc.close();S.ra&&(S.ra.srcObject=null)}
$("home2").onclick=()=>location.reload();
// P2P download (host -> client over the DataChannel: meta -> chunks -> end)
async function sendFile(id){
 const p=S.pcs[id],q=S.queue[S.idx];if(!p||!q||p.dc.readyState!=="open"||p.xfer)return;
 const x=p.xfer={cancel:false},dc=p.dc,f=q.file,CH=16384;
 try{dc.send(JSON.stringify({t:"meta",name:f.name,size:f.size,type:f.type}));
  for(let o=0;o<f.size&&!x.cancel;o+=CH){
   while(dc.bufferedAmount>CH*16){await new Promise(r=>setTimeout(r,20));if(dc.readyState!=="open")throw new Error("channel closed")}
   if(dc.readyState!=="open")throw new Error("channel closed");dc.send(await f.slice(o,o+CH).arrayBuffer())}
  if(!x.cancel)dc.send(JSON.stringify({t:"end"}))}
 catch(e){console.error(e);toast("⚠ Transfer failed: "+e.message)}finally{p.xfer=null}}
let D=null;const dlUi=t=>$("dlStat").textContent=t;
function onDc(ch,data){
 if(typeof data!=="string"){if(!D)return;D.parts.push(data);D.got+=data.byteLength;dlUi(`Downloading ${Math.floor(D.got/D.size*100)}% — ${(D.got/1e6).toFixed(1)} / ${(D.size/1e6).toFixed(1)} MB`);return}
 const d=JSON.parse(data);
 if(d.t==="ping")ch.send(JSON.stringify({t:"pong",ts:d.ts}));
 else if(d.t==="meta"){if(!(d.size>0)||d.size>5e8){dlUi("");ch.send(JSON.stringify({t:"cancel"}));return toast("⚠ File too large or empty")}D={name:String(d.name),size:d.size,type:d.type||"audio/mpeg",parts:[],got:0};$("dlBtn").textContent="✖ Cancel download"}
 else if(d.t==="end"&&D){const ok=D.got===D.size,x=D;D=null;$("dlBtn").textContent="⬇ Download Song";
  if(!ok){dlUi("");return toast("⚠ Download incomplete")}
  const u=URL.createObjectURL(new Blob(x.parts,{type:x.type})),a=document.createElement("a");a.href=u;a.download=x.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),15000);dlUi("✓ Download Complete");toast("✓ Download complete")}}
$("dlBtn").onclick=()=>{if(D){S.cdc&&S.cdc.readyState==="open"&&S.cdc.send(JSON.stringify({t:"cancel"}));D=null;dlUi("Download cancelled");$("dlBtn").textContent="⬇ Download Song"}else{dlUi("Preparing download...");send({type:"download-request"})}};
// visualizer
const cv=$("cv"),g=cv.getContext("2d");
(function draw(){requestAnimationFrame(draw);const an=S.vizAn;g.fillStyle="rgba(0,0,0,.35)";g.fillRect(0,0,cv.width,cv.height);if(!an)return;
 const f=new Uint8Array(an.frequencyBinCount),w=new Uint8Array(an.fftSize),m=$("mode").value,W=cv.width,H=cv.height;an.getByteFrequencyData(f);an.getByteTimeDomainData(w);g.strokeStyle=g.fillStyle="#6df0ff";
 if(m==="0"){const n=64,bw=W/n;for(let i=0;i<n;i++){const h=f[i*2]/255*H;g.fillRect(i*bw,H-h,bw-2,h)}}
 else if(m==="1"){g.beginPath();w.forEach((v,i)=>{const x=i/w.length*W,y=v/255*H;i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke()}
 else{const n=96,r=H*.25;g.translate(W/2,H/2);for(let i=0;i<n;i++){g.rotate(Math.PI*2/n);const h=f[i]/255*H*.3;g.fillRect(-1.5,r,3,h)}g.setTransform(1,0,0,1,0,0)}})();
