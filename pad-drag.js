/* Pointer Events long-press sorting. Audio playback and persistence stay with the caller. */
(function(root){
'use strict';
class PadDrag {
 constructor(grid,options={}){
  this.grid=grid;this.o=options;this.g=null;this.blockUntil=0;this.supported=!!root.PointerEvent;
  grid.addEventListener('pointerdown',e=>this.down(e));
  grid.addEventListener('pointermove',e=>this.move(e),{passive:false});
  grid.addEventListener('pointerup',e=>this.up(e));
  grid.addEventListener('pointercancel',()=>this.cancel('操作が中断されました。'));
  grid.addEventListener('lostpointercapture',()=>this.cancel('指の追跡が中断されました。'));
  grid.addEventListener('click',e=>{if(this.g||performance.now()<this.blockUntil||e.target.closest('.ko-drag-handle')){e.preventDefault();e.stopImmediatePropagation();}},true);
  grid.addEventListener('contextmenu',e=>{if(e.target.closest('.ko-drag-handle'))e.preventDefault();});
  document.addEventListener('pointerdown',e=>{if(this.g&&e.pointerId!==this.g.pointerId)this.cancel('複数の指を検出しました。');},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){this.cancel('キャンセルしました。');}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancel('画面が非表示になりました。');});
  for(const event of ['pagehide','blur','resize'])root.addEventListener(event,()=>this.cancel('画面が切り替わりました。'));
 }
 get active(){return !!this.g?.active;}
 cards(){return Array.from(this.grid.children).filter(e=>e.matches('.ko-pad-card'));}
 down(e){
  const handle=e.target.closest('.ko-drag-handle');
  if(!this.supported||!handle||handle.disabled||this.g||e.isPrimary===false||(e.button!==undefined&&e.button!==0)||!this.o.canStart())return;
  const card=handle.closest('.ko-pad-card'),cards=this.cards();if(!card||cards.length<2)return;
  e.preventDefault();
  const g=this.g={pointerId:e.pointerId,handle,card,id:card.dataset.padId,key:this.o.key(),expected:cards.map(c=>c.dataset.padId),x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,active:false,index:0};
  try{handle.setPointerCapture(e.pointerId);}catch{this.g=null;return;}
  handle.classList.add('ko-drag-arming');
  g.timer=setTimeout(()=>{
   if(this.g!==g)return;
   if(!this.o.canStart()||this.o.key()!==g.key||this.cards().map(c=>c.dataset.padId).join()!==g.expected.join()){this.cancel();return;}
   g.active=true;g.card.classList.add('ko-dragging');g.handle.classList.remove('ko-drag-arming');g.handle.setAttribute('aria-grabbed','true');
   g.ghost=document.createElement('div');g.ghost.className='ko-drag-ghost';g.ghost.textContent=g.card.querySelector('strong').textContent;g.ghost.setAttribute('aria-hidden','true');document.body.append(g.ghost);
   this.o.onBegin?.();this.preview();this.tick();
  },380);
 }
 move(e){const g=this.g;if(!g||e.pointerId!==g.pointerId)return;
  g.x=e.clientX;g.y=e.clientY;
  if(!g.active){if(Math.hypot(g.x-g.startX,g.y-g.startY)>10)this.cancel();return;}
  e.preventDefault();if(this.o.key()!==g.key){this.cancel('シーンが変わりました。');return;}this.preview();
 }
 preview(){const g=this.g;if(!g?.active)return;
  const cards=this.cards().filter(c=>c!==g.card);let index=cards.length;
  for(let i=0;i<cards.length;i++){const r=cards[i].getBoundingClientRect();if(g.y<r.top||(g.y<=r.bottom&&g.x<r.left+r.width/2)){index=i;break;}}
  g.index=index;for(const c of this.cards())c.classList.remove('ko-drop-before','ko-drop-after');
  if(index<cards.length)cards[index].classList.add('ko-drop-before');else cards.at(-1)?.classList.add('ko-drop-after');
  const bounds=this.o.bounds?.()||{top:0,bottom:root.innerHeight};
  const top=Math.max(bounds.top+4,Math.min(bounds.bottom-g.ghost.offsetHeight-6,g.y-36));
  g.ghost.style.transform='translate('+Math.max(4,Math.min(root.innerWidth-164,g.x-80))+'px,'+top+'px)';
 }
 tick(time){const g=this.g;if(!g?.active)return;
  const bounds=this.o.bounds?.()||{top:0,bottom:root.innerHeight},edge=64;
  let speed=0;if(g.y<bounds.top+edge)speed=-Math.min(1,(bounds.top+edge-g.y)/edge);else if(g.y>bounds.bottom-edge)speed=Math.min(1,(g.y-bounds.bottom+edge)/edge);
  const dt=Math.min(40,Math.max(0,(time||0)-(g.time||time||0)));g.time=time;
  if(speed){root.scrollBy(0,speed*dt*.65);this.preview();}
  g.raf=root.requestAnimationFrame(t=>this.tick(t));
 }
 up(e){const g=this.g;if(!g||e.pointerId!==g.pointerId)return;
  if(!g.active){this.finish();return;}
  e.preventDefault();g.x=e.clientX;g.y=e.clientY;this.preview();
  if(this.o.key()!==g.key||g.x<0||g.x>root.innerWidth||g.y<0||g.y>root.innerHeight){this.cancel('画面外のためキャンセルしました。');return;}
  const ids=g.expected.filter(id=>id!==g.id);ids.splice(g.index,0,g.id);
  this.finish();if(ids.join()!==g.expected.join())this.o.onCommit?.(g.key,ids,g.expected);else this.o.onCancel?.('順番は変更していません。');
 }
 finish(){const g=this.g;if(!g)return;this.g=null;clearTimeout(g.timer);root.cancelAnimationFrame(g.raf);g.ghost?.remove();
  for(const c of this.cards())c.classList.remove('ko-dragging','ko-drop-before','ko-drop-after');
  g.handle.classList.remove('ko-drag-arming');g.handle.setAttribute('aria-grabbed','false');
  try{if(g.handle.hasPointerCapture(g.pointerId))g.handle.releasePointerCapture(g.pointerId);}catch{}
  this.blockUntil=performance.now()+400;this.o.onEnd?.();
 }
 cancel(reason='並べ替えをキャンセルしました。'){const active=this.active;this.finish();if(active)this.o.onCancel?.(reason);}
}
root.KoedashiPadDrag=PadDrag;
})(window);
