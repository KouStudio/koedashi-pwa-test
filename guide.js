/* First-use help routes to existing controls without changing the saved tab on open/skip. */
(function(){
'use strict';const $=id=>document.getElementById(id),R=SoraRecordingSessions,B=SoraEditorBridge,key='koedashi.guide.seen';
const guide=document.createElement('dialog');guide.id='koGuide';guide.setAttribute('aria-labelledby','koGuideTitle');const goals=[['record','音声を録音したい','録音画面へ。録音開始は自分で押します。'],['edit','音声を切る・加工したい','素材を選び、波形で範囲を調整します。'],['join','2つの音声をつなげたい','前半・後半と範囲を選び、新規保存します。'],['copy','別の録音から一部分をコピーしたい','Aでコピー→Bでカーソル指定→貼り付け。'],['register','声出しに音声を登録したい','素材一覧から「声出しに登録」を選べます。'],['sampler','サンプラーで音を鳴らしたい','登録済みパッドをタップ。一時停止・位置指定も可能。'],['wav','音声をWAVで書き出したい','声出しパッドのメニュー、または編集画面から。'],['handoff','データをバックアップ・引き継ぎしたい','ZIPをそのまま保存・共有・読み込みできます。']];
guide.innerHTML='<div class="guide-heading"><h2 id="koGuideTitle">何をしたいですか？</h2><button id="koGuideTopSkip">スキップ</button></div><p>最初は「録音 → 素材を選んで編集 → 声出しに登録」。素材はパッド登録前から使えます。</p><div id="koGuideGoals">'+goals.map(([id,label,hint])=>'<button data-guide="'+id+'"><strong>'+label+'</strong><small>'+hint+'</small></button>').join('')+'</div><p id="koGuideStatus" class="hint" role="status"></p><details id="guideDiagnostics"><summary>診断情報（端末内のみ）</summary><p class="hint">音声は含めず、処理段階・エラー・参照ID・ブラウザ情報を記録します。自動送信しません。</p><button id="guideDiagnosticRefresh">最新の診断を表示</button><textarea id="guideDiagnosticText" readonly aria-label="診断ログ"></textarea></details><button id="koGuideSkip">スキップ／閉じる</button>';document.body.append(guide);
const entry=document.createElement('button');entry.id='koGuideEntry';entry.className='guide-entry';entry.textContent='？ 使い方';document.querySelector('header .local').replaceWith(entry);const simple=document.createElement('button');simple.id='koGuideSimple';simple.className='guide-entry';simple.textContent='？';simple.setAttribute('aria-label','使い方ガイド');document.querySelector('.sampler-transport').append(simple);
function mark(){try{localStorage.setItem(key,'1');}catch{}}
function open(){if(guide.open)return;mark();$('koGuideStatus').textContent='目的を選ぶと操作場所へ移動します。';guide.showModal();}
entry.onclick=simple.onclick=open;$('koGuideSkip').onclick=$('koGuideTopSkip').onclick=()=>guide.close();guide.addEventListener('cancel',mark);
function hint(text){const status=$('koStatus');status.textContent=text;status.className='hint';}
async function route(goal){if(B.isBusy()||R.isRecording()||R.isRestoring()){$('koGuideStatus').textContent='録音・保存・復元が終わってから移動してください。';return;}guide.close();
 try{
  if(goal==='record'){await KoedashiPads.navigate('record');$('recStart').scrollIntoView({block:'center'});hint('録音開始を押してください。マイク許可が必要な場合はブラウザで確認します。');}
  else if(goal==='sampler'){await KoedashiPads.navigate('simple');hint('パッドをタップして再生。未登録なら素材一覧の「声出しに登録」を使います。');}
  else if(goal==='handoff'){$('handoffEntry').click();}
  else if(goal==='join'){await KoedashiPads.navigate('record');$('koJoinEntry').click();}
  else if(goal==='wav'){await KoedashiPads.navigate('pads');$('koPadScreen').scrollIntoView({block:'start'});hint('書き出したいパッドのメニュー → WAVに書き出し。未登録素材は録音一覧のWAV保存、外部ファイルは編集画面のWAV保存も使えます。');}
  else if(goal==='edit'&&B.hasData()){await KoedashiPads.navigate('edit');$('scroll').scrollIntoView({block:'center'});hint('波形で範囲を選び、クイック編集／詳細編集を使えます。別素材は録音画面の素材一覧から選択できます。');}
  else{await KoedashiPads.navigate('record');$('materialBrowser').scrollIntoView({block:'start'});$('materialSearch').focus({preventScroll:true});hint(goal==='copy'?'Aを選択して編集→範囲をコピー→Bを選択→オレンジ位置へ貼り付け。録音間の作業コピーは保存方法を選んで確定してください。':goal==='register'?'素材を検索・試聴し、対象の「声出しに登録」を押してください。':'素材を検索し、「選択して編集」。外部ファイルは編集タブのファイル入力からも開けます。');}
 }catch(e){hint('移動できません：'+e.message);}
}
for(const button of guide.querySelectorAll('[data-guide]'))button.onclick=()=>route(button.dataset.guide);
function diagnostics(){$('guideDiagnosticText').value=JSON.stringify({...KoedashiDiagnostics.snapshot(),playback:KoedashiPads.diagnostics()},null,2);}
$('guideDiagnosticRefresh').onclick=diagnostics;$('guideDiagnostics').ontoggle=()=>{if($('guideDiagnostics').open)diagnostics();};
(async()=>{try{if(localStorage.getItem(key))return;await R.ready;const store=await new KoedashiData.PadStore().open(),list=await store.list(),layout=await store.layout();store.close();const existing=list.takes.length||layout.pads.length||layout.scenes.length>1||layout.layout.mode&&layout.layout.mode!=='pads';if(existing){mark();return;}for(let i=0;i<100&&$('koModeRecord').disabled;i++)await new Promise(r=>setTimeout(r,50));if(document.querySelector('dialog[open]')){mark();return;}if(!$('koModeRecord').disabled&&!B.isBusy())open();}catch{}})();
window.KoedashiGuide={open,route};
})();
