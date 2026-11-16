/* Explicit pad save destinations; existing WAV export remains independent. */
(function(){
'use strict';
const B=SoraEditorBridge,P=KoedashiPads,$=id=>document.getElementById(id);
const panel=document.createElement('section');panel.id='padSaveMethods';panel.hidden=true;panel.innerHTML='<p id="padSaveSource"></p><button id="padSaveOpen" type="button">保存方法を選ぶ</button><p class="hint">編集は下書きに自動保存します。元パッドへの反映は上書き保存で確定します。</p>';
$('nearWaveActions').after(panel);
const modal=document.createElement('dialog');modal.id='padSaveDialog';modal.innerHTML='<h3>パッド音声の保存方法</h3><p id="padSaveTarget"></p><p class="hint">上書きは対象パッドの編集音声だけを更新します。元録音・他のパッド・登録時の音声は残ります。</p><button id="padOverwrite" class="primary">上書き保存</button><hr><label>新しい素材名<input id="padSaveName" maxlength="80"></label><label class="check"><input id="padAlsoRegister" type="checkbox">同じシーンに新しいパッドも登録</label><button id="padSaveNew">新規保存（元パッドを残す）</button><hr><button id="padRestoreRegistered">登録時の状態に戻す</button><p class="hint">登録時に戻す操作も下書きです。元に戻すで取り消せます。</p><p id="padSaveResult" role="status" aria-live="polite"></p><button id="padSaveCancel">閉じる</button>';
document.body.append(modal);let saving=false;
function sync(){const info=P.saveInfo();panel.hidden=!info;if(info){$('padSaveSource').textContent='編集元：'+info.name;$('padSaveOpen').disabled=info.busy;}for(const id of ['quickRedo','nearRedo'])$(id).disabled=$('redo').disabled;}
function open(){const info=P.saveInfo();if(!info||info.busy)return;$('padSaveTarget').textContent='対象：'+info.sceneName+' ／ '+info.name+'（'+info.id.slice(0,8)+'） 更新：'+(info.savedSeconds??0).toFixed(3)+'秒 → '+info.seconds.toFixed(3)+'秒の編集音声';$('padOverwrite').disabled=!info.canOverwrite;$('padSaveName').value=info.name+'（編集コピー）';$('padAlsoRegister').checked=false;$('padSaveResult').textContent=info.canOverwrite?'保存方法を選んでください。':'編集元が更新されています。上書きせず新規保存してください。';modal.showModal();}
function lock(value){saving=value;for(const el of modal.querySelectorAll('button,input'))el.disabled=value;if(!value)$('padOverwrite').disabled=!P.saveInfo()?.canOverwrite;}
async function save(kind){if(saving)return;const name=$('padSaveName').value,alsoPad=$('padAlsoRegister').checked;lock(true);$('padSaveResult').textContent='保存中…';try{const result=await P.savePadChoice(kind,{name,alsoPad});modal.close();$('padSaveSource').textContent='保存済み：'+result.name;}catch(e){$('padSaveResult').textContent=e.message+' 編集中の音声を保持しています。';$('padSaveResult').className='rec-error';}finally{lock(false);sync();}}
$('padSaveOpen').onclick=open;$('padOverwrite').onclick=()=>save('overwrite');$('padSaveNew').onclick=()=>save('new');$('padSaveCancel').onclick=()=>modal.close();modal.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
$('padRestoreRegistered').onclick=async()=>{lock(true);try{await P.resetRegistered();modal.close();}catch(e){$('padSaveResult').textContent=e.message;}finally{lock(false);}};
for(const id of ['quickRedo','nearRedo'])$(id).onclick=()=>$('redo').click();
const note=document.createElement('p');note.className='hint';note.textContent='元に戻す／やり直す：編集中の最大5段階。再起動後の履歴は残りません。';$('quickModeSwitch').after(note);
window.KoedashiPadSaveUI={open};B.onChange(sync);B.onContext(()=>queueMicrotask(sync));setInterval(sync,200);sync();
})();
