/* Adapter to the unchanged classic editor script. PCM arrays are shared, never cloned. */
(function () {
  'use strict';
  const rawLoad = $('file').onchange;
  const oldReserve = reserve;
  let external = () => [], beforeFile = () => {}, afterFile = () => {}, activeFile = null, changed = () => {};
  const listeners=new Set(),contexts=new Set();let owner={type:'file',id:null};
  const budget = (navigator.deviceMemory && navigator.deviceMemory <= 2 ? 128 : 256) * 1048576;
  const documents = state => state ? [state.original,state.data,state.clip,...state.undo.map(s=>s.data),...state.redo.map(s=>s.data)] : [];
  function capture() {
    if (!data) return null;
    return {original,data,sr,clip,undo:undo.slice(),redo:redo.slice(),pos,a,b,zoom,raw,isVideo,file:activeFile,marks:marks.slice(),filename:$('filename').textContent,meta:$('meta').textContent};
  }
  reserve = function (extra = 0) {
    oldReserve(extra);
    const retained = external().filter(Boolean).flatMap(documents);
    // Leave the original single-document long-audio budget unchanged.
    if(!retained.length)return;
    if (E.bytes(original,data,clip,...undo.map(s=>s.data),...redo.map(s=>s.data),...retained) + extra > budget) throw Error('テイク全体のPCMメモリ目安を超えます。不要なテイクを削除し、短い範囲で編集してください。');
  };
  function restore(s) {
    const carriedClip=clip, carriedRate=sr;
    stop(); clearPreparedExport();
    if (url) URL.revokeObjectURL(url);
    url=null;
    if (!s) {
      original=data=undefined; activeFile=null;clip=null; undo=[];redo=[];marks=[];url=null;isVideo=false;raw=false;a=b=pos=0;
      $('editor').hidden=$('dock').hidden=true;$('video').pause();$('video').removeAttribute('src');$('video').load();
      status('録音するか、音声・動画ファイルを開いてください。');return;
    }
    ({original,data,sr,clip,pos,a,b,zoom,raw,isVideo}=s);
    clip=carriedClip && carriedRate===sr ? carriedClip : null;
    activeFile=s.file;
    if(isVideo && activeFile)url=URL.createObjectURL(activeFile);
    undo=s.undo.slice();redo=s.redo.slice();marks=s.marks.slice();
    $('filename').textContent=s.filename;$('meta').textContent=s.meta;
    $('video').hidden=!isVideo;$('videohelp').hidden=!isVideo;
    if (isVideo && url) { $('video').src=url;$('video').load(); }
    else { $('video').removeAttribute('src');$('video').load(); }
    $('mode').textContent=isVideo?'VIDEO / 尺を維持':'AUDIO';
    $('editor').hidden=$('dock').hidden=false;
    $('compare').textContent=raw?'試聴：編集前（原音）':'試聴：編集後';
    $('clipboard').textContent=clip?'コピー済み：'+(clip[0].length/sr).toFixed(3)+'秒 / '+clip.length+'ch':'コピーした音声は、挿入または選択範囲の置換に使えます。';
    drawKey=null;update();status('編集状態を復元しました。');
  }
  async function load(file, {keepClipboard=false,audioOnly=false}={}) {
    if (busy) throw Error('編集処理が終わってから操作してください。');
    const previous=capture(), old=original;
    await rawLoad({target:{files:[file],value:''}});
    if (original===old) {
      const error=$('status').textContent;restore(previous);status(error,true);throw Error(error);
    }
    // The legacy loader treats every .webm as video. Microphone captures
    // always contain audio-only tracks and must retain cut/insert/fade tools.
    if(audioOnly){
      isVideo=false;
      $('video').onerror=null;$('video').pause();$('video').hidden=true;
      $('video').removeAttribute('src');$('video').load();
      if(url)URL.revokeObjectURL(url);url=null;
      $('videohelp').hidden=true;$('mode').textContent='AUDIO';update();
    }
    activeFile=file;
    if(keepClipboard && previous && previous.sr===sr){clip=previous.clip;update();}
    return capture();
  }
  $('file').onchange=async event=>{
    if (busy || !event.target.files[0]) return;
    const previousOwner=owner;beforeFile();
    try { await load(event.target.files[0]);afterFile(true,event.target.files[0]); }
    catch { afterFile(false);window.SoraEditorBridge.setContext(previousOwner); }
    finally { event.target.value=''; }
  };
  const baseUpdate=update;
  update=function(){baseUpdate();const state=capture();changed(state);for(const fn of listeners)fn(state);};
  window.SoraEditorBridge={
    onChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
    onContext(fn){contexts.add(fn);},
    context(){return owner;},
    setContext(next){if(next.type===owner.type&&next.id===owner.id)return;for(const fn of contexts)fn(next,capture(),owner);owner=next;},
    stopPreview(){stop();cursor();},
    async prepare(state){await preparePeaks(state.original);await preparePeaks(state.data);},
    capture,restore,load,documents,hasData:()=>!!data,isBusy:()=>busy,
    lock(value){stop();setBusy(value);},
    setExternalStates(fn){external=fn;},
    onFileLoad(before,after){beforeFile=before;afterFile=after;},
    rename(name){if(data)$('filename').textContent=name;},
    totalBytes(states){return E.bytes(...states.flatMap(documents),...documents(capture()));},
    budget
  };
})();
