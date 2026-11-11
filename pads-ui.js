(function(){
'use strict';
const $k=id=>document.getElementById(id),S=window.SoraSafe,D=window.KoedashiData,B=window.SoraEditorBridge,R=window.SoraRecordingSessions,store=new D.PadStore();
const budget=(navigator.deviceMemory&&navigator.deviceMemory<=2?64:128)*1048576;
let drag=null;
let ready=false,busy=false,hydrating=false,mode='record',sceneId=null,editingPadId=null,layout={},scenes=[],pads=[],serial=Promise.resolve(),sceneReady=Promise.resolve();
const buttons=new Map(),labels=new Map(),editStates=new Map();let latestEdit=null,lastKey=null,saveFailure=false,wasPlaying=false;
const message=(text,error=false)=>{$k('koStatus').textContent=text;$k('koStatus').className=error?'hint rec-error':'hint';};
const problem=e=>e?.name==='QuotaExceededError'?'保存容量が不足しています。元音声を削除せず、外部バックアップを作成してください。':e?.message||String(e);
const markChanged=()=>R.backupChanged?.();
function showSave(text,error=false){if(!error&&[...editStates.values()].includes('failed')){text='保存失敗（未保存のパッド編集があります。外部バックアップで回収してください）';error=true;}else if(!error&&text==='保存済み'&&[...editStates.values()].includes('saving'))text='保存中';saveFailure=error;$k('koSaveStatus').textContent='声出し：'+text;$k('koSaveStatus').className=error?'hint rec-error':'hint';}
const player=new KoedashiPlayer({
 onReady(id,state,error){const button=buttons.get(id),label=labels.get(id);if(button)button.disabled=!!drag?.active||state!=='ready';if(label)label.textContent=state==='ready'?'再生可能':state==='loading'?'読み込み中…':'読込失敗：'+error;},
 onActive(id){for(const [key,button]of buttons){button.className='ko-pad-play'+(key===id?' playing':'');button.setAttribute('aria-pressed',String(key===id));}if(id){wasPlaying=true;message('再生中：'+(pads.find(p=>p.id===id)?.name||''));}else if(wasPlaying){wasPlaying=false;message('再生を停止しました。');}},
 onError:text=>message(text,true)
},window,budget);
const queue=new S.EditQueue(store,D.Codec.pack,(id,state,error,revision)=>{
 editStates.set(id,state);
 if(revision!==undefined){const p=pads.find(p=>p.id===id);if(p)p.revision=revision;}
 saveFailure=state==='failed';showSave(state==='saving'?'保存中':state==='saved'?'保存済み':'保存失敗：'+problem(error),state==='failed');
});
function dropEdit(id){queue.drop(id);editStates.delete(id);}
function stopAll(){player.stop();B.stopPreview();}
function currentLayout(){return {mode,sceneId,editingPadId};}
function applyMode(){document.documentElement.dataset.appMode=mode;$k('koPadScreen').hidden=mode!=='pads';$k('koEditEmpty').hidden=mode!=='edit'||B.hasData();for(const [id,value]of [['koModeRecord','record'],['koModeEdit','edit'],['koModePads','pads']])$k(id).setAttribute('aria-pressed',String(mode===value));$k('koPadEditing').hidden=mode!=='edit'||!editingPadId;}
function refresh(){
 const locked=busy||!!drag?.active||!ready||R.isRecording()||B.isBusy();
 for(const id of ['koSceneSelect','koSceneNew','koSceneRename','koSceneDelete','koSceneUp','koSceneDown','koFile','koRegister','koSavePad','koReloadAudio'])$k(id).disabled=locked;
 $k('koRegister').disabled=locked||!B.hasData();$k('koSavePad').disabled=locked||!editingPadId;
 for(const id of ['koModeRecord','koModeEdit','koModePads'])$k(id).disabled=busy||!!drag?.active||!ready||B.isBusy();
 for(const el of $k('koPadGrid').querySelectorAll('.ko-menu button'))el.disabled=locked||el.dataset.edge==='yes';
 for(const el of $k('koPadGrid').querySelectorAll('.ko-drag-handle'))el.disabled=(!drag?.active&&locked)||!drag?.supported||pads.filter(p=>p.sceneId===sceneId).length<2;
 for(const [id,button]of buttons)button.disabled=!!drag?.active||player.states.get(id)?.state!=='ready';
 const i=scenes.findIndex(s=>s.id===sceneId);$k('koSceneUp').disabled=locked||i<=0;$k('koSceneDown').disabled=locked||i<0||i>=scenes.length-1;
 $k('koTargetScene').textContent='登録先：'+(scenes.find(s=>s.id===sceneId)?.name||'準備中');
}
async function reload(){const data=await store.layout();scenes=data.scenes;pads=data.pads;layout=data.layout;sceneId=scenes.some(s=>s.id===sceneId)?sceneId:layout.sceneId||scenes[0]?.id;render();}
function render(){
 drag?.cancel('一覧が更新されたため、並べ替えをキャンセルしました。');
 const select=$k('koSceneSelect');select.replaceChildren();for(const scene of scenes){const o=document.createElement('option');o.value=scene.id;o.textContent=scene.name;select.append(o);}select.value=sceneId||'';
 $k('koPadGrid').replaceChildren();buttons.clear();labels.clear();const group=pads.filter(p=>p.sceneId===sceneId).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
 $k('koPadEmpty').hidden=!!group.length;$k('koPadSetup').open=!group.length;
 for(const [i,pad]of group.entries()){
  const card=document.createElement('article');card.className='ko-pad-card';card.dataset.padId=pad.id;
  const play=document.createElement('button');play.className='ko-pad-play';play.setAttribute('aria-label',pad.name+'を先頭から再生');play.setAttribute('aria-pressed','false');play.disabled=player.states.get(pad.id)?.state!=='ready';
  const title=document.createElement('strong');title.textContent=pad.name;const length=document.createElement('span'),pcm=pad.edit||pad.original;length.textContent=(pcm.frames/pcm.sr).toFixed(2)+' 秒';
  const state=document.createElement('small');const status=player.states.get(pad.id);state.textContent=status?.state==='ready'?'再生可能':status?.state==='failed'?'読込失敗：'+status.error:'準備待ち';
  play.append(title,length,state);play.addEventListener('click',()=>{if(drag?.active)return;B.stopPreview();void player.play(pad.id);});buttons.set(pad.id,play);labels.set(pad.id,state);
  const menu=document.createElement('details');menu.className='ko-menu';const summary=document.createElement('summary');summary.textContent='メニュー ⋯';summary.setAttribute('aria-label',pad.name+'のメニュー');menu.append(summary);
  function action(label,fn,disabled=false){const b=document.createElement('button');b.textContent=label;b.disabled=disabled;b.addEventListener('click',()=>{menu.open=false;fn();});menu.append(b);return b;}
  action('名前変更',()=>{stopAll();const name=window.prompt('パッド名',pad.name);if(name?.trim())void operation(async()=>{await store.rename('pads',pad.id,name);markChanged();if(editingPadId===pad.id)B.rename(name.trim().slice(0,80)+'.wav');});});
  action('音声の編集',()=>void editPad(pad.id));
  const up=action('前へ',()=>void operation(async()=>{await store.reorder('pads',pad.id,-1);markChanged();}),i===0);up.dataset.edge=i===0?'yes':'no';
  const down=action('後へ',()=>void operation(async()=>{await store.reorder('pads',pad.id,1);markChanged();}),i===group.length-1);down.dataset.edge=i===group.length-1?'yes':'no';
  action('登録時の音声に戻す',()=>{stopAll();if(window.confirm('「'+pad.name+'」のパッド編集を登録時に戻します。元の録音テイクは変更しません。'))void operation(async()=>{await queue.flush(pad.id).catch(()=>{});const p=await store.getPad(pad.id);await store.resetEdit(pad.id,p.revision);dropEdit(pad.id);markChanged();if(editingPadId===pad.id){editingPadId=null;B.setContext({type:'file',id:null});B.restore(null);latestEdit=null;}});});
  action('パッドを削除',()=>{stopAll();if(window.confirm('「'+pad.name+'」のパッド内音声を削除します。必要な外部バックアップは保存済みですか？元の録音テイクがある場合、そのテイクは削除しません。'))void operation(async()=>{await queue.flush(pad.id).catch(()=>{});await store.removePad(pad.id);dropEdit(pad.id);markChanged();if(editingPadId===pad.id){editingPadId=null;latestEdit=null;B.setContext({type:'file',id:null});B.restore(null);await store.saveLayout(currentLayout());}});});
  const handle=document.createElement('button');handle.className='ko-drag-handle';handle.textContent='≡';handle.setAttribute('aria-label',pad.name+'を長押しして並べ替え');handle.setAttribute('aria-grabbed','false');handle.title='長押しして移動（メニューの前へ・後へも利用できます）';
  card.append(play,handle,menu);$k('koPadGrid').append(card);
 }
 applyMode();refresh();for(const b of $k('koPadGrid').querySelectorAll('button[data-edge="yes"]'))b.disabled=true;
}
function preload(){const group=pads.filter(p=>p.sceneId===sceneId);sceneReady=player.prepare(group,S.PCM.decodeData);return sceneReady;}
async function operation(fn,{prepare=true}={}){
 if(busy||!ready)return;busy=true;refresh();showSave('保存中');
 const task=(async()=>{try{await fn();await reload();showSave('保存済み');if(prepare&&mode==='pads')void preload();}catch(e){saveFailure=true;showSave('保存失敗：'+problem(e),true);message(problem(e),true);try{await reload();}catch{}}finally{busy=false;refresh();R.refresh();}})();serial=task;await task;
}
function padEditChanged(state){
 if(hydrating||!editingPadId||!state||B.context().type!=='pad')return;
 const key=[state.data,state.a,state.b,state.pos,state.zoom,state.marks.join(',')];if(lastKey&&key.every((v,i)=>v===lastKey[i]))return;
 lastKey=key;latestEdit=state;markChanged();const p=pads.find(p=>p.id===editingPadId);if(p)queue.enqueue(p.id,state,p.revision);
}
async function modeTo(value){
 if(!ready||busy||B.isBusy())return;if(value==='edit'&&!B.hasData()&&layout.editingPadId)return editPad(layout.editingPadId);if(R.isRecording()&&value!=='record'){message('録音を停止してからモードを切り替えてください。',true);return;}
 stopAll();busy=true;refresh();try{
  if(editingPadId)padEditChanged(B.capture());try{await queue.flushAll();}catch(e){if(value!=='record')throw e;showSave('保存失敗：'+problem(e),true);message('パッド編集はまだメモリ内です。録音モードの外部バックアップで回収してください。',true);}
  mode=value;await store.saveLayout(currentLayout());markChanged();applyMode();if(mode==='pads'){await reload();void preload();}
 }catch(e){showSave('保存失敗：'+problem(e),true);message(problem(e),true);}finally{busy=false;applyMode();refresh();R.refresh();}
}
async function editPad(id){
 if(busy||!ready||R.isRecording()){message('録音・保存処理を先に完了してください。',true);return;}
 player.cancelPreparation();B.stopPreview();busy=true;B.lock(true);refresh();try{
  if(editingPadId)padEditChanged(B.capture());await queue.flushAll();
  const p=await store.getPad(id);if(!p)throw Error('パッドがありません。');hydrating=true;
  const state=await D.Codec.state(p);await B.prepare(state);B.lock(false);const suspending=R.suspendForPad();B.lock(true);await suspending;B.setContext({type:'pad',id});B.restore(state);B.rename(p.name+'.wav');editingPadId=id;latestEdit=state;lastKey=[state.data,state.a,state.b,state.pos,state.zoom,state.marks.join(',')];
  mode='edit';sceneId=p.sceneId;await store.saveLayout(currentLayout());markChanged();showSave('保存済み');message('パッド「'+p.name+'」を編集しています。原録音と登録時のPCMは保持されます。');
 }catch(e){showSave('読み込み／保存失敗：'+problem(e),true);message('パッド編集を開けません：'+problem(e),true);}finally{hydrating=false;busy=false;B.lock(false);applyMode();refresh();R.refresh();}
}
async function registerState(state,sourceTakeId=null,suggested=''){
 if(!ready||busy||R.isRecording())throw Error('録音・保存処理を終えてから登録してください。');
 if(!state?.data?.length)throw Error('録音テイクまたは編集する音声を読み込んでください。');
 stopAll();const name=window.prompt('声出しパッド名',suggested||state.filename?.replace(/\.[^.]+$/,'')||'新しい音声');if(!name?.trim())return;
 const range=$k('koRegisterRange').checked;let data=state.data;
 if(range){const a=Math.round(state.a*state.sr),b=Math.round(state.b*state.sr);if(b-a<2)throw Error('登録する範囲を選択してください。');data=AudioEngine.range(data,a,b);}
 const bytes=data[0].length*data.length*4,used=pads.filter(p=>p.sceneId===sceneId).reduce((n,p)=>{const a=p.edit||p.original;return n+a.frames*a.channelsCount*4;},0);
 if(used+bytes>budget)throw Error('シーンの事前読込目安（'+budget/1048576+'MiB）を超えます。短い範囲を登録するか、別シーンへ分けてください。');
 await operation(async()=>{
  const pcm=await D.Codec.pack({...state,data,a:0,b:data[0].length/state.sr,pos:0,zoom:1,marks:[]});
  await store.createPad(sceneId,name,pcm,sourceTakeId);markChanged();mode='pads';await store.saveLayout(currentLayout());message('パッドを保存しました。再生可能になってからタップしてください。');
 });
}
async function registerCurrent(){try{await registerState(B.capture(),B.context().type==='take'?B.context().id:null);}catch(e){message('登録できません：'+problem(e),true);}}
async function registerTake(id){try{await R.ready;const state=await R.selectTake(id);const check=$k('koRegisterRange'),old=check.checked;check.checked=false;try{await registerState(state,id);}finally{check.checked=old;}}catch(e){message('登録できません：'+problem(e),true);}}
async function importFile(file){
 if(!file||!ready||busy)return;
 try{
  const ac=await player.arm();if(file.size>64*1048576)throw Error('入力ファイルが64MiBを超えます。既存の編集画面で必要な範囲を選んで登録してください。');
  message('音声ファイルを読み込み中…');const decoded=await AudioCompat.decode(ac,await AudioCompat.readFile(file));
  if(!decoded.length||decoded.numberOfChannels>2)throw Error('1～2chの音声ファイルを使用してください。');
  if(decoded.length*decoded.numberOfChannels*4>budget)throw Error('展開後の音声が事前読込目安を超えます。編集画面で短くして登録してください。');
  const data=AudioEngine.wrap(Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i)));
  const state={data,original:data,sr:decoded.sampleRate,a:0,b:decoded.duration,pos:0,zoom:1,marks:[],filename:file.name};
  // File imports always register the complete selected file, independent of editor selection.
  const check=$k('koRegisterRange'),previous=check.checked;check.checked=false;try{await registerState(state,null,file.name.replace(/\.[^.]+$/,''));}finally{check.checked=previous;}
 }catch(e){message('音声の読み込み／登録に失敗：'+problem(e),true);}
}
$k('koModeRecord').addEventListener('click',()=>void modeTo('record'));$k('koModeEdit').addEventListener('click',()=>void modeTo('edit'));$k('koModePads').addEventListener('click',()=>void modeTo('pads'));
$k('koStopAll').addEventListener('click',stopAll);$k('koPadStop').addEventListener('click',stopAll);
$k('koArm').addEventListener('click',()=>{void player.arm().then(()=>message('音声出力を準備しました。接続先は端末の音声出力設定をご確認ください。'),e=>message(problem(e),true));});
$k('koReloadAudio').addEventListener('click',()=>{player.cancelPreparation();for(const b of buttons.values())b.disabled=true;void reload().then(preload).catch(e=>message('音声の再読込に失敗：'+problem(e),true));});
$k('koRegister').addEventListener('click',()=>void registerCurrent());
$k('koFile').addEventListener('click',()=>{stopAll();void player.arm().catch(e=>message(problem(e),true));});
$k('koFile').addEventListener('change',e=>{const file=e.target.files[0];e.target.value='';void importFile(file);});
$k('koSavePad').addEventListener('click',async()=>{try{padEditChanged(B.capture());await queue.flushAll();showSave('保存済み');await reload();message('パッド編集を保存しました。声出しモードで最新音声を準備できます。');}catch(e){showSave('保存失敗：'+problem(e),true);}});
for(const event of ['pointerdown','focus'])$k('koSceneSelect').addEventListener(event,stopAll);
$k('koSceneSelect').addEventListener('change',e=>{const id=e.target.value;player.cancelPreparation();void operation(async()=>{await queue.flushAll();const next={...currentLayout(),sceneId:id};await store.saveLayout(next);sceneId=id;markChanged();});});
$k('koSceneNew').addEventListener('click',()=>{stopAll();const name=window.prompt('新しいシーン名','シーン'+(scenes.length+1));if(name?.trim())void operation(async()=>{const scene=await store.createScene(name);markChanged();sceneId=scene.id;await store.saveLayout(currentLayout());});});
$k('koSceneRename').addEventListener('click',()=>{stopAll();const name=window.prompt('シーン名',scenes.find(s=>s.id===sceneId)?.name||'');if(name?.trim())void operation(async()=>{await store.rename('scenes',sceneId,name);markChanged();});});
for(const [id,direction]of [['koSceneUp',-1],['koSceneDown',1]])$k(id).addEventListener('click',()=>{void operation(async()=>{await store.reorder('scenes',sceneId,direction);markChanged();});});
$k('koSceneDelete').addEventListener('click',()=>{stopAll();if(window.confirm('このシーンと含まれるパッドを削除します。元の録音テイクは削除しません。必要なら先にバックアップを保存してください。'))void operation(async()=>{await queue.flushAll();const ids=pads.filter(p=>p.sceneId===sceneId).map(p=>p.id);sceneId=await store.removeScene(sceneId);for(const id of ids)dropEdit(id);if(ids.includes(editingPadId)){editingPadId=null;latestEdit=null;B.setContext({type:'file',id:null});B.restore(null);}markChanged();});});
$k('koBackup').addEventListener('click',()=>{void modeTo('record').then(()=>{document.getElementById('safeAdvanced').open=true;document.getElementById('safeMakeBackup').scrollIntoView({block:'center'});});});
drag=new KoedashiPadDrag($k('koPadGrid'),{
 key:()=>sceneId,
 canStart:()=>ready&&!busy&&!R.isRecording()&&!B.isBusy()&&mode==='pads',
 bounds:()=>({top:Math.max(0,$k('koModes').getBoundingClientRect().bottom),bottom:Math.min(innerHeight,$k('koPadStop').getBoundingClientRect().top)}),
 onBegin(){stopAll();refresh();message('並べ替え中：青い線の位置へ挿入します。指を離すと保存。取り消しは別の指で「全停止」／Esc。');},
 onEnd:refresh,
 onCancel:text=>message(text+' 保存前の順序は保持しています。'),
 onCommit:(id,ids,expected)=>void operation(async()=>{if(await store.reorderPads(id,ids,expected))markChanged();message('パッドの並び順を保存しました。');},{prepare:false})
});
B.onChange(state=>{padEditChanged(state);refresh();});
B.onContext((next,state)=>{if(next.type==='pad'&&!hydrating&&state){editingPadId=next.id;latestEdit=state;lastKey=[state.data,state.a,state.b,state.pos,state.zoom,state.marks.join(',')];mode='edit';applyMode();}if(editingPadId&&next.type!=='pad'){padEditChanged(state);editingPadId=null;latestEdit=null;lastKey=null;}if(next.type==='take'&&ready&&!busy){mode='edit';applyMode();void store.saveLayout(currentLayout()).catch(e=>showSave('保存失敗：'+problem(e),true));}refresh();});
for(const type of ['visibilitychange','pagehide']){const target=type==='visibilitychange'?document:window;target.addEventListener(type,()=>{if(type==='pagehide'||document.hidden){stopAll();if(editingPadId)padEditChanged(B.capture());void queue.flushAll().catch(()=>{});}});}
window.addEventListener('beforeunload',e=>{if(busy||queue.busy()||saveFailure){e.preventDefault();e.returnValue='';}});
window.KoedashiPads={
 stopAll,registerTake,registerCurrent,checkpoint(){if(editingPadId)padEditChanged(B.capture());},
 showEditor(){if(ready&&!busy){mode='edit';applyMode();void store.saveLayout(currentLayout()).catch(e=>showSave('保存失敗：'+problem(e),true));}},
 hasData:()=>scenes.length>0||pads.length>0,
 safeStatusChanged(text){$k('koSafeSummary').textContent='録音保存：'+text;$k('koSafeSummary').dataset.warning=/保存失敗|保存中|不整合|確認要/.test(text)?'yes':'no';},
 async backupSnapshot(){await serial;if(editingPadId)padEditChanged(B.capture());await queue.flushAll().catch(()=>{});const snapshot=await store.layout();snapshot.layout=currentLayout();for(const pad of snapshot.pads){const pending=queue.pending(pad.id);if(pending)pad.edit=await D.Codec.pack(pending);}return snapshot;},
 async beforeImport(){if(busy)throw Error('声出しの保存処理が終わるまでお待ちください。');stopAll();busy=true;refresh();try{if(editingPadId)padEditChanged(B.capture());await queue.flushAll();}catch(e){busy=false;refresh();throw e;}},
 async afterImport(success,{legacyEdit=false}={}){
  stopAll();try{
   if(success){await reload();layout=(await store.layout()).layout;mode=legacyEdit?'edit':layout.mode||'record';sceneId=layout.sceneId||scenes[0]?.id;render();if(mode==='edit'&&layout.editingPadId){busy=false;await editPad(layout.editingPadId);}else if(mode==='pads')await preload();}
  }finally{busy=false;applyMode();refresh();R.refresh();}
 }

};
async function boot(){
 try{
  await R.ready;await store.open();await store.ensureScene();const data=await store.layout();scenes=data.scenes;pads=data.pads;layout=data.layout;sceneId=layout.sceneId||scenes[0].id;mode=layout.mode||'record';ready=true;
  const migration=R.migration?.();$k('koMigrationInfo').textContent=migration?.copied?'旧SAFEから'+migration.count+'テイクをコピーしました。旧保存領域は変更していません。以後の変更は別保存です。':migration?.note?.includes('新領域')?'旧SAFEデータは保持しています。新領域に録音があるため自動コピーせず、旧側のバックアップからの追加復元が必要です。':'旧SAFEの別URL・別ブラウザにある録音は自動共有されません。必要ならバックアップから復元してください。';
  render();showSave('保存済み');window.KoedashiPads.safeStatusChanged($k('safeSaveStatus').textContent);
  if(mode==='edit'&&layout.editingPadId)await editPad(layout.editingPadId);else if(mode==='pads')await preload();R.refresh();
 }catch(e){saveFailure=true;showSave('保存領域の準備失敗：'+problem(e),true);message('元のSAFEデータは変更していません。'+problem(e),true);}
 finally{applyMode();refresh();}
}
applyMode();void boot();
})();
