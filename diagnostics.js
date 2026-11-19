/* Bounded session-only diagnostics. No audio, names, or automatic upload. */
(function(root){'use strict';const entries=[];function record(stage,detail={}){try{entries.push({time:new Date().toISOString(),kind:stage,stage,...detail});if(entries.length>100)entries.shift();}catch{}}
function snapshot(){return {build:'2.6.7',userAgent:root.navigator?.userAgent,platform:root.navigator?.platform,maxTouchPoints:root.navigator?.maxTouchPoints,visibility:root.document?.visibilityState,origin:root.location?.origin,path:root.location?.pathname,standalone:!!(root.navigator?.standalone||root.matchMedia?.('(display-mode: standalone)').matches),secure:root.isSecureContext,entries:entries.slice()};}
function progress(fn,value){try{fn?.(value);}catch{}}
root.KoedashiDiagnostics={record,snapshot,progress};if(root.addEventListener){root.addEventListener('error',e=>record('window-error',{name:e.error?.name,message:String(e.message).slice(0,500)}));root.addEventListener('unhandledrejection',e=>record('unhandled-promise',{name:e.reason?.name,message:String(e.reason?.message||e.reason).slice(0,500)}));}
})(globalThis);
