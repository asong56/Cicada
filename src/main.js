import InlineWorker from './render.worker.js?worker&inline';

const $ = id => document.getElementById(id);
const base=$('base'),live=$('live'),cur=$('cur'),ti=$('ti');
const lctx=live.getContext('2d'),cctx=cur.getContext('2d');
const ZH=$('zoom-hud'),TT=$('toast'),BU=$('btn-undo'),BR=$('btn-redo');

const COLORS=['#363028','#C9A89A','#8FA89A','#8A9BAE','#C4B49A','#A898AE'];
const PEN_W=[2,6,16],ERASER_W=[28,60,110],FONT_SZ=[22,36,60],RDP_EPS=[1.5,3,6];
const dpr=Math.min(devicePixelRatio||1,2);

let vp={x:0,y:0,scale:1},tool='pen',ci=0,wi=0;
let strokes=[],undoStack=[[]],histIdx=0;
let isDrawing=false,drawPts=[];
let spaceDown=false,mousePanning=false,midPanning=false;
let panStart,vpAtPanStart,rafId;
let curSX=-999,curSY=-999;
// FIX: initialise recordStart immediately so now() is never NaN
let recording=true,replayLog=[],recordStart=performance.now();

// ── Worker (OffscreenCanvas + ESM) ──
const pending=new Map();let sid=0,wk;
{
  const off=base.transferControlToOffscreen();
  wk = new InlineWorker();
  wk.onmessage=({data})=>{
    if(data.type==='simplified'){pending.get(data.id)?.(data.pts);pending.delete(data.id);}
  };
  wk.postMessage({type:'init',canvas:off,dpr,vp:{...vp},strokes:[]},[off]);
}
const wr=(ss,v,sz)=>{const m={type:'update',strokes:ss??strokes,vp:v??{...vp}};if(sz)m.size=sz;wk.postMessage(m);};
// FIX: was {type:'simplify',id,pts,type,w} — duplicate 'type' key meant the stroke-type
//      variable overwrote 'simplify', so the worker never matched the simplify branch,
//      pending promises never resolved, and commitStroke hung forever for any stroke > 2pts.
const ws=(pts,strokeType,w)=>new Promise(r=>{const id=sid++;pending.set(id,r);wk.postMessage({type:'simplify',id,pts,strokeType,w});});

function resize(){
  const W=innerWidth,H=innerHeight,pw=Math.round(W*dpr),ph=Math.round(H*dpr);
  for(const c of[live,cur]){c.width=pw;c.height=ph;c.style.width=W+'px';c.style.height=H+'px';}
  wr();drawCursorAt(curSX,curSY);
}
addEventListener('resize',()=>{wr(null,null,{w:Math.round(innerWidth*dpr),h:Math.round(innerHeight*dpr)});resize();});

const s2w=(sx,sy)=>({x:(sx-vp.x)/vp.scale,y:(sy-vp.y)/vp.scale});
const applyVP=ctx=>ctx.setTransform(vp.scale*dpr,0,0,vp.scale*dpr,vp.x*dpr,vp.y*dpr);
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

function setZoom(ns,cx,cy){const rf=ns/vp.scale;vp.x=cx-(cx-vp.x)*rf;vp.y=cy-(cy-vp.y)*rf;vp.scale=ns;ZH.textContent=Math.round(ns*100)+'%';}
const zoomAt=(f,cx,cy)=>setZoom(clamp(vp.scale*f,.05,20),cx,cy);

// fallback renderStroke (PNG export only — no grid needed)
function renderStroke(ctx,s){
  ctx.save();
  if(s.type==='text'){
    ctx.fillStyle=s.color;ctx.font=`${s.fs}px 'Lora',Georgia,serif`;
    s.text.split('\n').forEach((ln,i)=>ctx.fillText(ln,s.x,s.y+i*s.fs*1.35));
  }else if(s.type==='circle'){
    ctx.strokeStyle=s.color;ctx.lineWidth=s.w;ctx.lineCap='round';
    ctx.beginPath();ctx.arc(s.cx,s.cy,s.r,0,Math.PI*2);ctx.stroke();
  }else{
    ctx.strokeStyle=ctx.fillStyle=s.type==='eraser'?'#fff':s.color;
    ctx.lineWidth=s.w;ctx.lineCap='round';ctx.lineJoin='round';
    const p=s.pts;if(!p?.length){ctx.restore();return;}
    if(p.length===1){ctx.beginPath();ctx.arc(p[0].x,p[0].y,s.w/2,0,Math.PI*2);ctx.fill();}
    else{ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);for(let i=1;i<p.length-1;i++)ctx.quadraticCurveTo(p[i].x,p[i].y,(p[i].x+p[i+1].x)/2,(p[i].y+p[i+1].y)/2);ctx.lineTo(p[p.length-1].x,p[p.length-1].y);ctx.stroke();}
  }
  ctx.restore();
}

function drawCursorAt(sx,sy){
  cctx.setTransform(1,0,0,1,0,0);cctx.clearRect(0,0,cur.width,cur.height);
  if(sx<0)return;
  if(tool==='pen'){cctx.fillStyle=COLORS[ci];cctx.beginPath();cctx.arc(sx*dpr,sy*dpr,5*dpr,0,Math.PI*2);cctx.fill();}
  else if(tool==='eraser'){
    const r=Math.max(8,ERASER_W[wi]*vp.scale/2);
    cctx.strokeStyle='rgba(80,80,80,.7)';cctx.lineWidth=1.5*dpr;cctx.setLineDash([4*dpr,3*dpr]);
    cctx.beginPath();cctx.arc(sx*dpr,sy*dpr,r*dpr,0,Math.PI*2);cctx.stroke();
  }
}
const setCursor=t=>{live.style.cursor=t==='text'?'text':'none';};

function rdp(pts,eps){
  if(pts.length<=2)return pts;
  const a=pts[0],b=pts[pts.length-1],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
  let mx=0,mi=0;
  for(let i=1;i<pts.length-1;i++){
    const d=l2===0?Math.hypot(pts[i].x-a.x,pts[i].y-a.y):Math.abs(dy*pts[i].x-dx*pts[i].y+b.x*a.y-b.y*a.x)/Math.sqrt(l2);
    if(d>mx){mx=d;mi=i;}
  }
  return mx>eps?[...rdp(pts.slice(0,mi+1),eps).slice(0,-1),...rdp(pts.slice(mi),eps)]:[a,b];
}
const simplify=s=>s.pts?.length>2?{...s,pts:rdp(s.pts,s.type==='eraser'?10:(RDP_EPS[PEN_W.indexOf(s.w)]??2))}:s;

function detectCircle(pts){
  const n=pts.length;if(n<12)return null;
  let cx=0,cy=0;for(const p of pts){cx+=p.x;cy+=p.y;}cx/=n;cy/=n;
  let sd=0,sd2=0,arc=0;const d=pts.map(p=>Math.hypot(p.x-cx,p.y-cy));
  d.forEach((v,i)=>{sd+=v;if(i)arc+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);});
  const r=sd/n;if(r<10)return null;
  d.forEach(v=>sd2+=(v-r)**2);
  if(Math.sqrt(sd2/n)/r>.26||arc<Math.PI*r*1.5)return null;
  if(Math.hypot(pts[0].x-pts[n-1].x,pts[0].y-pts[n-1].y)>r*.55)return null;
  return{cx,cy,r};
}

function animateCircleSnap(s,cb){
  const dur=340,t0=performance.now();
  (function frame(now){
    const t=Math.min((now-t0)/dur,1),sp=t<.65?(t/.65)*1.06:1.06-((t-.65)/.35)*.06;
    lctx.setTransform(1,0,0,1,0,0);lctx.clearRect(0,0,live.width,live.height);
    lctx.save();
    applyVP(lctx);lctx.translate(s.cx,s.cy);lctx.scale(.82+.18*sp,.82+.18*sp);lctx.translate(-s.cx,-s.cy);
    // FIX: was setting globalAlpha directly without save/restore — now contained in save/restore block
    lctx.globalAlpha=Math.min(t*4,1);lctx.strokeStyle=s.color;lctx.lineWidth=s.w;lctx.lineCap='round';
    lctx.beginPath();lctx.arc(s.cx,s.cy,s.r,0,Math.PI*2);lctx.stroke();
    lctx.restore();
    t<1?requestAnimationFrame(frame):cb();
  })(t0);
}

function pushHistory(){
  undoStack=undoStack.slice(0,histIdx+1);
  undoStack.push(JSON.parse(JSON.stringify(strokes)));
  histIdx++;_ub();draft.save();
}
const _ub=()=>{BU.disabled=!histIdx;BR.disabled=histIdx===undoStack.length-1;};

// FIX: also reset globalAlpha and compositeOperation so callers don't leak drawing state
const clearLive=()=>{
  lctx.setTransform(1,0,0,1,0,0);
  lctx.clearRect(0,0,live.width,live.height);
  lctx.globalAlpha=1;
  lctx.globalCompositeOperation='source-over';
};

// Incremental segment renderer — expects applyVP already set on ctx, draws only the newest segment
function appendSeg(ctx,pts,color,w){
  const n=pts.length;if(n<2)return;
  ctx.strokeStyle=ctx.fillStyle=color;ctx.lineWidth=w;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();
  if(n===2){ctx.moveTo(pts[0].x,pts[0].y);ctx.lineTo(pts[1].x,pts[1].y);}
  else{const i=n-2,p0=pts[i-1]??pts[i];ctx.moveTo((p0.x+pts[i].x)/2,(p0.y+pts[i].y)/2);ctx.quadraticCurveTo(pts[i].x,pts[i].y,(pts[i].x+pts[i+1].x)/2,(pts[i].y+pts[i+1].y)/2);}
  ctx.stroke();
}

async function commitStroke(){
  if(!drawPts.length)return;
  const isE=tool==='eraser',ew=isE?ERASER_W[wi]:PEN_W[wi];
  if(!isE){
    const c=detectCircle(drawPts);
    if(c){
      drawPts=[];clearLive();
      const s={type:'circle',cx:c.cx,cy:c.cy,r:c.r,color:COLORS[ci],w:ew};
      if(recording)replayLog.push({t:now(),s:JSON.parse(JSON.stringify(s))});
      animateCircleSnap(s,()=>{strokes=[...strokes,s];pushHistory();wr();clearLive();});
      return;
    }
  }
  const raw={type:isE?'eraser':'pen',color:COLORS[ci],w:ew,pts:drawPts};
  const spts=drawPts.length>2?await ws(drawPts,raw.type,ew):null;
  const s=spts?{...raw,pts:spts}:simplify(raw);
  if(recording)replayLog.push({t:now(),s:JSON.parse(JSON.stringify(s))});
  strokes=[...strokes,s];pushHistory();
  // FIX: was `if(!isE)wr()` — eraser strokes never triggered a worker redraw,
  //      so the base canvas stayed unchanged and erasure was invisible.
  wr();
  clearLive();
  drawPts=[];
}

const cancelStroke=()=>{drawPts=[];clearLive();};
const now=()=>performance.now()-recordStart;

function startDraw(sx,sy){
  isDrawing=true;const p=s2w(sx,sy);drawPts=[p];
  const isE=tool==='eraser',ew=isE?ERASER_W[wi]:PEN_W[wi];
  applyVP(lctx);
  lctx.fillStyle=isE?'#fff':COLORS[ci];
  lctx.beginPath();lctx.arc(p.x,p.y,ew/2,0,Math.PI*2);lctx.fill();
}

function continueDraw(sx,sy){
  if(!isDrawing)return;
  const p=s2w(sx,sy),last=drawPts[drawPts.length-1];
  const dx=(p.x-last.x)*vp.scale,dy=(p.y-last.y)*vp.scale;
  if(dx*dx+dy*dy<4)return;
  drawPts.push(p);
  // FIX: re-apply VP each segment — defensive against any state that might have drifted
  applyVP(lctx);
  const isE=tool==='eraser';
  appendSeg(lctx,drawPts,isE?'#fff':COLORS[ci],isE?ERASER_W[wi]:PEN_W[wi]);
}
const endDraw=()=>{if(isDrawing){isDrawing=false;commitStroke();}};

// ── Input ──
const AP=new Map();let dpid=-1,pinch=null;
const _pair=()=>{const[a,b]=[...AP.values()];return b?{mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},dist:Math.hypot(b.x-a.x,b.y-a.y)}:null;};

live.addEventListener('pointerdown',e=>{
  e.preventDefault();live.setPointerCapture(e.pointerId);
  AP.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const m=e.pointerType==='mouse';
  if(m&&e.button===1){if(isDrawing){cancelStroke();dpid=-1;}midPanning=true;panStart={x:e.clientX,y:e.clientY};vpAtPanStart={...vp};live.style.cursor='grabbing';return;}
  if(spaceDown&&m&&!e.button){if(isDrawing){cancelStroke();dpid=-1;}mousePanning=true;panStart={x:e.clientX,y:e.clientY};vpAtPanStart={...vp};live.style.cursor='grabbing';return;}
  if(AP.size>=2){if(isDrawing){cancelStroke();dpid=-1;}pinch=_pair();return;}
  if(pinch||m&&e.button)return;
  if(tool==='text'){openText(e.clientX,e.clientY);return;}
  dpid=e.pointerId;startDraw(e.clientX,e.clientY);
});
live.addEventListener('pointermove',e=>{
  e.preventDefault();
  if(e.pointerType!=='touch'){curSX=e.clientX;curSY=e.clientY;drawCursorAt(curSX,curSY);}
  if(!AP.has(e.pointerId))return;
  AP.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(mousePanning||midPanning){vp.x=vpAtPanStart.x+(e.clientX-panStart.x);vp.y=vpAtPanStart.y+(e.clientY-panStart.y);wr();return;}
  if(pinch&&AP.size>=2){
    const g=_pair();if(!g)return;
    const ns=clamp(vp.scale*g.dist/pinch.dist,.05,20),rf=ns/vp.scale;
    vp.x=pinch.mid.x-(pinch.mid.x-vp.x)*rf+(g.mid.x-pinch.mid.x);
    vp.y=pinch.mid.y-(pinch.mid.y-vp.y)*rf+(g.mid.y-pinch.mid.y);
    vp.scale=ns;pinch=g;ZH.textContent=Math.round(ns*100)+'%';wr();
    if(tool==='eraser')drawCursorAt(curSX,curSY);return;
  }
  if(isDrawing&&e.pointerId===dpid)continueDraw(e.clientX,e.clientY);
});
function _pend(e){
  e.preventDefault();AP.delete(e.pointerId);
  if(mousePanning||midPanning){if(!e.buttons||e.button===1){mousePanning=midPanning=false;live.style.cursor=spaceDown?'grab':tool==='text'?'text':'none';}return;}
  if(e.pointerId===dpid){dpid=-1;endDraw();return;}
  if(AP.size<2)pinch=null;
}
live.addEventListener('pointerup',_pend);
live.addEventListener('pointercancel',e=>{e.preventDefault();AP.delete(e.pointerId);if(e.pointerId===dpid){cancelStroke();dpid=-1;}if(AP.size<2)pinch=null;mousePanning=midPanning=false;live.style.cursor=tool==='text'?'text':'none';});
live.addEventListener('pointerleave',e=>{if(!AP.has(e.pointerId)){curSX=-999;drawCursorAt(-1,-1);}});
live.addEventListener('wheel',e=>{
  e.preventDefault();if(isDrawing)return;
  if(e.ctrlKey||e.metaKey)zoomAt(Math.pow(.998,e.deltaY),e.clientX,e.clientY);
  else{vp.x-=e.deltaX*1.2;vp.y-=e.deltaY*1.2;}
  ZH.textContent=Math.round(vp.scale*100)+'%';
  wr();if(tool==='eraser'&&curSX>0)drawCursorAt(curSX,curSY);
},{passive:false});

document.addEventListener('keydown',e=>{
  if(ti.style.display==='block')return;
  if(e.code==='Space'&&!spaceDown&&!isDrawing&&!e.repeat){spaceDown=true;e.preventDefault();live.style.cursor='grab';}
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&e.key==='z'){e.preventDefault();BU.click();}
  if(mod&&(e.key==='y'||e.shiftKey&&e.key==='Z')){e.preventDefault();BR.click();}
  if(!mod&&!e.shiftKey)({p:()=>$('btn-pen').click(),t:()=>$('btn-text').click(),e:()=>$('btn-eraser').click(),0:()=>{vp={x:0,y:0,scale:1};ZH.textContent='100%';wr();}})[e.key]?.();
});
document.addEventListener('keyup',e=>{if(e.code==='Space'){spaceDown=false;mousePanning=false;live.style.cursor=tool==='text'?'text':'none';}});

BU.addEventListener('click',()=>{if(histIdx>0){histIdx--;strokes=JSON.parse(JSON.stringify(undoStack[histIdx]));wr();_ub();}});
BR.addEventListener('click',()=>{if(histIdx<undoStack.length-1){histIdx++;strokes=JSON.parse(JSON.stringify(undoStack[histIdx]));wr();_ub();}});

['pen','text','eraser'].forEach(t=>{
  $('btn-'+t).addEventListener('click',()=>{
    document.querySelectorAll('.tb[id^=btn-]').forEach(b=>b.classList.remove('on'));
    $('btn-'+t).classList.add('on');tool=t;
    if(ti.style.display==='block')commitText();setCursor(t);drawCursorAt(curSX,curSY);
  });
});
document.querySelectorAll('.cb').forEach((b,i)=>{b.addEventListener('click',()=>{document.querySelectorAll('.cb').forEach(x=>x.classList.remove('on'));b.classList.add('on');ci=i;if(ti.style.display==='block')ti.style.color=COLORS[i];drawCursorAt(curSX,curSY);});});
document.querySelectorAll('.wb').forEach((b,i)=>{b.addEventListener('click',()=>{document.querySelectorAll('.wb').forEach(x=>x.classList.remove('on'));b.classList.add('on');wi=i;drawCursorAt(curSX,curSY);});});
$('zoom-hud').addEventListener('click',()=>{vp={x:0,y:0,scale:1};ZH.textContent='100%';wr();drawCursorAt(curSX,curSY);});

// ── Text tool ──
let _txC=false;
function openText(sx,sy){
  const p=s2w(sx,sy),fs=FONT_SZ[wi],sfs=fs*vp.scale;
  ti.style.cssText=`display:block;left:${sx}px;top:${sy-sfs*.82}px;font-size:${sfs}px;color:${COLORS[ci]};height:auto;min-height:${sfs*1.35}px`;
  ti.value='';ti.dataset.wx=p.x;ti.dataset.wy=p.y;ti.dataset.fs=fs;ti.dataset.ci=ci;ti.focus();
}
ti.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ti.style.display='none';return;}
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();commitText();return;}
  setTimeout(()=>{ti.style.height='auto';ti.style.height=ti.scrollHeight+'px';},0);
});
ti.addEventListener('blur',()=>{if(!_txC)commitText();});
function commitText(){
  if(_txC||ti.style.display==='none')return;_txC=true;ti.style.display='none';
  const txt=ti.value.trim();
  if(txt){
    const s={type:'text',text:txt,color:COLORS[+ti.dataset.ci],x:+ti.dataset.wx,y:+ti.dataset.wy,fs:+ti.dataset.fs};
    if(recording)replayLog.push({t:now(),s:JSON.parse(JSON.stringify(s))});
    strokes=[...strokes,s];pushHistory();wr();
  }
  _txC=false;
}

// ── Binary codec ──
const _vw=(o,v)=>{v>>>=0;do{let b=v&127;v>>>=7;o.push(v?b|128:b)}while(v)};
const _zw=(o,v)=>_vw(o,v>=0?v*2:(-v-1)*2+1);
const _vr=(b,p)=>{let v=0,s=0;do{const x=b[p.i++];v|=(x&127)<<s;s+=7;if(!(x&128))break}while(1);return v>>>0};
const _zr=(b,p)=>{const v=_vr(b,p);return(v&1)?-((v+1)>>1):v>>1};

function _encStroke(o,s){
  const tc=s.type==='eraser'?1:s.type==='text'?2:s.type==='circle'?3:0;
  const col=Math.max(0,COLORS.indexOf(s.color));
  const wId=s.type==='text'?Math.max(0,FONT_SZ.indexOf(s.fs)):s.type==='eraser'?Math.max(0,ERASER_W.indexOf(s.w)):Math.max(0,PEN_W.indexOf(s.w));
  o.push((tc<<6)|(col<<3)|(wId&3));
  if(s.type==='circle'){_zw(o,Math.round(s.cx));_zw(o,Math.round(s.cy));_vw(o,Math.max(0,Math.round(s.r)));}
  else if(s.type==='text'){
    const x=clamp(Math.round(s.x)+32768,0,65535),y=clamp(Math.round(s.y)+32768,0,65535);
    o.push(x&255,x>>8,y&255,y>>8);
    const tb=new TextEncoder().encode((s.text||'').slice(0,500));
    _vw(o,tb.length);for(const b of tb)o.push(b);
  }else{
    const pts=s.pts||[];o.push(pts.length&255,pts.length>>8);
    if(!pts.length)return;
    const x0=clamp(Math.round(pts[0].x)+32768,0,65535),y0=clamp(Math.round(pts[0].y)+32768,0,65535);
    o.push(x0&255,x0>>8,y0&255,y0>>8);
    let px=Math.round(pts[0].x),py=Math.round(pts[0].y);
    for(let i=1;i<pts.length;i++){const x=Math.round(pts[i].x),y=Math.round(pts[i].y);_zw(o,x-px);_zw(o,y-py);px=x;py=y;}
  }
}

function _decStroke(b,p){
  const f=b[p.i++],tc=(f>>6)&3,col=(f>>3)&7,wId=f&3;
  const color=COLORS[Math.min(col,5)];
  const type=tc===1?'eraser':tc===2?'text':tc===3?'circle':'pen';
  if(type==='circle'){const cx=_zr(b,p),cy=_zr(b,p),r=_vr(b,p);return{type:'circle',cx,cy,r,color,w:PEN_W[wId]||PEN_W[0]};}
  if(type==='text'){
    const x=(b[p.i]|(b[p.i+1]<<8))-32768;p.i+=2;const y=(b[p.i]|(b[p.i+1]<<8))-32768;p.i+=2;
    const tl=_vr(b,p);const text=new TextDecoder().decode(b.slice(p.i,p.i+tl));p.i+=tl;
    return{type:'text',text,color,x,y,fs:FONT_SZ[wId]||FONT_SZ[0]};
  }
  const ptc=b[p.i]|(b[p.i+1]<<8);p.i+=2;const pts=[];
  if(ptc>0){let x=(b[p.i]|(b[p.i+1]<<8))-32768;p.i+=2;let y=(b[p.i]|(b[p.i+1]<<8))-32768;p.i+=2;pts.push({x,y});for(let i=1;i<ptc;i++){x+=_zr(b,p);y+=_zr(b,p);pts.push({x,y});}}
  return{type,color,w:type==='eraser'?(ERASER_W[wId]||ERASER_W[0]):(PEN_W[wId]||PEN_W[0]),pts};
}

function encodeBody(ss,vport){
  const o=[];
  if(vport){const su=Math.round(vport.scale*1000)&0xFFFF;o.push(su&255,su>>8);_zw(o,Math.round(vport.cx));_zw(o,Math.round(vport.cy));}
  o.push(ss.length&255,ss.length>>8);for(const s of ss)_encStroke(o,s);return new Uint8Array(o);
}
function encodeReplay(log){
  const o=[];_vw(o,log.length);let pt=0;
  for(const{t,s}of log){_vw(o,Math.round(t-pt));pt=t;_encStroke(o,s);}
  return new Uint8Array(o);
}
function decodeBody(bytes,hasVP){
  const p={i:0};let rvp=null;
  if(hasVP){const su=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;rvp={scale:su/1000,cx:_zr(bytes,p),cy:_zr(bytes,p)};}
  const count=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;
  const ss=[];for(let i=0;i<count;i++)ss.push(_decStroke(bytes,p));
  let log=null;
  if(p.i<bytes.length)try{const n=_vr(bytes,p);const l=[];let t=0;for(let i=0;i<n;i++){t+=_vr(bytes,p);l.push({t,s:_decStroke(bytes,p)});}log=l;}catch{}
  return{strokes:ss,vp:rvp,log};
}

const toB64u=b=>{let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')};
const fromB64u=s=>{const b=atob(s.replace(/-/g,'+').replace(/_/g,'/'));const r=new Uint8Array(b.length);for(let i=0;i<b.length;i++)r[i]=b.charCodeAt(i);return r};

async function compress(bytes){
  if(!('CompressionStream' in window))return{b:bytes,v:0};
  try{
    const cs=new CompressionStream('deflate-raw'),w=cs.writable.getWriter();
    for(let i=0;i<bytes.length;i+=65536)w.write(bytes.subarray(i,i+65536));
    w.close();
    const ch=[],r=cs.readable.getReader();while(1){const{done,value}=await r.read();if(done)break;ch.push(value);}
    const tot=ch.reduce((n,c)=>n+c.length,0),out=new Uint8Array(tot);let off=0;
    for(const c of ch){out.set(c,off);off+=c.length;}
    return out.length<bytes.length?{b:out,v:1}:{b:bytes,v:0};
  }catch{return{b:bytes,v:0};}
}
async function decompress(bytes){
  try{
    const ds=new DecompressionStream('deflate-raw'),w=ds.writable.getWriter();w.write(bytes);w.close();
    const ch=[],r=ds.readable.getReader();while(1){const{done,value}=await r.read();if(done)break;ch.push(value);}
    const tot=ch.reduce((n,c)=>n+c.length,0),out=new Uint8Array(tot);let off=0;
    for(const c of ch){out.set(c,off);off+=c.length;}return out;
  }catch{return bytes;}
}

async function toHash(ss,withReplay){
  const W=innerWidth,H=innerHeight;
  const body=encodeBody(ss,{scale:vp.scale,cx:Math.round((-vp.x+W/2)/vp.scale),cy:Math.round((-vp.y+H/2)/vp.scale)});
  let full=body;
  if(withReplay&&replayLog.length){const rl=encodeReplay(replayLog);full=new Uint8Array(body.length+rl.length);full.set(body);full.set(rl,body.length);}
  const{b:pl,v}=await compress(full);
  const pkg=new Uint8Array(2+pl.length);pkg[0]=0xAB;pkg[1]=v?5:4;pkg.set(pl,2);
  return toB64u(pkg);
}
async function fromHash(hash){
  try{
    const bytes=fromB64u(hash);
    if(bytes[0]===0xAB){const v=bytes[1];let body=bytes.slice(2);if(v===3||v===5)body=await decompress(body);return decodeBody(body,v===4||v===5);}
  }catch(e){console.warn(e);}
  try{
    if(typeof LZString!=='undefined'){const j=LZString.decompressFromEncodedURIComponent(hash);if(j){const CV={'var(--c0)':'#363028','var(--c1)':'#C9A89A','var(--c2)':'#8FA89A','var(--c3)':'#8A9BAE','var(--c4)':'#C4B49A','var(--c5)':'#A898AE'};return{strokes:JSON.parse(j).map(s=>({...s,color:CV[s.color]||s.color||COLORS[0]})),vp:null,log:null};}}
  }catch(e){console.warn(e);}
  return null;
}

// ── Draft (auto-save) ──
const draft={
  KEY:'cicada_draft_v2',
  save(){
    clearTimeout(this._t);
    this._t=setTimeout(async()=>{
      try{
        const ts=('Temporal' in globalThis)?Temporal.Now.instant().epochMilliseconds:Date.now();
        localStorage.setItem(this.KEY,JSON.stringify({hash:await toHash(strokes,false),ts,count:strokes.length}));
      }catch{}
    },1500);
  },
  load(){
    try{
      const raw=localStorage.getItem(this.KEY);
      if(!raw)return null;
      const{hash,ts,count}=JSON.parse(raw);
      if(Date.now()-ts>604800000){this.clear();return null;}
      return{hash,age:Date.now()-ts,count};
    }catch{return null;}
  },
  clear(){localStorage.removeItem(this.KEY);}
};

// ── Replay playback ──
let replayActive=false;
async function playReplay(log){
  if(!log?.length||replayActive)return;
  replayActive=true;const saved=strokes.slice();strokes=[];wr();
  const temp=[],t0=performance.now(),ts=log[0].t;
  await new Promise(r=>{let i=0;(function frame(now){const el=now-t0;while(i<log.length&&log[i].t-ts<=el)temp.push(log[i++].s);strokes=temp.slice();wr();i<log.length?requestAnimationFrame(frame):r();})(t0);});
  strokes=saved;wr();replayActive=false;
}

// ── Share popover ──
function showPopover(btn){
  const ex=$('sp');if(ex){ex.remove();return;}
  const pop=document.createElement('div');pop.id='sp';
  pop.innerHTML='<button id="sp-a">Save as PNG</button><button id="sp-b">Copy SVG</button><button id="sp-c">Copy link</button>';
  document.body.appendChild(pop);
  const r=btn.getBoundingClientRect();
  pop.style.cssText=`position:fixed;z-index:50;bottom:${innerHeight-r.top+8}px;left:${r.left+r.width/2}px;transform:translateX(-50%);background:var(--glass);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);border:.5px solid var(--glass-border);border-radius:14px;padding:6px;display:flex;flex-direction:column;gap:2px;box-shadow:0 4px 28px rgba(0,0,0,.13);animation:fadeIn .18s ease both`;
  // FIX: outside-click listener was never removed when popover was closed via button click (memory leak).
  //      Now removeListener is called in every close path.
  const dismiss=()=>{pop.remove();removeEventListener('pointerdown',outsideClick);};
  const outsideClick=e=>{if(!pop.contains(e.target)&&e.target!==btn)dismiss();};
  setTimeout(()=>addEventListener('pointerdown',outsideClick),10);
  $('sp-a').onclick=()=>{dismiss();savePNG();};
  $('sp-b').onclick=()=>{dismiss();copySVG();};
  $('sp-c').onclick=()=>{dismiss();copyLink();};
}

async function savePNG(){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,pad=40;
  for(const s of strokes){
    if(s.type==='text'){x0=Math.min(x0,s.x);y0=Math.min(y0,s.y-s.fs);x1=Math.max(x1,s.x+400);y1=Math.max(y1,s.y+40);}
    else if(s.type==='circle'){x0=Math.min(x0,s.cx-s.r);y0=Math.min(y0,s.cy-s.r);x1=Math.max(x1,s.cx+s.r);y1=Math.max(y1,s.cy+s.r);}
    else if(s.pts?.length)for(const p of s.pts){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
  }
  if(x0===Infinity){x0=0;y0=0;x1=800;y1=600;}
  const W=x1-x0+pad*2,H=y1-y0+pad*2;
  const oc=new OffscreenCanvas(Math.round(W*2),Math.round(H*2)),octx=oc.getContext('2d');
  octx.scale(2,2);octx.fillStyle='#fff';octx.fillRect(0,0,W,H);octx.translate(-x0+pad,-y0+pad);
  for(const s of strokes)renderStroke(octx,s);
  const blob=await oc.convertToBlob({type:'image/png'});
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:'cicada.png'});
  a.click();URL.revokeObjectURL(a.href);toast('PNG saved');
}

function copySVG(){
  const paths=strokes.map(s=>{
    if(s.type==='pen'||s.type==='eraser'){
      const p=s.pts||[];if(!p.length)return'';
      let d=`M${p[0].x},${p[0].y}`;
      for(let i=1;i<p.length-1;i++)d+=`Q${p[i].x},${p[i].y} ${(p[i].x+p[i+1].x)/2},${(p[i].y+p[i+1].y)/2}`;
      if(p.length>1)d+=`L${p[p.length-1].x},${p[p.length-1].y}`;
      return`<path d="${d}" stroke="${s.type==='eraser'?'#fff':s.color}" stroke-width="${s.w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if(s.type==='circle')return`<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" stroke="${s.color}" stroke-width="${s.w}" fill="none"/>`;
    if(s.type==='text')return`<text x="${s.x}" y="${s.y}" font-size="${s.fs}" fill="${s.color}" font-family="Georgia,serif">${s.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>`;
    return'';
  }).join('');
  navigator.clipboard.writeText(`<svg xmlns="http://www.w3.org/2000/svg" style="background:#fff">${paths}</svg>`).then(()=>toast('SVG copied')).catch(()=>toast('Copy failed'));
}

async function copyLink(){
  const btn=$('btn-save');btn.disabled=true;btn.style.opacity='.25';
  try{
    const hash=await toHash(strokes,recording);
    history.replaceState(null,'','#'+hash);
    await navigator.clipboard.writeText(location.href).catch(()=>{});
    toast(`Link copied · ${(hash.length*.75/1024).toFixed(1)} KB`);
  }catch(e){console.error(e);toast('Save failed');}
  finally{btn.disabled=false;btn.style.opacity='';}
}

$('btn-save').addEventListener('click',()=>showPopover($('btn-save')));

let _tT;
const toast=msg=>{TT.textContent=msg;TT.classList.add('show');clearTimeout(_tT);_tT=setTimeout(()=>TT.classList.remove('show'),3000);};

function fitContent(){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const s of strokes){
    if(s.type==='text'){x0=Math.min(x0,s.x);y0=Math.min(y0,s.y-s.fs);x1=Math.max(x1,s.x+200);y1=Math.max(y1,s.y+20);}
    else if(s.type==='circle'){x0=Math.min(x0,s.cx-s.r);y0=Math.min(y0,s.cy-s.r);x1=Math.max(x1,s.cx+s.r);y1=Math.max(y1,s.cy+s.r);}
    else if(s.pts?.length)for(const p of s.pts){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
  }
  if(x0===Infinity)return;
  const W=innerWidth,H=innerHeight,pad=80;
  vp.scale=Math.min(W/(x1-x0+pad*2),H/(y1-y0+pad*2),1);
  vp.x=(W-(x1-x0+pad*2)*vp.scale)/2-x0*vp.scale+pad*vp.scale;
  vp.y=(H-(y1-y0+pad*2)*vp.scale)/2-y0*vp.scale+pad*vp.scale;
  ZH.textContent=Math.round(vp.scale*100)+'%';wr();
}

document.head.insertAdjacentHTML('beforeend',`<style>
#sp button{display:block;width:100%;padding:9px 18px;border:none;background:transparent;font-size:13px;font-weight:500;text-align:left;cursor:pointer;border-radius:9px;color:var(--label);transition:background .1s}
#sp button:hover{background:var(--fill)}
#btn-record.on{color:#ff3b30;opacity:1}
#toast.show{pointer-events:auto}
</style>`);

// ── Init ──
(async()=>{
  resize();_ub();setCursor('pen');
  $('btn-record').addEventListener('click',()=>{
    recording=!recording;
    $('btn-record').classList.toggle('on',recording);
    toast(recording?'Replay recording on':'Replay recording off');
  });

  const h=location.hash.slice(1);
  if(h){
    const result=await fromHash(h).catch(()=>null);
    if(result?.strokes?.length){
      strokes=result.strokes;undoStack=[[],JSON.parse(JSON.stringify(strokes))];histIdx=1;
      if(result.vp){vp.scale=result.vp.scale;vp.x=innerWidth/2-result.vp.cx*vp.scale;vp.y=innerHeight/2-result.vp.cy*vp.scale;ZH.textContent=Math.round(vp.scale*100)+'%';}
      else fitContent();
      wr();_ub();draft.clear();
      if(result.log?.length)setTimeout(()=>playReplay(result.log),400);
    }
  }else{
    const d=draft.load();
    if(d?.count){
      const age=Math.round(d.age/60000),label=age<60?age+'m ago':Math.round(age/60)+'h ago';
      TT.innerHTML=`Draft from ${label} — <span id="dr" style="text-decoration:underline;cursor:pointer">Restore</span>&ensp;<span id="dd" style="opacity:.6;cursor:pointer">Discard</span>`;
      TT.classList.add('show');
      $('dr').onclick=async()=>{TT.classList.remove('show');const r=await fromHash(d.hash).catch(()=>null);if(r?.strokes?.length){strokes=r.strokes;undoStack=[[],JSON.parse(JSON.stringify(strokes))];histIdx=1;r.vp?(vp.scale=r.vp.scale,vp.x=innerWidth/2-r.vp.cx*vp.scale,vp.y=innerHeight/2-r.vp.cy*vp.scale,ZH.textContent=Math.round(vp.scale*100)+'%'):fitContent();wr();_ub();}};
      $('dd').onclick=()=>{draft.clear();TT.classList.remove('show');};
    }
  }
  recordStart=performance.now();
})();
