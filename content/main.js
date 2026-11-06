'use strict';

(() => {
  const MC = globalThis.__mediaChecker;
  const { lightbox } = MC;
  const TEARDOWN_EVENT = '__media_checker_teardown__';
  const PROBE_KEY = '__mediaCheckerProbe';
  const MISS_TEXT = '這個位置找不到圖片或影片';
  const isTop = window === window.top;

  // 擴充功能更新後舊腳本仍留在頁面上，先請它自行卸載，避免事件被處理兩次
  window.dispatchEvent(new Event(TEARDOWN_EVENT));
  const controller = new AbortController();
  const { signal } = controller;
  const listen = (target, type, handler, options = {}) =>
    target.addEventListener(type, handler, { ...options, signal });

  listen(window, TEARDOWN_EVENT, () => {
    controller.abort();
    lightbox.close();
    chrome.runtime.onMessage.removeListener(onMessage);
  });

  MC.send = async (message) => {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return undefined; // 擴充功能已被重新載入
    }
  };

  let lastPoint = null;
  let lastScan = null;
  let relayedMedia = null; // 頂層載入失敗時，退回到本 frame 開啟
  let resumeOnClose = null;
  let altArmed = false;
  let forwardKeysTo = null; // 燈箱開在頂層而焦點留在本 frame 時，把按鍵轉發過去

  function safeScan(x, y, ignore) {
    try {
      return MC.scan(x, y, ignore);
    } catch (error) {
      console.debug('[media-checker] scan failed', error);
      return { media: null, rank: Infinity, iframes: [] };
    }
  }

  function notifyMiss() {
    if (isTop) lightbox.toast(MISS_TEXT);
    else MC.send({ type: 'toast', text: MISS_TEXT });
  }

  async function openMedia(media) {
    if (isTop) {
      lightbox.open(media);
      return;
    }
    // 子 frame 的燈箱只有 iframe 那麼大，能交給頂層就交給頂層
    const relayable = await MC.toRelayable(media);
    if (relayable) {
      relayedMedia = media;
      const response = await MC.send({ type: 'relay-open', media: relayable });
      if (response?.ok) {
        // 影片改由頂層播放，本 frame 的原影片先停下，避免兩份聲音
        if (media.el?.localName === 'video' && !media.el.paused) {
          media.el.pause();
          resumeOnClose = media.el;
        }
        return;
      }
    }
    lightbox.open(media);
  }

  // ---------- 跨 frame 探測 ----------
  // pointer-events:none 的 iframe 或覆蓋在媒體上的透明 iframe，事件只會落在其中一邊。

  async function postProbe(targetWindow, x, y, direction) {
    const response = await MC.send({ type: 'mint-nonce' });
    if (!response?.nonce) return;
    targetWindow.postMessage({ [PROBE_KEY]: { nonce: response.nonce, x, y, direction } }, '*');
  }

  function continueSearch(result, x, y, direction) {
    const child = result.iframes[0];
    if (child?.contentWindow) {
      const rect = child.getBoundingClientRect();
      postProbe(child.contentWindow, x - rect.left - child.clientLeft, y - rect.top - child.clientTop, 'down');
    } else if (direction !== 'down' && !isTop) {
      postProbe(window.parent, x, y, 'up');
    } else {
      notifyMiss();
    }
  }

  function trigger(x, y, scan = safeScan(x, y)) {
    if (scan.media) openMedia(scan.media);
    else continueSearch(scan, x, y, 'origin');
  }

  listen(window, 'message', async (event) => {
    const probe = event.data?.[PROBE_KEY];
    if (!probe) return;
    event.stopImmediatePropagation();
    const verdict = await MC.send({ type: 'consume-nonce', nonce: probe.nonce });
    if (!verdict?.valid || lightbox.isOpen) return;

    let { x, y } = probe;
    const ignore = [];
    if (probe.direction === 'up') {
      // 由子 frame 上來：換算座標，並跳過該 iframe 本身
      const source = [...document.querySelectorAll('iframe')].find((f) => f.contentWindow === event.source);
      if (!source) return;
      const rect = source.getBoundingClientRect();
      x += rect.left + source.clientLeft;
      y += rect.top + source.clientTop;
      ignore.push(source);
    }
    const scan = safeScan(x, y, ignore);
    if (scan.media) openMedia(scan.media);
    else continueSearch(scan, x, y, probe.direction);
  }, { capture: true });

  // ---------- Alt + 右鍵 ----------
  // 這支腳本在 document_start 就於 window capture 註冊，排在頁面所有 handler 之前，
  // 頁面即使禁用右鍵或 stopPropagation 也攔不到我們。

  const swallowAltRight = (e) => {
    if (lightbox.isOpen || e.button !== 2) return;
    if (e.type === 'pointerdown' || e.type === 'mousedown') {
      if (e.altKey) altArmed = true;
      else if (e.type === 'pointerdown') altArmed = false;
    }
    if (altArmed) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick']) {
    listen(window, type, swallowAltRight, { capture: true });
  }

  listen(window, 'contextmenu', (e) => {
    if (lightbox.isOpen) return;
    lastPoint = { x: e.clientX, y: e.clientY };
    if (e.altKey || altArmed) {
      altArmed = false;
      lastScan = null;
      e.stopImmediatePropagation();
      e.preventDefault();
      trigger(lastPoint.x, lastPoint.y);
      return;
    }
    // 在此刻就掃描：等選單項目被點下時，hover 才顯示的元素可能已經消失
    lastScan = safeScan(lastPoint.x, lastPoint.y);
  }, { capture: true });

  // ---------- Alt + C：複製目前頁面網址 ----------

  // 不經過 DOM：不改動頁面的焦點與選取範圍，也不讓頁面的 copy handler 改寫內容
  function copyViaExecCommand(text) {
    let handled = false;
    const onCopy = (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
      handled = true;
    };
    window.addEventListener('copy', onCopy, { capture: true });
    try {
      return document.execCommand('copy') && handled;
    } catch {
      return false;
    } finally {
      window.removeEventListener('copy', onCopy, { capture: true });
    }
  }

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 非安全連線沒有此 API；跨來源 iframe 預設也沒有寫入權限
      return copyViaExecCommand(text);
    }
  }

  function notifyCopyResult(text) {
    if (isTop) lightbox.toast(text, { top: true });
    else MC.send({ type: 'toast', text, top: true });
  }

  async function copyPageUrl() {
    // 焦點在 iframe 內時，要複製的仍是分頁本身的網址
    const url = isTop ? location.href : (await MC.send({ type: 'get-tab-url' }))?.url;
    const copied = !!url && (await writeClipboard(url));
    notifyCopyResult(copied ? '已複製網址連結' : '複製網址失敗');
  }

  listen(window, 'keydown', (e) => {
    // 用 code 判斷才不受輸入法與鍵盤配置影響；排除 Ctrl 是因為 AltGr 會回報成 Ctrl + Alt
    if (e.code !== 'KeyC' || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!e.repeat) copyPageUrl();
  }, { capture: true });

  // ---------- 按鍵轉發 ----------

  listen(window, 'keydown', (e) => {
    if (forwardKeysTo == null || lightbox.isOpen || e.repeat) return;
    if (e.key !== 'Escape' && e.key !== ' ') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    MC.send({ type: 'key', key: e.key, frameId: forwardKeysTo });
  }, { capture: true });

  // ---------- 來自 background 的訊息 ----------

  function handleMenuClick({ srcUrl, mediaType }) {
    if (lightbox.isOpen) return;
    const scan = lastScan;
    if (scan?.media && scan.rank === MC.RANK.NORMAL) {
      openMedia(scan.media);
    } else if (srcUrl && (mediaType === 'image' || mediaType === 'video')) {
      openMedia({ kind: mediaType, urls: [srcUrl] });
    } else if (lastPoint) {
      trigger(lastPoint.x, lastPoint.y, scan ?? undefined);
    } else {
      notifyMiss();
    }
  }

  function onMessage(message, _sender, sendResponse) {
    switch (message.type) {
      case 'menu-click':
        handleMenuClick(message.info);
        sendResponse({ ok: true });
        return false;
      case 'show':
        lightbox.open(message.media, {
          onUnavailable: () => MC.send({ type: 'show-local', frameId: message.sourceFrameId }),
        });
        sendResponse({ ok: true });
        return false;
      case 'show-local':
        if (relayedMedia) lightbox.open(relayedMedia);
        return false;
      case 'toast':
        lightbox.toast(message.text, { top: message.top });
        return false;
      case 'state':
        forwardKeysTo = message.open ? message.hostFrameId : null;
        if (!message.open && resumeOnClose) {
          if (resumeOnClose.isConnected) resumeOnClose.play().catch(() => {});
          resumeOnClose = null;
        }
        return false;
      case 'key':
        lightbox.handleKey(message.key);
        return false;
      default:
        return false;
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);
})();
