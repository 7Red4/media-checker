'use strict';

(() => {
  const MC = globalThis.__mediaChecker;

  const MIN_SCALE = 0.05;
  const MAX_SCALE = 64;
  const ZOOM_PER_PX = 0.00182; // 一格滾輪（100px）約 ×1.2
  const ROTATE_DEG_PER_PX = 0.15; // 一格滾輪約 15°
  const DRAG_THRESHOLD_PX = 4;
  const FIT_RATIO = 0.92;
  const VIDEO_LOAD_TIMEOUT_MS = 15000;
  const MIRROR_FRAME_TIMEOUT_MS = 1500;
  const PIXELATED_FROM = 3; // 放大超過 3 倍後顯示清晰像素，方便檢查細節
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  const CSS_TEXT = `
    :host { color-scheme: dark; }
    * { box-sizing: border-box; }
    .root {
      position: absolute; inset: 0; overflow: hidden;
      background: rgba(9, 10, 14, .93);
      color: #e8eaf0;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif;
      user-select: none;
      animation: mc-in .14s ease-out;
    }
    @keyframes mc-in { from { opacity: 0; } }
    .stage {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      cursor: grab; touch-action: none; outline: none;
    }
    .stage.dragging { cursor: grabbing; }
    .frame { flex: none; transform-origin: center; will-change: transform; line-height: 0; }
    .frame.animate { transition: transform .18s ease-out; }
    .frame > * { display: block; -webkit-user-drag: none; user-select: none; }
    .frame > .checker {
      background: repeating-conic-gradient(#3a3d46 0 25%, #2a2c33 0 50%) 0 0 / 16px 16px;
    }
    .frame.pixelated > * { image-rendering: pixelated; }

    .pill {
      background: rgba(22, 24, 31, .82);
      border: 1px solid rgba(255, 255, 255, .1);
      border-radius: 8px;
      backdrop-filter: blur(8px);
    }
    .hud {
      position: absolute; top: 14px; left: 14px; padding: 6px 10px;
      font-variant-numeric: tabular-nums; pointer-events: none;
    }
    .hint {
      position: absolute; left: 14px; bottom: 14px; padding: 6px 10px;
      color: #a6abb8; font-size: 12px; pointer-events: none;
    }
    .close {
      position: absolute; top: 14px; right: 14px; width: 34px; height: 34px; padding: 0;
      display: grid; place-items: center; color: inherit; cursor: pointer;
    }
    .close:hover { background: rgba(70, 74, 88, .9); }
    button:focus-visible, input:focus-visible { outline: 2px solid #7cc4ff; outline-offset: 1px; }
    svg { display: block; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    .zone {
      position: absolute; right: 14px; bottom: 14px; width: 132px; height: 132px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
      border-radius: 16px; cursor: ns-resize; transition: border-color .12s, background .12s;
    }
    .zone:hover, .zone.active { background: rgba(38, 56, 84, .9); border-color: #7cc4ff; }
    .dial { width: 74px; height: 74px; color: #7cc4ff; }
    .dial-ring { stroke: rgba(255, 255, 255, .22); stroke-width: 2; }
    .dial-tick { stroke: rgba(255, 255, 255, .4); stroke-width: 1.5; }
    .dial-text { font-size: 15px; font-variant-numeric: tabular-nums; }
    .zone-label { color: #a6abb8; font-size: 11px; }

    .bar {
      position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
      width: min(620px, calc(100% - 520px)); height: 42px; padding: 0 10px;
      display: flex; align-items: center; gap: 10px; cursor: default;
    }
    .bar button {
      flex: none; width: 28px; height: 28px; padding: 0; display: grid; place-items: center;
      background: transparent; border: 0; border-radius: 6px; color: inherit; cursor: pointer;
    }
    .bar button:hover { background: rgba(255, 255, 255, .12); }
    .bar input[type=range] { accent-color: #7cc4ff; min-width: 0; margin: 0; cursor: pointer; }
    .seek { flex: 1; }
    .volume { flex: none; width: 70px; }
    .time { flex: none; font-variant-numeric: tabular-nums; font-size: 12px; color: #c4c8d2; white-space: nowrap; }

    .status {
      position: absolute; inset: 0; display: grid; place-items: center; text-align: center;
      pointer-events: none; padding: 24px;
    }
    .status a { color: #7cc4ff; pointer-events: auto; }
    .spinner {
      width: 34px; height: 34px; border-radius: 50%;
      border: 3px solid rgba(255, 255, 255, .18); border-top-color: #7cc4ff;
      animation: mc-spin .8s linear infinite;
    }
    @keyframes mc-spin { to { transform: rotate(360deg); } }
    @media (max-width: 900px) {
      .hint { display: none; }
      .bar { left: 14px; right: 160px; width: auto; transform: none; }
    }
    @media (max-width: 560px) {
      .volume, .time { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .root, .spinner { animation-duration: 0s; }
      .frame.animate { transition: none; }
    }

    .toast {
      position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%);
      padding: 8px 14px; background: rgba(22, 24, 31, .94); color: #e8eaf0;
      border: 1px solid rgba(255, 255, 255, .14); border-radius: 8px;
      font: 13px/1.4 system-ui, "Segoe UI", "Microsoft JhengHei", sans-serif; white-space: nowrap;
    }
    .toast.at-top { top: 24px; bottom: auto; }
  `;

  // 不用 innerHTML：部分網站啟用 Trusted Types，會直接拋錯
  function h(tag, props = {}, ...children) {
    const el = document.createElementNS(HTML_NS, tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') el.className = value;
      else if (key in el) el[key] = value;
      else el.setAttribute(key, value);
    }
    el.append(...children);
    return el;
  }

  function s(tag, attrs = {}, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    el.append(...children);
    return el;
  }

  const icon = (...paths) =>
    s('svg', { width: 18, height: 18, viewBox: '0 0 24 24' }, ...paths.map((d) => s('path', { d })));
  const ICONS = {
    close: () => icon('M6 6l12 12', 'M18 6L6 18'),
    play: () => icon('M7 4.5v15l12-7.5z'),
    pause: () => icon('M8 5v14', 'M16 5v14'),
    sound: () => icon('M4 9.5v5h4l5 4v-13l-5 4z', 'M16.5 9a4 4 0 0 1 0 6'),
    muted: () => icon('M4 9.5v5h4l5 4v-13l-5 4z', 'M17 10l4 4', 'M21 10l-4 4'),
  };

  function createHost() {
    const host = document.createElementNS(HTML_NS, 'div');
    const styles = {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      'max-width': 'none',
      'max-height': 'none',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      overflow: 'hidden',
      display: 'block',
      'z-index': '2147483647',
    };
    // 走 CSSOM 而非 style 屬性，避開嚴格 CSP；!important 擋住頁面規則
    for (const [key, value] of Object.entries(styles)) host.style.setProperty(key, value, 'important');
    host.setAttribute('popover', 'manual');
    host.setAttribute('data-media-checker', '');
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS_TEXT);
    shadow.adoptedStyleSheets = [sheet];
    return { host, shadow };
  }

  function showInTopLayer(host) {
    document.documentElement.appendChild(host);
    // top layer 蓋得過任何 z-index，也蓋得過頁面的全螢幕元素；
    // manual 模式不會自帶 Esc 關閉，Esc 邏輯才能完全由我們決定。
    try {
      host.showPopover();
    } catch {
      /* 舊版或特殊文件：退回 z-index */
    }
  }

  function removeHost(host) {
    try {
      host.hidePopover();
    } catch {
      /* 未開啟 */
    }
    host.remove();
  }

  const uiHosts = new WeakSet();
  MC.isOwnUi = (el) => uiHosts.has(el);

  // ---------- 媒體載入：逐層退回 ----------

  function loadImageFromUrl(url, media, session) {
    return new Promise((resolve, reject) => {
      const img = document.createElementNS(HTML_NS, 'img');
      if (media.referrerPolicy) img.referrerPolicy = media.referrerPolicy;
      img.draggable = false;
      img.alt = '';
      img.onload = () => {
        img.onload = img.onerror = null;
        resolve(img);
      };
      img.onerror = () => {
        img.onload = img.onerror = null;
        reject(new Error(`image failed: ${url}`));
      };
      session.track(img);
      img.src = url;
    });
  }

  function snapshotCanvas(source) {
    const w = source.videoWidth || source.naturalWidth || source.width;
    const h = source.videoHeight || source.naturalHeight || source.height;
    if (!w || !h) return null;
    const canvas = document.createElementNS(HTML_NS, 'canvas');
    canvas.width = w;
    canvas.height = h;
    // 被污染的來源仍可繪製，只是不能再匯出，顯示不受影響
    canvas.getContext('2d').drawImage(source, 0, 0, w, h);
    return canvas;
  }

  async function loadImage(media, session) {
    for (const url of media.urls) {
      try {
        const el = await loadImageFromUrl(url, media, session);
        return { el, kind: 'image', vector: !!media.vector };
      } catch {
        session.ensureOpen();
      }
    }
    // 頁面 CSP 或 CORS 擋下時，由 background 帶 cookie 重抓一次
    for (const url of media.urls) {
      if (!/^https?:/i.test(url)) continue;
      const response = await MC.send({ type: 'fetch-image', url });
      session.ensureOpen();
      if (!response?.dataUrl) continue;
      try {
        const el = await loadImageFromUrl(response.dataUrl, media, session);
        return { el, kind: 'image', vector: !!media.vector };
      } catch {
        session.ensureOpen();
      }
    }
    // 最後手段：原元素已解碼完成，直接拷貝像素
    if (media.el && media.el.localName !== 'svg') {
      const canvas = snapshotCanvas(media.el);
      if (canvas) return { el: canvas, kind: 'image', note: '畫面擷取' };
    }
    throw new Error('no usable image source');
  }

  function waitForVideo(video, session) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(reject, new Error('video timeout')), VIDEO_LOAD_TIMEOUT_MS);
      const onReady = () => done(resolve);
      const onError = () => done(reject, new Error('video error'));
      const done = (settle, value) => {
        clearTimeout(timer);
        session.signal.removeEventListener('abort', onAbort);
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
        settle(value);
      };
      const onAbort = () => done(reject, new Error('closed'));
      session.signal.addEventListener('abort', onAbort);
      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('error', onError);
    });
  }

  function createVideoElement(session) {
    const video = document.createElementNS(HTML_NS, 'video');
    video.playsInline = true;
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    video.draggable = false;
    session.track(video);
    return video;
  }

  async function loadClonedVideo(media, session) {
    for (const url of media.urls) {
      const video = createVideoElement(session);
      if (media.crossOrigin != null) video.crossOrigin = media.crossOrigin;
      if (media.referrerPolicy) video.setAttribute('referrerpolicy', media.referrerPolicy);
      video.loop = !!media.loop;
      video.muted = !!media.muted;
      if (media.volume != null) video.volume = media.volume;
      video.src = url;
      try {
        await waitForVideo(video, session);
        if (media.currentTime && Number.isFinite(video.duration)) {
          video.currentTime = Math.min(media.currentTime, video.duration);
        }
        return { el: video, kind: 'video', control: video, startPlayback: true };
      } catch {
        session.ensureOpen();
        session.destroy(video);
      }
    }
    return null;
  }

  // MSE（blob: 且綁定 MediaSource）或串流無法再次載入，改鏡像原元素的畫面，
  // 控制列則直接操作原元素。
  async function loadMirroredVideo(media, session) {
    const source = media.el;
    if (source?.localName !== 'video') return null;
    let stream = source.srcObject instanceof MediaStream ? source.srcObject : null;
    let ownsStream = false;
    if (!stream) {
      try {
        stream = source.captureStream();
        ownsStream = true;
      } catch {
        return null; // 跨來源或 DRM
      }
    }
    if (!stream.getVideoTracks().length) return null;

    const video = createVideoElement(session);
    video.muted = true; // 聲音仍由原元素播放
    video.srcObject = stream;
    if (ownsStream) session.ownedStreams.add(stream);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(reject, MIRROR_FRAME_TIMEOUT_MS);
        video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true, signal: session.signal });
        video.play().catch(() => {});
        // 暫停中的原影片不會輸出新影格，原地 seek 一次促使它送出畫面
        if (source.paused && Number.isFinite(source.duration)) source.currentTime = source.currentTime;
      });
    } catch {
      session.ensureOpen();
      session.destroy(video);
      return null;
    }
    return { el: video, kind: 'video', control: source, note: '同步原影片' };
  }

  async function loadVideo(media, session) {
    const cloned = await loadClonedVideo(media, session);
    if (cloned) return cloned;
    session.ensureOpen();
    const mirrored = await loadMirroredVideo(media, session);
    if (mirrored) return mirrored;
    session.ensureOpen();
    if (media.el?.localName === 'video') {
      const canvas = snapshotCanvas(media.el);
      if (canvas) return { el: canvas, kind: 'image', note: '影片無法複製，僅顯示目前畫面' };
    }
    if (media.poster) {
      return loadImage({ urls: [media.poster], referrerPolicy: media.referrerPolicy }, session);
    }
    throw new Error('no usable video source');
  }

  // ---------- 燈箱 ----------

  let current = null;
  let toastTimer = null;
  let toastHost = null;

  function formatTime(t) {
    if (!Number.isFinite(t)) return '--:--';
    const total = Math.floor(t);
    const hours = Math.floor(total / 3600);
    const mm = String(Math.floor(total / 60) % 60).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function normalizeAngle(deg) {
    const wrapped = ((deg + 180) % 360 + 360) % 360 - 180;
    return wrapped === -180 ? 180 : wrapped;
  }

  function normalizedWheelDelta(e) {
    const raw = e.deltaY || e.deltaX;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return raw * 33;
    if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return raw * 400;
    return raw;
  }

  function open(media, { onUnavailable } = {}) {
    if (current) return;
    const controller = new AbortController();
    const { signal } = controller;
    const { host, shadow } = createHost();
    uiHosts.add(host);

    const view = { scale: 1, rotation: 0, x: 0, y: 0 };

    const frame = h('div', { class: 'frame' });
    const stage = h('div', { class: 'stage', tabIndex: -1 }, frame);
    const hud = h('div', { class: 'hud pill', textContent: '載入中…' });
    const hint = h('div', { class: 'hint pill', textContent: '滾輪縮放 · 左鍵拖曳 · Esc 復原／退出' });
    const closeButton = h('button', { class: 'close pill', type: 'button', title: '關閉', ariaLabel: '關閉' }, ICONS.close());
    const needle = s('line', { x1: 40, y1: 40, x2: 40, y2: 12, 'stroke-width': 3 });
    const ticks = [0, 90, 180, 270].map((a) =>
      s('line', { class: 'dial-tick', x1: 40, y1: 2, x2: 40, y2: 8, transform: `rotate(${a} 40 40)` }),
    );
    const dial = s('svg', { class: 'dial', viewBox: '0 0 80 80' },
      s('circle', { class: 'dial-ring', cx: 40, cy: 40, r: 37 }), ...ticks, needle,
      s('circle', { cx: 40, cy: 40, r: 3, fill: 'currentColor', stroke: 'none' }));
    const zoneText = h('div', { class: 'dial-text', textContent: '0°' });
    const zone = h('div', { class: 'zone pill', title: '在此區域滾動滾輪可旋轉媒體' },
      dial, zoneText, h('div', { class: 'zone-label', textContent: '滾輪旋轉' }));
    const status = h('div', { class: 'status' }, h('div', { class: 'spinner' }));
    const root = h('div', { class: 'root' }, stage, status, hud, hint, zone, closeButton);
    shadow.append(root);

    const session = {
      signal,
      ownedStreams: new Set(),
      live: new Set(),
      closed: false,
      track(el) { this.live.add(el); },
      ensureOpen() { if (this.closed) throw new Error('closed'); },
      destroy(el) {
        this.live.delete(el);
        if (el.localName === 'video') {
          el.pause();
          el.srcObject = null;
          el.removeAttribute('src');
          el.load(); // 釋放解碼器與網路連線
        } else if (el.localName === 'img') {
          el.removeAttribute('src');
        }
        el.remove();
      },
    };

    let loaded = null;
    let baseSize = { w: 0, h: 0, naturalW: 0, naturalH: 0 };
    let resumeSource = false;

    const isDirty = () =>
      Math.abs(view.scale - 1) > 0.001 || Math.abs(view.rotation) > 0.01 || Math.abs(view.x) > 0.5 || Math.abs(view.y) > 0.5;

    function render() {
      frame.style.transform = `translate(${view.x}px, ${view.y}px) rotate(${view.rotation}deg) scale(${view.scale})`;
      const angle = Math.round(view.rotation * 10) / 10;
      zoneText.textContent = `${angle}°`;
      needle.setAttribute('transform', `rotate(${view.rotation} 40 40)`);
      if (!loaded) return;
      const pixelRatio = baseSize.naturalW ? (baseSize.w * view.scale) / baseSize.naturalW : 1;
      frame.classList.toggle('pixelated', !loaded.vector && pixelRatio >= PIXELATED_FROM);
      const parts = [
        loaded.kind === 'video' ? '影片' : '圖片',
        baseSize.naturalW ? `${baseSize.naturalW} × ${baseSize.naturalH}` : null,
        `${Math.round(pixelRatio * 100)}%`,
        loaded.note,
      ];
      hud.textContent = parts.filter(Boolean).join(' · ');
    }

    function layout() {
      if (!loaded) return;
      const { el, vector } = loaded;
      const naturalW = el.naturalWidth || el.videoWidth || el.width || media.el?.getBoundingClientRect?.().width || 300;
      const naturalH = el.naturalHeight || el.videoHeight || el.height || media.el?.getBoundingClientRect?.().height || 150;
      const maxW = root.clientWidth * FIT_RATIO;
      const maxH = root.clientHeight * FIT_RATIO;
      // 點陣圖不主動放大，才看得出原始尺寸；向量圖則填滿
      const ratio = Math.min(maxW / naturalW, maxH / naturalH, vector ? Infinity : 1);
      baseSize = { w: naturalW * ratio, h: naturalH * ratio, naturalW, naturalH };
      el.style.width = `${baseSize.w}px`;
      el.style.height = `${baseSize.h}px`;
      render();
    }

    function resetView() {
      frame.classList.add('animate');
      Object.assign(view, { scale: 1, rotation: 0, x: 0, y: 0 });
      render();
      frame.addEventListener('transitionend', () => frame.classList.remove('animate'), { once: true, signal });
    }

    function zoomAt(clientX, clientY, delta) {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * Math.exp(-delta * ZOOM_PER_PX)));
      const snapped = Math.abs(next - 1) < 0.01 ? 1 : next;
      const rect = root.getBoundingClientRect();
      const px = clientX - rect.left - rect.width / 2;
      const py = clientY - rect.top - rect.height / 2;
      const k = snapped / view.scale;
      // 讓游標下的點保持不動
      view.x = px - (px - view.x) * k;
      view.y = py - (py - view.y) * k;
      view.scale = snapped;
      if (snapped === 1 && Math.abs(view.x) < 1 && Math.abs(view.y) < 1) view.x = view.y = 0;
      render();
    }

    function rotateBy(delta, fine) {
      const next = normalizeAngle(view.rotation + delta * ROTATE_DEG_PER_PX * (fine ? 0.2 : 1));
      view.rotation = Math.abs(next) < 0.25 ? 0 : next;
      render();
    }

    function togglePlayback() {
      const control = loaded?.control;
      if (!control) return;
      if (control.paused) control.play().catch(() => {});
      else control.pause();
    }

    function buildVideoBar(control) {
      const playButton = h('button', { type: 'button', title: '播放／暫停（空白鍵）' });
      const seek = h('input', { class: 'seek', type: 'range', min: 0, max: 1000, value: 0, step: 1, ariaLabel: '播放進度' });
      const time = h('div', { class: 'time', textContent: '00:00 / --:--' });
      const muteButton = h('button', { type: 'button', title: '靜音' });
      const volume = h('input', { class: 'volume', type: 'range', min: 0, max: 1, step: 0.01, ariaLabel: '音量' });
      const bar = h('div', { class: 'bar pill' }, playButton, seek, time, muteButton, volume);

      const sync = () => {
        playButton.replaceChildren(control.paused ? ICONS.play() : ICONS.pause());
        const muted = control.muted || control.volume === 0;
        muteButton.replaceChildren(muted ? ICONS.muted() : ICONS.sound());
        volume.value = control.muted ? 0 : control.volume;
      };
      const syncTime = () => {
        const seekable = Number.isFinite(control.duration) && control.duration > 0;
        seek.disabled = !seekable;
        if (seekable) seek.value = (control.currentTime / control.duration) * 1000;
        time.textContent = `${formatTime(control.currentTime)} / ${formatTime(control.duration)}`;
      };
      for (const type of ['play', 'pause', 'volumechange']) control.addEventListener(type, sync, { signal });
      for (const type of ['timeupdate', 'durationchange', 'seeked']) control.addEventListener(type, syncTime, { signal });
      playButton.addEventListener('click', togglePlayback, { signal });
      muteButton.addEventListener('click', () => { control.muted = !control.muted; }, { signal });
      volume.addEventListener('input', () => {
        control.volume = Number(volume.value);
        control.muted = control.volume === 0;
      }, { signal });
      seek.addEventListener('input', () => {
        if (Number.isFinite(control.duration)) control.currentTime = (Number(seek.value) / 1000) * control.duration;
      }, { signal });
      // 控制列上的操作不應連帶拖曳媒體
      bar.addEventListener('pointerdown', (e) => e.stopPropagation(), { signal });
      sync();
      syncTime();
      root.append(bar);
    }

    function showFailure() {
      const link = media.urls?.find((u) => /^https?:/i.test(u));
      const children = [h('div', { textContent: '無法載入此媒體' })];
      if (link) {
        children.push(h('a', { href: link, target: '_blank', rel: 'noreferrer noopener', textContent: '在新分頁開啟' }));
      }
      status.replaceChildren(h('div', {}, ...children));
      hud.textContent = '載入失敗';
    }

    function mount(result) {
      loaded = result;
      status.replaceChildren();
      if (result.kind === 'image' && !result.vector) result.el.classList.add('checker');
      frame.append(result.el);
      layout();
      if (result.kind === 'video') {
        buildVideoBar(result.control);
        result.el.addEventListener('dblclick', (e) => e.preventDefault(), { signal });
        if (result.startPlayback) {
          const source = media.el;
          if (source?.localName === 'video' && !source.paused) {
            resumeSource = true;
            source.pause(); // 避免原影片與燈箱同時發聲
          }
          result.el.play().catch(() => {
            // 自動播放政策擋下有聲播放：改靜音再試
            result.el.muted = true;
            result.el.play().catch(() => {});
          });
        }
      }
    }

    // ---------- 事件 ----------

    // 頁面的 bubble 階段監聽不該看到燈箱內的事件（例如禁止右鍵的 handler）
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu', 'wheel', 'auxclick']) {
      host.addEventListener(type, (e) => e.stopPropagation(), { signal });
    }

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      frame.classList.remove('animate');
      zoomAt(e.clientX, e.clientY, normalizedWheelDelta(e));
    }, { passive: false, signal });

    zone.addEventListener('wheel', (e) => {
      e.preventDefault();
      frame.classList.remove('animate');
      rotateBy(normalizedWheelDelta(e), e.shiftKey);
    }, { passive: false, signal });

    // 不論滾輪落在燈箱哪個位置（含 HUD、控制列），底下的頁面都不能捲動
    window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false, capture: true, signal });

    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      stage.focus({ preventScroll: true });
      if (e.button !== 0) return;
      e.preventDefault();
      frame.classList.remove('animate');
      stage.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: view.x, y: view.y, moved: false, onMedia: e.target === loaded?.el };
    }, { signal });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      stage.classList.add('dragging');
      view.x = drag.x + dx;
      view.y = drag.y + dy;
      render();
    }, { signal });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { moved, onMedia } = drag;
      drag = null;
      stage.classList.remove('dragging');
      if (e.type === 'pointerup' && !moved && onMedia) togglePlayback();
    };
    stage.addEventListener('pointerup', endDrag, { signal });
    stage.addEventListener('pointercancel', endDrag, { signal });
    stage.addEventListener('dragstart', (e) => e.preventDefault(), { signal });

    closeButton.addEventListener('click', close, { signal });

    function handleKey(key, event) {
      if (key === 'Escape') {
        if (event?.repeat) return; // 長按不能連續觸發「復原 → 退出」
        if (isDirty()) resetView();
        else close();
      } else if (key === ' ') {
        if (event?.repeat) return;
        togglePlayback();
      }
    }

    const SCROLL_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Tab', 'Alt']);
    // 聚焦在控制列時，方向鍵交給滑桿、空白鍵交給按鈕（按鈕要到 keyup 才觸發 click）
    const belongsToControl = (e) => {
      const focused = shadow.activeElement?.localName;
      return (e.key.startsWith('Arrow') && focused === 'input') || (e.key === ' ' && focused === 'button');
    };
    const swallowKey = (e) => {
      e.stopImmediatePropagation();
      if (SCROLL_KEYS.has(e.key) && !belongsToControl(e)) e.preventDefault();
    };
    window.addEventListener('keydown', (e) => {
      swallowKey(e);
      if (!belongsToControl(e)) handleKey(e.key, e);
    }, { capture: true, signal });
    // Alt 放開也要吃掉，否則 Windows 上 Chrome 會把焦點移到工具列，Esc 就失效了
    window.addEventListener('keyup', swallowKey, { capture: true, signal });
    window.addEventListener('keypress', swallowKey, { capture: true, signal });
    window.addEventListener('resize', layout, { signal });
    window.addEventListener('pagehide', close, { signal });

    function close() {
      if (session.closed) return;
      session.closed = true;
      const source = media.el;
      controller.abort();
      for (const el of [...session.live]) session.destroy(el);
      for (const stream of session.ownedStreams) {
        for (const track of stream.getTracks()) track.stop();
      }
      session.ownedStreams.clear();
      removeHost(host);
      current = null;
      if (resumeSource && source?.isConnected) source.play().catch(() => {});
      MC.send({ type: 'state', open: false });
    }

    current = { close, handleKey, host };

    showInTopLayer(host);
    stage.focus({ preventScroll: true });
    window.focus();
    MC.send({ type: 'state', open: true });
    render();

    (media.kind === 'video' ? loadVideo(media, session) : loadImage(media, session)).then(
      (result) => {
        if (session.closed) return;
        mount(result);
      },
      () => {
        if (session.closed) return;
        if (onUnavailable) {
          // 頂層 frame 載不到（例如防盜連），交回媒體所在的 frame 開啟
          close();
          onUnavailable();
        } else {
          showFailure();
        }
      },
    );
  }

  function toast(text, { top = false } = {}) {
    clearTimeout(toastTimer);
    toastHost?.remove();
    const { host, shadow } = createHost();
    host.style.setProperty('pointer-events', 'none', 'important');
    uiHosts.add(host);
    shadow.append(h('div', { class: top ? 'toast at-top' : 'toast', textContent: text }));
    showInTopLayer(host);
    toastHost = host;
    toastTimer = setTimeout(() => {
      removeHost(host);
      if (toastHost === host) toastHost = null;
    }, 2200);
  }

  MC.lightbox = {
    open,
    toast,
    close: () => current?.close(),
    handleKey: (key) => current?.handleKey(key),
    get isOpen() { return !!current; },
  };
})();
