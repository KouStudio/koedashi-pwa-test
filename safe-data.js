/* Local-only, transaction-confirmed audio storage and portable backups. */
(function(root){
'use strict';
const MAX_BACKUP=1024*1048576, MAGIC='SORA_SAFE_BACKUP_1\n', MAGIC2='KOEDASHI_BACKUP_2\n';
const fail=message=>{throw Error(message);};
const mediaType=t=>typeof t==='string'&&t.length<=100&&(t===''||/^audio\/[a-z0-9.+-]+(?:;[\x20-\x7e]*)?$/i.test(t)||/^video\/(?:webm|mp4|ogg)(?:;[\x20-\x7e]*)?$/i.test(t));
const uid=()=>root.crypto.randomUUID();
const hash=async blob=>Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
class Store{
 constructor(factory=root.indexedDB,name='koedashi-local-v1'){this.factory=factory;this.name=name;this.db=null;}
 async open(){
  if(!this.factory)fail('IndexedDBを利用できません。録音の永続保存を開始できません。');
  if(this.db)return this;
  const r=this.factory.open(this.name,1);
  r.onupgradeneeded=()=>{
   const db=r.result;db.createObjectStore('takes',{keyPath:'id'});
   const chunks=db.createObjectStore('chunks',{keyPath:['takeId','index']});chunks.createIndex('take','takeId');
   db.createObjectStore('edits',{keyPath:'takeId'});db.createObjectStore('meta',{keyPath:'key'});
   db.createObjectStore('scenes',{keyPath:'id'});const pads=db.createObjectStore('pads',{keyPath:'id'});pads.createIndex('scene','sceneId');
  };
  this.db=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('別ウィンドウが保存領域を使用中です。閉じて開き直してください。'));});
  this.db.onversionchange=()=>{this.db.close();this.db=null;};return this;
 }
 // Resolve ONLY on transaction.complete, never on request.success.
 transaction(names,mode,body){
  return new Promise((resolve,reject)=>{
   let tx,result,error;
   try{try{tx=this.db.transaction(names,mode,mode==='readwrite'?{durability:'strict'}:undefined);}catch{tx=this.db.transaction(names,mode);}}
   catch(e){reject(e);return;}
   tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||Error('保存トランザクションが中断されました。'));
   tx.onerror=()=>{};
   const abort=e=>{error=e;try{tx.abort();}catch{reject(e);}};
   try{body(tx,value=>{result=value;},abort);}catch(e){abort(e);}
  });
 }
 async list(){return this.transaction(['takes','meta'],'readonly',(tx,set)=>{const r=tx.objectStore('takes').getAll(),m=tx.objectStore('meta').get('selection');let takes,selection;const done=()=>{if(takes!==undefined&&selection!==undefined)set({takes:takes.sort((a,b)=>a.created-b.created),selected:selection});};r.onsuccess=()=>{takes=r.result;done();};m.onsuccess=()=>{selection=m.result?.value||null;done();};});}
 async create(name,id=uid()){
  const record={id,name:name.slice(0,80),created:Date.now(),status:'recording',chunkCount:0,bytes:0,lastMs:0,elapsed:0,mime:'',revision:0};
  await this.transaction(['takes','meta'],'readwrite',(tx,set)=>{tx.objectStore('takes').add(record);tx.objectStore('meta').put({key:'selection',value:id});set(record);});return record;
 }
 async markStarted(id,recordedAt,name){
  if(!Number.isFinite(recordedAt)||recordedAt<0)fail('録音開始日時が不正です。');
  return this.transaction(['takes'],'readwrite',(tx,set,abort)=>{const t=tx.objectStore('takes'),r=t.get(id);r.onsuccess=()=>{if(!r.result){abort(Error('録音情報がありません。'));return;}const v=r.result;if(v.recordedAt!==undefined){abort(Error('録音開始日時は変更できません。'));return;}v.recordedAt=recordedAt;if(name)v.name=name.slice(0,80);t.put(v);set(v);};});
 }
 async append(id,index,blob,lastMs){
  const digest=await hash(blob);
  return this.transaction(['takes','chunks'],'readwrite',(tx,set,abort)=>{
   const t=tx.objectStore('takes'),r=t.get(id);
   r.onsuccess=()=>{const record=r.result;if(!record||record.status!=='recording'||record.chunkCount!==index){abort(Error('録音チャンクの保存順序に不整合があります。'));return;}
    tx.objectStore('chunks').add({takeId:id,index,blob,hash:digest,size:blob.size,lastMs});
    record.chunkCount++;record.bytes+=blob.size;record.lastMs=lastMs;record.mime=blob.type||record.mime;t.put(record);set(record);
   };
  });
 }
 async finish(id,count,bytes,elapsed,reason,partial=false){
  return this.transaction(['takes'],'readwrite',(tx,set,abort)=>{const t=tx.objectStore('takes'),r=t.get(id);r.onsuccess=()=>{const value=r.result;if(!value||value.chunkCount!==count||value.bytes!==bytes){abort(Error('録音の保存件数・容量を確認できません。'));return;}value.status=partial?'recording':'complete';value.partial=partial;value.elapsed=elapsed;value.reason=reason;value.finished=Date.now();t.put(value);set(value);};});
 }
 async rename(id,name){return this.transaction(['takes'],'readwrite',(tx,set,abort)=>{const t=tx.objectStore('takes'),r=t.get(id);r.onsuccess=()=>{if(!r.result){abort(Error('テイクが別ウィンドウで削除されています。'));return;}r.result.name=name.slice(0,80);t.put(r.result);set(r.result);};});}
 async select(id){return this.transaction(['meta'],'readwrite',tx=>tx.objectStore('meta').put({key:'selection',value:id}));}
 async saveEdit(id,edit,expected){
  return this.transaction(['takes','edits'],'readwrite',(tx,set,abort)=>{const t=tx.objectStore('takes'),r=t.get(id);r.onsuccess=()=>{
   if(!r.result||r.result.revision!==expected){abort(Error('他のウィンドウの変更と競合しました。上書きせず停止しました。バックアップを作成してください。'));return;}
   const revision=expected+1;tx.objectStore('edits').put({takeId:id,...edit});r.result.revision=revision;r.result.editSavedAt=Date.now();t.put(r.result);set(revision);
  };});
 }
 async editInfo(id){return this.transaction(['edits'],'readonly',(tx,set)=>{const r=tx.objectStore('edits').get(id);r.onsuccess=()=>set({mode:r.result?.mode||null});});}
 async read(id){
  return this.transaction(['takes','chunks','edits'],'readonly',(tx,set)=>{
   const a=tx.objectStore('takes').get(id),b=tx.objectStore('chunks').index('take').getAll(id),c=tx.objectStore('edits').get(id);let n=0;const done=()=>{if(++n===3)set({take:a.result,chunks:b.result.sort((x,y)=>x.index-y.index),edit:c.result||null});};a.onsuccess=b.onsuccess=c.onsuccess=done;
  });
 }
 async source(id){
  const row=await this.read(id);if(!row.take)fail('保存されたテイクがありません。');
  const valid=[];let damaged=false,bytes=0,lastMs=0;
  for(let i=0;i<row.take.chunkCount;i++){
   const c=row.chunks[i];
   if(!c||c.index!==i||c.blob.size!==c.size||await hash(c.blob)!==c.hash){damaged=true;break;}
   valid.push(c.blob);bytes+=c.size;lastMs=c.lastMs;
  }
  if(row.chunks.length!==row.take.chunkCount||bytes!==row.take.bytes)damaged=true;
  if(!valid.length)fail('検証できる録音チャンクがありません。元データは削除していません。');
  return {...row,blob:new Blob(valid,{type:row.take.mime||valid[0].type||'application/octet-stream'}),damaged,lastMs,verifiedChunks:valid.length};
 }
 async remove(id){
  return this.transaction(['takes','chunks','edits','meta'],'readwrite',tx=>{
   tx.objectStore('takes').delete(id);tx.objectStore('edits').delete(id);
   const r=tx.objectStore('chunks').index('take').openCursor(id);r.onsuccess=()=>{const cursor=r.result;if(cursor){cursor.delete();cursor.continue();}};
   const m=tx.objectStore('meta').get('selection');m.onsuccess=()=>{if(m.result?.value===id)tx.objectStore('meta').put({key:'selection',value:null});};
  });
 }
 close(){this.db?.close();this.db=null;}
}
const finite=(x,min,max)=>Number.isFinite(x)&&x>=min&&x<=max;
function validateEdit(edit){
 if(!edit||!['original','pcm'].includes(edit.mode)||!finite(edit.sr,8000,192000)||!Number.isSafeInteger(edit.frames)||edit.frames<1||edit.frames>67108864||!finite(edit.channelsCount,1,2)||!Number.isInteger(edit.channelsCount))fail('編集情報の形式が不正です。');
 const duration=edit.frames/edit.sr;
 for(const x of [edit.a,edit.b,edit.pos])if(!finite(x,0,duration+.001))fail('編集範囲が不正です。');
 if(edit.b<edit.a||!finite(edit.zoom,1,16)||!Array.isArray(edit.marks)||edit.marks.length>10000||edit.marks.some(x=>!finite(x,0,duration)))fail('選択・分割情報が不正です。');
 if(edit.mode==='original'&&(!Array.isArray(edit.channels)||edit.channels.length))fail('原音モードの編集情報が不正です。');
 if(edit.mode==='pcm'){
  if(!Array.isArray(edit.channels)||edit.channels.length!==edit.channelsCount)fail('編集PCMのチャンネル数が不正です。');
  for(const channel of edit.channels){if(!Array.isArray(channel)||channel.length>2048||channel.reduce((n,c)=>n+c.blob.size,0)!==edit.frames*4)fail('編集PCMの長さが一致しません。');for(const c of channel)if(c.blob.size>262144||c.blob.size%4||!/^[0-9a-f]{64}$/.test(c.hash))fail('編集PCMブロックが不正です。');}
 }
 return edit;
}
const PCM={
 validate:validateEdit,
 async decodeData(edit){
  validateEdit(edit);if(edit.mode!=='pcm')fail('パッドのPCMがありません。');const out=[];
  for(const channel of edit.channels){const parts=[];for(const c of channel){if(await hash(c.blob)!==c.hash)fail('パッド音声の検証に失敗しました。');const a=new Float32Array(await c.blob.arrayBuffer());for(const x of a)if(!Number.isFinite(x))fail('パッド音声に不正なサンプルがあります。');parts.push(a);}out.push(root.AudioEngine.join(...parts));}return out;
 },
 async pack(state){
  if(new Uint8Array(new Uint16Array([0x0102]).buffer)[0]!==2)fail('この端末のPCM保存形式には対応していません。');
  const edit={mode:state.data===state.original?'original':'pcm',sr:state.sr,frames:state.data[0].length,channelsCount:state.data.length,a:state.a,b:state.b,pos:state.pos,zoom:state.zoom,marks:state.marks.slice(),channels:[]};
  if(edit.mode==='pcm')for(const channel of state.data){const blocks=[];for(let i=0;i<channel.length;i+=65536){const pcm=root.AudioEngine.read(channel,i,Math.min(channel.length,i+65536)),blob=new Blob([pcm]);blocks.push({blob,hash:await hash(blob)});if((blocks.length&7)===0)await root.AudioEngine.pause();}edit.channels.push(blocks);}
  return validateEdit(edit);
 },
 async apply(state,edit){
  validateEdit(edit);const E=root.AudioEngine;
  let original=state.original;
  if(state.sr!==edit.sr){
   original=[];const ratio=state.sr/edit.sr;
   for(const channel of state.original){const parts=[],length=Math.round(channel.length/ratio);for(let start=0;start<length;start+=65536){const end=Math.min(length,start+65536),from=Math.floor(start*ratio),to=Math.min(channel.length,Math.ceil(end*ratio)+1),input=E.read(channel,from,to),output=new Float32Array(end-start);for(let i=start;i<end;i++){const at=i*ratio-from,k=Math.floor(at),mix=at-k;output[i-start]=(input[k]||0)*(1-mix)+(input[Math.min(k+1,input.length-1)]||0)*mix;}parts.push(output);await E.pause();}original.push(E.join(...parts));}
  }
  let data=original;
  if(edit.mode==='original'&&(!Array.isArray(edit.channels)||edit.channels.length))fail('原音モードの編集情報が不正です。');
 if(edit.mode==='pcm'){
   data=[];for(const channel of edit.channels){const parts=[];for(const part of channel){if(await hash(part.blob)!==part.hash)fail('編集PCMの検証に失敗しました。原音は変更していません。');const floats=new Float32Array(await part.blob.arrayBuffer());for(const x of floats)if(!Number.isFinite(x))fail('編集PCMに不正なサンプルがあります。');parts.push(floats);}data.push(E.join(...parts));}
  }else if(Math.abs(original[0].length-edit.frames)>2)fail('原音のデコード長が保存時と一致しません。原音を確認してください。');
  return {...state,original,data,sr:edit.sr,a:edit.a,b:edit.b,pos:edit.pos,zoom:edit.zoom,marks:edit.marks.slice(),raw:false,undo:[],redo:[],clip:null,meta:(data[0].length/edit.sr).toFixed(2)+'秒 · '+edit.sr+' Hz · '+data.length+'ch · 復元'};
 }
};
async function makeBackup(rows,selected,padBundle=null){
 const sections=[],takes=[];let offset=0;
 async function add(blob,digest){const actual=await hash(blob);if(digest&&digest!==actual)fail('保存データの検証に失敗しました。バックアップ成功とは表示しません。');const descriptor={offset,size:blob.size,hash:actual,type:blob.type};sections.push(blob);offset+=blob.size;if(offset>MAX_BACKUP)fail('バックアップの1GiB目安を超えます。個別WAV保存も利用してください。');return descriptor;}
 for(const row of rows){
  const t=row.take,original=[];
  if(!row.chunks.length)continue;
  if(row.chunks.length!==t.chunkCount||row.chunks.reduce((n,c)=>n+c.blob.size,0)!==t.bytes)fail('元チャンクの件数・容量が一致しません。');
  for(let i=0;i<row.chunks.length;i++){const c=row.chunks[i];if(c.index!==i)fail('元チャンクが欠落しています。');original.push({...await add(c.blob,c.hash),lastMs:c.lastMs});}
  let edit=null;if(row.edit){validateEdit(row.edit);edit={...row.edit,channels:[]};for(const channel of row.edit.channels){const parts=[];for(const c of channel)parts.push(await add(c.blob,c.hash));edit.channels.push(parts);}delete edit.takeId;}
  takes.push({id:t.id,name:t.name,mime:t.mime,status:t.status,created:t.created,...(t.recordedAt!==undefined?{recordedAt:t.recordedAt}:{}),elapsed:t.elapsed,lastMs:t.lastMs,reason:t.reason||'',original,edit});
 }
 const scenes=padBundle?.scenes||[],pads=[];
 async function encodePCM(pcm){validateEdit(pcm);if(pcm.mode!=='pcm')fail('パッドのPCMがありません。');const value={...pcm,channels:[]};for(const channel of pcm.channels){const parts=[];for(const c of channel)parts.push(await add(c.blob,c.hash));value.channels.push(parts);}return value;}
 if(padBundle)for(const p of padBundle.pads){pads.push({id:p.id,sceneId:p.sceneId,name:p.name,order:p.order,created:p.created,sourceTakeId:p.sourceTakeId||null,original:await encodePCM(p.original),edit:p.edit?await encodePCM(p.edit):null});}
 if(!takes.length&&!scenes.length)fail('バックアップできるデータがありません。');
 const metadata=padBundle?{version:2,created:Date.now(),selected,takes,scenes,layout:padBundle.layout,pads}:{version:1,created:Date.now(),selected,takes};
 const json=new TextEncoder().encode(JSON.stringify({...metadata,metadataHash:await hash(new Blob([JSON.stringify(metadata)]))}));if(json.length>2*1048576)fail('バックアップ情報が大きすぎます。');
 const size=new ArrayBuffer(4);new DataView(size).setUint32(0,json.length,true);
 return new Blob([padBundle?MAGIC2:MAGIC,size,json,...sections],{type:'application/octet-stream'});
}
async function parseBackup(file){
 if(file.size>MAX_BACKUP+2*1048576+64)fail('バックアップが大きすぎます。');
 const text=await file.slice(0,32).text(),magic=text.startsWith(MAGIC2)?MAGIC2:text.startsWith(MAGIC)?MAGIC:null;if(!magic)fail('SORA / KOEDASHIバックアップ形式ではありません。');
 const prefix=new TextEncoder().encode(magic),start=prefix.length+4;
 const headerSize=new DataView(await file.slice(prefix.length,start).arrayBuffer()).getUint32(0,true);
 if(headerSize>2*1048576||start+headerSize>file.size)fail('バックアップヘッダーが破損しています。');
 const header=JSON.parse(await file.slice(start,start+headerSize).text()),base=start+headerSize;
 const {metadataHash,...metadata}=header;
 if(typeof metadataHash!=='string'||await hash(new Blob([JSON.stringify(metadata)]))!==metadataHash)fail('バックアップ情報のチェックサムが一致しません。既存データは変更していません。');
 if(![1,2].includes(header.version)||header.version!==(magic===MAGIC2?2:1)||!Array.isArray(header.takes)||(header.version===1&&!header.takes.length))fail('バックアップの版・テイク数が不正です。');
 let offset=0;const ids=new Set(),rows=[];
 async function get(d){
  if(!d||!Number.isSafeInteger(d.size)||d.size<1||d.size>MAX_BACKUP||d.offset!==offset||base+offset+d.size>file.size||!/^[0-9a-f]{64}$/.test(d.hash)||(!mediaType(d.type)&&d.type!=='application/octet-stream'))fail('バックアップ音声の範囲が不正です。');
  const blob=file.slice(base+offset,base+offset+d.size,d.type);offset+=d.size;
  if(await hash(blob)!==d.hash)fail('バックアップのチェックサムが一致しません。既存データは変更していません。');return {blob,hash:d.hash};
 }
 for(const t of header.takes){
  if(t.recordedAt!==undefined&&!finite(t.recordedAt,0,8640000000000000))fail('録音開始日時が不正です。');
  if(typeof t.id!=='string'||ids.has(t.id)||typeof t.name!=='string'||t.name.length>80||!mediaType(t.mime)||!['complete','recording'].includes(t.status)||!Array.isArray(t.original)||t.original.length>10000||!finite(t.lastMs,0,1e12)||!finite(t.elapsed,0,1e12)||!finite(t.created,0,1e15))fail('テイク情報が不正です。');
  ids.add(t.id);const chunks=[];
  for(const d of t.original){if(!finite(d.lastMs,0,1e12))fail('チャンクの時刻が不正です。');chunks.push({...await get(d),lastMs:d.lastMs,index:chunks.length,size:d.size});}
  if(!chunks.length)fail('原音がありません。');
  let edit=null;
  if(t.edit){edit={...t.edit,channels:[]};if(!Array.isArray(t.edit.channels)||t.edit.channels.length>2)fail('編集情報が不正です。');for(const channel of t.edit.channels){if(!Array.isArray(channel)||channel.length>2048)fail('PCMブロック数が不正です。');const blocks=[];for(const d of channel)blocks.push(await get(d));edit.channels.push(blocks);}validateEdit(edit);}
  rows.push({take:{id:t.id,name:t.name,mime:t.mime,status:t.status,created:t.created,...(t.recordedAt!==undefined?{recordedAt:t.recordedAt}:{}),elapsed:t.elapsed,lastMs:t.lastMs,reason:typeof t.reason==='string'?t.reason.slice(0,1000):'',chunkCount:chunks.length,bytes:chunks.reduce((n,c)=>n+c.size,0),revision:edit?1:0},chunks,edit});
 }
 const scenes=[],pads=[];let layout=null;
 async function decodePCM(value){if(!value||value.mode!=='pcm'||!Array.isArray(value.channels)||value.channels.length>2)fail('パッドPCMの形式が不正です。');const pcm={...value,channels:[]};for(const channel of value.channels){if(!Array.isArray(channel)||channel.length>2048)fail('パッドPCMが大きすぎます。');const parts=[];for(const d of channel)parts.push(await get(d));pcm.channels.push(parts);}validateEdit(pcm);return pcm;}
 if(header.version===2){
  if(!Array.isArray(header.scenes)||!header.scenes.length||!Array.isArray(header.pads)||header.pads.length>256)fail('シーン／パッド数が不正です。');
  const sceneIds=new Set(),padIds=new Set();
  for(const scene of header.scenes){if(typeof scene.id!=='string'||sceneIds.has(scene.id)||typeof scene.name!=='string'||!scene.name.trim()||scene.name.length>80||!Number.isSafeInteger(scene.order)||scene.order<0)fail('シーン情報が不正です。');sceneIds.add(scene.id);scenes.push({id:scene.id,name:scene.name,order:scene.order,created:finite(scene.created,0,1e15)?scene.created:Date.now()});}
  for(const p of header.pads){if(typeof p.id!=='string'||padIds.has(p.id)||!sceneIds.has(p.sceneId)||typeof p.name!=='string'||!p.name.trim()||p.name.length>80||!Number.isSafeInteger(p.order)||p.order<0)fail('パッド情報が不正です。');padIds.add(p.id);pads.push({id:p.id,sceneId:p.sceneId,name:p.name,order:p.order,created:finite(p.created,0,1e15)?p.created:Date.now(),sourceTakeId:typeof p.sourceTakeId==='string'?p.sourceTakeId:null,original:await decodePCM(p.original),edit:p.edit?await decodePCM(p.edit):null,revision:p.edit?1:0});}
  if(scenes.some(scene=>pads.filter(p=>p.sceneId===scene.id).length>64))fail('1シーンのパッド数が64件を超えます。');
  const v=header.layout;if(!v||!['record','edit','pads'].includes(v.mode)||(v.sceneId&&!sceneIds.has(v.sceneId))||(v.editingPadId&&!padIds.has(v.editingPadId)))fail('画面構成が不正です。');layout={mode:v.mode,sceneId:v.sceneId||scenes[0].id,editingPadId:v.editingPadId||null};
 }
 if(base+offset!==file.size)fail('バックアップ末尾に不正なデータがあります。');return {rows,scenes,pads,layout,selected:typeof header.selected==='string'?header.selected:null};
}
Store.prototype.importBackup=async function(parsed){
 const idMap=new Map(parsed.rows.map(row=>[row.take.id,uid()])),sceneMap=new Map((parsed.scenes||[]).map(s=>[s.id,uid()])),padMap=new Map((parsed.pads||[]).map(p=>[p.id,uid()]));
 await this.transaction(['takes','chunks','edits','meta','scenes','pads'],'readwrite',(tx,set,abort)=>{
  const t=tx.objectStore('takes').count(),ss=tx.objectStore('scenes').getAll(),pp=tx.objectStore('pads').count();let n=0;
  const done=()=>{if(++n!==3)return;
   if(pp.result+padMap.size>256){abort(Error('復元後の件数目安を超えます。先に外部バックアップを確認して整理してください。'));return;}
   for(const row of parsed.rows){const id=idMap.get(row.take.id);tx.objectStore('takes').add({...row.take,id,restored:Date.now()});for(const c of row.chunks)tx.objectStore('chunks').add({...c,takeId:id});if(row.edit)tx.objectStore('edits').add({...row.edit,takeId:id});}
   const offset=Math.max(-1,...ss.result.map(s=>s.order))+1;
   [...(parsed.scenes||[])].sort((a,b)=>a.order-b.order).forEach((s,i)=>tx.objectStore('scenes').add({...s,id:sceneMap.get(s.id),order:offset+i}));
   for(const p of parsed.pads||[])tx.objectStore('pads').add({...p,id:padMap.get(p.id),sceneId:sceneMap.get(p.sceneId),sourceTakeId:idMap.get(p.sourceTakeId)||null});
   tx.objectStore('meta').put({key:'selection',value:idMap.get(parsed.selected)||null});
   if(parsed.layout)tx.objectStore('meta').put({key:'pad-layout',value:{mode:parsed.layout.mode,sceneId:sceneMap.get(parsed.layout.sceneId),editingPadId:padMap.get(parsed.layout.editingPadId)||null}});
   set(idMap);
  };t.onsuccess=ss.onsuccess=pp.onsuccess=done;
 });idMap.sceneMap=sceneMap;idMap.padMap=padMap;return idMap;
};
class EditQueue{
 constructor(store,pack=PCM.pack,onState=()=>{}){this.store=store;this.pack=pack;this.onState=onState;this.jobs=new Map();}
 enqueue(id,state,revision){
  let job=this.jobs.get(id);if(!job){job={revision,pending:null,running:null,timer:null};this.jobs.set(id,job);}
  job.pending=state;clearTimeout(job.timer);this.onState(id,'saving');
  job.timer=setTimeout(()=>{this.flush(id).catch(()=>{});},700);
 }
 async flush(id){
  const job=this.jobs.get(id);if(!job)return;
  clearTimeout(job.timer);
  if(job.running){await job.running;if(job.pending)return this.flush(id);return;}
  if(!job.pending)return;
  job.running=(async()=>{
   while(job.pending){const state=job.pending;job.pending=null;try{
    this.onState(id,'saving');const edit=await this.pack(state);job.revision=await this.store.saveEdit(id,edit,job.revision);
    this.onState(id,job.pending?'saving':'saved',null,job.revision);
   }catch(error){if(!job.pending)job.pending=state;this.onState(id,'failed',error);throw error;}}
  })();
  try{await job.running;}finally{job.running=null;}
 }
 async flushAll(){await Promise.all([...this.jobs.keys()].map(id=>this.flush(id)));}
 pending(id){return this.jobs.get(id)?.pending||null;}
 busy(){return [...this.jobs.values()].some(j=>j.pending||j.running);}
 drop(id){const job=this.jobs.get(id);if(job)clearTimeout(job.timer);this.jobs.delete(id);}
}
root.SoraSafe={Store,PCM,EditQueue,hash,makeBackup,parseBackup,uid};if(typeof module!=='undefined')module.exports=root.SoraSafe;
})(globalThis);
