/* One-shot, single-voice Web Audio player. Tap races and scene changes cancel synchronously. */
(function(root){
'use strict';
const V=root.KoedashiVolume||(typeof require==='function'?require('./pad-volume.js'):null);
class PadPlayer{
 constructor(callbacks={},env=root,budget=128*1048576){this.env=env;this.cb=callbacks;this.budget=budget;this.cache=new Map();this.states=new Map();this.token=0;this.generation=0;this.context=null;this.source=null;this.active=null;this.bytes=0;this.volumes=new Map();this.voice=null;this.selected=null;this.position=0;this.paused=false;this.starting=false;} 
 emit(name,...args){this.cb[name]?.(...args);}
 contextForTap(){if(!this.context||this.context.state==='closed'){const A=this.env.AudioContext||this.env.webkitAudioContext;if(!A)throw Error('Web Audio APIに対応していません。');try{this.context=new A({latencyHint:'interactive'});}catch{this.context=new A();}this.context.onstatechange=()=>{this.env.KoedashiDiagnostics?.record('audio-context',{state:this.context.state});if(this.context.state!=='running'&&this.active){this.stop();this.emit('onError','音声出力が中断されました。出力を準備してもう一度タップしてください。');}};}return this.context;}
 async arm(){const ac=this.contextForTap();await this.env.AudioCompat.resume(ac);return ac;}
 detach(){const old=this.source;this.source=null;this.voice?.dispose();this.voice=null;if(old){old.onended=null;try{old.stop();}catch{}old.disconnect();}}
 positionTime(){const buffer=this.cache.get(this.active||this.selected);return Math.max(0,Math.min(buffer?.duration||0,this.source?this.context.currentTime-this.startedAt:this.position));}
 stop(clear=false){this.token++;this.detach();this.active=null;this.position=0;this.paused=false;this.starting=false;if(clear)this.selected=null;this.emit('onActive',null);}
 pause(){if(!this.source&&!this.starting)return false;this.position=this.positionTime();this.active=this.active||this.selected;this.token++;this.detach();this.starting=false;this.paused=true;this.emit('onActive',this.active);return true;}
 resume(){const id=this.active||this.selected;if(!id)return Promise.resolve(false);return this.play(id,this.positionTime());}
 seek(seconds){const id=this.active||this.selected,buffer=this.cache.get(id);if(!buffer||!Number.isFinite(seconds))return Promise.resolve(false);const t=Math.max(0,Math.min(buffer.duration-1/(buffer.sampleRate||48000),seconds));if(this.source||this.starting)return this.play(id,t);this.token++;this.position=t;this.emit('onActive',this.active);return Promise.resolve(true);}
 status(id,state,error=''){if(state==='failed')this.env.KoedashiDiagnostics?.record('pad-load-failed',{id,error,generation:this.generation});this.states.set(id,{state,error});this.emit('onReady',id,state,error);}
 async prepare(pads,decode){
  this.stop(true);const generation=++this.generation;this.cache.clear();this.states.clear();this.bytes=0;
  for(const pad of pads){this.status(pad.id,'loading');try{this.setVolume(pad.id,V.value(pad.volume));}catch(e){this.status(pad.id,'failed',e.message);}}
  let ac;try{ac=this.contextForTap();}catch(e){for(const p of pads)this.status(p.id,'failed',e.message);return;}
  for(const pad of pads){
   if(generation!==this.generation)return;
   if(this.states.get(pad.id)?.state==='failed')continue;
   try{const pcm=pad.edit||pad.original;if(!pcm||!Number.isFinite(pcm.frames)||!Number.isFinite(pcm.sr))throw Error('パッド音声の参照が不正です。');const bytes=pcm.frames*pcm.channelsCount*4;
   if(bytes+this.bytes>this.budget){this.status(pad.id,'failed','事前読込のメモリ目安を超えます。シーンを分けてください。');continue;}
   this.status(pad.id,'loading');
    const data=await decode(pcm);if(generation!==this.generation)return;
    const buffer=ac.createBuffer(pcm.channelsCount,pcm.frames,pcm.sr);
    data.forEach((channel,k)=>{let offset=0;for(const part of channel.parts){if(buffer.copyToChannel)buffer.copyToChannel(part,k,offset);else buffer.getChannelData(k).set(part,offset);offset+=part.length;}});
    if(generation!==this.generation)return;
    this.cache.set(pad.id,buffer);this.bytes+=bytes;this.status(pad.id,'ready');
   }catch(e){if(generation===this.generation){this.env.KoedashiDiagnostics?.record('pad-prepare-error',{id:pad.id,name:e.name,message:e.message,audioState:ac.state});this.status(pad.id,'failed',e.message||'音声を読み込めませんでした。');}}
  }
 }
 setVolume(id,percent){percent=V.value(percent);this.volumes.set(id,percent);if(this.active===id)this.voice?.set(percent);}
 async play(id,offset=0){
  this.stop();const token=this.token,buffer=this.cache.get(id);this.selected=id;this.position=offset;this.starting=!!buffer;
  if(!buffer){this.env.KoedashiDiagnostics?.record('pad-play-not-ready',{id,state:this.states.get(id)?.state,error:this.states.get(id)?.error});this.emit('onError','音声はまだ再生可能な状態ではありません。読込状態を確認してください。');return false;}
  let phase='音声出力の再開';try{
   const ac=await this.arm();if(token!==this.token)return false;phase='音源の作成・開始';
   const source=ac.createBufferSource();source.buffer=buffer;const voice=V.graph(ac,this.volumes.get(id)??100);source.connect(voice.input);this.voice=voice;source.onended=()=>{if(this.source===source){this.source=null;this.active=null;this.position=0;this.paused=false;voice.dispose();this.voice=null;source.disconnect();this.emit('onActive',null);}};
   this.source=source;this.active=id;this.position=Math.max(0,Math.min(offset,buffer.duration-1/(buffer.sampleRate||48000)));this.paused=false;this.starting=false;this.startedAt=ac.currentTime-this.position;if(this.position)source.start(0,this.position);else source.start(0);this.emit('onActive',id);return true;
  }catch(e){if(token!==this.token)return false;this.env.KoedashiDiagnostics?.record('pad-play-failed',{id,stage:phase,name:e.name,message:e.message,audioState:this.context?.state});this.stop();this.emit('onError','再生できませんでした：'+(e.message||String(e)));return false;}
 }
 cancelPreparation(){++this.generation;this.stop(true);this.cache.clear();this.bytes=0;}
}
root.KoedashiPlayer=PadPlayer;if(typeof module!=='undefined')module.exports=PadPlayer;
})(globalThis);
