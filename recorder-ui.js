(function(){
'use strict';
const $r=id=>document.getElementById(id),bridge=window.SoraEditorBridge,S=window.SoraSafe,store=new S.Store();
const supported=!!(window.isSecureContext&&navigator.mediaDevices?.getUserMedia&&window.MediaRecorder&&(window.AudioContext||window.webkitAudioContext));
const wavOpen=new Set();
const takes=[];let activeId=null,base=null,loading=true,ready=false,capture=null,desiredName='',rawURL=null,rawTarget=null;
let generation=0,backupFile=null,backupURL=null,selectionSaving=0,storageError='',hydrating=false;
const recordingDate=ms=>{const d=new Date(ms),z=n=>String(n).padStart(2,'0');return z(d.getMonth()+1)+'/'+z(d.getDate())+' '+z(d.getHours())+':'+z(d.getMinutes())+':'+z(d.getSeconds());};
const fullDate=t=>Number.isFinite(t.recordedAt)?new Date(t.recordedAt).getFullYear()+'/'+recordingDate(t.recordedAt):'録音日時の記録なし';
const clock=ms=>{const s=Math.floor(ms/1000);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};
const notice=(text,error=false)=>{$r('recStatus').textContent=text;$r('recStatus').className=error?'hint rec-error':'hint';};
const explain=e=>(e?.name==='QuotaExceededError'?'容量不足です。外部バックアップやWAV保存で回収し、ブラウザのデータを消去しないでください。':e?.message||String(e));
function dirty(){generation++;if(!backupFile){$r('safeBackupLink').hidden=$r('safeShareBackup').hidden=true;}else{$r('safeBackupLink').textContent='前回作成したバックアップを保存（現在の変更は未反映）';}$r('safeBackupStatus').textContent='バックアップ未実施（現在の内容。前回生成ファイルは新しい作成が成功するまで保持）';}
function saveStatus(){
 const pending=selectionSaving||capture?.pending||takes.some(t=>t.editStatus==='saving'||t.nameDirty);
 const errors=[storageError,...takes.filter(t=>t.rawFailed||t.nameFailed||t.damaged||t.integrityError||t.editStatus==='failed').map(t=>t.name+'：'+(t.damaged?'原音に不整合があります。元データは保持しています。':t.integrityError||t.nameError||t.error||'保存失敗'))].filter(Boolean);
 if(!ready&&!storageError){$r('safeSaveStatus').textContent='保存領域を確認中…';return;}
 const live=capture&&recorder.state!=='idle';
 const liveText=live?(capture.record?.chunkCount?'受信済み '+capture.record.chunkCount+' チャンクは保存済み。未受信・未確定の音声は未保存です。':'保存待ち（音声チャンクはまだ確定していません）'):null;
 $r('safeSaveStatus').textContent=errors.length?'保存失敗：'+errors.join(' / '):pending?(takes.some(t=>t.nameDirty)&&!selectionSaving?'保存中（名前入力の確定待ち。入力欄の外をタップしてください）':'保存中'):liveText||'保存済み（ブラウザ内。未完了録音の末尾や外部保存は保証しません）';
 $r('safeSaveStatus').className=errors.length?'hint rec-error':'hint';window.KoedashiPads?.safeStatusChanged($r('safeSaveStatus').textContent);
}
const edits=new S.EditQueue(store,S.PCM.pack,(id,state,error,revision)=>{
 const take=takes.find(t=>t.id===id);if(!take)return;take.editStatus=state;if(revision!==undefined){take.revision=revision;if(state==='saved')take.integrityError=null;}if(error)take.error=explain(error);saveStatus();
});
function signature(state){return state?[state.data,state.a,state.b,state.pos,state.zoom,state.marks.join(',')]:[];}
function autosave(take,state){
 if(!take||!state||!ready)return;
 const key=signature(state);if(take.signature&&key.every((v,i)=>v===take.signature[i]))return;
 take.signature=key;dirty();edits.enqueue(take.id,state,take.revision||0);
}
function stash(){if(bridge.context?.().type==='pad'||!bridge.hasData())return;const state=bridge.capture(),take=takes.find(t=>t.id===activeId);if(take){take.state=state;autosave(take,state);}else base=state;}
function forgetLive(){const take=takes.find(t=>t.id===activeId);if(take)take.state=null;else if(bridge.context?.().type!=='pad')base=null;}
async function selectStored(id){selectionSaving++;saveStatus();try{await store.select(id);}catch(e){storageError=explain(e);}finally{selectionSaving--;saveStatus();}}
const recorder=new MicrophoneRecorder({
 async beforeRecord(){
  if(navigator.storage?.estimate){let estimate;try{estimate=await navigator.storage.estimate();}catch{}if(estimate&&Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage)&&estimate.quota-estimate.usage<8*1048576)throw Error('保存領域の空きが8 MiB未満です。録音を開始できません。外部バックアップを実際に保存し、不要データを確認して整理してください。');}
  const id=S.uid(),name=desiredName.slice(0,80)||'録音開始待ち';
  const c=capture={id,name,count:0,bytes:0,pending:1,failed:null,tail:Promise.resolve()};saveStatus();
  c.tail=store.create(name,id);try{c.record=await c.tail;}catch(e){c.failed=e;storageError=explain(e);throw e;}finally{c.pending--;saveStatus();}
 },
 onStarted(recordedAt){
  const c=capture;if(!c)return;c.recordedAt=recordedAt;c.name=desiredName.slice(0,80)||recordingDate(recordedAt);c.pending++;dirty();
  c.tail=c.tail.then(()=>store.markStarted(c.id,recordedAt,c.name));
  c.tail.then(record=>{c.record=record;},error=>{c.failed=error;storageError=explain(error);notice('録音日時の保存失敗：'+storageError,true);recorder.stop('録音情報の保存に失敗しました。');}).finally(()=>{c.pending--;saveStatus();});
 },
 onChunk(blob,lastMs){
  const c=capture;if(!c)return Promise.reject(Error('保存対象の録音がありません。'));
  const index=c.count++;c.bytes+=blob.size;c.pending++;dirty();saveStatus();
  c.tail=c.tail.then(()=>store.append(c.id,index,blob,lastMs));
  c.tail.then(record=>{c.record=record;},error=>{c.failed=error;storageError=explain(error);notice('保存失敗：'+storageError,true);}).finally(()=>{c.pending--;saveStatus();});
  return c.tail;
 },
 onState(){
  bridge.lock(recorder.state!=='idle'||loading);
  if(recorder.state!=='idle')window.KoedashiPads?.stopAll();
  if(recorder.state==='requesting')notice('マイクの許可と保存領域の準備を待っています…');
  if(recorder.state==='recording')notice('録音中。受信したチャンクを順次保存しています。');
  if(recorder.state==='paused')notice('一時停止中。マイクは使用中です。');
  if(recorder.state==='stopping')notice('録音を停止し、最終データを受け取っています…');
  refresh();
 },
 onCountdown:n=>notice('録音開始まで '+n+' 秒。「今すぐ録音」でスキップできます。'),
 onTime:ms=>$r('recTime').textContent=clock(ms),
 onLevel(db,clip){$r('recLevel').value=db;$r('recLevelText').textContent=(db<=-60?'−60以下':db.toFixed(0))+' dBFS'+(clip?' · 入力が大きすぎます':'');},
 onError(text){notice(text,true);if(capture)void reloadList();saveStatus();refresh();},
 onNotice(text){notice(text);if(capture)void reloadList();if(ready)void selectStored(activeId);refresh();},
 onComplete:result=>{void complete(result);}
});
function unavailable(){return loading||recorder.state!=='idle'||bridge.isBusy();}
function refresh(){
 const state=recorder.state,busy=state!=='idle'||loading;
 $r('recStart').disabled=busy||!supported||!ready;$r('recStop').disabled=state==='idle'||state==='stopping';
 $r('recStop').textContent=['requesting','countdown'].includes(state)?'キャンセル':'停止';
 $r('recPause').disabled=!['recording','paused'].includes(state);$r('recPause').textContent=state==='paused'?'再開':'一時停止';
 $r('recSkip').hidden=state!=='countdown';$r('recCountdown').disabled=busy;
 $r('recBackFile').hidden=!base||(activeId===null&&bridge.context?.().type!=='pad'&&bridge.hasData());$r('recBackFile').disabled=busy;
 $r('safeOriginal').disabled=busy||!activeId;$r('safeRetry').disabled=busy||!ready;
 $r('safeMakeBackup').disabled=busy||(!takes.length&&!window.KoedashiPads?.hasData());$r('safeImport').disabled=busy||!ready;
 $r('takeCount').textContent=takes.length+' 件の録音';
 for(const e of $r('takeList').querySelectorAll('button,input'))e.disabled=busy||e.dataset.unavailable==='true';
 saveStatus();
}
function extension(blob){if(blob.type.includes('mp4'))return '.m4a';if(blob.type.includes('webm'))return '.webm';if(blob.type.includes('ogg'))return '.ogg';if(blob.type.includes('wav'))return '.wav';return '.audio';}
const filename=t=>t.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_')+extension(t.blob||{type:t.mime||''});
function render(){
 if(rawURL)URL.revokeObjectURL(rawURL);rawURL=null;
 const unfinished=takes.filter(t=>t.status==='recording'||t.damaged||t.integrityError);
 $r('safeRecoveryInfo').textContent=unfinished.length?'未完了・整合性確認が必要なテイクが '+unfinished.length+' 件あります。救出を試し、元データを残したまま外部へ保存してください。':'';
 $r('takeList').replaceChildren();
 for(const take of takes){
  const row=document.createElement('div');row.dataset.takeId=take.id;row.className='rec-take'+(take.id===activeId?' active':'');
  const name=document.createElement('input');name.type='text';name.maxLength=80;name.value=take.name;name.setAttribute('aria-label','テイク名');
  name.addEventListener('input',()=>{take.name=name.value.trim().slice(0,80)||take.name;take.nameDirty=true;dirty();saveStatus();});
  name.addEventListener('change',async()=>{const old=take.name;take.name=name.value.trim().slice(0,80)||old;name.value=take.name;dirty();selectionSaving++;saveStatus();try{await store.rename(take.id,take.name);take.nameFailed=false;take.nameError=null;take.nameDirty=false;if(take.id===activeId)bridge.rename(filename(take));}catch(e){take.nameFailed=true;take.nameError=explain(e);notice('名前の保存失敗：'+explain(e),true);}finally{selectionSaving--;saveStatus();}});
  const detail=document.createElement('small');detail.textContent=fullDate(take)+' · 音声 '+(take.damaged||take.integrityError?'整合性要確認：':'')+(take.status==='recording'?'未完了・救出候補：':'')+clock(take.elapsed||take.lastMs)+' · '+(take.bytes/1048576).toFixed(2)+' MB · '+(take.rawFailed?'保存失敗（メモリ内原本あり）':take.chunkCount+'チャンク確定')+(take.reason?' · '+take.reason:'');
  const chooseButton=document.createElement('button');chooseButton.textContent=take.id===activeId?'選択中':take.status==='recording'?'救出を試す':'選択して編集';chooseButton.addEventListener('click',()=>void choose(take));
  const again=document.createElement('button');again.textContent='録り直し';again.addEventListener('click',()=>start(Number.isFinite(take.recordedAt)&&take.name===recordingDate(take.recordedAt)?'':take.name+'（録り直し）'));
  const remove=document.createElement('button');remove.textContent='削除';remove.addEventListener('click',()=>void erase(take));
  const originalButton=document.createElement('button');originalButton.textContent='原音から開く';originalButton.addEventListener('click',()=>{if(window.confirm('原音から開き、現在の編集保存を原音状態に戻します。必要なら先にバックアップしてください。'))void choose(take,{originalOnly:true});});
  const register=document.createElement('button');register.textContent='声出しに登録';register.addEventListener('click',()=>{window.KoedashiPads?.registerTake(take.id);});
  row.append(name,detail,chooseButton,again,remove,originalButton,register);appendWavMenu(row,take);$r('takeList').append(row);
 }
 const target=takes.find(t=>t.id===rawTarget)||takes.find(t=>t.id===activeId);
 $r('recRaw').hidden=!target?.blob;if(target?.blob){rawURL=URL.createObjectURL(target.blob);$r('recRaw').href=rawURL;$r('recRaw').download=filename(target);$r('recRaw').textContent='録音原本／検証できた部分を保存：'+target.name;}else $r('recRaw').removeAttribute('href');
 refresh();
}
function appendWavMenu(row,take){
 const menu=document.createElement('details'),summary=document.createElement('summary');summary.textContent='WAV保存';menu.open=wavOpen.has(take.id);menu.append(summary);
 const info=document.createElement('p');info.className='hint';info.textContent='この録音IDの原音、またはブラウザ内に保存済みの編集全体を書き出します。';menu.append(info);
 const raw=document.createElement('button');raw.textContent='原音WAV保存';
 const edited=document.createElement('button');edited.textContent='編集済みWAV保存（確認中）';edited.dataset.unavailable='true';edited.disabled=true;
 const hint=document.createElement('p');hint.className='hint';hint.textContent='編集済みデータを確認中…';menu.append(raw,edited,hint);
 async function check(){try{const info=await store.editInfo(take.id),pending=take.editStatus==='saving'||take.editStatus==='failed'||!!edits.pending(take.id);const available=info.mode==='pcm'&&!pending;edited.dataset.unavailable=String(!available);edited.disabled=unavailable()||!available;edited.textContent='編集済みWAV保存';hint.textContent=pending?'編集の保存完了後に利用できます。保存失敗は「編集保存を再試行」で確認してください。':available?'保存済みの編集結果（全音声）を使用します。':'編集済みデータはありません。原音WAV保存をご利用ください。';}catch(e){edited.dataset.unavailable='true';edited.disabled=true;hint.textContent='編集情報の確認失敗：'+explain(e);}}
 menu.addEventListener('toggle',()=>{if(menu.open){wavOpen.add(take.id);void check();}else wavOpen.delete(take.id);});void check();
 raw.addEventListener('click',()=>void exportTake(take,'original'));
 edited.addEventListener('click',()=>void exportTake(take,'edited'));
 row.append(menu);
}
let takeWavFile=null,takeWavURL=null;
async function exportTake(take,kind){
 if(unavailable())return;
 if(kind==='edited'&&(take.editStatus==='saving'||take.editStatus==='failed'||edits.pending(take.id))){notice('編集の保存が完了してからWAV保存してください。',true);return;}
 loading=true;bridge.lock(true);refresh();notice('「'+take.name+'」の'+(kind==='original'?'原音':'保存済み編集')+'WAVを作成中…');
 try{
  const result=await window.KoedashiTakeExport.create(store,take.id,kind);
  const file=new File([result.blob],(result.take.name+'_'+(kind==='original'?'原音':'編集済み')+'_'+take.id.slice(0,8)).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_')+'.wav',{type:'audio/wav'});
  if(takeWavURL)URL.revokeObjectURL(takeWavURL);takeWavFile=file;takeWavURL=URL.createObjectURL(file);
  const box=$r('takeWavReady');box.hidden=false;$r('takeWavInfo').textContent='WAV作成済み：'+result.take.name+' / '+fullDate(result.take)+' / '+(kind==='original'?'原音（編集なし）':'保存済み編集結果')+' / '+result.seconds.toFixed(2)+'秒。端末への保存完了は確認できません。';
  const link=$r('takeWavDownload');link.href=takeWavURL;link.download=file.name;$r('takeWavShare').hidden=!AudioCompat.canShare(file,navigator);
  notice('WAVの作成が完了しました。録音一覧の下のリンク／共有から端末へ保存し、実ファイルを確認してください。');box.scrollIntoView({block:'nearest'});
 }catch(e){notice('WAV作成失敗：'+explain(e)+' 元データは変更していません。'+(takeWavFile?' 表示中のリンクは前回作成分です。':''),true);}
 finally{loading=false;bridge.lock(false);render();}
}
$r('takeWavShare').addEventListener('click',()=>{if(!takeWavFile||unavailable())return;try{navigator.share({files:[takeWavFile]}).catch(e=>notice(e.name==='AbortError'?'共有をキャンセルしました。':'WAVの共有に失敗しました。保存リンクを試してください。',true));}catch(e){notice('WAV共有失敗：'+explain(e),true);}});
function start(name=''){
 if(unavailable())return;
 const bytes=takes.reduce((n,t)=>n+t.bytes,0);if(bytes>=64*1048576||bridge.totalBytes(takes.map(t=>t.state).concat(base))>=bridge.budget){notice('保持データの目安を超えます。外部バックアップ後に整理してください。',true);return;}
 capture=null;desiredName=name;storageError='';$r('recTime').textContent='00:00';
 void recorder.start({countdown:$r('recCountdown').checked?3:0,maxBytes:Math.min(32*1048576,64*1048576-bytes)});
}
async function complete({blob,elapsed,reason,partial=false}){
 const c=capture;if(c)c.pending++;loading=true;bridge.lock(true);refresh();$r('recTime').textContent=clock(elapsed);
 let record=c?.record;
 try{if(!c)throw Error('録音保存情報がありません。');await c.tail;record=await store.finish(c.id,c.count,c.bytes,elapsed,reason,partial);storageError='';}
 catch(e){storageError=explain(e);if(c)c.failed=e;}
 finally{if(c)c.pending--;saveStatus();}
 const take={...(record||{id:c?.id||S.uid(),name:c?.name||'未保存テイク',chunkCount:0,bytes:blob.size,revision:0,status:'recording'}),...(c?.recordedAt!==undefined?{recordedAt:c.recordedAt,name:c.name}:{}),blob,elapsed,reason,partial,state:null,rawFailed:!!c?.failed,error:c?.failed?explain(c.failed):''};
 if(!takes.some(t=>t.id===take.id))takes.push(take);else Object.assign(takes.find(t=>t.id===take.id),take);
 capture=null;loading=false;bridge.lock(false);dirty();render();await choose(take);
 if(reason)notice(reason+' 保存できた内容・末尾を確認してください。',true);
 if(take.rawFailed)notice('保存失敗：録音全体はまだメモリ内です。今すぐ外部バックアップまたは録音原本を保存してください。 '+take.error,true);
}
async function choose(take,{originalOnly=false}={}){
 if(unavailable()||take.id===activeId&&!originalOnly)return;
 const previousOwner=bridge.context?.();stash();bridge.setContext?.({type:'take',id:take.id});loading=true;hydrating=true;rawTarget=take.id;refresh();const previous=bridge.capture();let recovery='';
 try{
  if(take.state&&!originalOnly)bridge.restore(take.state);
  else{
   const source=take.blob&&!take.damaged?{blob:take.blob,edit:null,lastMs:take.lastMs,damaged:false}:await store.source(take.id);
   take.blob=source.blob;take.damaged=source.damaged;
   const state=await bridge.load(new File([source.blob],filename(take),{type:source.blob.type}),{keepClipboard:true,audioOnly:true});
   const originalState=bridge.capture();
   const editRow=await store.read(take.id);take.revision=editRow.take?.revision||0;
   if(!originalOnly&&editRow.edit){const restored=await S.PCM.apply(state,editRow.edit);await bridge.prepare(restored);bridge.restore(restored);}
   if(take.status==='recording'||source.damaged)recovery='救出できたデコード音声：'+(state.data[0].length/state.sr).toFixed(2)+'秒。最後に確定したチャンクの受信時刻は録音時間約'+clock(source.lastMs)+'。その後の未受信・未確定部分～異常終了時の長さは不明です。原チャンクは削除していません。'+(source.damaged?' 不整合より前の検証済み部分だけを使用しました。':'');
  }
  activeId=take.id;forgetLive();bridge.rename(filename(take));take.signature=signature(bridge.capture());
  await selectStored(activeId);
  notice(recovery||'「'+take.name+'」を編集できます。原音は別に保持しています。');
  window.KoedashiPads?.showEditor();
  if(originalOnly){take.signature=null;hydrating=false;autosave(take,bridge.capture());}
 }catch(e){bridge.restore(previous);if(previousOwner)bridge.setContext?.(previousOwner);forgetLive();notice('復旧／読み込みに失敗：'+explain(e)+' 元チャンクは削除していません。原本保存を試せます。',true);take.error=explain(e);if(/PCM|検証|不整合|一致/.test(take.error))take.integrityError=take.error;}
 finally{loading=false;hydrating=false;render();}
}
async function erase(take){
 if(unavailable()||!window.confirm('「'+take.name+'」（'+fullDate(take)+'）の原音と編集保存を削除します。外部バックアップを実際に保存・確認しましたか？'))return;
 loading=true;bridge.lock(true);refresh();
 try{await edits.flush(take.id).catch(()=>{});await store.remove(take.id);edits.drop(take.id);takes.splice(takes.indexOf(take),1);dirty();
  if(activeId===take.id){activeId=null;bridge.restore(null);if(base){const s=base;base=null;bridge.restore(s);}}
  notice('削除を確定しました。');
 }catch(e){notice('削除失敗：'+explain(e)+' 保存データの削除を確定できませんでした。',true);}
 finally{loading=false;bridge.lock(false);render();}
}
async function reloadList(){
 if(!ready)return;try{const list=await store.list();for(const row of list.takes){const current=takes.find(t=>t.id===row.id);if(current)Object.assign(current,row);else takes.push({...row,state:null});}render();}catch(e){storageError=explain(e);saveStatus();}
}
async function makeBackup({throwOnError=false}={}){
 if(unavailable()){if(throwOnError)throw Error('録音・読込・保存処理を終えてから共有してください。');return;}window.KoedashiPads?.checkpoint();stash();loading=true;bridge.lock(true);refresh();$r('safeBackupStatus').textContent='バックアップ作成中…';const version=generation;
 try{
  await edits.flushAll().catch(()=>{});const rows=[];
  for(const take of takes){
   let row=await store.read(take.id);
   if(take.rawFailed&&take.blob){row={take:{...take,status:take.partial?'recording':'complete',chunkCount:1,bytes:take.blob.size,lastMs:take.elapsed},chunks:[{index:0,blob:take.blob,size:take.blob.size,lastMs:take.elapsed,hash:await S.hash(take.blob)}],edit:row.edit};}
   if(row.take)row.take.name=take.name;
   if(!row.take)throw Error('未保存のテイク情報を取得できません。録音原本を個別に保存してください。');
   const pending=edits.pending(take.id);if(pending)row.edit=await S.PCM.pack(pending);
   rows.push(row);
  }
  const padBundle=window.KoedashiPads?await window.KoedashiPads.backupSnapshot():null;const blob=await S.makeBackup(rows,activeId,padBundle);if(version!==generation)throw Error('作成中に内容が変更されました。もう一度作成してください。');
  if(backupURL)URL.revokeObjectURL(backupURL);backupURL=URL.createObjectURL(blob);
  backupFile=new File([blob],'KOEDASHI_BACKUP_'+new Date().toISOString().replace(/[:.]/g,'-')+'.koedashi-backup',{type:blob.type});
  const link=$r('safeBackupLink');link.href=backupURL;link.download=backupFile.name;link.textContent='作成したバックアップを端末へ保存';link.hidden=false;
  $r('safeShareBackup').hidden=!AudioCompat.canShare(backupFile,navigator);
  $r('safeBackupStatus').textContent='バックアップ作成済み（ファイル生成のみ。端末への保存完了は確認できません）';return backupFile;
 }catch(e){$r('safeBackupStatus').textContent='バックアップ未実施／作成失敗：'+explain(e);if(throwOnError)throw e;}
 finally{loading=false;bridge.lock(false);forgetLive();render();}
}
async function importBackup(file,{onState=()=>{},isCancelled=()=>false}={}){
 if(unavailable()||!file)return {ok:false,message:'録音・読込・保存処理を終えてから復元してください。'};let result={ok:false};stash();loading=true;bridge.lock(true);refresh();let restoredId=null,restorePadMode=false,committed=false,padPrepared=false,hasLayout=false;
 try{
  await edits.flushAll();await window.KoedashiPads?.beforeImport();padPrepared=!!window.KoedashiPads;onState('ファイルと音声データを検証中…');const parsed=await (window.KoedashiTransfer?KoedashiTransfer.parse(file):S.parseBackup(file));hasLayout=!!parsed.layout;restorePadMode=!!parsed.layout?.editingPadId;if(isCancelled())return {cancelled:true};
  if(!window.confirm(parsed.rows.length+'テイク／'+(parsed.scenes?.length||0)+'シーン／'+(parsed.pads?.length||0)+'パッドを追加復元します。既存データは上書きしません。同じファイルを再度取り込むと重複追加されます。'+(parsed.transferSettings?'カウントダウンを'+(parsed.transferSettings.countdown?'オン':'オフ')+'に切り替えます。':'')))return {cancelled:true};onState('検証済みデータを追加復元中…');
  const mapping=await store.importBackup(parsed);committed=true;restoredId=mapping.get(parsed.selected)||null;dirty();await reloadList();const warning=parsed.transferSettings?KoedashiTransfer.applySettings(parsed.transferSettings):'';notice('バックアップの検証と追加保存が完了しました。各テイクとパッドの音声を確認してください。'+warning);result={ok:true,warning};
 }catch(e){const message='復元失敗：'+explain(e)+' 既存の原音を削除・上書きしていません。';notice(message,true);result={ok:false,message};}
 finally{
  loading=false;bridge.lock(false);forgetLive();render();
  const restored=takes.find(t=>t.id===restoredId);if(committed&&!restorePadMode&&restored?.status==='complete')await choose(restored);
  if(padPrepared)await window.KoedashiPads.afterImport(committed,{legacyEdit:!hasLayout&&!!restoredId});
 }
 return result;
}
$r('recStart').addEventListener('click',()=>start());$r('recStop').addEventListener('click',()=>recorder.stop());
$r('recPause').addEventListener('click',()=>recorder.state==='paused'?recorder.resume():recorder.pause());$r('recSkip').addEventListener('click',()=>recorder.skipCountdown());
$r('recBackFile').addEventListener('click',()=>{if(unavailable()||!base)return;const state=base;stash();activeId=null;base=null;bridge.setContext?.({type:'file',id:null});bridge.restore(state);void selectStored(null);render();window.KoedashiPads?.showEditor();});
$r('safeOriginal').addEventListener('click',()=>{const t=takes.find(t=>t.id===activeId);if(t&&!unavailable()&&window.confirm('編集結果を原音へ戻します。原音自体は変更しません。必要なら先にバックアップを作成してください。'))void choose(t,{originalOnly:true});});
$r('safeRetry').addEventListener('click',async()=>{if(unavailable())return;stash();try{await edits.flushAll();for(const t of takes.filter(t=>t.nameFailed||t.nameDirty)){await store.rename(t.id,t.name);t.nameFailed=false;t.nameDirty=false;t.nameError=null;if(t.id===activeId)bridge.rename(filename(t));}await selectStored(activeId);storageError='';notice('編集保存の再試行を完了しました。録音原本の保存失敗は外部バックアップでも回収してください。');}catch(e){notice('保存失敗：'+explain(e),true);}finally{forgetLive();saveStatus();}});
$r('safeMakeBackup').addEventListener('click',()=>void makeBackup());
$r('safeImport').addEventListener('change',e=>{const file=e.target.files[0];e.target.value='';void importBackup(file);});
$r('safeShareBackup').addEventListener('click',()=>{if(!backupFile)return;try{const sharing=navigator.share({files:[backupFile]});sharing.catch(e=>notice(e.name==='AbortError'?'共有をキャンセルしました。':'共有できませんでした。バックアップの保存リンクを使用してください。',true));}catch(e){notice('共有できませんでした。バックアップの保存リンクを使用してください。',true);}});
$r('safePersist').addEventListener('click',async()=>{try{if(!navigator.storage?.persist){$r('safeStorageInfo').textContent='永続ストレージ許可APIはこのブラウザで利用できません。';return;}const ok=await navigator.storage.persist();$r('safeStorageInfo').textContent=ok?'永続ストレージ許可あり。ただし手動削除・OS障害・ブラウザ制約による消失は防げません。':'永続ストレージ許可は得られませんでした。外部バックアップを保存してください。';}catch(e){$r('safeStorageInfo').textContent='永続ストレージ確認失敗：'+explain(e);}});
bridge.setExternalStates(()=>takes.map(t=>t.state).concat(base));
bridge.onChange(state=>{if(!hydrating&&!loading&&recorder.state==='idle')autosave(takes.find(t=>t.id===activeId),state);});
bridge.onFileLoad(()=>{bridge.setContext?.({type:'file',id:null});if(activeId)stash();loading=true;refresh();},success=>{loading=false;if(success){activeId=null;base=null;void selectStored(null);notice('ファイル編集は既存WAV保存を利用してください。自動保存・バックアップの対象は録音テイクです。');}else forgetLive();render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(recorder.state!=='idle')recorder.stop('背景移行・画面ロックを検出しました。確定済みチャンクを優先して回収します。');else{if(activeId)autosave(takes.find(t=>t.id===activeId),bridge.capture());void edits.flushAll().catch(()=>{});}}});
window.addEventListener('pagehide',()=>{if(recorder.state!=='idle')recorder.stop('終了時に未受信データを失う可能性があります。');else{if(activeId)autosave(takes.find(t=>t.id===activeId),bridge.capture());void edits.flushAll().catch(()=>{});}});
window.addEventListener('beforeunload',e=>{if(recorder.state!=='idle'||loading||edits.busy()||selectionSaving||storageError||takes.some(t=>t.rawFailed||t.nameFailed||t.nameDirty||t.editStatus==='failed')){e.preventDefault();e.returnValue='';}});
async function boot(){
 bridge.lock(true);$r('safeSaveStatus').textContent='保存領域を確認中…';
 try{
  await store.open();if(store.migrateLegacy)store.migration=await store.migrateLegacy();ready=true;const list=await store.list();takes.push(...list.takes.map(t=>({...t,state:null})));
  const partial=takes.filter(t=>t.status==='recording');if(partial.length)notice('未完了の録音を'+partial.length+'件検出しました。「救出を試す」で検証済み部分を読み込めるか確認してください。元チャンクは保持しています。',true);
  else notice('ブラウザ内の録音一覧を読み込みました。外部バックアップも保存してください。');
  loading=false;bridge.lock(false);render();const selected=takes.find(t=>t.id===list.selected);if(selected?.status==='complete')await choose(selected);
 }catch(e){ready=false;storageError=explain(e);notice('永続保存を開始できないため新規録音を停止しています。ファイル編集は利用できます。 '+storageError,true);}
 finally{loading=false;bridge.lock(false);render();}
}
const bootPromise=boot();
window.SoraRecordingSessions={ready:bootPromise,isReady:()=>ready,isRecording:()=>recorder.state!=='idle',
 async selectTake(id){if(unavailable())throw Error('録音・編集処理が終わるまでお待ちください。');const take=takes.find(t=>t.id===id);if(!take)throw Error('録音テイクがありません。');await choose(take);if(activeId!==id)throw Error('テイクを編集へ読み込めませんでした。');return bridge.capture();},
 async suspendForPad(){if(unavailable())throw Error('録音・編集処理を先に完了してください。');stash();activeId=null;await selectStored(null);render();},
 flush:()=>edits.flushAll(),refresh,makeBackup,exportBackup:()=>makeBackup({throwOnError:true}),importBackup,backupChanged:dirty,migration:()=>store.migration,
 unsaved:()=>edits.busy()||takes.some(t=>t.rawFailed||t.nameFailed||t.nameDirty||t.editStatus==='failed')
};render();
})();
