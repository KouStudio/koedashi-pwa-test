/* Playback-only gain and bounded soft peak protection; no PCM or WAV mutation. */
(function(root){
'use strict';
function value(v){if(v===undefined)return 100;if(!Number.isInteger(v)||v<0||v>200||v%10)throw Error('音量は0～200%、10%単位で指定してください。');return v;}
let curve;
function limiterCurve(){if(curve)return curve;curve=new Float32Array(65537);for(let i=0;i<curve.length;i++){const x=4*i/(curve.length-1)-2,a=Math.abs(x),limited=a<=.9?a:.9+.09*(1-Math.exp(-(a-.9)/.09));curve[i]=Math.sign(x)*limited/2;}return curve;}
function graph(ac,percent){
 const gain=ac.createGain(),pre=ac.createGain(),limiter=ac.createWaveShaper(),post=ac.createGain();pre.gain.value=.5;post.gain.value=2;limiter.oversample='none';
 gain.connect(pre);pre.connect(limiter);limiter.connect(post);post.connect(ac.destination);
 let timer=null,disposed=false,current;
 function set(v,immediate=false){v=value(v);current=v;clearTimeout(timer);const now=ac.currentTime||0;
  // A null curve bypasses shaping. Power-of-two pre/post gains cancel exactly.
  if(v>100)limiter.curve=limiterCurve();
  if(immediate){gain.gain.value=v/100;limiter.curve=v>100?limiterCurve():null;}
  else{const p=gain.gain;if(p.cancelAndHoldAtTime)p.cancelAndHoldAtTime(now);else{const held=p.value;p.cancelScheduledValues(now);p.setValueAtTime(held,now);}p.linearRampToValueAtTime(v/100,now+.01);
   // Keep protection until an attenuation ramp has reached <= unity.
   if(v<=100&&limiter.curve)timer=setTimeout(()=>{if(!disposed&&current<=100)limiter.curve=null;},20);
  }
 }
 set(percent,true);
 return {input:gain,output:post,gain,limiter,set,dispose(){disposed=true;clearTimeout(timer);for(const node of [gain,pre,limiter,post])node.disconnect();}};
}
class Queue{
 constructor(store,onState=()=>{}){this.store=store;this.onState=onState;this.jobs=new Map();}
 set(id,v){v=value(v);let j=this.jobs.get(id);if(!j){j={pending:null,running:null,status:'saved',desired:v};this.jobs.set(id,j);}j.pending=j.desired=v;j.status='saving';clearTimeout(j.timer);this.onState(id,'saving');j.timer=setTimeout(()=>{void this.flush(id).catch(()=>{});},250);}
 pending(id){const j=this.jobs.get(id);return j&&(j.pending!==null||j.running||j.status==='failed')?j.desired:undefined;}
 busy(){return [...this.jobs.values()].some(j=>j.pending!==null||j.running);}
 failed(id){if(id!==undefined)return this.jobs.get(id)?.status==='failed';return [...this.jobs.values()].some(j=>j.status==='failed');}
 async flush(id){const j=this.jobs.get(id);if(!j)return;clearTimeout(j.timer);if(j.running)return j.running;
  const work=(async()=>{while(j.pending!==null){const v=j.pending;j.pending=null;try{await this.store.setVolume(id,v);}catch(e){if(j.pending===null)j.pending=v;j.status='failed';if(this.jobs.get(id)===j)this.onState(id,'failed',e);throw e;}}j.status='saved';})();j.running=work;
  try{await work;}finally{j.running=null;}if(this.jobs.get(id)===j)this.onState(id,'saved');
 }
 async flushAll(){await Promise.all([...this.jobs.keys()].map(id=>this.flush(id)));}
 drop(id){const j=this.jobs.get(id);if(j)clearTimeout(j.timer);this.jobs.delete(id);}
}
root.KoedashiVolume={value,graph,Queue};if(typeof module==='object'&&module.exports)module.exports=root.KoedashiVolume;
})(globalThis);
