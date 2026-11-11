/* Separate KOEDASHI database. Legacy SAFE is READ ONLY and never upgraded/deleted. */
(function(root){
'use strict';
const S=root.SoraSafe, uid=S.uid;
async function legacySnapshot(factory){
 if(factory.databases){try{const names=await factory.databases();if(!names.some(d=>d.name==='sora-audio-safe-v1'))return null;}catch{/* Fall back to a non-upgrading open; absent legacy creation is aborted. */}}
 const db=await new Promise((resolve,reject)=>{const r=factory.open('sora-audio-safe-v1');let absent=false;r.onupgradeneeded=()=>{absent=true;r.transaction.abort();};r.onerror=()=>absent?resolve(null):reject(r.error);r.onsuccess=()=>resolve(r.result);r.onblocked=()=>reject(Error('旧SAFEの保存領域を読み取れません。旧版のタブを閉じて再試行してください。'));});
 if(!db)return null;
 try{return await new Promise((resolve,reject)=>{const names=['takes','chunks','edits','meta'];if(names.some(n=>!db.objectStoreNames.contains(n))){reject(Error('旧SAFEの保存形式を確認できません。元データは変更していません。'));return;}const tx=db.transaction(names,'readonly'),snapshot={};for(const name of names){const r=tx.objectStore(name).getAll();r.onsuccess=()=>snapshot[name]=r.result;}tx.oncomplete=()=>resolve(snapshot);tx.onabort=()=>reject(tx.error||Error('旧データの読み取りが中断されました。'));});}finally{db.close();}
}
S.Store.prototype.migrateLegacy=async function(){
 const marker=await this.transaction(['meta'],'readonly',(tx,set)=>{const r=tx.objectStore('meta').get('legacy-copy');r.onsuccess=()=>set(r.result);});if(marker)return marker;
 const source=await legacySnapshot(this.factory);
 return this.transaction(['takes','chunks','edits','meta'],'readwrite',(tx,set,abort)=>{
  const meta=tx.objectStore('meta'),m=meta.get('legacy-copy');m.onsuccess=()=>{
   if(m.result){set(m.result);return;}
   const count=tx.objectStore('takes').count();count.onsuccess=()=>{
    const copied=source&&count.result===0;
    if(copied){for(const n of ['takes','chunks','edits'])for(const row of source[n])tx.objectStore(n).add(row);for(const row of source.meta)if(row.key==='selection')meta.put(row);}
    const result={key:'legacy-copy',source:'sora-audio-safe-v1',copied:!!copied,count:copied?source.takes.length:0,at:Date.now(),note:count.result&&source?'新領域に録音があるため自動コピーせず保持':source?'読み取り専用コピー。原音検証は読み込み時':'同一オリジンの旧データなし'};
    meta.add(result);set(result);
   };
  };
 });
};
class PadStore extends S.Store{
 async layout(){return this.transaction(['scenes','pads','meta'],'readonly',(tx,set)=>{const a=tx.objectStore('scenes').getAll(),b=tx.objectStore('pads').getAll(),c=tx.objectStore('meta').get('pad-layout');let n=0;const done=()=>{if(++n===3)set({scenes:a.result.sort((x,y)=>x.order-y.order||x.id.localeCompare(y.id)),pads:b.result.sort((x,y)=>x.order-y.order||x.id.localeCompare(y.id)),layout:c.result?.value||{mode:'record',sceneId:null,editingPadId:null}});};a.onsuccess=b.onsuccess=c.onsuccess=done;});}
 async ensureScene(){return this.transaction(['scenes','meta'],'readwrite',(tx,set)=>{const r=tx.objectStore('scenes').getAll();r.onsuccess=()=>{if(r.result.length){set(r.result[0]);return;}const scene={id:uid(),name:'シーン1',order:0,created:Date.now()};tx.objectStore('scenes').add(scene);tx.objectStore('meta').put({key:'pad-layout',value:{mode:'record',sceneId:scene.id,editingPadId:null}});set(scene);};});}
 async saveLayout(value){return this.transaction(['meta'],'readwrite',tx=>tx.objectStore('meta').put({key:'pad-layout',value}));}
 async createScene(name){return this.transaction(['scenes'],'readwrite',(tx,set,abort)=>{const r=tx.objectStore('scenes').getAll();r.onsuccess=()=>{const value={id:uid(),name:name.trim().slice(0,80)||'新しいシーン',order:Math.max(-1,...r.result.map(s=>s.order))+1,created:Date.now()};tx.objectStore('scenes').add(value);set(value);};});}
 async rename(kind,id,name){if(!['pads','scenes'].includes(kind))throw Error('不正な変更対象です。');return this.transaction([kind],'readwrite',(tx,set,abort)=>{const table=tx.objectStore(kind),r=table.get(id);r.onsuccess=()=>{if(!r.result){abort(Error('対象が別の画面で削除されています。'));return;}r.result.name=name.trim().slice(0,80)||r.result.name;table.put(r.result);set(r.result);};});}
 async reorder(kind,id,direction){return this.transaction([kind],'readwrite',(tx,set,abort)=>{if(!['pads','scenes'].includes(kind)||![-1,1].includes(direction)){abort(Error('並べ替えの指定が不正です。'));return;}const table=tx.objectStore(kind),r=table.getAll();r.onsuccess=()=>{const target=r.result.find(v=>v.id===id);if(!target){abort(Error('並べ替え対象がありません。'));return;}const group=r.result.filter(v=>kind==='scenes'||v.sceneId===target.sceneId).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)),i=group.findIndex(v=>v.id===id),j=i+direction;if(j<0||j>=group.length){set(false);return;}[group[i],group[j]]=[group[j],group[i]];group.forEach((v,n)=>{v.order=n;table.put(v);});set(true);};});}
 async createPad(sceneId,name,original,sourceTakeId=null){S.PCM.validate(original);if(original.mode!=='pcm')throw Error('登録音声のPCMがありません。');return this.transaction(['scenes','pads'],'readwrite',(tx,set,abort)=>{const scene=tx.objectStore('scenes').get(sceneId),all=tx.objectStore('pads').getAll();let n=0;const done=()=>{if(++n!==2)return;if(!scene.result){abort(Error('登録先シーンがありません。'));return;}const group=all.result.filter(p=>p.sceneId===sceneId);if(all.result.length>=256||group.length>=64){abort(Error('パッド数の目安（1シーン64・全体256）に達しています。'));return;}const value={id:uid(),sceneId,name:name.trim().slice(0,80)||'無題の音声',original,edit:null,revision:0,sourceTakeId,order:Math.max(-1,...group.map(p=>p.order))+1,created:Date.now()};tx.objectStore('pads').add(value);set(value);};scene.onsuccess=all.onsuccess=done;});}
 async getPad(id){return this.transaction(['pads'],'readonly',(tx,set)=>{const r=tx.objectStore('pads').get(id);r.onsuccess=()=>set(r.result);});}
 async saveEdit(id,edit,expected){S.PCM.validate(edit);return this.transaction(['pads'],'readwrite',(tx,set,abort)=>{const table=tx.objectStore('pads'),r=table.get(id);r.onsuccess=()=>{if(!r.result||r.result.revision!==expected){abort(Error('パッド編集が他の画面と競合しました。上書きせず停止しました。'));return;}r.result.edit=edit;r.result.revision++;table.put(r.result);set(r.result.revision);};});}
 async resetEdit(id,expected){const saved=await this.getPad(id);if(!saved)throw Error('パッドがありません。');S.PCM.validate(saved.original);for(const channel of saved.original.channels)for(const c of channel)if(await S.hash(c.blob)!==c.hash)throw Error('登録時の音声に不整合があるため、編集を消さず復帰を中止しました。');return this.transaction(['pads'],'readwrite',(tx,set,abort)=>{const table=tx.objectStore('pads'),r=table.get(id);r.onsuccess=()=>{if(!r.result||r.result.revision!==expected){abort(Error('編集リビジョンが競合しました。'));return;}r.result.edit=null;r.result.revision++;table.put(r.result);set(r.result.revision);};});}
 async removePad(id){return this.transaction(['pads'],'readwrite',tx=>tx.objectStore('pads').delete(id));}
 async removeScene(id){return this.transaction(['scenes','pads','meta'],'readwrite',(tx,set)=>{const scenes=tx.objectStore('scenes'),r=scenes.getAll();r.onsuccess=()=>{scenes.delete(id);const remaining=r.result.filter(s=>s.id!==id).sort((a,b)=>a.order-b.order);if(!remaining.length){const scene={id:uid(),name:'シーン1',order:0,created:Date.now()};scenes.add(scene);remaining.push(scene);}tx.objectStore('meta').put({key:'pad-layout',value:{mode:'pads',sceneId:remaining[0].id,editingPadId:null}});set(remaining[0].id);};const pads=tx.objectStore('pads').index('scene').openCursor(id);pads.onsuccess=()=>{const c=pads.result;if(c){c.delete();c.continue();}};});}
}
const Codec={
 async pack(state){return S.PCM.pack({...state,original:[]});},
 async state(pad){const original=await S.PCM.decodeData(pad.original),current=pad.edit?await S.PCM.decodeData(pad.edit):original,edit=pad.edit||pad.original;return {original,data:current,sr:edit.sr,clip:null,undo:[],redo:[],pos:edit.pos,a:edit.a,b:edit.b,zoom:edit.zoom,raw:false,isVideo:false,file:null,marks:edit.marks.slice(),filename:pad.name+'.wav',meta:(edit.frames/edit.sr).toFixed(2)+'秒 · '+edit.sr+' Hz · '+edit.channelsCount+'ch · 声出しパッド'};}
};
root.KoedashiData={PadStore,Codec,legacySnapshot};if(typeof module!=='undefined')module.exports=root.KoedashiData;
})(globalThis);
