/* One-shot, single-voice Web Audio player. Tap races and scene changes cancel synchronously. */
(function(root){
'use strict';
const V=root.KoedashiVolume||(typeof require==='function'?require('./pad-volume.js'):null);
class PadPlayer{
 constructor(callbacks={},env=root,budget=128*1048576){this.env=env;this.cb=callbacks;this.budget=budget;this.cache=new Map();this.states=new Map();this.token=0;this.generation=0;this.context=null;this.source=null;this.active=null;this.bytes=0;this.volumes=new Map();this.voice=null;}
 emit(name,...args){this.cb[name]?.(...args);}
 contextForTap(){if(!this.context||this.context.state==='closed'){const A=this.env.AudioContext||this.env.webkitAudioContext;if(!A)throw Error('Web Audio APIに対応していません。');try{this.context=new A({latencyHint:'interactive'});}catch{this.context=new A();}this.context.onstatechange=()=>{if(this.context.state!=='running'&&this.active){this.stop();this.emit('onError','音声出力が中断されました。出力を準備してもう一度タップしてください。');}};}return this.context;}
 async arm(){const ac=this.contextForTap();await this.env.AudioCompat.resume(ac);return ac;}
 stop(){this.token++;const old=this.source;this.source=null;this.active=null;this.voice?.dispose();this.voice=null;if(old){old.onended=null;try{old.stop();}catch{}old.disconnect();}this.emit('onActive',null);}
 status(id,state,error=''){this.states.set(id,{state,error});this.emit('onReady',id,state,error);}
 async prepare(pads,decode){
  this.stop();const generation=++this.generation;this.cache.clear();this.states.clear();this.bytes=0;
  for(const pad of pads){this.status(pad.id,'loading');try{this.setVolume(pad.id,V.value(pad.volume));}catch(e){this.status(pad.id,'failed',e.message);}}
  let ac;try{ac=this.contextForTap();}catch(e){for(const p of pads)this.status(p.id,'failed',e.message);return;}
  for(const pad of pads){
   if(generation!==this.generation)return;
   if(this.states.get(pad.id)?.state==='failed')continue;
   const pcm=pad.edit||pad.original,bytes=pcm.frames*pcm.channelsCount*4;
   if(bytes+this.bytes>this.budget){this.status(pad.id,'failed','事前読込のメモリ目安を超えます。シーンを分けてください。');continue;}
   this.status(pad.id,'loading');
   try{
    const data=await decode(pcm);if(generation!==this.generation)return;
    const buffer=ac.createBuffer(pcm.channelsCount,pcm.frames,pcm.sr);
    data.forEach((channel,k)=>{let offset=0;for(const part of channel.parts){if(buffer.copyToChannel)buffer.copyToChannel(part,k,offset);else buffer.getChannelData(k).set(part,offset);offset+=part.length;}});
    if(generation!==this.generation)return;
    this.cache.set(pad.id,buffer);this.bytes+=bytes;this.status(pad.id,'ready');
   }catch(e){if(generation===this.generation)this.status(pad.id,'failed',e.message||'音声を読み込めませんでした。');}
  }
 }
 setVolume(id,percent){percent=V.value(percent);this.volumes.set(id,percent);if(this.active===id)this.voice?.set(percent);}
 async play(id){
  this.stop();const token=this.token,buffer=this.cache.get(id);
  if(!buffer){this.emit('onError','音声はまだ再生可能な状態ではありません。読込状態を確認してください。');return false;}
  try{
   const ac=await this.arm();if(token!==this.token)return false;
   const source=ac.createBufferSource();source.buffer=buffer;const voice=V.graph(ac,this.volumes.get(id)??100);source.connect(voice.input);this.voice=voice;source.onended=()=>{if(this.source===source){this.source=null;this.active=null;voice.dispose();this.voice=null;source.disconnect();this.emit('onActive',null);}};
   this.source=source;this.active=id;this.startedAt=ac.currentTime;source.start(0);this.emit('onActive',id);return true;
  }catch(e){this.stop();this.emit('onError','再生できませんでした：'+(e.message||String(e)));return false;}
 }
 cancelPreparation(){++this.generation;this.stop();this.cache.clear();this.bytes=0;}
}
root.KoedashiPlayer=PadPlayer;if(typeof module!=='undefined')module.exports=PadPlayer;
})(globalThis);
