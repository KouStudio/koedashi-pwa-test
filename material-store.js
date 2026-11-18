/* New immutable material: one transaction, no updates to source records. */
(function(root){
'use strict';const S=root.SoraSafe,E=root.AudioEngine,D=root.KoedashiData,T=root.KoedashiAudioTools;
async function save(store,name,state){if(!name.trim())throw Error('素材名を入力してください。');T.check(E.bytes(state.data)*2);const pcm=await D.Codec.pack(state),blob=await E.wav(state.data,state.sr),hash=await S.hash(blob),id=S.uid(),now=Date.now(),ms=state.data[0].length/state.sr*1000;
 return store.transaction(['takes','chunks','edits'],'readwrite',(tx,set)=>{const take={id,name:name.trim().slice(0,80),created:now,status:'complete',chunkCount:1,bytes:blob.size,lastMs:ms,elapsed:ms,mime:'audio/wav',revision:1,editSavedAt:now};tx.objectStore('takes').add(take);tx.objectStore('chunks').add({takeId:id,index:0,blob,hash,size:blob.size,lastMs:ms});tx.objectStore('edits').add({takeId:id,...pcm});set(take);});
}
async function read(store,key){
 if(key.startsWith('pad:')){const p=await store.getPad(key.slice(4));if(!p)throw Error('パッドがありません。');const pcm=p.edit||p.original;T.check(pcm.frames*pcm.channelsCount*4*2);return {data:await S.PCM.decodeData(pcm),sr:pcm.sr,name:p.name};}
 const id=key.slice(5),row=await store.read(id);if(!row.take)throw Error('音声素材がありません。');if(row.edit?.mode==='pcm'){T.check(row.edit.frames*row.edit.channelsCount*4*2);return {data:await S.PCM.decodeData(row.edit),sr:row.edit.sr,name:row.take.name};}
 const source=await store.source(id);if(source.damaged||source.take.status!=='complete')throw Error('未完了・不整合の録音は先に救出して保存してください。');T.check(source.blob.size*8);const AC=root.AudioContext||root.webkitAudioContext,ac=new AC();try{const decoded=await root.AudioCompat.decode(ac,await root.AudioCompat.readFile(source.blob));T.check(decoded.length*decoded.numberOfChannels*8);if(decoded.numberOfChannels>2)throw Error('2チャンネル以下の素材を選んでください。');return {data:E.wrap(Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i))),sr:decoded.sampleRate,name:row.take.name};}finally{await ac.close().catch(()=>{});}
}
root.KoedashiMaterials={save,read};if(typeof module!=='undefined')module.exports=root.KoedashiMaterials;
})(globalThis);
