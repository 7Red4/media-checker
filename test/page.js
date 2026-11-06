'use strict';

// 頁面行為模擬：禁用右鍵
document.getElementById('c-blocked').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

const photo = () => {
  const img = document.createElement('img');
  img.src = 'img/photo.svg?shadow';
  img.style.cssText = 'width:200px;height:130px;display:block';
  return img;
};

customElements.define('x-open', class extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' }).append(photo());
  }
});
customElements.define('x-closed', class extends HTMLElement {
  connectedCallback() {
    const img = photo();
    img.style.pointerEvents = 'none';
    this.attachShadow({ mode: 'closed' }).append(img);
  }
});

const canvas = document.getElementById('c-canvas');
const g = canvas.getContext('2d');
g.fillStyle = '#c33';
g.fillRect(0, 0, 400, 260);
g.fillStyle = '#fff';
g.font = '48px sans-serif';
g.fillText('canvas', 120, 145);

// 跨來源 iframe：localhost <-> 127.0.0.1
const otherOrigin = location.hostname === 'localhost'
  ? `http://127.0.0.1:${location.port}`
  : `http://localhost:${location.port}`;
const framePath = location.pathname.replace(/[^/]*$/, 'frame.html');
for (const id of ['c-frame-cross', 'c-frame-pe']) {
  document.getElementById(id).src = otherOrigin + framePath;
}
document.getElementById('c-frame-over').src = `${otherOrigin + framePath}?empty`;

// 影片素材用 MediaRecorder 即時產生，測試頁不必附帶二進位檔
async function recordClip() {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const ctx = c.getContext('2d');
  const stream = c.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start();
  const started = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = performance.now() - started;
      ctx.fillStyle = `hsl(${t / 8}, 70%, 45%)`;
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#fff';
      ctx.fillRect((t / 5) % 320, 70, 40, 40);
      if (t < 1500) setTimeout(tick, 33);
      else resolve();
    };
    tick();
  });
  recorder.stop();
  await stopped;
  return new Blob(chunks, { type: 'video/webm' });
}

async function attachMse(video, blob) {
  const source = new MediaSource();
  video.src = URL.createObjectURL(source);
  await new Promise((resolve) => source.addEventListener('sourceopen', resolve, { once: true }));
  const buffer = source.addSourceBuffer('video/webm;codecs=vp8');
  buffer.appendBuffer(await blob.arrayBuffer());
  await new Promise((resolve) => buffer.addEventListener('updateend', resolve, { once: true }));
  source.endOfStream();
}

window.mediaReady = (async () => {
  const blob = await recordClip();
  const url = URL.createObjectURL(blob);
  const plain = document.getElementById('c-video');
  const covered = document.getElementById('c-video2');
  plain.src = url;
  covered.src = url;
  await attachMse(document.getElementById('c-mse'), blob);
  await Promise.all([plain, covered, document.getElementById('c-mse')].map((v) => v.play().catch(() => {})));
})();
