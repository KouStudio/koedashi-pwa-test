/* Read-only exact-pad export. Uses the same 16-bit WAV encoder as the editor. */
(function(root){
'use strict';
const S=root.SoraSafe||(typeof require==='function'?require('./safe-data.js'):null),E=root.AudioEngine||(typeof require==='function'?require('./engine.js'):null);
function filename(name){let stem=String(name||'').replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g,'_').trim().replace(/\.wav$/i,'').replace(/[. ]+$/g,'').slice(0,80);if(!stem||/^\.+$/.test(stem))stem='パッド';if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem))stem='_'+stem;return stem+'.wav';}
async function create(store,id,progress=()=>{}){
 // A single DB snapshot is the source. Never consult the live editor or meta drafts.
 const pad=await store.getPad(id);if(!pad||pad.id!==id)throw Error('対象のパッドがありません。');
 const pcm=pad.edit||pad.original;if(!pcm)throw Error('このパッドに音声が登録されていません。');S.PCM.validate(pcm);
 const budget=root.navigator?.deviceMemory<=2?64*1048576:128*1048576;
 if(pcm.frames*pcm.channelsCount*4>budget)throw Error('WAV変換のメモリ目安を超えます。音声セットのバックアップをご利用ください。');
 const data=await S.PCM.decodeData(pcm),blob=await E.wav(data,pcm.sr,progress);
 return {blob,id:pad.id,name:pad.name,filename:filename(pad.name),seconds:pcm.frames/pcm.sr,edited:!!pad.edit};
}
function ui(store){
 const doc=root.document,box=doc.createElement('section');box.id='koPadWavReady';box.className='panel';box.hidden=true;box.style.overflowWrap='anywhere';box.setAttribute('aria-label','パッドWAV書き出し');
 const info=doc.createElement('p');info.id='koPadWavInfo';info.className='hint';info.setAttribute('role','status');info.setAttribute('aria-live','polite');
 const link=doc.createElement('a');link.id='koPadWavDownload';link.textContent='WAVをダウンロード';link.target='_blank';link.rel='noopener';link.hidden=true;
 const share=doc.createElement('button');share.id='koPadWavShare';share.textContent='共有／ファイルに保存';share.hidden=true;
 const note=doc.createElement('p');note.className='hint';note.textContent='確定保存済みのパッド音声全体です。未確定下書き・パッド再生音量は含めません。端末への保存後、実ファイルを確認してください。';
 box.append(info,share,doc.createTextNode(' '),link,note);doc.getElementById('koLegacyWave').after(box);
 let generating=false,prepared=null;
 const status=(text,error=false)=>{info.textContent=text;info.className=error?'hint rec-error':'hint';};
 link.onclick=()=>status('準備済みWAV：'+prepared.file.name+' を開きます。保存されない場合はプレビューの共有から「ファイルに保存」を選んでください。');
 share.onclick=()=>{if(!prepared||generating)return;const saved=prepared;try{
  // Direct trusted tap: do not move navigator.share behind async work.
  const request=root.navigator.share({files:[saved.file]});status('「'+saved.file.name+'」の共有画面を開く処理中…');
  Promise.resolve(request).then(()=>status('共有操作が終了しました。端末または共有先で「'+saved.file.name+'」を確認してください。'),e=>status((e.name==='AbortError'?'共有をキャンセルしました。準備済みWAVは再利用できます。':'WAV共有失敗：'+(e.name||'Error')+'：'+e.message+' ダウンロードをご利用ください。'),e.name!=='AbortError'));
 }catch(e){status('WAV共有失敗：'+(e.name||'Error')+'：'+e.message+' ダウンロードをご利用ください。',true);}};
 return {async export(id){
  if(generating){status('WAVを作成中です。完了後、別のパッドの書き出しを選んでください。');return;}
  generating=true;box.hidden=false;status('選択したパッドの保存済み音声からWAVを作成中…');share.disabled=true;box.scrollIntoView({block:'nearest'});
  try{
   const result=await create(store,id,p=>status('選択したパッドのWAVを作成中… '+Math.round(p*100)+'%'));
   const file=new File([result.blob],result.filename,{type:'audio/wav'}),url=URL.createObjectURL(file);if(prepared)URL.revokeObjectURL(prepared.url);prepared={file,url,id:result.id};
   link.href=url;link.download=file.name;link.textContent='WAVをダウンロード：'+file.name;link.hidden=false;share.hidden=!root.AudioCompat.canShare(file,root.navigator);
   status('WAV作成済み：'+result.name+'（'+result.seconds.toFixed(2)+'秒 ／ '+(result.edited?'確定保存済みの編集音声':'登録済みの音声')+'）。端末への保存完了は確認できません。');
   if(!root.AudioCompat.isAppleTouch(root.navigator)){const download=doc.createElement('a');download.href=url;download.download=file.name;doc.body.append(download);download.click();download.remove();}
  }catch(e){status('WAV書き出し失敗：'+(e.name||'Error')+'：'+(e.message||String(e))+' 元データは変更していません。'+(prepared?' 表示中のリンクは前回作成分「'+prepared.file.name+'」です。':''),true);}
  finally{generating=false;share.disabled=false;}
 }};
}
const api={create,filename,ui};root.KoedashiPadExport=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
