'use strict';

// 找出座標下的媒體。不依賴事件 target 或 <img>/<video> 標籤：
// pointer-events:none、透明遮罩、background-image、偽元素、canvas、inline SVG、
// shadow DOM（含 closed）都要能命中。
(() => {
  const MC = (globalThis.__mediaChecker = {});

  // 數字越小越優先；同級則取視覺上最上層者。
  const RANK = {
    NORMAL: 0,
    ICON: 1, // 小型 SVG、小型背景圖，通常是疊在媒體上的按鈕
    PAGE_BG: 2, // html/body 的背景
    WEAK: 3, // 透明、1x1、佔位圖
  };
  const ICON_MAX_PX = 64;
  const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-url'];
  const PLACEHOLDER_NAME = /(?:spacer|blank|transparent|pixel|1x1|placeholder)[^/]*$/i;
  const MEDIA_LINK = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i;
  const USABLE_URL = /^(?:https?|data|blob|file|filesystem):/i;
  const VIDEO_LINK = /\.(?:mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i;

  const passThrough = new CSSStyleSheet();
  passThrough.replaceSync('*{pointer-events:auto !important}');

  const shadowRootOf = (el) => {
    if (!(el instanceof HTMLElement)) return null;
    try {
      return chrome.dom?.openOrClosedShadowRoot?.(el) ?? el.shadowRoot;
    } catch {
      return el.shadowRoot;
    }
  };

  // 暫時讓所有元素可被命中，就能取得含 pointer-events:none 的真實視覺堆疊。
  // 用 adoptedStyleSheets 而非插入 <style>，不會驚動頁面的 MutationObserver。
  function hitTest(root, x, y) {
    const sheets = root.adoptedStyleSheets;
    sheets.push(passThrough);
    try {
      return root.elementsFromPoint(x, y);
    } finally {
      const index = sheets.lastIndexOf(passThrough);
      if (index >= 0) sheets.splice(index, 1);
    }
  }

  function stackAt(x, y) {
    const seen = new Set();
    const out = [];
    const visit = (root) => {
      for (const el of hitTest(root, x, y)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const inner = shadowRootOf(el);
        if (inner) visit(inner); // shadow 內容視覺上在 host 之上
        out.push(el);
      }
    };
    visit(document);
    return out;
  }

  function allElements(root, out = []) {
    for (const el of root.querySelectorAll('*')) {
      out.push(el);
      const inner = shadowRootOf(el);
      if (inner) allElements(inner, out);
    }
    return out;
  }

  // 命中測試抓不到的情況（visibility:hidden、inline !important、inert）改用幾何比對。
  function geometricStack(x, y) {
    return allElements(document)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      })
      .reverse();
  }

  const unique = (urls) => [...new Set(urls.filter((u) => u && USABLE_URL.test(u)))];

  function parseSrcset(srcset, base) {
    if (!srcset) return [];
    return srcset
      .split(/,\s+/)
      .map((part) => {
        const [url, descriptor = '1x'] = part.trim().split(/\s+/);
        const value = parseFloat(descriptor) || 1;
        // w 與 x 描述子不會混用，直接比數值即可
        try {
          return { url: new URL(url, base).href, value };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.value - a.value);
  }

  function bestFromSrcset(img) {
    const base = img.baseURI;
    const own = parseSrcset(img.getAttribute('srcset'), base);
    const current = img.currentSrc;
    const picture = img.parentElement?.localName === 'picture' ? img.parentElement : null;
    if (picture && current) {
      // <picture> 只採用目前生效的 source，避免選到美術裁切不同的版本
      for (const source of picture.querySelectorAll('source[srcset]')) {
        const list = parseSrcset(source.getAttribute('srcset'), base);
        if (list.some((c) => c.url === current)) return list[0].url;
      }
    }
    return own[0]?.url;
  }

  function isPlaceholder(img, url) {
    if (img.complete && img.naturalWidth > 0 && img.naturalWidth <= 2 && img.naturalHeight <= 2) return true;
    if (!url) return true;
    if (url.startsWith('data:')) return url.length < 200;
    try {
      return PLACEHOLDER_NAME.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  function fromImg(img) {
    const current = img.currentSrc || img.src;
    const placeholder = isPlaceholder(img, current);
    const lazy = LAZY_ATTRS.map((name) => img.getAttribute(name)).filter(Boolean).map((u) => {
      try {
        return new URL(u, img.baseURI).href;
      } catch {
        return null;
      }
    });
    const urls = unique(placeholder ? [bestFromSrcset(img), ...lazy, current] : [bestFromSrcset(img), current]);
    if (!urls.length) return null;
    const stillPlaceholder = placeholder && !bestFromSrcset(img) && !lazy.length;
    return {
      kind: 'image',
      urls,
      referrerPolicy: img.referrerPolicy || '',
      forcedRank: stillPlaceholder ? RANK.WEAK : undefined,
    };
  }

  function fromVideo(video) {
    const src = video.currentSrc || video.src || video.querySelector('source[src]')?.src || '';
    if (!src && !video.srcObject) {
      return video.poster ? { kind: 'image', urls: [video.poster] } : null;
    }
    return {
      kind: 'video',
      urls: unique([src]),
      poster: video.poster || '',
      currentTime: video.currentTime || 0,
      muted: video.muted,
      volume: video.volume,
      loop: video.loop,
      referrerPolicy: video.getAttribute('referrerpolicy') || '',
      crossOrigin: video.crossOrigin,
    };
  }

  function fromCanvas(canvas) {
    if (!canvas.width || !canvas.height) return null;
    let dataUrl = null;
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch {
      // 跨來源污染：無法匯出，但同 frame 內仍可用 drawImage 顯示
    }
    return { kind: 'image', urls: dataUrl ? [dataUrl] : [], snapshotOnly: !dataUrl };
  }

  const SVG_PAINT_PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'font-family', 'font-size'];

  function fromInlineSvg(svg) {
    const rect = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', rect.width || 300);
    clone.setAttribute('height', rect.height || 150);
    clone.style.color = getComputedStyle(svg).color;

    // 序列化後頁面 CSS 不再生效，要把算出來的繪製屬性寫回去
    const sources = [svg, ...svg.querySelectorAll('*')];
    const targets = [clone, ...clone.querySelectorAll('*')];
    sources.forEach((source, i) => {
      const style = getComputedStyle(source);
      for (const prop of SVG_PAINT_PROPS) targets[i].style?.setProperty(prop, style.getPropertyValue(prop));
    });

    // <use href="#sprite"> 參照的是頁面內其他 SVG，要一起帶上
    const root = svg.getRootNode();
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    for (const use of clone.querySelectorAll('use')) {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      if (!href.startsWith('#')) continue;
      const selector = `#${CSS.escape(href.slice(1))}`;
      if (clone.querySelector(selector)) continue;
      const target = root.querySelector?.(selector);
      if (target) defs.appendChild(target.cloneNode(true));
    }
    if (defs.childNodes.length) clone.prepend(defs);

    const xml = new XMLSerializer().serializeToString(clone);
    return { kind: 'image', urls: [`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`], vector: true };
  }

  function cssUrls(value) {
    if (!value || value === 'none' || !value.includes('url(')) return [];
    const urls = [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)].map((m) => m[2]);
    // image-set 由低至高解析度排列，高解析度優先
    return value.includes('image-set(') ? urls.reverse() : urls;
  }

  function fromCss(el) {
    const urlsIn = (style) => [
      ...cssUrls(style.backgroundImage),
      ...cssUrls(style.content),
      ...cssUrls(style.webkitMaskImage),
      ...cssUrls(style.borderImageSource),
    ];
    const urls = unique([
      ...urlsIn(getComputedStyle(el)),
      ...urlsIn(getComputedStyle(el, '::before')),
      ...urlsIn(getComputedStyle(el, '::after')),
    ]);
    return urls.length ? { kind: 'image', urls, fromCss: true } : null;
  }

  function fromElement(el) {
    switch (el.localName) {
      case 'img': {
        const media = fromImg(el);
        if (media) return media;
        break;
      }
      case 'video': {
        const media = fromVideo(el);
        if (media) return media;
        break;
      }
      case 'canvas': {
        const media = fromCanvas(el);
        if (media) return media;
        break;
      }
      case 'svg':
        if (!el.ownerSVGElement) return fromInlineSvg(el);
        break;
      case 'image': {
        const href = el.href?.baseVal || el.getAttribute('href');
        if (href) return { kind: 'image', urls: unique([new URL(href, el.baseURI).href]) };
        break;
      }
      case 'input':
        if (el.type === 'image' && el.src) return { kind: 'image', urls: [el.src] };
        break;
      case 'object':
      case 'embed': {
        const src = el.data || el.src;
        if (src && MEDIA_LINK.test(src)) {
          return { kind: VIDEO_LINK.test(src) ? 'video' : 'image', urls: [src] };
        }
        break;
      }
      case 'a':
        if (el.href && MEDIA_LINK.test(el.href)) {
          return {
            kind: VIDEO_LINK.test(el.href) ? 'video' : 'image',
            urls: [el.href],
            forcedRank: RANK.WEAK,
          };
        }
        break;
      default:
    }
    return fromCss(el);
  }

  function isEffectivelyInvisible(el) {
    for (let node = el, depth = 0; node && depth < 12; node = node.parentElement, depth++) {
      if (parseFloat(getComputedStyle(node).opacity) < 0.02) return true;
    }
    return getComputedStyle(el).visibility !== 'visible';
  }

  function rankOf(el, media) {
    if (media.forcedRank !== undefined) return media.forcedRank;
    const rect = el.getBoundingClientRect();
    if (rect.width * rect.height < 16 || isEffectivelyInvisible(el)) return RANK.WEAK;
    if (el === document.documentElement || el === document.body) return RANK.PAGE_BG;
    const small = Math.max(rect.width, rect.height) <= ICON_MAX_PX;
    if (small && (media.fromCss || el.localName === 'svg')) return RANK.ICON;
    return RANK.NORMAL;
  }

  function pickFrom(elements, ignore) {
    let best = null;
    for (let el of elements) {
      if (ignore?.includes(el)) continue;
      // 命中的可能是 SVG 內部的 path，往上找到 svg 根節點
      if (el instanceof SVGElement && el.localName !== 'image' && el.ownerSVGElement) {
        let root = el.ownerSVGElement;
        while (root.ownerSVGElement) root = root.ownerSVGElement;
        el = root;
      }
      let media;
      try {
        media = fromElement(el);
      } catch {
        continue;
      }
      if (!media || (!media.urls.length && !media.snapshotOnly && el.localName !== 'video')) continue;
      const rank = rankOf(el, media);
      if (!best || rank < best.rank) best = { media: { ...media, el }, rank };
      if (rank === RANK.NORMAL) break;
    }
    return best;
  }

  /**
   * @returns {{media: object|null, rank: number, iframes: HTMLIFrameElement[]}}
   */
  MC.scan = (x, y, ignore = []) => {
    const stack = stackAt(x, y).filter((el) => !MC.isOwnUi?.(el));
    let best = pickFrom(stack, ignore);
    // 只命中頁面背景或佔位圖時，再用幾何比對找看看被藏起來的真正媒體
    if (!best || best.rank >= RANK.PAGE_BG) {
      const fallback = pickFrom(geometricStack(x, y).filter((el) => !MC.isOwnUi?.(el)), ignore);
      if (fallback && (!best || fallback.rank < best.rank)) best = fallback;
    }
    const iframes = stack.filter((el) => el.localName === 'iframe' && !ignore.includes(el));
    return { media: best?.media ?? null, rank: best?.rank ?? Infinity, iframes };
  };

  MC.RANK = RANK;

  // 把媒體描述轉成可跨 frame 傳遞的形式；做不到就回傳 null，由所在 frame 自行開啟。
  MC.toRelayable = async (media) => {
    if (media.snapshotOnly) return null;
    const { el, ...plain } = media;
    if (media.kind === 'video') {
      // blob 網址只在同來源有效，srcObject 也無法傳遞
      const relayable = media.urls.length && !media.urls[0].startsWith('blob:') && !el?.srcObject;
      return relayable ? plain : null;
    }
    const urls = [];
    for (const url of media.urls) {
      if (!url.startsWith('blob:')) {
        urls.push(url);
        continue;
      }
      try {
        const blob = await (await fetch(url)).blob();
        urls.push(
          await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
        );
      } catch {
        return null;
      }
    }
    return { ...plain, urls };
  };
})();
