/* Selection-only adapter. Audio engine, PCM, playback and persistence are unchanged. */
(function(root){
'use strict';
function boundary(state,target,seconds){
 const {start,end,rate,frames}=state;if(!frames||!Number.isFinite(seconds)||!['start','end'].includes(target))return target==='start'?start:end;
 const low=target==='start'?0:Math.ceil(start*rate-1e-8),high=target==='start'?Math.floor(end*rate+1e-8):frames;
 return Math.max(0,low,Math.min(high,Math.round(seconds*rate)))/rate;
}
function move(state,target,direction){const current=target==='start'?state.start:state.end,next=boundary(state,target,current+direction*.01);return direction*(next-current)>1e-12?next:current;}
const delay=elapsed=>Math.max(35,180*Math.exp(-Math.max(0,elapsed-380)/1200));
const api={boundary,move,delay};if(typeof module==='object'&&module.exports)module.exports=api;
if(!root.document||!root.SoraEditorBridge)return;
const B=root.SoraEditorBridge,byId=id=>document.getElementById(id),buttons=[byId('nudgeMinus'),byId('nudgePlus')];
let target='start',hold=null,gesture=null,typing=false,pointerClickUntil=0;
const state=()=>({start:a,end:b,rate:sr,frames:data?.[0]?.length||0});
const editable=()=>!!data&&!busy&&document.documentElement.dataset.appMode==='edit'&&!byId('editor').hidden&&!document.hidden;
const fmt=t=>t.toFixed(b-a<.001?6:3);
function finishHold(){const h=hold;if(!h)return;hold=null;pointerClickUntil=performance.now()+500;clearTimeout(h.timer);h.node.classList.remove('precision-held');try{if(h.node.hasPointerCapture(h.id))h.node.releasePointerCapture(h.id);}catch{}}
function finishGesture(){const g=gesture;gesture=null;drag=null;if(g?.node)try{if(g.node.hasPointerCapture(g.id))g.node.releasePointerCapture(g.id);}catch{}}
function cancel(){finishHold();finishGesture();}
function pick(next){cancel();target=next;render();}
function lineX(which){const r=byId('track').getBoundingClientRect();return r.left+(which==='start'?a:b)/duration()*byId('track').clientWidth;}
function render(){
 if((hold&&(!editable()||hold.data!==data))||(gesture&&(!editable()||gesture.data!==data||gesture.zoom!==zoom)))cancel();
 const enabled=editable();for(const [id,t]of [['precisionStart','start'],['precisionEnd','end']]){byId(id).disabled=!enabled;byId(id).setAttribute('aria-pressed',String(target===t));}
 buttons.forEach((node,i)=>{node.disabled=!enabled||move(state(),target,i?1:-1)===(target==='start'?a:b);});
 byId('precisionReadout').textContent=data?'開始 '+fmt(a)+' s ／ 終了 '+fmt(b)+' s':'音声を読み込んでください。';
 byId('precisionHint').textContent='1回10ms。長押しで徐々に加速。境界は音声サンプル単位に丸めます。'+(data?'（'+sr.toLocaleString()+' Hz）':'');
 if(!data)return;
 if(!typing){byId('start').value=fmt(a);byId('end').value=fmt(b);}
 const view=byId('scroll').getBoundingClientRect(),base=lineX('start');
 // Visible grips stay on their true boundary. Only invisible hit areas extend outward.
 const edgeLeft=view.left+1,edgeRight=view.right-45;
 const startLeft=Math.max(edgeLeft,Math.min(edgeRight,base-44));
 const endLeft=Math.max(edgeLeft,Math.min(edgeRight,lineX('end')));
 const stacked=base>=view.left-1&&lineX('end')<=view.right+1&&endLeft-startLeft<44;
 byId('selection').classList.toggle('handles-stacked',stacked);byId('track').classList.toggle('handles-edge',stacked);
 for(const [id,t]of [['left','start'],['right','end']]){
  const node=byId(id),x=lineX(t),visible=x>=view.left-1&&x<=view.right+1;
  node.disabled=!enabled;node.style.visibility=visible?'visible':'hidden';node.setAttribute('aria-label',(t==='start'?'選択開始':'選択終了')+'ハンドル '+fmt(t==='start'?a:b)+'秒');
  node.setAttribute('aria-pressed',String(target===t));
  const left=t==='start'?startLeft:endLeft;node.style.left=(left-base)+'px';node.style.setProperty('--precision-mark',(x-left+(t==='start'?(x<view.left+6?0:-5):(x>view.right-6?-5:0)))+'px');node.style.zIndex=target===t?'4':'3';
 }
}
function rangeOnly(){const dur=duration();byId('selection').style.left=a/dur*100+'%';byId('selection').style.width=(b-a)/dur*100+'%';render();}
function reveal(){const scroll=byId('scroll'),x=(target==='start'?a:b)/duration()*byId('track').clientWidth;
 if(x<scroll.scrollLeft+24)scroll.scrollLeft=Math.max(0,x-24);else if(x>scroll.scrollLeft+scroll.clientWidth-24)scroll.scrollLeft=x-scroll.clientWidth+24;
 render();
}
function step(which,direction){if(!editable())return false;const old=which==='start'?a:b,next=move(state(),which,direction);if(next===old)return false;stop();if(which==='start')a=next;else b=next;update();reveal();return true;}
function press(e,direction){
 if(!editable()||e.isPrimary===false||(e.button!==undefined&&e.button!==0))return;e.preventDefault();cancel();
 const h=hold={node:e.currentTarget,id:e.pointerId,which:target,direction,data,started:performance.now(),timer:null};
 try{h.node.setPointerCapture(h.id);}catch{hold=null;return;}
 h.node.classList.add('precision-held');if(!step(h.which,direction)){finishHold();return;}
 function repeat(){if(hold!==h)return;if(!step(h.which,h.direction)){finishHold();return;}if(hold===h)h.timer=setTimeout(repeat,delay(performance.now()-h.started));}
 if(hold===h)h.timer=setTimeout(repeat,380);
}
buttons.forEach((node,i)=>{
 node.onpointerdown=e=>press(e,i?1:-1);
 node.onpointermove=e=>{if(!hold||hold.id!==e.pointerId)return;const r=node.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)finishHold();};
 node.onpointerup=node.onpointercancel=node.onlostpointercapture=finishHold;
 node.addEventListener('click',e=>{e.preventDefault();if(e.detail===0&&performance.now()>=pointerClickUntil){finishHold();step(target,i?1:-1);}});
 for(const type of ['contextmenu','selectstart','dragstart'])node.addEventListener(type,e=>e.preventDefault());
});
byId('precisionStart').onclick=()=>pick('start');byId('precisionEnd').onclick=()=>pick('end');
function point(e,offset=0){return Math.max(0,Math.min(duration(),(e.clientX-offset-byId('track').getBoundingClientRect().left)/byId('track').clientWidth*duration()));}
function down(e,kind){
 if(!editable()||e.isPrimary===false||(e.button!==undefined&&e.button!==0))return;cancel();
 if(kind==='new'&&!selectMode){gesture={kind:'tap',x:e.clientX,t:point(e),id:e.pointerId,data,zoom};drag=gesture;return;}
 e.preventDefault();stop();if(kind!=='new')target=kind==='left'?'start':'end';
 const g=gesture={kind,id:e.pointerId,node:e.currentTarget,data,zoom,offset:kind==='new'?0:e.clientX-lineX(target),t:boundary(state(),'start',point(e))};drag=g;
 try{g.node.setPointerCapture(g.id);}catch{finishGesture();return;}
 if(kind==='new'){g.kind='newPending';g.x=e.clientX;g.y=e.clientY;g.t=Math.round(point(e)*sr)/sr;}update();
}
byId('wave').onpointerdown=e=>down(e,'new');byId('left').onpointerdown=e=>down(e,'left');byId('right').onpointerdown=e=>down(e,'right');
byId('track').onpointermove=e=>{
 const g=gesture;if(!g||g.id!==e.pointerId||g.kind==='tap')return;if(!editable()){cancel();return;}e.preventDefault();if(g.kind==='newPending'){if(Math.hypot(e.clientX-g.x,e.clientY-g.y)<=8)return;g.kind='new';a=b=g.t;}const t=point(e,g.offset);
 if(g.kind==='new'){const q=Math.round(t*sr)/sr;a=Math.min(q,g.t);b=Math.max(q,g.t);}else if(g.kind==='left')a=boundary(state(),'start',t);else b=boundary(state(),'end',t);update();
};
byId('track').onpointerup=e=>{const g=gesture;if(!g||g.id!==e.pointerId)return;if((g.kind==='tap'||g.kind==='newPending')&&Math.abs(e.clientX-g.x)<8){stop();pos=g.t;if(isVideo)byId('video').currentTime=pos;update();}finishGesture();};
byId('track').onpointercancel=finishGesture;byId('track').addEventListener('lostpointercapture',finishGesture);
for(const [id,which]of [['left','start'],['right','end']]){
 byId(id).onclick=()=>pick(which);
 byId(id).onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();cancel();target=which;step(which,e.key==='ArrowLeft'?-1:1);}};
}
for(const [id,which]of [['start','start'],['end','end']]){
 const node=byId(id);node.addEventListener('input',e=>{e.stopImmediatePropagation();if(!editable())return;cancel();stop();target=which;const n=Number(node.value);if(Number.isFinite(n)){if(which==='start')a=boundary(state(),which,n);else b=boundary(state(),which,n);typing=true;try{rangeOnly();}finally{typing=false;}}},true);
 node.onchange=()=>{if(!editable())return;cancel();stop();target=which;const n=Number(node.value)||0;if(which==='start')a=boundary(state(),which,n);else b=boundary(state(),which,n);update();};
}
document.addEventListener('pointerdown',e=>{if((hold&&e.pointerId!==hold.id)||(gesture&&e.pointerId!==gesture.id))cancel();},true);
window.addEventListener('pointerup',e=>{if(hold?.id===e.pointerId)finishHold();},true);
window.addEventListener('pointercancel',cancel,true);
for(const event of ['pagehide','blur','resize','orientationchange'])window.addEventListener(event,cancel);
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')cancel();});
byId('scroll').addEventListener('scroll',render,{passive:true});
B.onChange(render);B.onContext(cancel);
const observer=new MutationObserver(()=>{if(!editable())cancel();render();});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-app-mode']});
render();
})(typeof window==='object'?window:globalThis);
