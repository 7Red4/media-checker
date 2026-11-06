'use strict';

const MENU_ID = 'media-check';
const MAX_FETCH_BYTES = 40 * 1024 * 1024; // 訊息通道上限約 64MB，base64 後需留餘裕
const NONCE_TTL_MS = 5000;

// 一次性憑證：跨 frame 探測走 postMessage，頁面也能偽造，所以要由 background 核發與核銷。
const nonces = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'media-check',
    contexts: ['page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio'],
  });
  injectIntoOpenTabs();
});

// 安裝或更新前就開著的分頁沒有 content script，補注入後不必重新整理頁面。
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => injectInto({ tabId: tab.id, allFrames: true })));
}

async function injectInto(target) {
  const { js } = chrome.runtime.getManifest().content_scripts[0];
  try {
    await chrome.scripting.executeScript({ target, files: js });
    return true;
  } catch {
    return false; // chrome://、線上應用程式商店等受限頁面
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  const message = {
    type: 'menu-click',
    info: { srcUrl: info.srcUrl, mediaType: info.mediaType },
  };
  const frameId = info.frameId ?? 0;
  try {
    await chrome.tabs.sendMessage(tab.id, message, { frameId });
  } catch {
    if (await injectInto({ tabId: tab.id, frameIds: [frameId] })) {
      chrome.tabs.sendMessage(tab.id, message, { frameId }).catch(() => {});
    }
  }
});

async function fetchAsDataUrl(url) {
  if (!/^https?:/i.test(url)) throw new Error('unsupported scheme');
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`not an image: ${type}`);
  const blob = await response.blob();
  if (blob.size > MAX_FETCH_BYTES) throw new Error('too large');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function mintNonce(tabId) {
  const nonce = crypto.randomUUID();
  nonces.set(nonce, tabId);
  setTimeout(() => nonces.delete(nonce), NONCE_TTL_MS);
  return nonce;
}

function consumeNonce(nonce, tabId) {
  const valid = nonces.get(nonce) === tabId;
  nonces.delete(nonce);
  return valid;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return false;
  const top = { frameId: 0 };

  switch (message.type) {
    case 'relay-open':
      chrome.tabs
        .sendMessage(tabId, { type: 'show', media: message.media, sourceFrameId: sender.frameId }, top)
        .then((response) => sendResponse({ ok: !!response?.ok }))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case 'show-local':
      chrome.tabs.sendMessage(tabId, { type: 'show-local' }, { frameId: message.frameId }).catch(() => {});
      return false;

    case 'fetch-image':
      fetchAsDataUrl(message.url)
        .then((dataUrl) => sendResponse({ dataUrl }))
        .catch((error) => sendResponse({ error: String(error) }));
      return true;

    case 'mint-nonce':
      sendResponse({ nonce: mintNonce(tabId) });
      return false;

    case 'consume-nonce':
      sendResponse({ valid: consumeNonce(message.nonce, tabId) });
      return false;

    case 'get-tab-url':
      sendResponse({ url: sender.tab.url });
      return false;

    case 'toast':
      chrome.tabs.sendMessage(tabId, { type: 'toast', text: message.text, top: message.top }, top).catch(() => {});
      return false;

    case 'state':
      chrome.tabs
        .sendMessage(tabId, { type: 'state', open: message.open, hostFrameId: sender.frameId })
        .catch(() => {});
      return false;

    case 'key':
      chrome.tabs
        .sendMessage(tabId, { type: 'key', key: message.key }, { frameId: message.frameId })
        .catch(() => {});
      return false;

    default:
      return false;
  }
});
