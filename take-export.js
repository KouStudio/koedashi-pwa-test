/* Exact-ID, read-only recording exports. Never reads or changes editor state. */
(function(root){
'use strict';
const S=root.SoraSafe||(typeof require==='function'?require('./safe-data.js'):null),E=root.AudioEngine||(typeof require==='function'?require('./engine.js'):null);
async function create(store,id,kind,decode){
 if(!['original','edited'].includes(kind))throw Error('WAVの種類が不正です。');
 let row,data,sr;
 if(kind==='edited'){
  row=await store.read(id);if(!row.take||row.take.id!==id)throw Error('対象の録音がありません。');
  if(row.edit?.mode!=='pcm')throw Error('保存済みの編集音声がありません。');
  const budget=root.navigator?.deviceMemory<=2?64*1048576:128*1048576;
  if(row.edit.frames*row.edit.channelsCount*4>budget)throw Error('WAV変換のメモリ目安を超えます。バックアップをご利用ください。');
  data=await S.PCM.decodeData(row.edit);sr=row.edit.sr;
 }else{
  row=await store.source(id);if(row.take.id!==id)throw Error('対象の録音IDが一致しません。');
  if(row.damaged||row.take.status!=='complete')throw Error('原音に不整合または未完了録音があります。「救出を試す」で確認し、原本・バックアップを保存してください。完全な原音WAVとしては出力しません。');
  if(decode){const audio=await decode(row.blob);data=audio.data;sr=audio.sr;}
  else{
   const AC=root.AudioContext||root.webkitAudioContext;if(!AC)throw Error('このブラウザでは音声変換できません。');
   const ctx=new AC();try{const b=await root.AudioCompat.decode(ctx,await row.blob.arrayBuffer());
    if(b.numberOfChannels<1||b.numberOfChannels>2)throw Error('2チャンネルを超える録音は変換できません。');
    const budget=root.navigator?.deviceMemory<=2?64*1048576:128*1048576;
    if(b.length*b.numberOfChannels*4>budget)throw Error('WAV変換のメモリ目安を超えます。原本保存またはバックアップをご利用ください。');
    data=E.wrap(Array.from({length:b.numberOfChannels},(_,i)=>b.getChannelData(i)));sr=b.sampleRate;
   }finally{await ctx.close().catch(()=>{});}
  }
 }
 if(!data?.length||!data[0]?.length||!Number.isFinite(sr))throw Error('音声を変換できません。');
 const budget=root.navigator?.deviceMemory<=2?64*1048576:128*1048576;
 if(data[0].length*data.length*4>budget)throw Error('WAV変換のメモリ目安を超えます。バックアップをご利用ください。');
 const blob=await E.wav(data,sr);return {blob,take:row.take,kind,seconds:data[0].length/sr};
}
const api={create};if(typeof module==='object'&&module.exports)module.exports=api;else root.KoedashiTakeExport=api;
})(typeof window==='object'?window:globalThis);
