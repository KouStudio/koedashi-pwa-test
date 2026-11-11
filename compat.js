(function(root){
'use strict';
const C={
 isAppleTouch(nav){return /iPhone|iPad|iPod/.test(nav.userAgent||'')||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1)},
 isVideo(f){return (f.type||'').startsWith('video/')||/\.(mp4|webm|mov|m4v|mkv)$/i.test(f.name||'')},
 createContext(onstate){const Constructor=root.AudioContext||root.webkitAudioContext;if(!Constructor)throw Error('このブラウザではWeb Audio APIを使用できません。SafariまたはChromeで開いてください。');const ac=new Constructor();ac.onstatechange=()=>onstate(ac);return ac},
 resume(ac,timeout=4000){if(ac.state==='running')return Promise.resolve();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('音声を再開できませんでした。再生をもう一度タップしてください。')),timeout);let resumed;try{resumed=ac.resume()}catch(e){clearTimeout(timer);reject(e);return}Promise.resolve(resumed).then(()=>{clearTimeout(timer);if(ac.state==='running')resolve();else reject(Error('音声が中断されています。再生をもう一度タップしてください。'))},e=>{clearTimeout(timer);reject(e)})})},
 decode(ac,encoded){return new Promise((resolve,reject)=>{try{const result=ac.decodeAudioData(encoded,resolve,reject);if(result&&typeof result.then==='function')result.then(resolve,reject)}catch(e){reject(e)}})},
 readFile(f){if(typeof f.arrayBuffer==='function')return f.arrayBuffer();return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('ファイルを読み取れませんでした。'));r.onabort=()=>reject(Error('ファイル読み込みが中断されました。'));r.readAsArrayBuffer(f)})},
 canvasRatio(w,h,ratio,apple){return apple?Math.min(ratio||1,8192/w,Math.sqrt(3000000/(w*h))):(ratio||1)},
 canShare(file,nav){try{return !!(file&&nav.share&&nav.canShare&&nav.canShare({files:[file]}))}catch{return false}},
 probeVideo(f){return new Promise(resolve=>{const video=document.createElement('video'),url=URL.createObjectURL(f);let ended=false;const done=(result)=>{if(ended)return;ended=true;clearTimeout(timer);video.onloadedmetadata=video.onerror=null;video.removeAttribute('src');video.load();URL.revokeObjectURL(url);resolve(result)};const timer=setTimeout(()=>done({}),2500);video.preload='metadata';video.muted=true;video.playsInline=true;video.onloadedmetadata=()=>done({noAudio:!!video.audioTracks&&video.audioTracks.length===0});video.onerror=()=>done({});video.src=url})}
};root.AudioCompat=C;if(typeof module!=='undefined')module.exports=C;
})(globalThis);
