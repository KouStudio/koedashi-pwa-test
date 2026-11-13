/* Simple-screen gesture adapter. PadStore owns order; this class never controls audio. */
(function(root){
'use strict';
class SimpleSort{
 constructor(view){this.v=view;this.grid=document.getElementById('koSimpleGrid');this.enabled=false;this.saving=false;this.blockUntil=0;this.g=null;this.supported=!!root.PointerEvent;
 const original=document.getElementById('koSimpleNotice'),head=document.createElement('div');head.className='simple-sort-head';original.before(head);head.append(original);this.original=original;
 this.status=document.createElement('p');this.status.id='koSimpleSortStatus';this.status.setAttribute('role','status');this.status.hidden=true;head.append(this.status);
 this.toggle=document.createElement('button');this.toggle.id='koSimpleSort';this.toggle.textContent='配置変更';this.toggle.setAttribute('aria-pressed','false');head.append(this.toggle);
 this.toggle.onclick=()=>{if(this.v.locked||this.saving||!this.supported)return;this.cancel();this.enabled=!this.enabled;this.blockUntil=0;this.note('長押しで移動・離すと自動保存（このページ内）');this.v.lock(this.v.locked);};
 this.grid.addEventListener('pointerdown',e=>this.down(e));this.grid.addEventListener('pointermove',e=>this.move(e),{passive:false});this.grid.addEventListener('pointerup',e=>this.up(e));
 this.grid.addEventListener('pointercancel',()=>this.cancel('操作をキャンセルしました。'));this.grid.addEventListener('lostpointercapture',()=>this.cancel('操作をキャンセルしました。'));
 this.grid.addEventListener('click',e=>{if(this.enabled||this.saving||this.g||performance.now()<this.blockUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
 this.grid.addEventListener('contextmenu',e=>{if(this.enabled)e.preventDefault();});this.grid.addEventListener('scroll',()=>this.cancel('表示が移動したためキャンセルしました。'),{passive:true});
 document.addEventListener('pointerdown',e=>{if(this.g&&e.pointerId!==this.g.pointerId)this.cancel('複数の指を検出したためキャンセルしました。');},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancel('キャンセルしました。');});document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancel('画面が非表示になったためキャンセルしました。');});
 for(const event of ['resize','orientationchange','pagehide','blur'])root.addEventListener(event,()=>this.cancel('画面が変わったためキャンセルしました。'));
 const fit=()=>requestAnimationFrame(()=>this.fit());root.addEventListener('resize',fit);root.visualViewport?.addEventListener('resize',fit);if(root.ResizeObserver)new ResizeObserver(fit).observe(this.grid);this.sync();
 }
 key(){return this.v.sceneId+':'+this.v.page;}
 note(text,error=false){this.status.textContent=text;this.status.classList.toggle('rec-error',error);}
 fit(){if(this.v.modeName!=='simple')return;const short=document.documentElement.classList.contains('ko-short'),normal=matchMedia('(max-height:650px)').matches?30:62,extra=short?normal-16:0;document.documentElement.classList.toggle('ko-short',(root.visualViewport?.height||innerHeight)<450||this.grid.clientHeight-extra<210);}
 mode(mode){if(mode!=='simple'){this.cancel();this.enabled=false;}this.sync();requestAnimationFrame(()=>this.fit());}
 sync(){this.grid.classList.toggle('simple-sorting',this.enabled);this.toggle.textContent=this.enabled?'完了':'配置変更';this.toggle.setAttribute('aria-pressed',String(this.enabled));this.toggle.disabled=!!this.v.locked||this.saving||!this.supported;this.toggle.title=this.supported?'配置変更中は音を再生しません':'このブラウザはドラッグ未対応です。通常の声出し画面で並べ替えてください。';this.original.hidden=this.enabled;this.status.hidden=!this.enabled;
 for(const [id,b]of this.v.buttons){b.style.touchAction=this.enabled?'none':'manipulation';b.setAttribute('aria-label',(this.v.pads?.find(p=>p.id===id)?.name||'パッド')+(this.enabled?'を長押しして配置変更':'を先頭から再生'));b.setAttribute('aria-grabbed',String(this.g?.id===id&&this.g.active));}
 }
 down(e){const card=e.target.closest('[data-simple-pad-id]');if(!this.enabled||this.saving||this.v.locked||!card||card.disabled||this.g||e.isPrimary===false||(e.button!==undefined&&e.button!==0))return;
 const visible=[...this.v.buttons.keys()];if(visible.length<2)return;e.preventDefault();
 const expected=this.v.pads.filter(p=>p.sceneId===this.v.sceneId).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)).map(p=>p.id);
 const g=this.g={pointerId:e.pointerId,card,id:card.dataset.simplePadId,key:this.key(),sceneId:this.v.sceneId,page:this.v.page,expected,visible,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,active:false,index:visible.indexOf(card.dataset.simplePadId)};
 try{card.setPointerCapture(e.pointerId);}catch{this.g=null;return;}card.classList.add('simple-sort-arming');
 g.timer=setTimeout(()=>{if(this.g!==g)return;if(!this.enabled||this.v.locked||this.key()!==g.key){this.cancel();return;}g.active=true;card.classList.remove('simple-sort-arming');card.classList.add('simple-sort-dragging');card.setAttribute('aria-grabbed','true');g.ghost=document.createElement('div');g.ghost.className='simple-sort-ghost';g.ghost.textContent=card.querySelector('strong').textContent;g.ghost.setAttribute('aria-hidden','true');document.body.append(g.ghost);this.note('移動中：青い枠の位置へ挿入。画面外で離すとキャンセル。');this.preview();},380);
 }
 move(e){const g=this.g;if(!g||g.pointerId!==e.pointerId)return;g.x=e.clientX;g.y=e.clientY;if(!g.active){if(Math.hypot(g.x-g.startX,g.y-g.startY)>10)this.cancel();return;}e.preventDefault();if(this.key()!==g.key){this.cancel();return;}this.preview();}
 target(){const g=this.g;if(!g)return null;return [...this.grid.children].find(b=>{const r=b.getBoundingClientRect();return g.x>=r.left&&g.x<=r.right&&g.y>=r.top&&g.y<=r.bottom;});}
 preview(){const g=this.g;if(!g?.active)return;for(const b of this.grid.children)b.classList.remove('simple-sort-before','simple-sort-after');const target=this.target();g.valid=!!target;
 if(target){const id=target.dataset.simplePadId,rest=g.visible.filter(id=>id!==g.id);if(id===g.id)g.index=g.visible.indexOf(g.id);else if(!id)g.index=rest.length;else{const r=target.getBoundingClientRect(),after=g.x>=r.left+r.width/2;g.index=rest.indexOf(id)+(after?1:0);}const before=this.v.buttons.get(rest[g.index]);if(before)before.classList.add('simple-sort-before');else this.v.buttons.get(rest.at(-1))?.classList.add('simple-sort-after');}
 g.ghost.style.transform='translate('+Math.max(4,Math.min(innerWidth-144,g.x-70))+'px,'+Math.max(4,Math.min(innerHeight-70,g.y-34))+'px)';
 }
 async up(e){const g=this.g;if(!g||e.pointerId!==g.pointerId)return;if(!g.active){this.cancel();return;}e.preventDefault();g.x=e.clientX;g.y=e.clientY;this.preview();if(!g.valid||g.key!==this.key()){this.cancel('パッド枠の外のためキャンセルしました。');return;}
 const visible=g.visible.filter(id=>id!==g.id);visible.splice(g.index,0,g.id);const ids=g.expected.slice();ids.splice(g.page*16,g.visible.length,...visible);this.finish();if(ids.every((id,i)=>id===g.expected[i])){this.note('順序は変更していません。');return;}
 this.saving=true;this.sync();this.note('配置を保存中…');try{const warning=await this.v.actions.reorder(g.sceneId,ids,g.expected);this.note('配置を保存しました。'+(warning?'保存状態の注意：'+warning:'続けて移動するか「完了」を押してください。'),!!warning);}catch(error){this.note('配置の保存失敗：'+(error.message||String(error))+' 最新の一覧から再度移動してください。',true);}finally{this.saving=false;this.v.lock(this.v.locked);}
 }
 finish(){const g=this.g;if(!g)return;this.g=null;clearTimeout(g.timer);g.ghost?.remove();for(const b of this.grid.children)b.classList.remove('simple-sort-arming','simple-sort-dragging','simple-sort-before','simple-sort-after');g.card.setAttribute('aria-grabbed','false');try{if(g.card.hasPointerCapture(g.pointerId))g.card.releasePointerCapture(g.pointerId);}catch{}this.blockUntil=performance.now()+400;}
 cancel(reason){const active=this.g?.active;this.finish();if(active&&reason)this.note(reason);}
}
root.KoedashiSimpleSort=SimpleSort;
})(window);
