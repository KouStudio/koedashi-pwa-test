/* Dedicated handoff UI, reusing the recorder's capture and atomic append importer. */
(function(){
'use strict';
const by=id=>document.getElementById(id),R=SoraRecordingSessions,T=KoedashiTransfer;
const entry=document.createElement('button');entry.id='handoffEntry';entry.textContent='データ共有・引き継ぎ';by('koAppInfo').prepend(entry);
const simpleEntry=document.createElement('button');simpleEntry.id='simpleHandoffEntry';simpleEntry.textContent='データ共有';document.querySelector('.simple-sort-head').append(simpleEntry);
const dialog=document.createElement('dialog');dialog.id='handoffDialog';dialog.setAttribute('aria-labelledby','handoffTitle');dialog.innerHTML='<div class="handoff-heading"><h2 id="handoffTitle">データ共有・引き継ぎ</h2><button id="handoffClose" aria-label="共有画面を閉じる">閉じる</button></div><p>対象：録音・編集済み音声、パッド、シーン、音量とカウントダウン設定。外部ファイルの編集は、先にパッドへ登録してください。</p><h3>データを渡す</h3><div class="handoff-buttons"><button id="handoffShare">共有する（他の端末へ）</button><button id="handoffSave">端末に保存</button></div><p id="handoffFilename"></p><p id="handoffSaveHelp" class="hint">Android Chrome：ブラウザの「ダウンロード」または端末の「ファイル」→「ダウンロード」で確認。iPad Safari：この画面の共有で「ファイルに保存」が出る場合は選択、またはSafariのダウンロード一覧を確認してください。保存先設定により場所は異なります。ZIPは解凍せず読み込めます。</p><a id="handoffDownload" hidden>準備済みZIPを保存する</a><h3>データを受け取る</h3><label class="handoff-read">ファイルを読み込む<input id="handoffFile" type="file" accept=".zip,.koedashi-backup,.sora-backup,application/zip,application/octet-stream"></label><p>音声セットZIPは解凍せずに選択できます。アプリ配布ZIPは対象外です。既存データを残して追加復元します。同じセットを繰り返し読み込むと重複追加されます。</p><details><summary>対応ファイル形式と解凍された場合</summary><p>KOEDASHIの音声セットZIP、従来の .koedashi-backup / .sora-backup に対応します。ZIPは解凍不要です。端末が自動展開した場合、内部の audio-set.koedashi-backup も読み込めます。manifest.json 単体やアプリ配布ZIPは対象外です。</p></details><p id="handoffStatus" role="status" aria-live="polite">操作を選んでください。</p><p class="hint">共有先は端末の共有画面で選択します。LINEがZIPを受け付けない場合は、端末に保存してLINEのファイル添付を確認してください。利用できなければ端末標準のファイル共有も確認してください。Googleアカウントは不要です。LINEへの到達はアプリから確認できません。</p>';
 document.body.append(dialog);const diagnosticDetails=document.createElement('details');diagnosticDetails.id='handoffDiagnosticDetails';const diagnosticTitle=document.createElement('summary');diagnosticTitle.textContent='共有の診断情報（端末内のみ）';const diagnosticBody=document.createElement('pre');diagnosticBody.id='handoffDiagnostics';diagnosticDetails.append(diagnosticTitle,diagnosticBody);const shareStatus=by('handoffStatus');document.querySelector('.handoff-buttons').after(shareStatus);shareStatus.after(diagnosticDetails);let prepared=null,url=null,busy=false,importing=false,epoch=0;const progress=document.createElement('progress');progress.id='handoffProgress';progress.hidden=true;by('handoffStatus').after(progress);function updateProgress(value){progress.hidden=false;const done=value.doneBytes??value.doneFiles,total=value.totalBytes??value.totalFiles;let text=value.stage+'…';if(Number.isFinite(done)&&Number.isFinite(total)&&total>0){progress.max=total;progress.value=done;text+=' '+Math.floor(done/total*100)+'%';}else progress.removeAttribute('value');if(Number.isFinite(value.doneFiles)&&Number.isFinite(value.totalFiles))text+=' ／ '+value.doneFiles+' / '+value.totalFiles+'件';state(text);}
function state(text,error=false){if(error)progress.hidden=true;by('handoffStatus').textContent=text;by('handoffStatus').classList.toggle('rec-error',error);if(error)by('handoffStatus').scrollIntoView({block:'nearest'});}
function lock(value){busy=value;entry.disabled=simpleEntry.disabled=value;for(const id of ['handoffShare','handoffSave','handoffFile'])by(id).disabled=value;dialog.setAttribute('aria-busy',String(value));by('handoffDownload').hidden=value||!prepared;by('handoffClose').disabled=importing&&value;}
function clear(){progress.hidden=true;prepared=null;if(url)URL.revokeObjectURL(url);url=null;by('handoffDownload').hidden=true;by('handoffFilename').textContent='';by('handoffShare').textContent='共有する（他の端末へ）';by('handoffDiagnostics').textContent='';by('handoffDiagnosticDetails').open=false;}
function open(){if(busy)return;KoedashiPads.stopAll();clear();epoch++;state('操作を選んでください。');if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');}
function close(){epoch++;clear();if(dialog.close)dialog.close();else dialog.removeAttribute('open');}
entry.onclick=simpleEntry.onclick=open;by('handoffClose').onclick=close;dialog.addEventListener('cancel',event=>{if(importing&&busy){event.preventDefault();return;}epoch++;clear();});
function remember(file){prepared=file;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(file);const link=by('handoffDownload');link.href=url;link.download=file.name;link.hidden=false;by('handoffFilename').textContent='生成ファイル名：'+file.name+' ／ '+(file.size/1048576).toFixed(2)+' MiB（'+file.size.toLocaleString()+' bytes）';by('handoffShare').textContent='準備済みZIPを共有';}
async function prepare(name,token){if(prepared)return prepared;progress.hidden=false;progress.removeAttribute('value');state('データ準備中… 最新の録音・編集とパッドを取得しています。');await R.ready;if(by('koModeRecord').disabled)throw Error('保存・読込処理を終えてから共有してください。');const backup=await R.exportBackup();state('ZIP生成中… 音声の検証とZIPへの格納を行っています。');const file=await T.pack(backup,{countdown:by('recCountdown').checked},name,value=>{if(token===epoch)updateProgress({...value,stage:'ZIP生成中 · '+value.stage});});if(token===epoch){remember(file);progress.hidden=true;}return file;}
// Pure synchronous observation only. No UI update or async work before share().
function shareContext(event,trigger){
 const info={build:'2.6.7',trigger,trustedClick:event?.isTrusted??null,secureContext:window.isSecureContext,visibility:document.visibilityState,hasFocus:document.hasFocus(),embedded:window.top!==window,standalone:matchMedia('(display-mode: standalone)').matches||!!navigator.standalone,userAgent:navigator.userAgent,file:{name:prepared?.name,type:prepared?.type,size:prepared?.size,isFile:typeof File==='function'&&prepared instanceof File},canShare:null,policyAllowed:null,policyFeatureKnown:null,activationAtClick:navigator.userActivation?.isActive??null,activationAtCall:null,errorName:null,errorMessage:null,stage:'capability'};
 try{const policy=document.permissionsPolicy||document.featurePolicy;if(policy?.allowsFeature){info.policyFeatureKnown=typeof policy.features==='function'?policy.features().includes('web-share'):null;if(info.policyFeatureKnown!==false)info.policyAllowed=policy.allowsFeature('web-share');}}catch{}
 return info;
}
function showShareInfo(info){by('handoffDiagnostics').textContent=JSON.stringify(info,null,2);}
function finishShare(info,error,token){
 if(token!==epoch)return;
 if(!error){info.result='API resolved; delivery unconfirmed';showShareInfo(info);state('共有APIの処理が終了しました。共有先の操作と相手への到達を端末側で確認してください。LINEへの送信成功はアプリから確認できません。');return;}
 info.errorName=String(error.name||'Error');info.errorMessage=String(error.message||error);info.result='rejected';showShareInfo(info);by('handoffDiagnosticDetails').open=true;
 let text;
 if(info.errorName==='AbortError')text='共有がキャンセルされたか、利用できる共有先がありません。ブラウザによる拒否とは区別して記録しました。';
 else if(info.errorName==='NotAllowedError'){
  if(info.policyAllowed===false)text='このページのweb-shareポリシーで共有が拒否されています。';
  else if(info.activationAtCall===false)text='共有呼び出し時にブラウザのタップ操作の有効状態を確認できませんでした。';
  else if(info.activationAtCall===true)text='タップ操作は有効でしたが、ブラウザがファイル共有を拒否しました。ZIPの共有制限やブラウザ設定などが考えられますが、この例外だけでは原因を断定できません。';
  else text='ブラウザが共有を拒否しました。操作の有効状態・ポリシー・ZIP共有制限のどれが原因か、この環境では断定できません。';
 }else if(info.errorName==='InvalidStateError')text='別の共有処理が残っているか、ページの状態により共有できません。';
 else if(info.errorName==='DataError')text='共有先の起動またはファイルの受け渡しに失敗しました。';
 else if(info.errorName==='TypeError')text='共有データまたはファイル形式をブラウザが受け付けませんでした。';
 else if(info.errorName==='SecurityError')text='ブラウザのセキュリティ制限により共有できませんでした。';
 else text='共有処理に失敗しました。';
 state(text+' ZIPは保持しています。下の例外名・内容をご確認ください。同じ拒否が続く場合は端末保存をご利用ください。［'+info.errorName+'：'+info.errorMessage+'］',info.errorName!=='AbortError');
}
function sharePrepared(event,trigger='prepared-direct-tap'){
 if(busy||!prepared)return;
 const token=epoch,file=prepared,data={files:[file]},info=shareContext(event,trigger);let sharing;
 // This entire path is synchronous. Reuse the File without regenerating it.
 try{
  if(typeof navigator.share!=='function'||typeof navigator.canShare!=='function'){
   info.result='API unavailable';showShareInfo(info);by('handoffDiagnosticDetails').open=true;state('この環境はZIPの直接共有を利用できません。「端末に保存」または保存リンクをご利用ください。送信は行っていません。',true);return;
  }
  info.stage='canShare';info.canShare=navigator.canShare(data);
  if(!info.canShare){info.result='canShare=false';showShareInfo(info);by('handoffDiagnosticDetails').open=true;state('canShare(files)がfalseのため、この環境はZIPの直接共有を利用できません。「端末に保存」または保存リンクをご利用ください。送信は行っていません。',true);return;}
  info.stage='share';info.activationAtCall=navigator.userActivation?.isActive??null;
  sharing=navigator.share(data);
 }catch(error){finishShare(info,error,token);return;}
 // Disable controls and update the display only AFTER invoking the native API.
 lock(true);state('共有画面を開く処理中… 共有先は端末で選択してください。');showShareInfo(info);
 Promise.resolve(sharing).then(()=>finishShare(info,null,token),error=>finishShare(info,error,token)).finally(()=>lock(false));
}
async function prepareAndShare(event){
 if(busy)return;const token=epoch;let delegated=false;lock(true);
 try{await prepare(T.dateName(),token);if(token!==epoch)return;lock(false);delegated=true;sharePrepared(event,'after-zip-generation');}
 catch(error){if(token===epoch)state('ファイル生成に失敗しました：'+(error.message||String(error))+' 既存データは変更していません。',true);}
 finally{if(!delegated)lock(false);}
}
by('handoffShare').onclick=function(event){if(prepared){sharePrepared(event);return;}void prepareAndShare(event);};
by('handoffSave').onclick=async()=>{if(busy)return;const token=epoch,name=prepared?.name||T.dateName();lock(true);try{let handle=null;if(window.showSaveFilePicker){state('保存先を選択してください。');handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:'KOEDASHI音声セットZIP',accept:{'application/zip':['.zip']}}]});}const file=await prepare(name,token);if(token!==epoch)return;if(handle){state('選択したファイルへ書き込み中…');const writer=await handle.createWritable();try{await writer.write(file);await writer.close();}catch(e){try{await writer.abort();}catch{}throw e;}by('handoffFilename').textContent='保存ファイル名：'+handle.name+' ／ '+(file.size/1048576).toFixed(2)+' MiB';state('選択したファイルへの書込みが完了しました。保存先で確認してください。アプリでは保存先のフルパスは把握できません。');}else{by('handoffDownload').click();state('ZIPのダウンロードを要求しました。保存完了や保存先はアプリでは確認できません。通常は「ダウンロード」などを確認してください。同名ファイルがあるとブラウザが名前を変える場合があります。iPhoneではプレビューの共有から「ファイルに保存」を選べる場合があります。反応しない場合は保存リンクを直接押してください。');}}catch(error){progress.hidden=true;if(token!==epoch)return;state(error.name==='AbortError'?'端末への保存先選択をキャンセルしました。':'ファイル生成・保存に失敗しました：'+(error.message||String(error)),error.name!=='AbortError');}finally{lock(false);}};
by('handoffFile').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file||busy)return;const token=epoch;clear();by('handoffFilename').textContent='読み込むファイル：'+file.name+' ／ '+file.size.toLocaleString()+' bytes';importing=true;lock(true);progress.hidden=false;progress.removeAttribute('value');state('ファイル内容を確認しています…');try{const result=await R.importBackup(file,{isCancelled:()=>token!==epoch,onProgress:value=>{if(token===epoch)updateProgress(value);}});if(token!==epoch)return;if(result?.cancelled){progress.hidden=true;state('追加復元をキャンセルしました。既存データは変更していません。');}else if(result?.ok){progress.max=1;progress.value=1;state('検証済みの音声セットを追加復元しました。録音・パッドを確認してください。'+(result.warning||''),!!result.warning);}else{progress.hidden=true;state(result?.message||'復元に失敗しました。既存データは消去していません。',true);}}catch(error){if(token===epoch)state('復元処理を完了できませんでした：'+(error.message||String(error))+' 画面の保存状態も確認してください。',true);}finally{importing=false;lock(false);}};
by('handoffFile').addEventListener('cancel',()=>{progress.hidden=true;state('ファイル選択をキャンセルしました。');});
})();
