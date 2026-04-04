const $ = id => document.getElementById(id);
const base = $('base'), live = $('live'), cur = $('cur'), ti = $('ti');
const bctx = base.getContext('2d'), lctx = live.getContext('2d'), cctx = cur.getContext('2d');
const ZH = $('zoom-hud'), TT = $('toast'), BU = $('btn-undo'), BR = $('btn-redo');

const COLORS = ['#363028','#C9A89A','#8FA89A','#8A9BAE','#C4B49A','#A898AE'];
const PEN_W = [2,6,16], ERASER_W = [28,60,110], FONT_SZ = [22,36,60], RDP_EPS = [1.5,3,6];
const MIN_SCALE = 0.05, MAX_SCALE = 20, MIN_D2 = 4;
const dpr = Math.min(window.devicePixelRatio||1, 2);

let vp = {x:0,y:0,scale:1};
let tool='pen', ci=0, wi=0;
let strokes=[], undoStack=[[]], histIdx=0;
let isDrawing=false, drawPts=[];
let spaceDown=false, mousePanning=false, midPanning=false;
let panStart=null, vpAtPanStart=null, rafId=null;
let curSX=-999, curSY=-999;

function resize() {
  const W=innerWidth, H=innerHeight;
  for (const c of [base,live,cur]) {
    c.width=Math.round(W*dpr); c.height=Math.round(H*dpr);
    c.style.width=W+'px'; c.style.height=H+'px';
  }
  scheduleRedraw(); drawCursorAt(curSX,curSY);
}
window.addEventListener('resize', resize);

const s2w = (sx,sy) => ({x:(sx-vp.x)/vp.scale, y:(sy-vp.y)/vp.scale});
const applyVP = ctx => ctx.setTransform(vp.scale*dpr,0,0,vp.scale*dpr,vp.x*dpr,vp.y*dpr);

function setZoom(ns, cx, cy) {
  const rf = ns/vp.scale;
  vp.x = cx-(cx-vp.x)*rf; vp.y = cy-(cy-vp.y)*rf; vp.scale=ns;
  ZH.textContent = Math.round(ns*100)+'%';
}
function zoomAt(factor,cx,cy){ setZoom(Math.max(MIN_SCALE,Math.min(MAX_SCALE,vp.scale*factor)),cx,cy); }

function drawGrid() {
  const W=base.width/dpr, H=base.height/dpr;
  let sp=32;
  while(sp*vp.scale<16) sp*=4;
  while(sp*vp.scale>64) sp/=2;
  const ox=-vp.x/vp.scale, oy=-vp.y/vp.scale;
  const x1=(W-vp.x)/vp.scale, y1=(H-vp.y)/vp.scale;
  const sx=Math.floor(ox/sp)*sp, sy=Math.floor(oy/sp)*sp;
  const r=1/vp.scale;
  bctx.fillStyle='rgba(0,0,0,.08)';
  bctx.beginPath();
  for(let gx=sx;gx<=x1+sp;gx+=sp)
    for(let gy=sy;gy<=y1+sp;gy+=sp)
      bctx.rect(gx-r,gy-r,r*2,r*2);
  bctx.fill();
}

function renderStroke(ctx, s) {
  ctx.save();
  if (s.type==='text') {
    ctx.fillStyle=s.color;
    ctx.font=`${s.fs}px 'Lora',Georgia,serif`;
    s.text.split('\n').forEach((ln,i)=>ctx.fillText(ln,s.x,s.y+i*s.fs*1.35));
  } else if (s.type==='circle') {
    ctx.strokeStyle=s.color; ctx.lineWidth=s.w; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(s.cx,s.cy,s.r,0,Math.PI*2); ctx.stroke();
  } else {
    ctx.strokeStyle=ctx.fillStyle=s.type==='eraser'?'#fff':s.color;
    ctx.lineWidth=s.w; ctx.lineCap='round'; ctx.lineJoin='round';
    const p=s.pts;
    if(!p?.length){ctx.restore();return;}
    if(p.length===1){ctx.beginPath();ctx.arc(p[0].x,p[0].y,s.w/2,0,Math.PI*2);ctx.fill();}
    else{
      ctx.beginPath(); ctx.moveTo(p[0].x,p[0].y);
      for(let i=1;i<p.length-1;i++)
        ctx.quadraticCurveTo(p[i].x,p[i].y,(p[i].x+p[i+1].x)/2,(p[i].y+p[i+1].y)/2);
      ctx.lineTo(p[p.length-1].x,p[p.length-1].y); ctx.stroke();
    }
  }
  ctx.restore();
}

function scheduleRedraw() {
  if(rafId) return;
  rafId=requestAnimationFrame(()=>{rafId=null;redrawBase();});
}
function redrawBase() {
  bctx.setTransform(1,0,0,1,0,0);
  bctx.fillStyle='#fff'; bctx.fillRect(0,0,base.width,base.height);
  applyVP(bctx); drawGrid();
  for(const s of strokes) renderStroke(bctx,s);
}

function drawCursorAt(sx,sy) {
  cctx.setTransform(1,0,0,1,0,0); cctx.clearRect(0,0,cur.width,cur.height);
  if(sx<0||sy<0) return;
  if(tool==='pen'){
    cctx.fillStyle=COLORS[ci];
    cctx.beginPath(); cctx.arc(sx*dpr,sy*dpr,5*dpr,0,Math.PI*2); cctx.fill();
  } else if(tool==='eraser'){
    const r=Math.max(8,ERASER_W[wi]*vp.scale/2);
    cctx.strokeStyle='rgba(80,80,80,.7)'; cctx.lineWidth=1.5*dpr;
    cctx.setLineDash([4*dpr,3*dpr]);
    cctx.beginPath(); cctx.arc(sx*dpr,sy*dpr,r*dpr,0,Math.PI*2); cctx.stroke();
  }
}
const setCursorStyle = t => { live.style.cursor=t==='text'?'text':'none'; };

function rdp(pts,eps) {
  if(pts.length<=2) return pts;
  const a=pts[0], b=pts[pts.length-1];
  const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
  let mx=0, mi=0;
  for(let i=1;i<pts.length-1;i++){
    const d=len2===0?Math.hypot(pts[i].x-a.x,pts[i].y-a.y)
      :Math.abs(dy*pts[i].x-dx*pts[i].y+b.x*a.y-b.y*a.x)/Math.sqrt(len2);
    if(d>mx){mx=d;mi=i;}
  }
  return mx>eps?[...rdp(pts.slice(0,mi+1),eps).slice(0,-1),...rdp(pts.slice(mi),eps)]:[a,b];
}
function simplify(s) {
  if(s.type==='text'||!s.pts||s.pts.length<=2) return s;
  return {...s,pts:rdp(s.pts,s.type==='eraser'?10:(RDP_EPS[PEN_W.indexOf(s.w)]??2))};
}

function detectCircle(pts) {
  const n=pts.length;
  if(n<12) return null;
  let cx=0,cy=0;
  for(const p of pts){cx+=p.x;cy+=p.y;}
  cx/=n; cy/=n;
  let sumD=0,sumD2=0,arcLen=0;
  const d=new Array(n);
  for(let i=0;i<n;i++){
    d[i]=Math.hypot(pts[i].x-cx,pts[i].y-cy); sumD+=d[i];
    if(i) arcLen+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);
  }
  const r=sumD/n;
  if(r<10) return null;
  for(let i=0;i<n;i++) sumD2+=(d[i]-r)**2;
  if(Math.sqrt(sumD2/n)/r>0.26||arcLen<Math.PI*r*1.5) return null;
  if(Math.hypot(pts[0].x-pts[n-1].x,pts[0].y-pts[n-1].y)>r*0.55) return null;
  return {cx,cy,r};
}

function animateCircleSnap(s,onDone) {
  const dur=340,start=performance.now();
  function frame(now) {
    const t=Math.min((now-start)/dur,1);
    const sp=t<0.65?(t/0.65)*1.06:1.06-((t-0.65)/0.35)*0.06;
    lctx.setTransform(1,0,0,1,0,0); lctx.clearRect(0,0,live.width,live.height);
    lctx.save(); applyVP(lctx);
    lctx.translate(s.cx,s.cy); lctx.scale(0.82+0.18*sp,0.82+0.18*sp); lctx.translate(-s.cx,-s.cy);
    lctx.globalAlpha=Math.min(t*4,1); lctx.strokeStyle=s.color; lctx.lineWidth=s.w; lctx.lineCap='round';
    lctx.beginPath(); lctx.arc(s.cx,s.cy,s.r,0,Math.PI*2); lctx.stroke();
    lctx.restore();
    t<1?requestAnimationFrame(frame):onDone();
  }
  requestAnimationFrame(frame);
}

function pushHistory() {
  undoStack=undoStack.slice(0,histIdx+1);
  undoStack.push(JSON.parse(JSON.stringify(strokes)));
  histIdx++; _updBtns();
}
function _updBtns() {
  BU.disabled=histIdx===0; BR.disabled=histIdx===undoStack.length-1;
}

const clearLive = () => { lctx.setTransform(1,0,0,1,0,0); lctx.clearRect(0,0,live.width,live.height); };

function appendLiveSeg(ctx,pts,color,width) {
  const n=pts.length;
  if(n<2) return;
  ctx.strokeStyle=ctx.fillStyle=color;
  ctx.lineWidth=width; ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.beginPath();
  if(n===2){ctx.moveTo(pts[0].x,pts[0].y);ctx.lineTo(pts[1].x,pts[1].y);}
  else{
    const i=n-2,p0=pts[i-1]??pts[i];
    ctx.moveTo((p0.x+pts[i].x)/2,(p0.y+pts[i].y)/2);
    ctx.quadraticCurveTo(pts[i].x,pts[i].y,(pts[i].x+pts[i+1].x)/2,(pts[i].y+pts[i+1].y)/2);
  }
  ctx.stroke();
}

function commitStroke() {
  if(!drawPts.length) return;
  const isE=tool==='eraser', ew=isE?ERASER_W[wi]:PEN_W[wi];
  if(!isE){
    const c=detectCircle(drawPts);
    if(c){
      drawPts=[]; clearLive();
      const s={type:'circle',cx:c.cx,cy:c.cy,r:c.r,color:COLORS[ci],w:ew};
      animateCircleSnap(s,()=>{strokes=[...strokes,s];pushHistory();renderStroke(bctx,s);clearLive();});
      return;
    }
  }
  const s=simplify({type:isE?'eraser':'pen',color:COLORS[ci],w:ew,pts:drawPts});
  strokes=[...strokes,s]; pushHistory();
  if(!isE){renderStroke(bctx,s);clearLive();}
  drawPts=[];
}

function cancelStroke() {
  drawPts=[]; clearLive();
  if(tool==='eraser') scheduleRedraw();
}

function startDraw(sx,sy) {
  isDrawing=true;
  const p=s2w(sx,sy); drawPts=[p];
  const isE=tool==='eraser', ew=isE?ERASER_W[wi]:PEN_W[wi];
  const ctx=isE?bctx:lctx;
  applyVP(ctx);
  ctx.fillStyle=isE?'#fff':COLORS[ci];
  ctx.beginPath(); ctx.arc(p.x,p.y,ew/2,0,Math.PI*2); ctx.fill();
}

function continueDraw(sx,sy) {
  if(!isDrawing) return;
  const p=s2w(sx,sy), last=drawPts[drawPts.length-1];
  const dsx=(p.x-last.x)*vp.scale, dsy=(p.y-last.y)*vp.scale;
  if(dsx*dsx+dsy*dsy<MIN_D2) return;
  drawPts.push(p);
  const isE=tool==='eraser';
  appendLiveSeg(isE?bctx:lctx,drawPts,isE?'#fff':COLORS[ci],isE?ERASER_W[wi]:PEN_W[wi]);
}

const endDraw = () => { if(isDrawing){isDrawing=false;commitStroke();} };

const activePointers = new Map();
let drawingPid=-1, pinchGest=null;

function _pairGest() {
  const it=activePointers.values();
  const a=it.next().value, b=it.next().value;
  if(!b) return null;
  return {mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},dist:Math.hypot(b.x-a.x,b.y-a.y)};
}

live.addEventListener('pointerdown', e=>{
  e.preventDefault();
  live.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const isMouse=e.pointerType==='mouse';
  if(isMouse&&e.button===1){
    if(isDrawing){cancelStroke();drawingPid=-1;}
    midPanning=true;panStart={x:e.clientX,y:e.clientY};vpAtPanStart={...vp};
    live.style.cursor='grabbing';return;
  }
  if(spaceDown&&isMouse&&e.button===0){
    if(isDrawing){cancelStroke();drawingPid=-1;}
    mousePanning=true;panStart={x:e.clientX,y:e.clientY};vpAtPanStart={...vp};
    live.style.cursor='grabbing';return;
  }
  if(activePointers.size>=2){
    if(isDrawing){cancelStroke();drawingPid=-1;}
    pinchGest=_pairGest();return;
  }
  if(pinchGest||(!isMouse&&false)||(isMouse&&e.button!==0)) return;
  if(tool==='text'){openTextInput(e.clientX,e.clientY);return;}
  drawingPid=e.pointerId;
  startDraw(e.clientX,e.clientY);
});

live.addEventListener('pointermove', e=>{
  e.preventDefault();
  if(e.pointerType!=='touch'){curSX=e.clientX;curSY=e.clientY;drawCursorAt(curSX,curSY);}
  if(!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(mousePanning||midPanning){
    vp.x=vpAtPanStart.x+(e.clientX-panStart.x);
    vp.y=vpAtPanStart.y+(e.clientY-panStart.y);
    scheduleRedraw();return;
  }
  if(pinchGest&&activePointers.size>=2){
    const g=_pairGest();if(!g)return;
    const ns=Math.max(MIN_SCALE,Math.min(MAX_SCALE,vp.scale*g.dist/pinchGest.dist));
    const rf=ns/vp.scale;
    vp.x=pinchGest.mid.x-(pinchGest.mid.x-vp.x)*rf+(g.mid.x-pinchGest.mid.x);
    vp.y=pinchGest.mid.y-(pinchGest.mid.y-vp.y)*rf+(g.mid.y-pinchGest.mid.y);
    vp.scale=ns;pinchGest=g;
    ZH.textContent=Math.round(ns*100)+'%';
    scheduleRedraw();
    if(tool==='eraser') drawCursorAt(curSX,curSY);
    return;
  }
  if(isDrawing&&e.pointerId===drawingPid) continueDraw(e.clientX,e.clientY);
});

function _pointerEnd(e) {
  e.preventDefault();
  activePointers.delete(e.pointerId);
  if(mousePanning||midPanning){
    if(!e.buttons||e.button===1){
      mousePanning=midPanning=false;
      live.style.cursor=tool==='text'?'text':'none';
      if(spaceDown) live.style.cursor='grab';
    }
    return;
  }
  if(e.pointerId===drawingPid){drawingPid=-1;endDraw();return;}
  if(activePointers.size<2) pinchGest=null;
}
live.addEventListener('pointerup',_pointerEnd);
live.addEventListener('pointercancel',e=>{
  e.preventDefault();
  activePointers.delete(e.pointerId);
  if(e.pointerId===drawingPid){cancelStroke();drawingPid=-1;}
  if(activePointers.size<2) pinchGest=null;
  mousePanning=midPanning=false;
  live.style.cursor=tool==='text'?'text':'none';
});
live.addEventListener('pointerleave',e=>{
  if(!activePointers.has(e.pointerId)){curSX=-999;curSY=-999;drawCursorAt(-1,-1);}
});

live.addEventListener('wheel',e=>{
  e.preventDefault();
  if(isDrawing) return;
  if(e.ctrlKey||e.metaKey) zoomAt(Math.pow(0.998,e.deltaY),e.clientX,e.clientY);
  else{vp.x-=e.deltaX*1.2;vp.y-=e.deltaY*1.2;ZH.textContent=Math.round(vp.scale*100)+'%';}
  scheduleRedraw();
  if(tool==='eraser'&&curSX>0) drawCursorAt(curSX,curSY);
},{passive:false});

document.addEventListener('keydown',e=>{
  if(ti.style.display==='block') return;
  if(e.code==='Space'&&!spaceDown&&!isDrawing&&!e.repeat){spaceDown=true;e.preventDefault();live.style.cursor='grab';}
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&e.key==='z'){e.preventDefault();BU.click();}
  if(mod&&(e.key==='y'||(e.shiftKey&&e.key==='Z'))){e.preventDefault();BR.click();}
  if(!mod&&!e.shiftKey){
    if(e.key==='p') $('btn-pen').click();
    if(e.key==='t') $('btn-text').click();
    if(e.key==='e') $('btn-eraser').click();
    if(e.key==='0'){vp.x=0;vp.y=0;vp.scale=1;ZH.textContent='100%';scheduleRedraw();}
  }
});
document.addEventListener('keyup',e=>{
  if(e.code==='Space'){spaceDown=false;mousePanning=false;live.style.cursor=tool==='text'?'text':'none';}
});

let _txC=false;
function openTextInput(sx,sy) {
  const p=s2w(sx,sy), fs=FONT_SZ[wi], sfs=fs*vp.scale;
  ti.style.cssText=`display:block;left:${sx}px;top:${sy-sfs*.82}px;font-size:${sfs}px;color:${COLORS[ci]};height:auto;min-height:${sfs*1.35}px`;
  ti.value='';ti.dataset.wx=p.x;ti.dataset.wy=p.y;ti.dataset.fs=fs;ti.dataset.ci=ci;
  ti.focus();
}
ti.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ti.style.display='none';return;}
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();commitText();return;}
  setTimeout(()=>{ti.style.height='auto';ti.style.height=ti.scrollHeight+'px';},0);
});
ti.addEventListener('blur',()=>{if(!_txC)commitText();});
function commitText() {
  if(_txC||ti.style.display==='none') return;
  _txC=true;ti.style.display='none';
  const txt=ti.value.trim();
  if(txt){
    const s={type:'text',text:txt,color:COLORS[+ti.dataset.ci],x:+ti.dataset.wx,y:+ti.dataset.wy,fs:+ti.dataset.fs};
    strokes=[...strokes,s];pushHistory();renderStroke(bctx,s);
  }
  _txC=false;
}

BU.addEventListener('click',()=>{if(histIdx>0){histIdx--;strokes=JSON.parse(JSON.stringify(undoStack[histIdx]));redrawBase();_updBtns();}});
BR.addEventListener('click',()=>{if(histIdx<undoStack.length-1){histIdx++;strokes=JSON.parse(JSON.stringify(undoStack[histIdx]));redrawBase();_updBtns();}});

const TOOL_BTNS = ['pen','text','eraser'].map(t=>$('btn-'+t));
TOOL_BTNS.forEach(btn=>{
  btn.addEventListener('click',()=>{
    TOOL_BTNS.forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    tool=btn.id.slice(4);
    if(ti.style.display==='block') commitText();
    setCursorStyle(tool);
    drawCursorAt(curSX,curSY);
  });
});
const COLOR_BTNS = document.querySelectorAll('.cb');
COLOR_BTNS.forEach((b,i)=>{
  b.addEventListener('click',()=>{
    COLOR_BTNS.forEach(x=>x.classList.remove('on'));
    b.classList.add('on');ci=i;
    if(ti.style.display==='block') ti.style.color=COLORS[i];
    drawCursorAt(curSX,curSY);
  });
});
const WIDTH_BTNS = document.querySelectorAll('.wb');
WIDTH_BTNS.forEach((b,i)=>{
  b.addEventListener('click',()=>{
    WIDTH_BTNS.forEach(x=>x.classList.remove('on'));
    b.classList.add('on');wi=i;
    drawCursorAt(curSX,curSY);
  });
});
$('zoom-hud').addEventListener('click',()=>{
  vp.x=0;vp.y=0;vp.scale=1;ZH.textContent='100%';
  scheduleRedraw();drawCursorAt(curSX,curSY);
});

/* ── Binary codec v2/v3=no-vp  v4/v5=with-vp ── */
function _vw(o,v){v=v>>>0;do{let b=v&127;v>>>=7;o.push(v?b|128:b)}while(v)}
function _zw(o,v){_vw(o,v>=0?v*2:(-v-1)*2+1)}
function _vr(b,p){let v=0,s=0;do{const x=b[p.i++];v|=(x&127)<<s;s+=7;if(!(x&128))break}while(1);return v>>>0}
function _zr(b,p){const v=_vr(b,p);return(v&1)?-((v+1)>>1):v>>1}

function encodeBody(ss,viewport) {
  const out=[];
  if(viewport){
    const su=Math.round(viewport.scale*1000)&0xFFFF;
    out.push(su&255,su>>8);_zw(out,Math.round(viewport.cx));_zw(out,Math.round(viewport.cy));
  }
  out.push(ss.length&255,ss.length>>8);
  for(const s of ss){
    const tc=s.type==='eraser'?1:s.type==='text'?2:s.type==='circle'?3:0;
    const col=Math.max(0,COLORS.indexOf(s.color));
    const wId=s.type==='text'?Math.max(0,FONT_SZ.indexOf(s.fs)):s.type==='eraser'?Math.max(0,ERASER_W.indexOf(s.w)):Math.max(0,PEN_W.indexOf(s.w));
    out.push((tc<<6)|(col<<3)|(wId&3));
    if(s.type==='circle'){_zw(out,Math.round(s.cx));_zw(out,Math.round(s.cy));_vw(out,Math.max(0,Math.round(s.r)));}
    else if(s.type==='text'){
      const x=Math.max(0,Math.min(65535,Math.round(s.x)+32768));
      const y=Math.max(0,Math.min(65535,Math.round(s.y)+32768));
      out.push(x&255,x>>8,y&255,y>>8);
      const tb=new TextEncoder().encode((s.text||'').slice(0,500));
      _vw(out,tb.length);for(const b of tb)out.push(b);
    }else{
      const pts=s.pts||[];
      out.push(pts.length&255,pts.length>>8);
      if(!pts.length)continue;
      const x0=Math.max(0,Math.min(65535,Math.round(pts[0].x)+32768));
      const y0=Math.max(0,Math.min(65535,Math.round(pts[0].y)+32768));
      out.push(x0&255,x0>>8,y0&255,y0>>8);
      let px=Math.round(pts[0].x),py=Math.round(pts[0].y);
      for(let i=1;i<pts.length;i++){
        const x=Math.round(pts[i].x),y=Math.round(pts[i].y);
        _zw(out,x-px);_zw(out,y-py);px=x;py=y;
      }
    }
  }
  return new Uint8Array(out);
}

function decodeBody(bytes,hasVP) {
  const p={i:0};
  let rvp=null;
  if(hasVP){
    const su=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;
    rvp={scale:su/1000,cx:_zr(bytes,p),cy:_zr(bytes,p)};
  }
  const count=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;
  const ss=[];
  for(let si=0;si<count;si++){
    const flags=bytes[p.i++],tc=(flags>>6)&3,col=(flags>>3)&7,wId=flags&3;
    const color=COLORS[Math.min(col,5)];
    const type=tc===1?'eraser':tc===2?'text':tc===3?'circle':'pen';
    if(type==='circle'){
      const cx=_zr(bytes,p),cy=_zr(bytes,p),r=_vr(bytes,p);
      ss.push({type:'circle',cx,cy,r,color,w:PEN_W[wId]||PEN_W[0]});
    }else if(type==='text'){
      const x=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
      const y=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
      const tl=_vr(bytes,p);
      const text=new TextDecoder().decode(bytes.slice(p.i,p.i+tl));p.i+=tl;
      ss.push({type:'text',text,color,x,y,fs:FONT_SZ[wId]||FONT_SZ[0]});
    }else{
      const ptc=bytes[p.i]|(bytes[p.i+1]<<8);p.i+=2;
      const pts=[];
      if(ptc>0){
        let x=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
        let y=(bytes[p.i]|(bytes[p.i+1]<<8))-32768;p.i+=2;
        pts.push({x,y});
        for(let i=1;i<ptc;i++){x+=_zr(bytes,p);y+=_zr(bytes,p);pts.push({x,y});}
      }
      ss.push({type,color,w:type==='eraser'?(ERASER_W[wId]||ERASER_W[0]):(PEN_W[wId]||PEN_W[0]),pts});
    }
  }
  return{strokes:ss,vp:rvp};
}

const toB64u=b=>{let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')};
const fromB64u=s=>{const b=atob(s.replace(/-/g,'+').replace(/_/g,'/'));const r=new Uint8Array(b.length);for(let i=0;i<b.length;i++)r[i]=b.charCodeAt(i);return r};

async function tryDeflate(b){
  if(!('CompressionStream' in window))return{b,v:false};
  try{const cs=new CompressionStream('deflate-raw');const w=cs.writable.getWriter();w.write(b);w.close();const c=new Uint8Array(await new Response(cs.readable).arrayBuffer());return c.length<b.length?{b:c,v:true}:{b,v:false};}catch{return{b,v:false};}
}
async function tryInflate(b){
  if(!('DecompressionStream' in window))return b;
  try{const ds=new DecompressionStream('deflate-raw');const w=ds.writable.getWriter();w.write(b);w.close();return new Uint8Array(await new Response(ds.readable).arrayBuffer());}catch{return b;}
}

async function strokesToHash(ss) {
  const W=innerWidth,H=innerHeight;
  const body=encodeBody(ss,{scale:vp.scale,cx:Math.round((-vp.x+W/2)/vp.scale),cy:Math.round((-vp.y+H/2)/vp.scale)});
  const{b:payload,v:deflated}=await tryDeflate(body);
  const full=new Uint8Array(2+payload.length);
  full[0]=0xAB;full[1]=deflated?5:4;full.set(payload,2);
  return toB64u(full);
}

async function hashToStrokes(hash) {
  try{
    const bytes=fromB64u(hash);
    if(bytes[0]===0xAB){
      const v=bytes[1],hasVP=v===4||v===5;
      let body=bytes.slice(2);
      if(v===3||v===5)body=await tryInflate(body);
      return decodeBody(body,hasVP);
    }
  }catch(e){console.warn('bin:',e);}
  try{
    if(typeof LZString!=='undefined'){
      const json=LZString.decompressFromEncodedURIComponent(hash);
      if(json){
        const CV={'var(--c0)':'#363028','var(--c1)':'#C9A89A','var(--c2)':'#8FA89A','var(--c3)':'#8A9BAE','var(--c4)':'#C4B49A','var(--c5)':'#A898AE'};
        return{strokes:JSON.parse(json).map(s=>({...s,color:CV[s.color]||s.color||COLORS[0]})),vp:null};
      }
    }
  }catch(e){console.warn('lz:',e);}
  return null;
}

$('btn-save').addEventListener('click',async()=>{
  const btn=$('btn-save');btn.disabled=true;btn.style.opacity='.25';
  try{
    const hash=await strokesToHash(strokes);
    const url=location.origin+location.pathname+'#'+hash;
    history.replaceState(null,'','#'+hash);
    await navigator.clipboard.writeText(url).catch(()=>{});
    toast(`Link copied · ${(hash.length*.75/1024).toFixed(1)} KB`);
  }catch(e){console.error(e);toast('Save failed');}
  finally{btn.disabled=false;btn.style.opacity='';}
});

let _tT;
function toast(msg){TT.textContent=msg;TT.classList.add('show');clearTimeout(_tT);_tT=setTimeout(()=>TT.classList.remove('show'),3000);}

function fitContent() {
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
  ZH.textContent=Math.round(vp.scale*100)+'%';
  scheduleRedraw();
}

(async()=>{
  resize();redrawBase();_updBtns();setCursorStyle('pen');
  const h=location.hash.slice(1);
  if(h){
    try{
      const result=await hashToStrokes(h);
      if(result?.strokes?.length){
        strokes=result.strokes;
        undoStack=[[],JSON.parse(JSON.stringify(strokes))];histIdx=1;
        if(result.vp){
          const W=innerWidth,H=innerHeight;
          vp.scale=result.vp.scale;
          vp.x=W/2-result.vp.cx*vp.scale;vp.y=H/2-result.vp.cy*vp.scale;
          ZH.textContent=Math.round(vp.scale*100)+'%';
        }else fitContent();
        redrawBase();_updBtns();
      }
    }catch(e){console.warn('load:',e);}
  }
})();
