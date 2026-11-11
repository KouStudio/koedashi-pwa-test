/* Real microphone capture only. No network, persistence or simulated audio. */
(function (root) {
  'use strict';
  const TYPES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  function message(error) {
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'マイクが許可されませんでした。ブラウザのサイト設定で許可し、HTTPSで開いてください。';
    if (name === 'NotFoundError') return '使用できるマイクが見つかりません。接続や端末設定をご確認ください。';
    if (name === 'NotReadableError' || name === 'AbortError') return 'マイクを使用できません。他のアプリの使用状況や接続をご確認ください。';
    if (name === 'NotSupportedError') return 'このブラウザは録音形式に対応していません。最新版のSafariまたはChromeでお試しください。';
    if (name === 'RangeError' || name === 'QuotaExceededError') return '録音に必要なメモリを確保できませんでした。短いテイクに分けてください。';
    return '録音できませんでした：' + (error && error.message || 'ブラウザが詳細を返しませんでした。');
  }
  class MicrophoneRecorder {
    constructor(callbacks = {}, env = root) {
      this.env = env; this.cb = callbacks; this.state = 'idle'; this.token = 0;
      this.stream = null; this.context = null; this.recorder = null;
      this.chunks = []; this.bytes = 0; this.elapsed = 0; this.segment = null;
    }
    emit(name, ...args) { if (this.cb[name]) return this.cb[name](...args); }
    stateTo(value) { this.state = value; this.emit('onState', value); }
    now() { return this.env.performance.now(); }
    duration() { return this.elapsed + (this.segment === null ? 0 : this.now() - this.segment); }
    accrue() { if (this.segment !== null) { this.elapsed += this.now() - this.segment; this.segment = null; } }
    async start({countdown = 3, maxBytes = 32 * 1048576} = {}) {
      if (this.state !== 'idle') return;
      const e = this.env;
      if (!e.isSecureContext || !e.navigator.mediaDevices || !e.navigator.mediaDevices.getUserMedia || !e.MediaRecorder || !(e.AudioContext || e.webkitAudioContext)) {
        this.emit('onError', '録音にはHTTPSと、マイク録音に対応するSafariまたはChromeが必要です。'); return;
      }
      const token = ++this.token;
      this.chunks = []; this.bytes = 0; this.elapsed = 0; this.segment = null;
      this.reason = ''; this.partial = false; this.limit = maxBytes; this.stateTo('requesting');
      try {
        // Both calls originate directly from the user's tap, before any await.
        const ctx = this.context = new (e.AudioContext || e.webkitAudioContext)();
        const resumed = e.AudioCompat.resume(ctx);
        const permission = e.navigator.mediaDevices.getUserMedia({audio: {channelCount: {ideal: 1}, echoCancellation: false, noiseSuppression: false, autoGainControl: false}, video: false});
        // Consume resume errors immediately even if permission remains pending.
        const ready = resumed.then(() => null, err => err);
        const stream = await permission;
        if (token !== this.token) { stream.getTracks().forEach(t => t.stop()); return; }
        this.stream = stream;
        const resumeError = await ready;
        if (token !== this.token) return;
        if (resumeError) throw resumeError;
        // Durable take metadata must commit before starting capture.
        await this.emit('beforeRecord');
        if (token !== this.token) return;
        if (!stream.getAudioTracks().length) throw new Error('音声トラックがありません。');
        const mimeType = TYPES.find(type => typeof e.MediaRecorder.isTypeSupported === 'function' && e.MediaRecorder.isTypeSupported(type));
        // Browser default is the fallback; actual recorder/chunk MIME is retained.
        const recorder = this.recorder = mimeType ? new e.MediaRecorder(stream, {mimeType}) : new e.MediaRecorder(stream);
        this.source = ctx.createMediaStreamSource(stream);
        this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
        this.silent = ctx.createGain(); this.silent.gain.value = 0;
        this.source.connect(this.analyser); this.analyser.connect(this.silent); this.silent.connect(ctx.destination);
        this.samples = new Float32Array(this.analyser.fftSize);
        this.byteSamples = new Uint8Array(this.analyser.fftSize);
        recorder.ondataavailable = event => {
          if (token !== this.token || !event.data || !event.data.size) return;
          this.chunks.push(event.data); this.bytes += event.data.size;
          try { const write=this.emit('onChunk',event.data,this.duration());if(write&&write.catch)write.catch(()=>this.stop('録音データの保存に失敗したため停止しました。外部バックアップまたは原本保存で回収してください。')); }
          catch { this.stop('録音データの保存を開始できませんでした。'); }
          if (this.bytes >= this.limit && this.state !== 'stopping') this.stop('録音データの容量目安に達したため停止しました。WAV保存して短いテイクに分けてください。');
        };
        recorder.onstart = () => { if (token === this.token && this.state !== 'stopping') { this.segment = this.now(); this.emit('onStarted', Date.now()); this.stateTo('recording'); } };
        recorder.onpause = () => { if (token === this.token && this.state !== 'stopping') { this.accrue(); this.stateTo('paused'); } };
        recorder.onresume = () => { if (token === this.token && this.state !== 'stopping') { this.segment = this.now(); this.stateTo('recording'); } };
        recorder.onerror = event => { if(token === this.token)this.stop(message(event.error)); };
        recorder.onstop = () => this.finish(token);
        for (const track of stream.getAudioTracks()) {
          track.addEventListener('ended', () => token === this.token && this.stop('マイクが切断されたため録音を停止しました。取得できた範囲をご確認ください。'));
          track.addEventListener('mute', () => token === this.token && this.stop('マイク入力が中断されたため停止しました。取得できた範囲をご確認ください。'));
        }
        ctx.onstatechange = () => { if (token === this.token && ['recording','paused','starting','countdown'].includes(this.state) && ctx.state !== 'running') this.stop('音声処理が中断されたため録音を停止しました。画面ロックや他アプリの使用状況をご確認ください。'); };
        this.ticker = e.setInterval(() => this.tick(), 100);
        if (countdown > 0) {
          this.remaining = countdown; this.stateTo('countdown'); this.emit('onCountdown', this.remaining);
          this.countTimer = e.setInterval(() => { this.remaining--; if (this.remaining <= 0) this.skipCountdown(); else this.emit('onCountdown', this.remaining); }, 1000);
        } else this.begin();
      } catch (error) {
        if (token !== this.token) return;
        ++this.token; this.release(); this.chunks = []; this.stateTo('idle'); this.emit('onError', message(error));
      }
    }
    begin() {
      if (!this.recorder || !['requesting','countdown'].includes(this.state)) return;
      this.env.clearInterval(this.countTimer); this.countTimer = null;
      this.stateTo('starting');
      try { this.recorder.start(1000); } catch (error) { this.reason = message(error); this.finish(this.token); }
    }
    skipCountdown() { if (this.state === 'countdown') this.begin(); }
    pause() {
      if (this.state !== 'recording') return;
      this.stateTo('pausing');
      try { this.recorder.pause(); } catch (error) { this.stop(message(error)); }
    }
    resume() {
      if (this.state !== 'paused') return;
      this.stateTo('resuming');
      this.env.AudioCompat.resume(this.context).catch(error => this.stop(message(error)));
      try { this.recorder.resume(); } catch (error) { this.stop(message(error)); }
    }
    stop(reason = '') {
      if (this.state === 'idle' || this.state === 'stopping') return;
      this.reason = reason;
      if (['requesting','countdown'].includes(this.state)) {
        ++this.token; this.release(); this.chunks = []; this.stateTo('idle');
        this.emit('onNotice', reason || '録音準備をキャンセルしました。'); return;
      }
      this.accrue(); this.stateTo('stopping');
      try {
        this.stopTimer = this.env.setTimeout(() => {
          this.partial = true;
          this.reason = (this.reason ? this.reason + ' ' : '') + '停止処理が完了しないため取得済みデータだけを回収しました。末尾や再生可否を確認してください。';
          this.finish(this.token);
        }, 5000);
        // An error/track end may already have made the recorder inactive while
        // its final dataavailable + stop events are still queued. Wait for them.
        if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
      } catch (error) { this.reason = message(error); this.finish(this.token); }
    }
    finish(token) {
      if (token !== this.token) return;
      ++this.token; this.accrue();
      const mime = (this.chunks.find(c => c.type) || {}).type || (this.recorder && this.recorder.mimeType) || '';
      const chunks = this.chunks; this.chunks = [];
      const elapsed = this.elapsed, reason = this.reason, partial = this.partial;
      this.release(); this.stateTo('idle');
      if (!chunks.length) { this.emit('onError', reason || '録音データがありません。少し長く録音してから停止してください。'); return; }
      try { const blob = new this.env.Blob(chunks, {type: mime}); this.emit('onComplete', {blob, elapsed, reason, partial}); }
      catch (error) { this.emit('onError', message(error)); }
    }
    tick() {
      let db = -60;
      try {
        if (this.analyser && this.context.state === 'running') {
          if (this.analyser.getFloatTimeDomainData) this.analyser.getFloatTimeDomainData(this.samples);
          else { this.analyser.getByteTimeDomainData(this.byteSamples); for (let i=0;i<this.samples.length;i++) this.samples[i]=(this.byteSamples[i]-128)/128; }
          let sum = 0, peak = 0;
          for (const x of this.samples) { sum += x*x; peak = Math.max(peak, Math.abs(x)); }
          db = Math.max(-60, Math.min(0, 20 * Math.log10(Math.sqrt(sum / this.samples.length) || 0.000001)));
          this.emit('onLevel', db, peak >= .98);
        }
      } catch { this.emit('onLevel', -60, false); }
      this.emit('onTime', this.duration());
    }
    release() {
      const e = this.env;
      e.clearInterval(this.ticker); e.clearInterval(this.countTimer); e.clearTimeout(this.stopTimer);
      this.ticker = this.countTimer = this.stopTimer = null;
      if (this.recorder) this.recorder.ondataavailable = this.recorder.onstop = this.recorder.onerror = this.recorder.onstart = this.recorder.onpause = this.recorder.onresume = null;
      if (this.stream) this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      for (const node of [this.source,this.analyser,this.silent]) { if (node) try { node.disconnect(); } catch {} }
      if (this.context) { this.context.onstatechange = null; if (this.context.state !== 'closed') this.context.close().catch(() => {}); }
      this.source = this.analyser = this.silent = this.context = this.recorder = null;
      this.emit('onLevel', -60, false);
    }
  }
  root.MicrophoneRecorder = MicrophoneRecorder;
  if (typeof module !== 'undefined') module.exports = {MicrophoneRecorder, message};
})(globalThis);
