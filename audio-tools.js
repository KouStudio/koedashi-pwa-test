/* Immutable cross-material conversion; windowed-sinc avoids downsample aliasing. */
(function(root){
'use strict';const E=root.AudioEngine||(typeof require==='function'?require('./engine.js'):null);
const budget=()=>((root.navigator?.deviceMemory||4)<=2?64:128)*1048576;
function check(bytes,limit=budget()){if(!Number.isFinite(bytes)||bytes>limit)throw Error('音声処理のメモリ目安を超えます。短い範囲を選んでください。');}
function channels(data,n){if(n===data.length)return data;if(n===2&&data.length===1)return [data[0],data[0]];throw Error('チャンネル数を変換できません。');}
async function convert(input,rate,count=input.data.length,limit=budget()){
 const {data,sr}=input;if(!data?.length||data.length>2||![1,2].includes(count)||sr<8000||rate<8000||sr>192000||rate>192000)throw Error('音声形式が不正です。');
 const length=Math.max(1,Math.round(data[0].length*rate/sr));check(length*count*4+E.bytes(data),limit);
 if(sr===rate)return {data:channels(data,count),sr:rate};
 const ratio=sr/rate,cutoff=Math.min(1,rate/sr),radius=16/cutoff,out=[];
 for(const channel of data){const parts=[];for(let start=0;start<length;start+=4096){const end=Math.min(length,start+4096),lo=Math.max(0,Math.floor(start*ratio-radius)),hi=Math.min(channel.length,Math.ceil(end*ratio+radius)+1),source=E.read(channel,lo,hi),block=new Float32Array(end-start);
  for(let i=start;i<end;i++){const at=i*ratio;let sum=0,weight=0;for(let j=Math.max(0,Math.ceil(at-radius));j<=Math.min(channel.length-1,Math.floor(at+radius));j++){const x=(at-j)*cutoff,z=Math.PI*x,w=(Math.abs(x)<1e-9?1:Math.sin(z)/z)*(.5+.5*Math.cos(Math.PI*(at-j)/radius));sum+=source[j-lo]*w;weight+=w;}block[i-start]=weight?sum/weight:0;}parts.push(block);await E.pause();}out.push(E.join(...parts));}
 return {data:channels(out,count),sr:rate};
}
async function concatenate(first,second,limit=budget()){
 const rate=Math.min(48000,Math.max(first.sr,second.sr)),count=Math.max(first.data.length,second.data.length),frames=Math.round(first.data[0].length*rate/first.sr)+Math.round(second.data[0].length*rate/second.sr);check(E.bytes(first.data,second.data)+frames*count*8,limit);
 const a=await convert(first,rate,count,limit),b=await convert(second,rate,count,limit);let data=a.data.map((c,i)=>E.join(c,b.data[i]));
 // Preserve duration; soften only the two sides of the join for at most 3ms.
 const at=a.data[0].length,n=Math.min(Math.round(rate*.003),at,b.data[0].length);if(n){data=await E.fade(data,at-n,at,false);data=await E.fade(data,at,at+n,true);}return {data,sr:rate};
}
const api={budget,check,channels,convert,concatenate};root.KoedashiAudioTools=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
