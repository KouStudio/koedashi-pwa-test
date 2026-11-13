/* UI adapter only: shared edit/play/register operations and a device preference. */
(function(){
'use strict';
const by=id=>document.getElementById(id),B=SoraEditorBridge,check=by('recCountdown'),key='koedashi.recCountdown';
function settingError(){by('recCountdownStatus').textContent='カウントダウン設定を保存できません。この起動中のみ反映します。';}
try{const value=localStorage.getItem(key);check.checked=value==='true'||value==='1';}catch{check.checked=false;settingError();}
check.addEventListener('change',()=>{try{localStorage.setItem(key,String(check.checked));by('recCountdownStatus').textContent='';}catch{settingError();}});
by('nearListen').onclick=()=>by('quickListen').click();
by('nearUndo').onclick=()=>by('undo').click();
by('nearRegister').onclick=()=>by('quickRegister').click();
function sync(){if(document.documentElement.dataset.appMode!=='edit')return;const enabled=B.hasData()&&!B.isBusy();by('nearListen').disabled=!enabled||by('quickListen').disabled;by('nearListen').textContent=playing?'■ 試聴を停止':'▶ 範囲試聴';by('nearListen').setAttribute('aria-pressed',String(playing));by('nearUndo').disabled=!enabled||by('undo').disabled;by('nearRegister').disabled=!enabled||by('koRegister').disabled||by('quickRegister').disabled;const scene=by('koSceneSelect').selectedOptions[0]?.textContent||'準備中';by('nearRegisterTarget').textContent='送る範囲：選択部分 ／ 登録先：'+scene+'（カットは選択部分を切り取り）';}
B.onChange(sync);setInterval(sync,100);sync();
})();
