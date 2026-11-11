(function () {
  'use strict';
  const button = document.getElementById('installApp');
  const help = document.getElementById('installHelp');
  const info = document.getElementById('pwaStatus');
  const mode = window.matchMedia('(display-mode: standalone)');
  let offer = null;
  const standalone = () => mode.matches || navigator.standalone === true;
  function refresh() {
    const installed = standalone();
    button.hidden = installed || !offer;
    help.hidden = installed;
  }
  refresh();
  if (mode.addEventListener) mode.addEventListener('change', refresh);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    offer = event;
    refresh();
  });
  button.addEventListener('click', async () => {
    if (!offer) return;
    const event = offer;
    offer = null;
    refresh();
    try {
      await event.prompt();
      const choice = await event.userChoice;
      info.textContent = choice.outcome === 'accepted'
        ? 'インストール操作を受け付けました。ホーム画面をご確認ください。'
        : 'インストールをキャンセルしました。ブラウザのメニューからも追加できます。';
    } catch {
      info.textContent = 'ブラウザのメニューからホーム画面に追加してください。';
    }
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    button.hidden = true;
    help.hidden = true;
    info.textContent = 'ホーム画面から起動できます。';
  });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    info.textContent = 'ホーム画面追加とオフライン準備にはHTTPSと対応ブラウザが必要です。';
    return;
  }
  const waitingMessage = () => {
    info.textContent = '更新があります。録音・編集の保存中が終わり、必要なWAVや外部バックアップを保存してから、このアプリのすべてのタブ・ウィンドウを閉じ、開き直してください。';
  };
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('sw.js', {scope: './', updateViaCache: 'none'});
      const observe = worker => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') {
            if (navigator.serviceWorker.controller) waitingMessage();
            else info.textContent = 'オフライン用のアプリを準備しました。録音・パッドはブラウザ内に保存します。外部バックアップも保存してください。';
          }
        });
      };
      if (registration.waiting) waitingMessage();
      else observe(registration.installing);
      registration.addEventListener('updatefound', () => observe(registration.installing));
    } catch {
      info.textContent = 'オフライン準備ができませんでした。オンラインで利用し、HTTPSや空き容量をご確認ください。';
    }
  });
})();
