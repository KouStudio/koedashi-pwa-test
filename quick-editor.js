/* Additive editor controls: shared PCM, selection, history, export and pad store. */
(function(){
'use strict';
const by=id=>document.getElementById(id),B=SoraEditorBridge,scroll=by('scroll');scroll.closest('.panel').classList.add('quick-wave-panel');
let quick=false,previewPending=false,previewRequest=0;
function feedback(text,error=false){by('quickFeedback').textContent=text;by('quickFeedback').classList.toggle('rec-error',error);}
function mode(value){cancelGesture();quick=value;document.documentElement.dataset.editorMode=quick?'quick':'detail';by('quickActions').hidden=!quick;by('quickMode').setAttribute('aria-pressed',String(quick));by('detailMode').setAttribute('aria-pressed',String(!quick));scroll.style.touchAction='none';if(data){drawKey=null;update();}sync();}
by('quickMode').onclick=()=>mode(true);by('detailMode').onclick=()=>mode(false);
function sync(){by('zoom').textContent=(Math.round(zoom*100)/100)+'×';const valid=!!data&&!busy,frames=valid?Math.round(b*sr)-Math.round(a*sr):0;by('quickRange').textContent=data?'残す範囲：'+a.toFixed(3)+' ～ '+b.toFixed(3)+' 秒（'+Math.max(0,b-a).toFixed(3)+' 秒）':'音声を開いてください';
 for(const id of ['quickListen','quickSave','quickRegister','quickFit'])by(id).disabled=!valid||(id==='quickListen'&&frames<2)||(id==='quickRegister'&&frames<2);
 by('quickTrim').disabled=!valid||isVideo||frames<2||(a===0&&b===duration());by('quickUndo').disabled=!valid||!undo.length;by('quickMode').disabled=by('detailMode').disabled=busy;
 by('quickListen').textContent=(playing||previewPending)?'■ 試聴を停止':'▶ 範囲を試聴';by('quickListen').setAttribute('aria-pressed',String(playing||previewPending));by('quickLoop').checked=by('loop').checked;
 by('quickHint').textContent=isVideo?'動画の尺を維持するため前後カットは無効です。詳細編集で処理できます。':'前後カットは表示した範囲だけを残します。WAV保存は編集音声全体です。範囲だけ保存する場合は先にカットしてください。';
}
by('quickListen').onclick=async()=>{if(playing||previewPending){previewRequest++;stop();cursor();sync();return;}const request=++previewRequest;previewPending=true;KoedashiPads.stopAll();try{await play(true);if(request!==previewRequest)stop();}finally{previewPending=false;sync();}};
by('quickLoop').onchange=()=>{by('loop').checked=by('quickLoop').checked;if(playing)rangeLoop=by('quickLoop').checked;};
by('quickUndo').onclick=()=>{by('undo').click();feedback('元に戻しました。');sync();};
by('quickSave').onclick=async()=>{await save();feedback(by('status').textContent,by('status').classList.contains('error'));};
by('quickRegister').onclick=async()=>{if(busy)return;const check=by('koRegisterRange'),before=check.checked;check.checked=true;try{await KoedashiPads.registerCurrent();if(document.documentElement.dataset.appMode==='edit')feedback(by('koStatus').textContent,true);}catch(e){feedback(e.message,true);}finally{check.checked=before;sync();}};
by('quickTrim').onclick=async()=>{if(!data||busy||isVideo)return;const i=Math.round(a*sr),j=Math.round(b*sr);if(j-i<2)return;const next=E.range(data,i,j),nextMarks=marks.filter(m=>m>=i/sr&&m<=j/sr).map(m=>m-i/sr);KoedashiPads.stopAll();setBusy(true);try{await commit(next,'選択範囲の前後をカットしました');marks=nextMarks;a=pos=0;b=duration();update();status('選択範囲だけを残しました。「元に戻す」で復元できます。');feedback('選択範囲だけを残しました。「元に戻す」で復元できます。');}catch(e){feedback(memoryError(e),true);}finally{setBusy(false);}};
by('quickFit').onclick=()=>{cancelGesture();if(!data||busy)return;zoom=1;drawKey=null;update();scroll.scrollLeft=0;};
// Capture custom gestures before the selection adapter. Handles keep their original listeners.
const points=new Map();let gesture=null,gestureFrame=null,gestureDocument=null;
const usable=()=>data&&!busy&&document.documentElement.dataset.appMode==='edit'&&!document.hidden;
function cancelGesture(){if(gestureFrame)cancelAnimationFrame(gestureFrame);gestureFrame=null;for(const id of points.keys())try{scroll.releasePointerCapture(id);}catch{}points.clear();gesture=null;gestureDocument=null;}
function pair(){const p=[...points.values()];return {mid:(p[0].x+p[1].x)/2,dist:Math.max(12,Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y))};}
function pinch(){const p=pair(),r=scroll.getBoundingClientRect();gesture={kind:'pinch',zoom,dist:p.dist,anchor:(scroll.scrollLeft+p.mid-r.left)/by('track').clientWidth};}
function flush(){gestureFrame=null;if(!gesture||!usable()||data!==gestureDocument){cancelGesture();return;}if(gesture.kind==='pinch'&&points.size>=2){const p=pair(),r=scroll.getBoundingClientRect();zoom=Math.max(1,Math.min(16,gesture.zoom*p.dist/gesture.dist));drawKey=null;update();scroll.scrollLeft=Math.max(0,Math.min(scroll.scrollWidth-scroll.clientWidth,gesture.anchor*by('track').clientWidth-(p.mid-r.left)));}else if(gesture.kind==='pan'&&points.size===1){const p=[...points.values()][0];scroll.scrollLeft=Math.max(0,Math.min(scroll.scrollWidth-scroll.clientWidth,gesture.left+gesture.x-p.x));}}
scroll.addEventListener('pointerdown',e=>{if(!usable()||e.button!==0||e.target.closest('#left,#right'))return;if(e.pointerType==='mouse')return;
 // Detail range-selection mode retains its single-finger range gesture.
 if(!quick&&selectMode&&points.size===0)return;
 e.preventDefault();e.stopImmediatePropagation();points.set(e.pointerId,{x:e.clientX,y:e.clientY});gestureDocument=data;try{scroll.setPointerCapture(e.pointerId);}catch{cancelGesture();return;}
 if(points.size>2){cancelGesture();return;}if(points.size===1)gesture={kind:'pan',x:e.clientX,left:scroll.scrollLeft};else if(points.size===2){drag=null;pinch();}
},true);
scroll.addEventListener('pointermove',e=>{if(!points.has(e.pointerId))return;e.preventDefault();e.stopImmediatePropagation();points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(!gestureFrame)gestureFrame=requestAnimationFrame(flush);},true);
function up(e){if(!points.has(e.pointerId))return;e.preventDefault();e.stopImmediatePropagation();if(gestureFrame){cancelAnimationFrame(gestureFrame);gestureFrame=null;flush();}points.delete(e.pointerId);if(points.size===1){const p=[...points.values()][0];gesture={kind:'pan',x:p.x,left:scroll.scrollLeft};}else if(!points.size)gesture=null;}
scroll.addEventListener('pointerup',up,true);scroll.addEventListener('pointercancel',cancelGesture,true);scroll.addEventListener('lostpointercapture',e=>{if(points.has(e.pointerId))cancelGesture();});
for(const event of ['blur','pagehide','resize','orientationchange'])window.addEventListener(event,cancelGesture);
document.addEventListener('visibilitychange',()=>{if(document.hidden){previewRequest++;cancelGesture();}});
B.onContext(()=>{previewRequest++;cancelGesture();feedback('');});B.onChange(()=>{if(gestureDocument&&gestureDocument!==data)cancelGesture();sync();});
new MutationObserver(()=>{if(document.documentElement.dataset.appMode!=='edit'){previewRequest++;cancelGesture();}}).observe(document.documentElement,{attributes:true,attributeFilter:['data-app-mode']});
mode(false);setInterval(()=>{if(quick&&document.documentElement.dataset.appMode==='edit')sync();},100);
})();
