import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = id => document.getElementById(id);
const state = { floor:0, miss:0, anomalyActive:false, currentAnomaly:null, locked:true };
const TARGET = 8;
const floorName = f => f===0 ? 'B1' : f+'F';

/* かご内の見た目状態（異変はここを変える） */
const room = {
  capacity:'定員 8名 / 600kg', panelFloor:'B1',
  btnCount:8, btnAllOn:false, btnLit:3, emgAlert:false,
  figOpacity:0.8, figTilt:0, figExtra:false, figEyes:false,
  posterMode:'normal', cautionHidden:false, ceilRed:false, wet:false,
  indDown:false, indBad:false, ceilFlicker:false, ceilBlue:false, badChime:false,
};

/* ===================== 音声エンジン =====================
   public/assets/audio/ に {hum,ding,ding_bad,door,motor,error}.mp3 があれば
   実録音サンプルを自動採用。無ければ高品質な合成音にフォールバック。
   かご内の反響を畳み込みリバーブで再現。 */
let audioCtx, master, reverb, reverbSend, hum;
const SAMPLES = {};
function ac(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    master = audioCtx.createGain(); master.gain.value=0.85; master.connect(audioCtx.destination);
    reverb = audioCtx.createConvolver(); reverb.buffer = makeIR(1.7,3.0);
    reverbSend = audioCtx.createGain(); reverbSend.gain.value=1.0;
    reverbSend.connect(reverb); reverb.connect(master);
    loadSamples();
  }
  return audioCtx;
}
function makeIR(dur,decay){
  const c=audioCtx, rate=c.sampleRate, len=Math.floor(rate*dur), buf=c.createBuffer(2,len,rate);
  for(let ch=0;ch<2;ch++){ const d=buf.getChannelData(ch);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay); }
  return buf;
}
function out(node, send=0.22){ node.connect(master); const s=audioCtx.createGain(); s.gain.value=send; node.connect(s); s.connect(reverbSend); }
async function loadSamples(){
  for(const n of ['hum','ding','ding_bad','door','motor','error']){
    try{ const r=await fetch('/assets/audio/'+n+'.mp3'); if(!r.ok) continue;
      SAMPLES[n]=await audioCtx.decodeAudioData(await r.arrayBuffer()); }catch(e){}
  }
}
function playBuf(name,{vol=0.9,rate=1,loop=false,send=0.22}={}){
  const b=SAMPLES[name]; if(!b) return null;
  const s=audioCtx.createBufferSource(); s.buffer=b; s.loop=loop; s.playbackRate.value=rate;
  const g=audioCtx.createGain(); g.gain.value=vol; s.connect(g); out(g,send); s.start(); return s;
}
function startHum(){
  const c = ac(); if(hum) return;
  if(SAMPLES.hum){ const s=playBuf('hum',{vol:0.8,loop:true,send:0.1}); hum={s}; return; }
  // 合成：低い基音＋唸り＋空気感ノイズ
  const o1=c.createOscillator(); o1.type='sawtooth'; o1.frequency.value=55;
  const o2=c.createOscillator(); o2.type='sine'; o2.frequency.value=110;
  const o3=c.createOscillator(); o3.type='sine'; o3.frequency.value=164.5;
  const lp=c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=240; lp.Q.value=0.7;
  // 空気のノイズ層
  const nb=c.createBuffer(1,c.sampleRate*2,c.sampleRate); const nd=nb.getChannelData(0);
  let last=0; for(let i=0;i<nd.length;i++){ last=(last+(Math.random()*2-1)*0.02)*0.98; nd[i]=last; }
  const noise=c.createBufferSource(); noise.buffer=nb; noise.loop=true;
  const nf=c.createBiquadFilter(); nf.type='bandpass'; nf.frequency.value=420; nf.Q.value=0.6;
  const ng=c.createGain(); ng.gain.value=0.06;
  const g=c.createGain(); g.gain.value=0;
  const lfo=c.createOscillator(); lfo.frequency.value=0.16; const lfoG=c.createGain(); lfoG.gain.value=7;
  lfo.connect(lfoG); lfoG.connect(o1.frequency);
  o1.connect(lp); o2.connect(lp); o3.connect(lp); lp.connect(g);
  noise.connect(nf); nf.connect(ng); ng.connect(g);
  g.connect(master);
  o1.start(); o2.start(); o3.start(); noise.start(); lfo.start();
  g.gain.linearRampToValueAtTime(0.09,c.currentTime+2.5); hum={g};
}
function tone(freq,dur,type='sine',vol=0.18,delay=0,send=0.3){
  const c=ac(),t=c.currentTime+delay,o=c.createOscillator(),g=c.createGain();
  o.type=type;o.frequency.value=freq;o.connect(g);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0008,t+dur);
  out(g,send); o.start(t);o.stop(t+dur);
}
function ding(mode='normal'){
  ac();
  if(mode==='normal' && playBuf('ding',{vol:0.4})) return;
  if(mode!=='normal' && playBuf('ding_bad',{vol:0.45})) return;
  let n=[1318.5,1046.5]; if(mode==='reverse')n=[1046.5,1318.5]; if(mode==='dissonant')n=[1318.5,987.7];
  n.forEach((f,i)=>{ tone(f,1.1,'sine',0.08,i*0.18,0.4); tone(f*2,0.8,'triangle',0.025,i*0.18,0.4); tone(f*3,0.5,'sine',0.01,i*0.18,0.4); });
}
function buzz(){ tone(110,0.55,'sawtooth',0.2,0,0.4); tone(70,0.6,'square',0.12,0.02,0.4); }
function errorSound(){
  ac(); if(playBuf('error',{vol:0.9})) return;
  tone(190,0.3,'square',0.2,0,0.35); tone(105,0.5,'square',0.18,0.18,0.35);
}
// 怪異の襲来音（上昇する金切り音＋衝撃＋不協和）
function screech(){
  const c=ac(); const t=c.currentTime;
  buzz();
  const o=c.createOscillator(),g=c.createGain(),f=c.createBiquadFilter();
  o.type='sawtooth'; f.type='bandpass'; f.frequency.value=1400; f.Q.value=7;
  o.frequency.setValueAtTime(320,t); o.frequency.exponentialRampToValueAtTime(2000,t+0.6);
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.32,t+0.08); g.gain.exponentialRampToValueAtTime(0.0008,t+0.95);
  o.connect(f); f.connect(g); out(g,0.4); o.start(t); o.stop(t+0.98);
  tone(46,0.8,'sine',0.34,0.45,0.3);   // 着弾のドン
  ding('dissonant');
}
function moveSound(){
  const c=ac(); if(playBuf('motor',{vol:1.15})) return;
  const o=c.createOscillator(),bp=c.createBiquadFilter(),g=c.createGain();
  o.type='sawtooth';bp.type='bandpass';bp.frequency.value=380;bp.Q.value=3.5;
  // ギア鳴りのAM
  const am=c.createOscillator(); am.type='sine'; am.frequency.value=33; const amG=c.createGain(); amG.gain.value=0.025;
  am.connect(amG); amG.connect(g.gain);
  o.connect(bp);bp.connect(g);const t=c.currentTime;
  o.frequency.setValueAtTime(150,t);o.frequency.linearRampToValueAtTime(235,t+0.55);o.frequency.linearRampToValueAtTime(150,t+0.85);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.14,t+0.12);g.gain.linearRampToValueAtTime(0.0008,t+0.9);
  out(g,0.3); o.start(t);o.stop(t+0.92); am.start(t); am.stop(t+0.92);
}
function doorMotor(){
  const c=ac(); if(playBuf('door',{vol:1.15})) return;
  const dur=1.0,buf=c.createBuffer(1,c.sampleRate*dur,c.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*0.5;
  const src=c.createBufferSource();src.buffer=buf;
  const bp=c.createBiquadFilter();bp.type='bandpass';bp.Q.value=1.4;const g=c.createGain();
  src.connect(bp);bp.connect(g);const t=c.currentTime;
  bp.frequency.setValueAtTime(450,t);bp.frequency.linearRampToValueAtTime(1100,t+dur);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.09,t+0.12);g.gain.linearRampToValueAtTime(0.0008,t+dur);
  out(g,0.25); src.start(t);src.stop(t+dur);
  // 開始と終了の機械的な「ガコッ」
  tone(70,0.08,'square',0.2,0,0.2); tone(60,0.1,'square',0.17,dur*0.9,0.2);
}

/* ===================== 3D シーン ===================== */
const sceneEl = $('scene');
let renderer, scene, camera, composer, doorL, doorR, ceilLight, lightPanel, wetMesh, hallLight, figFill, hairClipPlane;
let figureGroup, figureExtra;
let creature=null, scareActive=false, scareT0=0, scareBlackout=false, scareYaw0=0, scarePitch0=0;
let descending=false, descendT0=0;
// 来訪者（②選別：開で受け入れた人がカゴに乗り、次の階で降りていく）
let visitor=null, visitorPhase='hidden', visitorT0=0, visitorFaceIn=0, visitorFaceOut=Math.PI;
const VIS_ENTER=new THREE.Vector3(-1.2,0,-2.05); // 廊下の左端（ここから歩いてくる）
const VIS_WAIT=new THREE.Vector3(0,0,-2.05);     // 廊下中央で待つ
const VIS_ABOARD=new THREE.Vector3(-0.52,0,-0.05); // カゴ内の立ち位置（左寄り＝操作盤を隠さない）
const VIS_GONE=new THREE.Vector3(0,0,-3.3);      // 廊下奥へ去る
const visitorFaceWalk=Math.PI/2;                  // 右方向（+x）へ歩く時の向き
let visitorScare=false, visitorScareT0=0;         // 来訪者が怪異に襲われる演出
let blockedScare=false, blockedT0=0;              // 開・正解：怪異化するが閉まる扉に阻まれる演出
let figureMixers=[]; const figClock=new THREE.Clock();
let doorTex, mirrorTex, posterTex, indicatorTex, ceilTex, adTex;
const panelButtons=[]; let emgBtnMat;
let doorTarget = 0, lightLevel = 1;
const W=2.05, H=2.5, D=2.4;    // 低めの天井＋高比率ドアで密室感

function texCanvas(w,h){ const c=document.createElement('canvas'); c.width=w;c.height=h; return {c,ctx:c.getContext('2d')}; }
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath(); }

const DOORC=texCanvas(256,720), MIR=texCanvas(320,380), POS=texCanvas(320,320), FLR=texCanvas(1024,1024), WALLC=texCanvas(512,512), IND=texCanvas(256,128), CEIL=texCanvas(256,256), AD=texCanvas(512,720);

function drawAd(){ const {ctx,c}=AD,W2=c.width,H2=c.height;
  const g=ctx.createLinearGradient(0,0,0,H2);g.addColorStop(0,'#1c74ba');g.addColorStop(1,'#0c4a80');ctx.fillStyle=g;ctx.fillRect(0,0,W2,H2);
  // 斜めのアクセント
  ctx.fillStyle='rgba(255,255,255,.08)';ctx.beginPath();ctx.moveTo(0,H2*0.30);ctx.lineTo(W2,H2*0.16);ctx.lineTo(W2,H2*0.34);ctx.lineTo(0,H2*0.48);ctx.fill();
  ctx.textAlign='center';
  ctx.fillStyle='#ffffff';ctx.font="bold 62px 'Hiragino Kaku Gothic ProN',sans-serif";
  ctx.fillText('保険のしごと、',W2/2,H2*0.20);ctx.fillText('つなぐ。',W2/2,H2*0.33);
  // 下の白帯＋ブランド
  ctx.fillStyle='#f3f6f8';ctx.fillRect(0,H2*0.60,W2,H2*0.40);
  ctx.fillStyle='#0c4a80';ctx.font="bold 50px 'Hiragino Kaku Gothic ProN',sans-serif";ctx.fillText('ツナグンキャリア',W2/2,H2*0.74);
  ctx.fillStyle='#3a6a90';ctx.font="26px 'Hiragino Kaku Gothic ProN',sans-serif";ctx.fillText('保険業界専門の転職支援',W2/2,H2*0.83);
  ctx.strokeStyle='#1c74ba';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(W2*0.3,H2*0.88);ctx.lineTo(W2*0.7,H2*0.88);ctx.stroke();
  ctx.fillStyle='#6a8aa6';ctx.font="22px 'Hiragino Kaku Gothic ProN',sans-serif";ctx.fillText('tsunagun-career.jp',W2/2,H2*0.93);
  ctx.strokeStyle='rgba(0,0,0,.2)';ctx.lineWidth=8;ctx.strokeRect(4,4,W2-8,H2-8);
}

function drawCeilLight(){ const {ctx,c}=CEIL,S=c.width;
  const g=ctx.createRadialGradient(S/2,S*0.42,S*0.08,S/2,S/2,S*0.72);
  g.addColorStop(0,'#fff7e6');g.addColorStop(.65,'#ffedcf');g.addColorStop(1,'#efd9b2');
  ctx.fillStyle=g;ctx.fillRect(0,0,S,S);
  // ディフューザーの格子（ルーバー）
  ctx.strokeStyle='rgba(120,98,64,.16)';ctx.lineWidth=3;
  for(let i=1;i<7;i++){const p=i*S/7;ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,S);ctx.moveTo(0,p);ctx.lineTo(S,p);ctx.stroke();}
  // 縁の影
  ctx.strokeStyle='rgba(70,52,32,.35)';ctx.lineWidth=14;ctx.strokeRect(7,7,S-14,S-14);
}

function drawIndicator(){ const {ctx,c}=IND,Wi=c.width,Hi=c.height;
  ctx.fillStyle='#080a09';ctx.fillRect(0,0,Wi,Hi);
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#ff7a2c';ctx.shadowColor='rgba(255,110,30,.9)';ctx.shadowBlur=16;
  ctx.font='bold 70px Arial';ctx.fillText(room.indDown?'↓':'↑',Wi*0.3,Hi*0.54);
  ctx.font='bold 84px Arial';ctx.fillText(room.indBad?'13':room.panelFloor,Wi*0.64,Hi*0.54);
  ctx.shadowBlur=0;
  if(indicatorTex)indicatorTex.needsUpdate=true;
}

function drawWall(){ const {ctx,c}=WALLC,Wd=c.width,Hd=c.height;
  // 一枚板の金属（パネルの目地なし・ヘアライン仕上げ）
  const g=ctx.createLinearGradient(0,0,Wd,0);g.addColorStop(0,'#6a6f69');g.addColorStop(.5,'#7b807a');g.addColorStop(1,'#6a6f69');ctx.fillStyle=g;ctx.fillRect(0,0,Wd,Hd);
  ctx.globalAlpha=.04;for(let i=0;i<2500;i++){ctx.fillStyle=Math.random()<.5?'#fff':'#000';ctx.fillRect(Math.random()*Wd,Math.random()*Hd,1,1);}ctx.globalAlpha=1;
  // 横方向のヘアライン（金属の刷毛目）
  ctx.globalAlpha=.03;ctx.strokeStyle='#000';ctx.lineWidth=1;for(let y=0;y<Hd;y+=4){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(Wd,y);ctx.stroke();}ctx.globalAlpha=1;
}
function drawFloor(){ const {ctx,c}=FLR,S=c.width;
  // ダークブラウンのカーペット
  ctx.fillStyle='#3a281c';ctx.fillRect(0,0,S,S);
  // 繊維のノイズ
  for(let i=0;i<70000;i++){const x=Math.random()*S,y=Math.random()*S,v=Math.random();
    ctx.fillStyle=v<.5?'rgba(0,0,0,.10)':'rgba(135,100,68,.10)';ctx.fillRect(x,y,1.6,1.6);}
  // 微かな織り目
  ctx.globalAlpha=.05;ctx.strokeStyle='#000';ctx.lineWidth=1;
  for(let p=0;p<S;p+=3){ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,S);ctx.stroke();ctx.beginPath();ctx.moveTo(0,p);ctx.lineTo(S,p);ctx.stroke();}
  ctx.globalAlpha=1;
}
// ボタンの数字ラベル用テクスチャ
function makeLabelTex(label){
  const cc=document.createElement('canvas');cc.width=cc.height=64;const x=cc.getContext('2d');
  x.clearRect(0,0,64,64);x.fillStyle='#1c1f1a';x.textAlign='center';x.textBaseline='middle';
  x.font='bold '+(label.length>1?30:42)+'px Arial';x.fillText(label,32,34);
  const t=new THREE.CanvasTexture(cc);t.colorSpace=THREE.SRGBColorSpace;return t;
}
const PANEL_LABELS=['8','7','6','5','4','3','2','1','B1','B2'];
// 実3Dの操作パネルを組む（px,pzは盤の中心位置）
function buildPanel3D(px,pz){
  const g=new THREE.Group();g.position.set(px,1.3,pz);g.rotation.y=0;scene.add(g);
  const faceMat=new THREE.MeshStandardMaterial({color:0x6c716b,roughness:.45,metalness:.7,envMapIntensity:.9});
  const face=new THREE.Mesh(new THREE.BoxGeometry(0.34,1.28,0.05),faceMat);face.position.z=-0.025;g.add(face);
  // 階数スクリーン（実機の表示）
  const scrFrame=new THREE.Mesh(new THREE.PlaneGeometry(0.3,0.17),new THREE.MeshStandardMaterial({color:0x111312,roughness:.5}));scrFrame.position.set(0,0.5,0.004);g.add(scrFrame);
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(0.27,0.14),new THREE.MeshBasicMaterial({map:indicatorTex}));screen.position.set(0,0.5,0.008);g.add(screen);
  // 非常ボタン（オレンジ）
  emgBtnMat=new THREE.MeshStandardMaterial({color:0xe08018,roughness:.45,metalness:.2,emissive:0x000000});
  const emg=new THREE.Mesh(new THREE.CylinderGeometry(0.034,0.034,0.02,18),emgBtnMat);emg.rotation.x=Math.PI/2;emg.position.set(0,0.32,0.012);g.add(emg);
  // 階数ボタン（実3D・最大10／2列）
  const baseBtn=new THREE.CylinderGeometry(0.03,0.03,0.018,20);
  for(let i=0;i<10;i++){
    const col=i%2, row=Math.floor(i/2);
    const bx=col?0.075:-0.075, by=0.17-row*0.12;
    const mat=new THREE.MeshStandardMaterial({color:0xd2d6d0,roughness:.4,metalness:.25,emissive:0x000000});
    const b=new THREE.Mesh(baseBtn,mat);b.rotation.x=Math.PI/2;b.position.set(bx,by,0.011);g.add(b);
    const lbl=new THREE.Mesh(new THREE.PlaneGeometry(0.05,0.05),new THREE.MeshBasicMaterial({map:makeLabelTex(PANEL_LABELS[i]),transparent:true}));
    lbl.position.set(bx,by,0.021);g.add(lbl);
    panelButtons.push({mesh:b,mat,label:lbl});
  }
  // 開閉ボタン
  const ocMat=new THREE.MeshStandardMaterial({color:0xc0c4be,roughness:.5,metalness:.2});
  [-0.075,0.075].forEach(bx=>{const b=new THREE.Mesh(new THREE.CylinderGeometry(0.028,0.028,0.016,16),ocMat);b.rotation.x=Math.PI/2;b.position.set(bx,-0.5,0.01);g.add(b);});
  updatePanel3D();
  return g;
}
function updatePanel3D(){
  panelButtons.forEach((b,i)=>{
    const vis=i<room.btnCount; b.mesh.visible=vis; b.label.visible=vis;
    const on=room.btnAllOn||i===room.btnLit;
    b.mat.color.set(on?0xffc24a:0xd2d6d0);
    b.mat.emissive.set(on?0xc8761a:0x000000); b.mat.emissiveIntensity=on?0.8:0;
  });
  if(emgBtnMat){ const a=room.emgAlert&&blinkOn; emgBtnMat.emissive.set(a?0xff3018:0x000000); emgBtnMat.emissiveIntensity=a?1.3:0; }
}
function drawDoorTex(){ const {ctx,c}=DOORC,Wd=c.width,Hd=c.height;
  // グレー金属の扉
  const g=ctx.createLinearGradient(0,0,Wd,0);g.addColorStop(0,'#5b605a');g.addColorStop(.2,'#71766f');g.addColorStop(.5,'#6b706a');g.addColorStop(.8,'#71766f');g.addColorStop(1,'#5b605a');
  ctx.fillStyle=g;ctx.fillRect(0,0,Wd,Hd);
  // 背の高いメッシュ窓（ガラス＝透過。向こうの様子が見える）
  const wx=Wd*0.20,wy=Hd*0.15,ww=Wd*0.60,wh=Hd*0.64;
  ctx.clearRect(wx,wy,ww,wh);                              // ガラス部分を透明に
  ctx.save();ctx.beginPath();ctx.rect(wx,wy,ww,wh);ctx.clip();
  ctx.fillStyle='rgba(18,22,20,0.16)';ctx.fillRect(wx,wy,ww,wh);   // 薄いガラスの色味
  ctx.strokeStyle='rgba(150,160,152,.5)';ctx.lineWidth=1.3;        // ワイヤーメッシュ（残す）
  for(let i=-wh;i<ww+wh;i+=12){ctx.beginPath();ctx.moveTo(wx+i,wy);ctx.lineTo(wx+i+wh,wy+wh);ctx.stroke();ctx.beginPath();ctx.moveTo(wx+i,wy+wh);ctx.lineTo(wx+i+wh,wy);ctx.stroke();}
  ctx.restore();
  ctx.strokeStyle='#565b54';ctx.lineWidth=9;ctx.strokeRect(wx,wy,ww,wh);
  ctx.strokeStyle='rgba(255,255,255,.08)';ctx.lineWidth=2;ctx.strokeRect(wx-5,wy-5,ww+10,wh+10);
  if(doorTex)doorTex.needsUpdate=true;
}
function drawMirror(){ const {ctx,c}=MIR,Wm=c.width,Hm=c.height;
  const g=ctx.createLinearGradient(0,0,Wm,Hm);g.addColorStop(0,'#cfd9de');g.addColorStop(.5,'#aab9c0');g.addColorStop(1,'#8b9aa1');
  ctx.fillStyle=g;ctx.fillRect(0,0,Wm,Hm);
  ctx.fillStyle='rgba(255,255,255,.16)';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Wm*.5,0);ctx.lineTo(Wm*.2,Hm);ctx.lineTo(0,Hm);ctx.fill();
  function person(cx,scale,op,tilt){
    ctx.save();ctx.globalAlpha=op;ctx.translate(cx,Hm);ctx.rotate(tilt);
    const bw=Wm*0.26*scale,bh=Hm*0.7*scale;
    const pg=ctx.createLinearGradient(0,-bh,0,0);pg.addColorStop(0,'#6b6f72');pg.addColorStop(1,'#3f4448');
    ctx.fillStyle=pg;
    ctx.beginPath();ctx.ellipse(0,-bh+bw*0.5,bw*0.5,bw*0.5,0,0,7);ctx.fill();
    ctx.beginPath();ctx.moveTo(-bw*0.6,0);ctx.quadraticCurveTo(-bw*0.7,-bh*0.7,0,-bh+bw*0.4);ctx.quadraticCurveTo(bw*0.7,-bh*0.7,bw*0.6,0);ctx.closePath();ctx.fill();
    ctx.restore();
  }
  if(room.figExtra) person(Wm*0.32,0.92,0.6,0.04);
  person(Wm*0.5,1.0,room.figOpacity,room.figTilt);
  if(room.figEyes){ctx.fillStyle='#e0483d';ctx.shadowColor='#e0483d';ctx.shadowBlur=8;ctx.font='bold 26px sans-serif';ctx.textAlign='center';ctx.fillText('▾▾',Wm*0.5,Hm*0.32);ctx.shadowBlur=0;}
  ctx.strokeStyle='rgba(120,130,135,.6)';ctx.lineWidth=8;ctx.strokeRect(0,0,Wm,Hm);
  if(mirrorTex)mirrorTex.needsUpdate=true;
}
function drawPoster(){ const {ctx,c}=POS,Wp=c.width,Hp=c.height;
  ctx.save();
  if(room.posterMode==='blank'){
    ctx.fillStyle='#0b0b0c';ctx.fillRect(0,0,Wp,Hp);
    ctx.strokeStyle='rgba(40,40,44,.9)';ctx.lineWidth=4;ctx.strokeRect(2,2,Wp-4,Hp-4);
    ctx.restore(); if(posterTex)posterTex.needsUpdate=true; return;
  }
  if(room.posterMode==='flipped'){ctx.translate(Wp,0);ctx.scale(-1,1);}
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,Wp,Hp);
  ctx.strokeStyle='#c9c5ba';ctx.lineWidth=4;ctx.strokeRect(2,2,Wp-4,Hp-4);
  ctx.fillStyle='#33312b';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font="bold 30px 'Hiragino Kaku Gothic ProN',sans-serif";
  if(room.posterMode==='garbled'){ctx.fillText('エレベ−タ−内で',Wp/2,Hp/2-22);ctx.fillText('はおしすかに',Wp/2,Hp/2+22);}
  else{ctx.fillText('エレベーター内では',Wp/2,Hp/2-22);ctx.fillText('おしずかに',Wp/2,Hp/2+22);}
  ctx.restore();
  if(posterTex)posterTex.needsUpdate=true;
}

function buildFigure(){
  const g=new THREE.Group();
  const suit  =new THREE.MeshStandardMaterial({color:0x3b4356,roughness:.66,metalness:.05}); // 紺スーツ
  const suitDk=new THREE.MeshStandardMaterial({color:0x2f3645,roughness:.7});
  const shirt =new THREE.MeshStandardMaterial({color:0xeceef0,roughness:.55});
  const skin  =new THREE.MeshStandardMaterial({color:0xcaa07a,roughness:.76});
  const hair  =new THREE.MeshStandardMaterial({color:0x17140f,roughness:.88});
  const tieM  =new THREE.MeshStandardMaterial({color:0x86283a,roughness:.5});
  const shoe  =new THREE.MeshStandardMaterial({color:0x12100c,roughness:.5,metalness:.15});
  // 脚（ズボン）＋靴
  const legGeo=new THREE.CylinderGeometry(0.083,0.07,0.84,12);
  [-0.095,0.095].forEach(x=>{ const l=new THREE.Mesh(legGeo,suitDk);l.position.set(x,0.43,0);g.add(l);
    const s=new THREE.Mesh(new THREE.BoxGeometry(0.11,0.08,0.25),shoe);s.position.set(x,0.045,0.06);g.add(s); });
  // 腰
  const hip=new THREE.Mesh(new THREE.BoxGeometry(0.33,0.22,0.21),suitDk);hip.position.y=0.92;g.add(hip);
  // 胴（ジャケット：上が広いテーパー）
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(0.215,0.17,0.6,18),suit);torso.position.y=1.28;g.add(torso);
  // 肩
  const sh=new THREE.Mesh(new THREE.CapsuleGeometry(0.1,0.42,5,14),suit);sh.rotation.z=Math.PI/2;sh.position.y=1.54;g.add(sh);
  // シャツのV＋ネクタイ＋ラペル
  const shirtV=new THREE.Mesh(new THREE.BoxGeometry(0.17,0.36,0.04),shirt);shirtV.position.set(0,1.36,0.165);g.add(shirtV);
  const tie=new THREE.Mesh(new THREE.BoxGeometry(0.045,0.32,0.025),tieM);tie.position.set(0,1.33,0.19);g.add(tie);
  [-1,1].forEach(s=>{ const lap=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.28,0.03),suit);lap.position.set(s*0.075,1.41,0.17);lap.rotation.z=s*0.2;g.add(lap); });
  // 腕＋手
  const armGeo=new THREE.CylinderGeometry(0.053,0.046,0.64,12);
  [-1,1].forEach(s=>{ const a=new THREE.Mesh(armGeo,suit);a.position.set(s*0.275,1.26,0.02);a.rotation.z=s*0.08;g.add(a);
    const hand=new THREE.Mesh(new THREE.SphereGeometry(0.05,12,12),skin);hand.scale.set(1,1.2,0.8);hand.position.set(s*0.3,0.93,0.03);g.add(hand); });
  // 首・頭・髪
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.056,0.1,12),skin);neck.position.y=1.58;g.add(neck);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.115,22,22),skin);head.scale.set(1,1.18,1.05);head.position.y=1.7;g.add(head);
  const hairM=new THREE.Mesh(new THREE.SphereGeometry(0.122,22,22,0,Math.PI*2,0,Math.PI*0.58),hair);hairM.scale.set(1,1.12,1.06);hairM.position.y=1.72;g.add(hairM);
  // 目（異変「こちらを向いて笑う」用・通常は非表示）
  const eyeMat=new THREE.MeshStandardMaterial({color:0xe0483d,emissive:0xe0483d,emissiveIntensity:3});
  const eyes=new THREE.Group();
  const eL=new THREE.Mesh(new THREE.SphereGeometry(0.018,10,10),eyeMat);eL.position.set(-0.04,1.71,0.1);
  const eR=new THREE.Mesh(new THREE.SphereGeometry(0.018,10,10),eyeMat);eR.position.set(0.04,1.71,0.1);
  eyes.add(eL,eR);eyes.visible=false;g.add(eyes);
  g.traverse(o=>{ if(o.layers) o.layers.set(1); });  // 鏡レイヤー専用
  g.userData.eyes=eyes;
  return g;
}
function updateFigure(){
  if(!figureGroup) return;
  figureGroup.visible = room.figOpacity>0;
  figureGroup.rotation.z = room.figTilt;
  if(figureGroup.userData.eyes) figureGroup.userData.eyes.visible = room.figEyes;
  if(figureExtra) figureExtra.visible = room.figExtra;
}

// 来訪者（女性）：プレイヤーの鏡像（スーツ男性）と明確に差別化。ロングヘア＋ワンピース
function buildVisitor(){
  const g=new THREE.Group();
  const skin=new THREE.MeshStandardMaterial({color:0xe6bd96,roughness:.72});
  const hairM=new THREE.MeshStandardMaterial({color:0x241a12,roughness:.85});
  const dressM=new THREE.MeshStandardMaterial({color:0x9c2b3b,roughness:.7,metalness:.04});  // 深紅のワンピース
  const legM=new THREE.MeshStandardMaterial({color:0x35353c,roughness:.8});
  // 脚
  [-1,1].forEach(s=>{ const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.043,0.038,0.6,10),legM); leg.position.set(s*0.07,0.3,0); g.add(leg); });
  // ワンピース（裾広がり）＋細い上半身
  const dress=new THREE.Mesh(new THREE.CylinderGeometry(0.125,0.26,0.78,18),dressM); dress.position.y=0.95; g.add(dress);
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(0.108,0.135,0.32,16),dressM); torso.position.y=1.35; g.add(torso);
  // 腕
  const armGeo=new THREE.CapsuleGeometry(0.033,0.42,4,8);
  [-1,1].forEach(s=>{ const a=new THREE.Mesh(armGeo,skin); a.position.set(s*0.165,1.29,0.01); a.rotation.z=s*0.06; g.add(a); });
  // 首・頭
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(0.033,0.038,0.07,10),skin); neck.position.y=1.55; g.add(neck);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.103,20,20),skin); head.scale.set(.93,1.12,.97); head.position.y=1.65; g.add(head);
  // ロングヘア（頭頂＋後ろに垂れる）
  const hairTop=new THREE.Mesh(new THREE.SphereGeometry(0.112,20,18,0,Math.PI*2,0,Math.PI*0.66),hairM); hairTop.scale.set(1.05,1.12,1.1); hairTop.position.y=1.66; g.add(hairTop);
  const hairBack=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.082,0.36,14),hairM); hairBack.position.set(0,1.46,-0.07); g.add(hairBack);
  // 目（異変演出用・通常非表示）
  const eyes=new THREE.Group();
  const eyeMat=new THREE.MeshStandardMaterial({color:0xe0483d,emissive:0xe0483d,emissiveIntensity:3});
  const eL=new THREE.Mesh(new THREE.SphereGeometry(0.015,8,8),eyeMat); eL.position.set(-0.038,1.66,0.093);
  const eR=eL.clone(); eR.position.x=0.038; eyes.add(eL,eR); eyes.visible=false; g.add(eyes);
  g.userData.eyes=eyes;
  g.traverse(o=>{ if(o.isMesh) o.frustumCulled=false; if(o.layers) o.layers.set(0); });  // メインカメラに見える
  g.visible=false;
  return g;
}

// 廊下から突進してくる怪異（メインカメラ＝layer0に表示）
function buildCreature(){
  const g=new THREE.Group();
  const dark=new THREE.MeshStandardMaterial({color:0x0d0d11,roughness:1,metalness:0});
  // 痩せて背の高い人影（前傾）
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(0.2,1.15,6,14),dark);body.position.y=1.02;body.rotation.x=0.12;g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.16,20,20),dark);head.scale.set(0.86,1.18,0.9);head.position.set(0,1.82,0.06);g.add(head);
  // 長い腕を前へ伸ばす
  const armGeo=new THREE.CapsuleGeometry(0.055,0.9,5,10);
  [-1,1].forEach(s=>{ const a=new THREE.Mesh(armGeo,dark);a.position.set(s*0.26,1.2,0.22);a.rotation.x=0.7;a.rotation.z=s*0.12;g.add(a);
    const hnd=new THREE.Mesh(new THREE.SphereGeometry(0.06,10,10),dark);hnd.position.set(s*0.33,0.82,0.42);g.add(hnd); });
  // 光る眼（赤・ブルームで発光）
  const eyeMat=new THREE.MeshStandardMaterial({color:0xff2a20,emissive:0xff2a20,emissiveIntensity:7});
  [-0.058,0.058].forEach(x=>{ const e=new THREE.Mesh(new THREE.SphereGeometry(0.026,12,12),eyeMat);e.position.set(x,1.85,0.18);g.add(e); });
  g.visible=false;
  g.traverse(o=>{ if(o.layers) o.layers.set(0); });   // メインカメラに見えるレイヤー
  return g;
}

// 実3D glTF（リグ付き人体）を読み込み、プリミティブと差し替え
function loadFigureModel(pos,rot,epos,erot){
  new GLTFLoader().load('/assets/models/figure.glb', gltf=>{
    const clips = gltf.animations || [];
    hairClipPlane=new THREE.Plane(new THREE.Vector3(0,1,0), -1.66); // この高さより下の髪材質（＝ヒゲ）を切る
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const h = (box.max.y-box.min.y)||1.8, s = 1.78/h;
    const eyeMat=new THREE.MeshStandardMaterial({color:0xe0483d,emissive:0xe0483d,emissiveIntensity:3});
    const build=(p,ry)=>{
      const grp=new THREE.Group();
      const model=skeletonClone(gltf.scene);
      model.scale.setScalar(s);
      // 若い男性へ：髪＋髭の一体メッシュを隠し（＝ヒゲ除去）、肌/シャツを調整
      model.traverse(o=>{ if(o.isMesh&&o.material){
        const ms=Array.isArray(o.material)?o.material:[o.material];
        if(ms.some(mm=>mm.name==='Hair')){ o.visible=false; return; }   // 髪＋眉＋髭の一体メッシュを隠す
        ms.forEach(mm=>{ mm.flatShading=false; mm.transparent=false; mm.opacity=1; mm.depthWrite=true; mm.alphaTest=0; mm.side=THREE.FrontSide; mm.vertexColors=false; mm.needsUpdate=true;
          if(mm.color){
            if(mm.name==='Skin') mm.color.setHex(0xc89868);     // 明るく若々しい肌
            if(mm.name==='TieTexture') mm.color.setHex(0xf0f0f2); // 白シャツ
            if(mm.name==='Details') mm.color.setHex(0x7c2433);    // えんじのネクタイ調
          }
        });
      } });
      const b2=new THREE.Box3().setFromObject(model); model.position.y=-b2.min.y; // 足をy=0に
      grp.add(model);
      // 清潔感のある短髪（キャップ状）＝ヒゲなしで髪あり
      const cap=new THREE.Mesh(new THREE.SphereGeometry(0.12,18,14,0,Math.PI*2,0,Math.PI*0.5), new THREE.MeshStandardMaterial({color:0x20180e,roughness:.9}));
      cap.position.set(0,1.70,0.005); cap.scale.set(1.06,1.0,1.16); grp.add(cap);
      const eyes=new THREE.Group();
      const eL=new THREE.Mesh(new THREE.SphereGeometry(0.024,10,10),eyeMat);eL.position.set(-0.06,1.6,0.13);
      const eR=eL.clone();eR.position.x=0.06; eyes.add(eL,eR); eyes.visible=false; grp.add(eyes);
      grp.userData.eyes=eyes;
      grp.position.copy(p); grp.rotation.y=ry;
      grp.traverse(o=>{ if(o.isMesh) o.frustumCulled=false; if(o.layers) o.layers.set(1); });
      scene.add(grp);
      // idle系アニメがあれば再生（歩行のみのモデルは静止＝自然な立ち姿）
      const idle=clips.find(c=>/idle|stand|breath|pose/i.test(c.name));
      if(idle){ const mx=new THREE.AnimationMixer(model); mx.clipAction(idle).play(); figureMixers.push(mx); }
      return grp;
    };
    [figureGroup,figureExtra].forEach(o=>{ if(o) scene.remove(o); });
    figureMixers=[];
    figureGroup=build(pos,rot);
    figureExtra=build(epos,erot); figureExtra.visible=false;
    applyRoom();
  }, undefined, err=>{ console.warn('figure glTF load failed; using primitive figure', err); });
}

function applyRoom(){
  updatePanel3D();drawDoorTex();drawPoster();drawIndicator();updateFigure();
  if(ceilLight) ceilLight.color.set(room.ceilRed?0xff5038: room.ceilBlue?0x7fb0ff : 0xfff4e0);
  if(lightPanel){ lightPanel.material.color.set(room.ceilRed?0xff5038: room.ceilBlue?0xaecbff :0xffffff); lightPanel.material.emissive.set(room.ceilRed?0xff3020: room.ceilBlue?0x3f73d6 :0xfff2dc); }
  if(wetMesh) wetMesh.visible=room.wet;
}

function ctex(canvas){ const t=new THREE.CanvasTexture(canvas); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; return t; }

function initThree(){
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.localClippingEnabled=true;   // 髭カット用
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=0.6;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  sceneEl.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x141614);
  scene.fog=new THREE.Fog(0x141614,7,18);

  // 環境マップ（屋内反射）
  const pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(new RoomEnvironment(),0.04).texture;
  scene.environmentIntensity=0.16;

  camera=new THREE.PerspectiveCamera(72,1,0.05,100);
  camera.position.set(0,1.5,0.55);camera.rotation.order='YXZ';

  const amb=new THREE.AmbientLight(0xdfe2dc,0.09);scene.add(amb);
  // 天井の大型面光源（影あり）
  ceilLight=new THREE.SpotLight(0xfff2da,6,9,Math.PI/2.1,0.6,1.3);
  ceilLight.position.set(0,H-0.05,0);ceilLight.target.position.set(0,0,-0.2);
  ceilLight.castShadow=true;ceilLight.shadow.mapSize.set(1024,1024);
  ceilLight.shadow.camera.near=0.2;ceilLight.shadow.camera.far=8;ceilLight.shadow.bias=-0.0005;
  scene.add(ceilLight);scene.add(ceilLight.target);
  hallLight=new THREE.PointLight(0xffe6b4,0,13,2);hallLight.position.set(0,2.0,-3.0);scene.add(hallLight);

  drawWall();drawFloor();drawCeilLight();drawAd();
  const wallTex=ctex(WALLC.c);wallTex.wrapS=wallTex.wrapT=THREE.RepeatWrapping;wallTex.repeat.set(1,1);
  const floorTex=ctex(FLR.c);
  doorTex=ctex(DOORC.c);mirrorTex=ctex(MIR.c);posterTex=ctex(POS.c);indicatorTex=ctex(IND.c);ceilTex=ctex(CEIL.c);adTex=ctex(AD.c);

  // PBRテクスチャ（ambientCG CC0）
  const texLoader=new THREE.TextureLoader();
  const loadTex=(url,{srgb=false,rep=[1,1]}={})=>{
    const t=texLoader.load(url);
    t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(rep[0],rep[1]);
    t.colorSpace = srgb?THREE.SRGBColorSpace:THREE.NoColorSpace; t.anisotropy=8;
    return t;
  };
  const wallMat=new THREE.MeshStandardMaterial({map:wallTex,color:0xeef0ea,roughness:.78,metalness:.18,envMapIntensity:.5});
  // 床：ダークブラウンのカーペット（マット・無反射）
  const floorMat=new THREE.MeshStandardMaterial({ map:floorTex, roughness:.98, metalness:0, envMapIntensity:.08 });
  // 金属：Metal032の法線/粗さ/金属マップで実質感、色は明るいステンレスに補正
  const mr=[1,2];
  const steelMat=new THREE.MeshStandardMaterial({
    color:0xdfe3e5,
    normalMap:loadTex('/assets/textures/metal/normal.jpg',{rep:mr}),
    roughnessMap:loadTex('/assets/textures/metal/rough.jpg',{rep:mr}),
    metalnessMap:loadTex('/assets/textures/metal/metal.jpg',{rep:mr}),
    roughness:1, metalness:1, envMapIntensity:1.4,
  });

  const plane=(w,h,mat)=>new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);

  const floor=plane(W,D,floorMat);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const ceil=plane(W,D,wallMat);ceil.rotation.x=Math.PI/2;ceil.position.y=H;scene.add(ceil);
  const back=plane(W,H,wallMat);back.position.set(0,H/2,D/2);back.rotation.y=Math.PI;back.receiveShadow=true;scene.add(back);
  const left=plane(D,H,wallMat);left.position.set(-W/2,H/2,0);left.rotation.y=Math.PI/2;left.receiveShadow=true;scene.add(left);
  const right=plane(D,H,wallMat);right.position.set(W/2,H/2,0);right.rotation.y=-Math.PI/2;right.receiveShadow=true;scene.add(right);

  const fz=-D/2;
  const DHW=0.5, DTOP=2.15;                  // 開口の半幅・高さ（天井近くまで届く高比率ドア）
  const jw=W/2-DHW;                          // 左右の壁セクション幅
  const lintel=plane(W,H-DTOP,wallMat);lintel.position.set(0,(DTOP+H)/2,fz);lintel.receiveShadow=true;scene.add(lintel);
  const ljamb=plane(jw,DTOP,wallMat);ljamb.position.set(-(DHW+jw/2),DTOP/2,fz);ljamb.receiveShadow=true;scene.add(ljamb);
  const rsect=plane(jw,DTOP,wallMat);rsect.position.set(DHW+jw/2,DTOP/2,fz);rsect.receiveShadow=true;scene.add(rsect);

  // ===== ドアの先：マンションの暗い共用廊下（後で異変を追加） =====
  const CW=2.6, CH=2.4, CLEN=5.2, cMid=fz-CLEN/2;
  const corrWallMat=new THREE.MeshStandardMaterial({color:0x55514a,roughness:.96,metalness:.02});
  const corrFloorMat=new THREE.MeshStandardMaterial({color:0x29261f,roughness:.7,metalness:.05});
  const corrCeilMat=new THREE.MeshStandardMaterial({color:0x36312b,roughness:.96});
  const cFloor=plane(CW,CLEN,corrFloorMat);cFloor.rotation.x=-Math.PI/2;cFloor.position.set(0,0.004,cMid);scene.add(cFloor);
  const cCeil=plane(CW,CLEN,corrCeilMat);cCeil.rotation.x=Math.PI/2;cCeil.position.set(0,CH,cMid);scene.add(cCeil);
  const cBack=plane(CW,CH,corrWallMat);cBack.position.set(0,CH/2,fz-CLEN);scene.add(cBack);
  const cLeft=plane(CLEN,CH,corrWallMat);cLeft.position.set(-CW/2,CH/2,cMid);cLeft.rotation.y=Math.PI/2;scene.add(cLeft);
  const cRight=plane(CLEN,CH,corrWallMat);cRight.position.set(CW/2,CH/2,cMid);cRight.rotation.y=-Math.PI/2;scene.add(cRight);
  // 住戸ドア（左右に複数）
  const aptDoorMat=new THREE.MeshStandardMaterial({color:0x47413a,roughness:.7,metalness:.12});
  const aptFrameMat=new THREE.MeshStandardMaterial({color:0x6b665c,roughness:.85});
  const aptDoor=(sx,zz,ry)=>{
    const fr=plane(1.0,2.06,aptFrameMat);fr.position.set(sx,1.03,zz);fr.rotation.y=ry;scene.add(fr);
    const dr=plane(0.86,1.96,aptDoorMat);dr.position.set(sx+(ry>0?0.012:-0.012),1.0,zz);dr.rotation.y=ry;scene.add(dr);
  };
  aptDoor(-CW/2+0.02, fz-1.4, Math.PI/2);  aptDoor(-CW/2+0.02, fz-3.5, Math.PI/2);
  aptDoor(CW/2-0.02,  fz-1.4, -Math.PI/2); aptDoor(CW/2-0.02,  fz-3.5, -Math.PI/2);
  // 薄暗い廊下灯
  const corrLightMat=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffe6b4,emissiveIntensity:0.45});
  [fz-1.7, fz-3.8].forEach(z=>{ const cl=plane(0.55,0.45,corrLightMat);cl.rotation.x=Math.PI/2;cl.position.set(0,CH-0.02,z);scene.add(cl); });

  // 怪異（異変階で「開」を押すと、ここから突進してくる）
  creature=buildCreature();
  creature.userData.startZ=fz-4.0;     // 廊下の奥
  creature.userData.endZ=0.42;          // カメラ直前（z=0.55）
  creature.position.set(0,0,creature.userData.startZ);
  scene.add(creature);

  // 来訪者（女性）：廊下に配置（最初は非表示）
  visitor=buildVisitor();
  visitor.position.copy(VIS_WAIT); visitor.rotation.y=visitorFaceIn;
  scene.add(visitor); visitorPhase='hidden';

  // 扉（2枚・スライド）：壁の奥に置き、開くと袖壁の裏に隠れて室内から見えなくなる
  const doorMat=new THREE.MeshStandardMaterial({map:doorTex,roughness:.55,metalness:.35,envMapIntensity:.6,transparent:true,alphaTest:0,side:THREE.DoubleSide});
  doorL=plane(DHW,2.1,doorMat);doorL.position.set(-DHW/2,1.07,fz-0.05);doorL.castShadow=true;scene.add(doorL);
  doorR=plane(DHW,2.1,doorMat);doorR.position.set(DHW/2,1.07,fz-0.05);doorR.castShadow=true;scene.add(doorR);
  // 控えめなグレーの枠＋敷居（沓摺り）
  const dframeMat=new THREE.MeshStandardMaterial({color:0x7a7f78,roughness:.62,metalness:.35,envMapIntensity:.4});
  const frameT=plane(DHW*2+0.1,0.06,dframeMat);frameT.position.set(0,DTOP,fz+0.015);scene.add(frameT);
  const frameL=plane(0.06,DTOP+0.06,dframeMat);frameL.position.set(-(DHW+0.03),DTOP/2,fz+0.015);scene.add(frameL);
  const frameR=plane(0.06,DTOP+0.06,dframeMat);frameR.position.set(DHW+0.03,DTOP/2,fz+0.015);scene.add(frameR);
  const sill=new THREE.Mesh(new THREE.BoxGeometry(DHW*2+0.1,0.035,0.09),dframeMat);sill.position.set(0,0.02,fz+0.04);scene.add(sill);

  // 操作盤（実3D：立体ボタン・スクリーン）
  buildPanel3D(DHW+jw/2, fz+0.04);

  // ドア上の階数インジケータ（正面視で見える位置）
  const indFrame=plane(0.5,0.24,dframeMat);indFrame.position.set(0,DTOP+0.17,fz+0.01);scene.add(indFrame);
  const indDisp=plane(0.44,0.18,new THREE.MeshBasicMaterial({map:indicatorTex}));indDisp.position.set(0,DTOP+0.17,fz+0.02);scene.add(indDisp);

  // 鏡（背面壁）：実反射＋枠／鏡レイヤーにのみ人影。振り向くと正面で自分が見える
  const MY=1.55, MW=0.92, MH=1.25, MZ=D/2-0.03, mhw=MW/2+0.03, mhh=MH/2+0.03;
  const mframeMat=steelMat;
  const backMirrorM=new Reflector(new THREE.PlaneGeometry(MW,MH),{textureWidth:1024,textureHeight:1024,color:0x8b9197});
  backMirrorM.position.set(0,MY,MZ);backMirrorM.rotation.y=Math.PI;scene.add(backMirrorM);backMirrorM.camera.layers.enableAll();
  const bfTop=plane(MW+0.06,0.05,mframeMat);bfTop.position.set(0,MY+mhh,MZ);bfTop.rotation.y=Math.PI;scene.add(bfTop);
  const bfBot=plane(MW+0.06,0.05,mframeMat);bfBot.position.set(0,MY-mhh,MZ);bfBot.rotation.y=Math.PI;scene.add(bfBot);
  const bfL=plane(0.05,MH+0.06,mframeMat);bfL.position.set(-mhw,MY,MZ);bfL.rotation.y=Math.PI;scene.add(bfL);
  const bfR=plane(0.05,MH+0.06,mframeMat);bfR.position.set(mhw,MY,MZ);bfR.rotation.y=Math.PI;scene.add(bfR);

  // 右側の壁：宣伝ポスター（額装）
  const adF=plane(0.74,1.0,mframeMat);adF.position.set(W/2-0.025,1.5,-0.05);adF.rotation.y=-Math.PI/2;scene.add(adF);
  const adPoster=plane(0.66,0.92,new THREE.MeshStandardMaterial({map:adTex,roughness:.6,metalness:.0}));
  adPoster.position.set(W/2-0.03,1.5,-0.05);adPoster.rotation.y=-Math.PI/2;scene.add(adPoster);

  // 鏡にのみ映る人影（自分の映り込み）：左の鏡に正面を向けて立たせる
  // プレイヤーの分身：カメラと同じ立ち位置（振り向くと背面鏡に正面で映る）
  const FIG_POS=new THREE.Vector3(0,0,0.55), FIG_ROT=0;
  const EXTRA_POS=new THREE.Vector3(0.45,0,0.45), EXTRA_ROT=0;
  figureGroup=buildFigure();figureGroup.position.copy(FIG_POS);figureGroup.rotation.y=FIG_ROT;scene.add(figureGroup);
  figureExtra=buildFigure();figureExtra.position.copy(EXTRA_POS);figureExtra.rotation.y=EXTRA_ROT;figureExtra.visible=false;scene.add(figureExtra);
  // 人影専用の弱いフィル光（鏡で視認しやすく：鏡レイヤーのみ照らす）
  figFill=new THREE.PointLight(0xfff0e0,0.0,3.8,2);figFill.position.set(0.05,1.65,0.4);figFill.layers.set(1);scene.add(figFill);
  // 顔をムラなく照らすソフト光（人物レイヤーのみ・硬い影＝ヒゲ風の陰を消す）
  const figHemi=new THREE.HemisphereLight(0xfff4ea,0xd2c6b2,3.0);figHemi.layers.set(1);figHemi.position.set(0,2.2,0);scene.add(figHemi);
  loadFigureModel(FIG_POS,FIG_ROT,EXTRA_POS,EXTRA_ROT);

  // 掲示（左壁・下、鏡と重ならない位置）
  const posMat=new THREE.MeshStandardMaterial({map:posterTex,roughness:.8});
  const poster=plane(0.44,0.44,posMat);poster.position.set(-W/2+0.02,0.82,0.5);poster.rotation.y=Math.PI/2;scene.add(poster);

  // 手すり（左右・背面）
  const railMat=steelMat;
  const railGeoLR=new THREE.CylinderGeometry(0.022,0.022,D*0.78,16);
  const railL=new THREE.Mesh(railGeoLR,railMat);railL.rotation.x=Math.PI/2;railL.position.set(-W/2+0.05,0.92,0);railL.castShadow=true;scene.add(railL);
  const railR=new THREE.Mesh(railGeoLR,railMat);railR.rotation.x=Math.PI/2;railR.position.set(W/2-0.05,0.92,0);railR.castShadow=true;scene.add(railR);
  const railB=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,W*0.78,16),railMat);railB.rotation.z=Math.PI/2;railB.position.set(0,0.92,D/2-0.05);railB.castShadow=true;scene.add(railB);

  // 天井：小型の埋め込み発光パネル＋濃いグレー枠（密室感）
  const lpW=1.0, lpD=1.2;
  const lightFrame=plane(lpW+0.2,lpD+0.2,new THREE.MeshStandardMaterial({color:0x262826,roughness:.6,metalness:.4}));
  lightFrame.rotation.x=Math.PI/2;lightFrame.position.set(0,H-0.015,-0.05);scene.add(lightFrame);
  lightPanel=plane(lpW,lpD,new THREE.MeshStandardMaterial({map:ceilTex,emissive:0xffffff,emissiveMap:ceilTex,emissiveIntensity:0.9}));
  lightPanel.rotation.x=Math.PI/2;lightPanel.position.set(0,H-0.02,-0.05);scene.add(lightPanel);

  // 床の濡れ
  wetMesh=plane(0.7,0.6,new THREE.MeshStandardMaterial({color:0x0a0a08,roughness:.04,metalness:.2,transparent:true,opacity:.6,envMapIntensity:1.5}));
  wetMesh.rotation.x=-Math.PI/2;wetMesh.position.set(0.05,0.013,0.12);wetMesh.visible=false;scene.add(wetMesh);

  // ポストプロセス（ブルーム）
  composer=new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene,camera));
  const bloom=new UnrealBloomPass(new THREE.Vector2(1,1),0.28,0.4,0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  applyRoom();
  resize();
  renderer.setAnimationLoop(animate);
}

function resize(){
  if(!renderer)return;
  const w=sceneEl.clientWidth,h=sceneEl.clientHeight;
  renderer.setSize(w,h);composer.setSize(w,h);
  const aspect=w/h;
  camera.aspect=aspect;
  // 正面を向いたときエレベーター全面が横に収まるよう、水平視野角を確保（縦長でも適応）
  const targetH=THREE.MathUtils.degToRad(80);            // 望ましい水平視野角
  let vfov=2*Math.atan(Math.tan(targetH/2)/aspect);       // 水平→垂直FOVへ換算
  vfov=THREE.MathUtils.clamp(vfov, THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(90));
  camera.fov=THREE.MathUtils.radToDeg(vfov);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize',resize);

/* 見回し操作（キーボード主・ドラッグも可） */
let yaw=0,pitch=0,dragging=false,lx=0,ly=0;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const applyCam=()=>camera&&camera.rotation.set(pitch,yaw,0);
const hideHint=()=>{ const lh=$('lookhint'); if(lh)lh.style.opacity=0; };
// ドラッグ
sceneEl.addEventListener('pointerdown',e=>{dragging=true;lx=e.clientX;ly=e.clientY;});
window.addEventListener('pointerup',()=>dragging=false);
window.addEventListener('pointermove',e=>{
  if(!dragging||scareActive)return;
  yaw=yaw+(e.clientX-lx)*0.005;   // ドラッグは上下左右反転（キーボードは現状維持）
  pitch=clamp(pitch+(e.clientY-ly)*0.005,-0.55,0.5);
  lx=e.clientX;ly=e.clientY;applyCam();hideHint();
});
// キーボード
const keys={};
window.addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();
  if(['arrowleft','arrowright','arrowup','arrowdown',' '].includes(k)) e.preventDefault();
  keys[k]=true; hideHint();
  if(k==='z'||k==='o') judge(true);   // 開（降りて進む）
  if(k==='x'||k==='c') judge(false);  // 閉（やり過ごす）
  if(k==='enter'){ if(getComputedStyle($('startScreen')).display!=='none') $('btnStart').click(); else if(getComputedStyle($('overlay')).display!=='none') $('btnRetry').click(); }
});
window.addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; });
function keyLook(){
  if(scareActive) return;
  const s=0.03; let moved=false;
  if(keys['arrowleft']||keys['a']){ yaw+=s; moved=true; }   // 360°自由回転
  if(keys['arrowright']||keys['d']){ yaw-=s; moved=true; }
  if(keys['arrowup']||keys['w']){ pitch=clamp(pitch+s,-0.55,0.5); moved=true; }
  if(keys['arrowdown']||keys['s']){ pitch=clamp(pitch-s,-0.55,0.5); moved=true; }
  if(moved) applyCam();
}

/* ループ */
let blinkOn=false,blinkT=0,lastEmg=false;
function animate(){
  const t=performance.now()/1000;
  const dt=figClock.getDelta();
  if(figureMixers.length) figureMixers.forEach(m=>m.update(dt));
  keyLook();
  // 鏡の人物を視点(yaw)に追従させる＝本物の鏡のように一緒に動く
  if(figureGroup){
    figureGroup.rotation.y = yaw + Math.PI;
    figFill.position.set(figureGroup.position.x - 0.5*Math.sin(yaw), 1.55, figureGroup.position.z - 0.5*Math.cos(yaw));
  }
  doorL.position.x += ((-0.25 - doorTarget*0.5) - doorL.position.x)*0.09;
  doorR.position.x += (( 0.25 + doorTarget*0.5) - doorR.position.x)*0.09;
  ceilLight.intensity += (lightLevel*4.5 - ceilLight.intensity)*0.08;
  lightPanel.material.emissiveIntensity += (lightLevel*0.62 - lightPanel.material.emissiveIntensity)*0.08;
  // 異変：天井灯のチラつき（不規則に暗転）
  if(room.ceilFlicker){ const drop=(Math.random()<0.18)||(Math.sin(t*47)<-0.5); ceilLight.intensity=lightLevel*4.5*(drop?0.12:1); lightPanel.material.emissiveIntensity=lightLevel*0.62*(drop?0.1:1); }
  hallLight.intensity += ((doorTarget>0.5?2.8:0) - hallLight.intensity)*0.05;
  if(room.emgAlert){ if(t-blinkT>0.4){blinkOn=!blinkOn;blinkT=t;updatePanel3D();} }
  else if(lastEmg){ blinkOn=false; updatePanel3D(); }
  lastEmg=room.emgAlert;
  // ⑤ 怪異が襲ってくる（来訪者の位置→カメラ手前へ。顔が目線(1.5)に来る高さ・等身大）
  if(scareActive){
    const e=performance.now()/1000 - scareT0;
    const p=clamp(e/0.82,0,1), ease=p*p;           // 加速しながら接近
    creature.position.x = THREE.MathUtils.lerp(VIS_WAIT.x, 0, ease);
    creature.position.z = THREE.MathUtils.lerp(VIS_WAIT.z, 0.20, ease);
    creature.position.y = THREE.MathUtils.lerp(0, -0.35, ease);   // 近づくほど顔を目線へ下げる
    creature.scale.setScalar(1.0);
    const shake=(0.4+p)*0.045, fp=ease;            // fp: 正面(yaw0,pitch0→0)へ寄る比率
    camera.rotation.set(
      scarePitch0*(1-fp) + Math.sin(e*52)*shake,
      scareYaw0*(1-fp)   + Math.sin(e*43)*shake,
      Math.sin(e*61)*shake*0.55
    );
    ceilLight.intensity = (Math.sin(e*40)>0?1.9:0.55);   // 明滅（真っ暗にはしない）
    if(p>=1 && !scareBlackout){ scareBlackout=true; endScare(); }
  }
  // ① 開・正解：怪異化して迫るが、閉まる扉に阻まれる（廊下に等身大で立つ）
  if(blockedScare){
    const e=performance.now()/1000 - blockedT0;
    const p=clamp(e/0.7,0,1), ease=p*p;
    creature.position.set(VIS_WAIT.x, 0, THREE.MathUtils.lerp(VIS_WAIT.z, -1.5, ease)); // 扉(z=-1.25)の外で停止
    creature.scale.setScalar(1.0);
    ceilLight.intensity = (Math.sin(e*36)>0?1.7:0.7);
    hallLight.intensity = 3.4;   // 廊下を照らし、ガラス越しに怪異のシルエットを見せる
    if(p>=1 && blockedScare){ blockedScare=false; setTimeout(()=>{ if(!scareActive&&!visitorScare) creature.visible=false; }, 260); }
  }
  // ② 来訪者が怪異に連れ去られる（廊下に等身大。閉まる扉越しに見える）
  if(visitorScare){
    const e=performance.now()/1000 - visitorScareT0;
    const p=clamp(e/0.95,0,1), ease=p*p;
    creature.position.set(VIS_WAIT.x, 0, THREE.MathUtils.lerp(VIS_WAIT.z-2.2, VIS_WAIT.z-0.2, ease)); // 背後から迫る
    creature.scale.setScalar(1.05);
    if(visitor){ visitor.position.z = THREE.MathUtils.lerp(VIS_WAIT.z, VIS_WAIT.z-1.1, ease); visitor.position.x = VIS_WAIT.x + Math.sin(e*30)*0.05*p; visitor.rotation.z = Math.sin(e*34)*0.2*p; }
    ceilLight.intensity = (Math.sin(e*40)>0?1.9:0.5);
    hallLight.intensity = 3.4;   // 廊下を照らし、閉まる扉のガラス越しに惨劇を見せる
    if(p>=1 && !scareBlackout){ scareBlackout=true; endVisitorScare(); }
  }
  // 下降中の微振動（沈み込む感じ）
  if(descending){ camera.position.y = 1.5 + Math.sin((performance.now()/1000-descendT0)*30)*0.013; }
  else if(camera.position.y!==1.5){ camera.position.y=1.5; }
  // 来訪者の歩行（左から登場／乗り込み／降車）
  if(visitor && (visitorPhase==='arriving'||visitorPhase==='boarding'||visitorPhase==='alighting')){
    const dur = visitorPhase==='arriving' ? 1.1 : 0.95;
    const p=clamp((performance.now()/1000-visitorT0)/dur,0,1);
    if(visitorPhase==='arriving'){ visitor.position.lerpVectors(VIS_ENTER, VIS_WAIT, p); if(p>=1){ visitorPhase='waiting'; visitor.rotation.y=visitorFaceIn; } }
    else if(visitorPhase==='boarding'){ visitor.position.lerpVectors(VIS_WAIT, VIS_ABOARD, p); if(p>=1){ visitorPhase='aboard'; visitor.rotation.y=visitorFaceOut; } }
    else { visitor.position.lerpVectors(VIS_ABOARD, VIS_GONE, p); if(p>=1) visitorHide(); }
    visitor.position.y = Math.abs(Math.sin(p*Math.PI*4))*0.022;   // 軽い歩行の上下動
  }
  composer.render();
}

/* ===================== 異変 ===================== */
const anomalies = [
  { name:'定員人数が違う',          apply(){ room.capacity='定員 9名 / 600kg'; } },
  { name:'定員の重量が違う',        apply(){ room.capacity='定員 8名 / 660kg'; } },
  { name:'鏡の中の人影が消えている',  apply(){ room.figOpacity=0; } },
  { name:'鏡の中の人影が傾いている',  apply(){ room.figTilt=0.22; } },
  { name:'操作ボタンの数が増えている', apply(){ room.btnCount=10; } },
  { name:'操作ボタンが全部光っている', apply(){ room.btnAllOn=true; } },
  { name:'掲示の文字がおかしい',      apply(){ room.posterMode='garbled'; } },
  { name:'掲示が裏返っている',        apply(){ room.posterMode='flipped'; } },
  { name:'天井灯が赤い',            apply(){ room.ceilRed=true; } },
  { name:'非常ボタンが点滅している',  apply(){ room.emgAlert=true; } },
  { name:'床が濡れている',          apply(){ room.wet=true; } },
  { name:'階数ボタンが一つ足りない',   apply(){ room.btnCount=7; } },
  { name:'鏡の中だけ、もう一人いる',  wild:true, apply(){ room.figExtra=true; } },
  { name:'人影がこちらを向いて笑っている', wild:true, apply(){ room.figEyes=true; } },
  { name:'行き先が8階になっていない',  apply(){ room.btnLit=5; } },
  { name:'階数表示の矢印が下を向いている', apply(){ room.indDown=true; } },
  { name:'階数表示がありえない階になっている', apply(){ room.indBad=true; } },
  { name:'天井灯がチラついている',     apply(){ room.ceilFlicker=true; } },
  { name:'天井灯が青白く光っている',   apply(){ room.ceilBlue=true; } },
  { name:'掲示が黒く塗り潰されている', apply(){ room.posterMode='blank'; } },
  { name:'到着音がおかしい',          apply(){ room.badChime=true; } },
];
function resetRoomState(){
  room.capacity='定員 8名 / 600kg';room.btnCount=8;room.btnAllOn=false;room.btnLit=0; // 行き先は常に8階（index0='8'）
  room.emgAlert=false;room.figOpacity=0.8;room.figTilt=0;room.figExtra=false;room.figEyes=false;
  room.posterMode='normal';room.cautionHidden=false;room.ceilRed=false;room.wet=false;
  room.indDown=false;room.indBad=false;room.ceilFlicker=false;room.ceilBlue=false;room.badChime=false;
}

/* ===================== 進行 ===================== */
const setButtons=on=>{ $('btnExit').disabled=!on; $('btnStay').disabled=!on; };
const openDoors=()=>{ doorTarget=1; doorMotor(); };
const closeDoors=()=>{ doorTarget=0; doorMotor(); };

// 来訪者の状態遷移
function visitorWait(){ if(!visitor)return; visitor.position.copy(VIS_ENTER); visitor.rotation.set(0,visitorFaceWalk,0); visitor.visible=true; visitorPhase='arriving'; visitorT0=performance.now()/1000; }
function visitorBoard(){ if(!visitor)return; visitor.rotation.y=visitorFaceIn; visitor.visible=true; visitorPhase='boarding'; visitorT0=performance.now()/1000; }
function visitorAlight(){ if(!visitor||visitorPhase!=='aboard')return; visitor.rotation.y=visitorFaceOut; visitorPhase='alighting'; visitorT0=performance.now()/1000; }
function visitorHide(){ if(!visitor)return; visitor.visible=false; visitorPhase='hidden'; }

function nextFloor(skipIntro){
  state.locked=true; setButtons(false);
  resetRoomState();
  state.anomalyActive = Math.random()<0.7;   // 異変の出現率（0.7＝70%）
  if(state.anomalyActive){ const a=anomalies[Math.floor(Math.random()*anomalies.length)]; state.currentAnomaly=a; a.apply(); }
  else state.currentAnomaly=null;
  applyRoom();
  if(!skipIntro){ lightLevel=0.55; moveSound(); }   // 既に下降演出で到着済みなら移動音は省く
  const delay = skipIntro ? 200 : 900;
  setTimeout(()=>{
    const fn=floorName(state.floor);
    room.panelFloor=fn; drawIndicator();
    lightLevel=1;
    // 到着音：異音は「到着音がおかしい」異変のときだけ（＝音が違う⟺異変）。それ以外は常に正常音
    if(room.badChime){ (Math.random()<0.5?()=>ding('dissonant'):()=>ding('reverse'))(); }
    else ding('normal');
    openDoors();
    // 乗っていた来訪者は降車 → 入れ替わりで、この階の新しい来訪者が待つ
    if(visitorPhase==='aboard'){ visitorAlight(); setTimeout(visitorWait, 1050); }
    else visitorWait();
  },delay);
  setTimeout(()=>{ state.locked=false; setButtons(true); }, delay+1200);
}

function judge(playerSaysExit){
  if(state.locked) return;
  state.locked=true; setButtons(false);
  const correct = playerSaysExit ? !state.anomalyActive : state.anomalyActive;
  const flash=$('flash');
  if(correct){
    state.floor++;
    flash.style.background='#3ec46d';flash.animate([{opacity:.28},{opacity:0}],{duration:320});
    if(playerSaysExit){
      // 開・正解：普通の来訪者を受け入れて同乗 → 次の階で一緒に降りる
      visitorBoard();
      setTimeout(closeDoors, 1050);
      if(state.floor>=TARGET){ setTimeout(win,1750); return; }
      setTimeout(()=>nextFloor(),1750);
    } else {
      // 閉・正解：異変ありを締め出す → 来訪者が怪異化して迫るが、閉まる扉に阻まれる
      closeDoors();
      blockedLunge();
      if(state.floor>=TARGET){ setTimeout(win,2000); return; }
      setTimeout(()=>nextFloor(),2000);
    }
  } else if(state.anomalyActive && playerSaysExit){
    // 異変があるのに「開」＝閉めなかった → 扉の外から怪異が突進してくる
    creatureAttack();
  } else {
    // 異変が無いのに「閉」＝普通の住人を締め出した → 外の来訪者が怪異に襲われ失敗
    visitorTaken();
  }
}

// 来訪者見殺し：閉じた扉の外で、待っていた来訪者が怪異に連れ去られる → 失敗
function visitorTaken(){
  state.miss++; $('missCount').textContent=state.miss;
  if(visitorPhase==='hidden'||!visitor){ // 念のため来訪者がいない場合
    visitorScare=false; setTimeout(showVisitorLost,400); return;
  }
  // 来訪者は廊下の待機位置で固定し、背後の闇から怪異が迫る
  visitor.position.copy(VIS_WAIT); visitor.rotation.set(0,visitorFaceIn,0); visitor.visible=true; visitorPhase='taken';
  visitorScare=true; scareBlackout=false; visitorScareT0=performance.now()/1000;
  closeDoors();                 // 扉が閉まる → 隙間とガラス越しに惨劇が見える
  creature.scale.setScalar(1.05); creature.visible=true;
  screech();
}
// 開・正解：来訪者が怪異化して迫るが、閉まる扉に阻まれて乗り込めない
function blockedLunge(){
  if(visitor) visitorHide();
  creature.position.set(VIS_WAIT.x,0,VIS_WAIT.z); creature.scale.setScalar(1.0); creature.visible=true; creature.rotation.z=0;
  blockedScare=true; blockedT0=performance.now()/1000;
  screech();
}
function endVisitorScare(){
  const flash=$('flash');
  flash.style.background='#000'; flash.style.opacity='1';
  setTimeout(()=>{
    visitorScare=false; creature.visible=false;
    if(visitor){ visitor.visible=false; visitor.rotation.z=0; } visitorPhase='hidden';
    flash.style.opacity='0';
    showVisitorLost();
  },200);
}
function showVisitorLost(){
  const reached=floorName(state.floor);
  $('ovTitle').textContent='見殺し'; $('ovTitle').className='rbadge bad';
  $('ovBig').textContent=reached;
  $('ovText').innerHTML="あなたが見捨てた誰かが、闇へ連れ去られた。<br>到達 <b style='color:#ffcf5a'>"+reached+"</b>／見落とし <b style='color:var(--red)'>"+state.miss+"</b>。";
  $('ovHint').textContent='救えなかった。スクショ＆「#8階の異変」でシェア';
  shareText='『8階の異変』'+reached+'で、住人を見殺しにしてしまった…。あなたは救える？ #8階の異変';
  showResult();
  state.floor=0;
}

// 間違って閉じた：扉が閉まり、階数表示が落ちながらB1まで下降して再開
function missDescend(){
  visitorHide();
  state.miss++; $('missCount').textContent=state.miss;
  const flash=$('flash');
  flash.style.background='#e0483d'; flash.animate([{opacity:.32},{opacity:0}],{duration:380});
  closeDoors(); errorSound();
  const from=state.floor;
  if(from<=0){ state.floor=0; setTimeout(()=>nextFloor(true),1000); return; }   // 既にB1
  // 扉が閉まりきってから下降開始
  setTimeout(()=>{
    descending=true; descendT0=performance.now()/1000;
    lightLevel=0.6; moveSound();
    let f=from;
    const stepMs=clamp(1500/from, 200, 420);   // 階数が多いほど速く刻む
    const tick=()=>{
      f--;
      room.panelFloor=floorName(Math.max(f,0)); drawIndicator();
      tone(200-(from-f)*6,0.1,'sine',0.05,0,0.2);     // 階を通過するかすかな音
      if(f>0){ setTimeout(tick, stepMs); }
      else {                                           // B1到着
        descending=false; lightLevel=1;
        state.floor=0; setTimeout(()=>nextFloor(true), 650);
      }
    };
    setTimeout(tick, 360);
  }, 640);
}

// 怪異襲来：扉は開けたまま、廊下の奥から突進 → 暗転 → ゲームオーバー
// 異変あり×「開」＝招き入れた来訪者が怪異に姿を変えて襲ってくる
function creatureAttack(){
  state.miss++; $('missCount').textContent=state.miss;
  scareActive=true; scareBlackout=false; scareT0=performance.now()/1000;
  scareYaw0=yaw; scarePitch0=pitch;
  doorTarget=1;                                  // 扉は開いたまま（入ってくる）
  visitorHide();                                 // 来訪者が消え…
  creature.position.set(VIS_WAIT.x,0,VIS_WAIT.z); // …同じ位置に怪異が現れる（＝姿を変える）
  creature.scale.setScalar(1); creature.visible=true;
  screech();
}
function endScare(){
  const flash=$('flash');
  flash.style.background='#000'; flash.style.opacity='1';   // 暗転
  setTimeout(()=>{
    scareActive=false; creature.visible=false;
    flash.style.opacity='0';
    showCaught();
  },200);
}
let shareText='';
function showResult(){ $('overlay').style.display='flex'; }
function showCaught(){
  const reached=floorName(state.floor);
  $('ovTitle').textContent='GAME OVER'; $('ovTitle').className='rbadge bad';
  $('ovBig').textContent=reached;
  $('ovText').innerHTML="あなたは異変を見抜けず、闇に連れ込まれた。<br>到達 <b style='color:#ffcf5a'>"+reached+"</b>／見落とし <b style='color:var(--red)'>"+state.miss+"</b>。";
  $('ovHint').textContent='悔しい？スクショ＆「#8階の異変」でシェアして仲間を道連れに';
  shareText='『8階の異変』'+reached+'で異変に呑まれた…。あなたは何階まで上がれる？ #8階の異変';
  showResult();
  state.floor=0;
}

function win(){
  $('ovTitle').textContent='CLEAR'; $('ovTitle').className='rbadge good';
  $('ovBig').textContent='8F';
  $('ovText').innerHTML="全8階を見抜いて脱出成功！<br>見落とし <b style='color:var(--red)'>"+state.miss+"</b> 回。";
  $('ovHint').textContent='自慢していい記録。スクショ＆「#8階の異変」でシェアしよう';
  shareText=(state.miss===0?'『8階の異変』ノーミスで全8階クリア！':'『8階の異変』全8階クリア（見落とし'+state.miss+'回）！')+' あなたは8階まで辿り着ける？ #8階の異変';
  showResult();
}

function shareResult(){
  const url=location.href;
  if(navigator.share){ navigator.share({title:'8階の異変', text:shareText, url}).catch(()=>{}); return; }
  window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(shareText)+'&url='+encodeURIComponent(url),'_blank','noopener');
}

function beginGame(){
  ac(); startHum();
  doorTarget=0; yaw=0; pitch=0; applyCam();
  state.floor=0; state.miss=0; $('missCount').textContent=0;
  nextFloor();
}
$('btnStart').onclick=()=>{ $('startScreen').style.display='none'; beginGame(); };
$('btnRetry').onclick=()=>{ $('overlay').style.display='none'; beginGame(); };
$('btnShare').onclick=shareResult;
$('btnExit').onclick=()=>judge(true);
$('btnStay').onclick=()=>judge(false);

initThree();

// 検証用デバッグフック
window.__dbg = {
  state, room,
  setCam:(p,y)=>{ pitch=p; yaw=y; applyCam(); },
  setDoor:(v)=>{ doorTarget=v; },
  refresh:()=>applyRoom(),
  samples:()=>Object.keys(SAMPLES),
  showFig:(on)=>{ figureGroup.traverse(o=>{ if(o.layers){ on?o.layers.enable(0):o.layers.disable(0); } }); },
  cam:()=>({yaw:+yaw.toFixed(2),pitch:+pitch.toFixed(2),rotY:+camera.rotation.y.toFixed(2)}),
  setFig:(x,z,ry)=>{ figureGroup.position.set(x,0,z); figureGroup.rotation.y=ry; },
  figBox:()=>{ const b=new THREE.Box3().setFromObject(figureGroup); return {minY:+b.min.y.toFixed(3),maxY:+b.max.y.toFixed(3)}; },
  setHairClip:(y)=>{ if(hairClipPlane) hairClipPlane.constant=-y; },
  scare:()=>{ state.locked=false; state.anomalyActive=true; creatureAttack(); },
  scareState:()=>({scareActive, vis:creature&&creature.visible, z:creature&&+creature.position.z.toFixed(2)}),
  descend:(f)=>{ state.locked=false; state.anomalyActive=false; state.floor=(f==null?5:f); missDescend(); },
  descendState:()=>({descending, floor:room.panelFloor, miss:state.miss}),
  visWait:()=>visitorWait(), visBoard:()=>visitorBoard(), visAlight:()=>{ visitorPhase='aboard'; visitorAlight(); },
  visState:()=>({phase:visitorPhase, vis:visitor&&visitor.visible, pos:visitor&&visitor.position.toArray().map(n=>+n.toFixed(2)), ry:visitor&&+visitor.rotation.y.toFixed(2)}),
  taken:()=>{ state.locked=false; state.anomalyActive=false; if(visitor){visitor.position.copy(VIS_WAIT);visitor.rotation.set(0,visitorFaceIn,0);visitor.visible=true;visitorPhase='waiting';} visitorTaken(); },
  takenState:()=>({visitorScare, creatureVis:creature&&creature.visible, visPhase:visitorPhase, overlay:getComputedStyle($('overlay')).display, title:$('ovTitle').textContent}),
  lost:()=>{ try{ showVisitorLost(); return 'ok:'+$('overlay').style.display; }catch(e){ return 'ERR:'+String(e); } },
  blocked:()=>{ state.locked=false; if(visitor){visitor.position.copy(VIS_WAIT);visitor.visible=true;visitorPhase='waiting';} closeDoors(); blockedLunge(); },
  creaY:()=>creature&&({y:+creature.position.y.toFixed(2),z:+creature.position.z.toFixed(2),s:+creature.scale.x.toFixed(2),vis:creature.visible}),
  faceTest:()=>{ scareActive=false;visitorScare=false;blockedScare=false; creature.visible=true; creature.position.set(0,-0.35,0.20); creature.scale.setScalar(1.0); creature.rotation.set(0,0,0); pitch=0;yaw=0;applyCam(); ceilLight.intensity=2.0; },
  blockTest:(gap=0.45)=>{ scareActive=false;visitorScare=false;blockedScare=false; if(visitor)visitor.visible=false; creature.visible=true; creature.position.set(0,0,-1.5); creature.scale.setScalar(1.0); creature.rotation.set(0,0,0); doorL.position.x=-0.25-gap*0.5; doorR.position.x=0.25+gap*0.5; doorTarget=gap; hallLight.intensity=3.8; pitch=0.05;yaw=0;applyCam(); },
};
