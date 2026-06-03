// TikDownload Content Script
(() => {
  'use strict';
  const LOG = (...args) => console.log('[TikDownload]', ...args);
  const chrome = globalThis.chrome;
  const isDouyin = location.hostname.includes('douyin.com');
  const isTikTok = location.hostname.includes('tiktok.com');

  // --- Button config (produced by options page, stored in chrome.storage.local) ---
  const DEFAULT_BTN_CONFIG = {
    corner: 'top-right', offsetX: 12, offsetY: 12,
    size: 36, opacity: 0.6, trigger: 'hover', shape: 'circle'
  };
  let btnConfig = { ...DEFAULT_BTN_CONFIG };

  // --- Inject fetcher.js into page context ---
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('fetcher.js');
  document.body.appendChild(s);
  s.onload = () => s.remove();

  // --- Forward FETCH_AWEME_DETAIL_REQ from background to page ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FETCH_AWEME_DETAIL_REQ') {
      window.postMessage({ type: 'FETCH_AWEME_DETAIL_REQ', data: msg.data }, '*');
      sendResponse({ ok: true });
      return false;
    }
  });

  // --- Load button config, then run callback ---
  function loadButtonConfig(cb) {
    try {
      chrome.storage.local.get(['buttonConfig'], (data) => {
        btnConfig = { ...DEFAULT_BTN_CONFIG, ...(data && data.buttonConfig) };
        if (cb) cb();
      });
    } catch (e) {
      if (cb) cb();
    }
  }

  // --- Apply current config to a button as inline styles (overrides CSS) ---
  function applyButtonConfig(btn) {
    // Skip the fixed detail-page button; its CSS uses !important and owns its layout.
    if (btn.classList.contains('tikdownload-btn-fixed')) return;

    const { corner, offsetX, offsetY, size, opacity, shape, trigger } = btnConfig;

    btn.style.top = btn.style.bottom = btn.style.left = btn.style.right = 'auto';
    btn.style.transform = '';
    const place = {
      'top-left': () => { btn.style.top = offsetY + 'px'; btn.style.left = offsetX + 'px'; },
      'top-right': () => { btn.style.top = offsetY + 'px'; btn.style.right = offsetX + 'px'; },
      'bottom-left': () => { btn.style.bottom = offsetY + 'px'; btn.style.left = offsetX + 'px'; },
      'bottom-right': () => { btn.style.bottom = offsetY + 'px'; btn.style.right = offsetX + 'px'; },
      'center': () => { btn.style.top = '50%'; btn.style.left = '50%'; btn.style.transform = 'translate(-50%, -50%)'; }
    };
    (place[corner] || place['top-right'])();

    btn.style.boxSizing = 'border-box';
    btn.style.width = btn.style.height = size + 'px';
    btn.style.opacity = opacity;
    btn.style.borderRadius = shape === 'circle' ? '50%' : '8px';

    // 'always' = persistent; 'hover' = hidden until the container is hovered.
    btn.dataset.trigger = trigger;
    btn.style.display = trigger === 'always' ? 'flex' : 'none';
  }

  // --- Wire hover show/hide that respects the trigger mode ---
  function attachHover(container, btn) {
    container.addEventListener('mouseover', () => { btn.style.display = 'flex'; });
    container.addEventListener('mouseout', () => {
      if (btn.dataset.trigger !== 'always') btn.style.display = 'none';
    });
  }

  // --- Live update: re-apply config to all buttons when settings change ---
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.buttonConfig) {
        btnConfig = { ...DEFAULT_BTN_CONFIG, ...changes.buttonConfig.newValue };
        document.querySelectorAll('.tikdownload-btn').forEach(applyButtonConfig);
      }
    });
  } catch (e) {}

  // --- Get video/note ID from element ---
  function getVidFromElement(el) {
    // Walk up to find data-e2e-vid
    let parent = el;
    while (parent) {
      if (parent.dataset?.e2eVid) return parent.dataset.e2eVid;
      parent = parent.parentElement;
    }

    // Search nearby links for /video/ or /note/ patterns
    const searchRoot = el.closest('[data-e2e-vid]')
      || el.closest('li')
      || el.closest('[class*="card"]')
      || el.closest('[class*="item"]')
      || el.closest('[class*="video"]')
      || el.closest('[class*="note"]')
      || el.parentElement?.parentElement?.parentElement;

    if (searchRoot) {
      const links = searchRoot.querySelectorAll('a[href]');
      for (const link of links) {
        const m = link.href.match(/\/(video|note)\/(\d+)/);
        if (m) return m[2];
      }
      // Check href on the element itself
      const rootHref = searchRoot.getAttribute?.('href') || '';
      const rm = rootHref.match(/\/(video|note)\/(\d+)/);
      if (rm) return rm[2];
    }

    // From URL (single video/note page)
    const urlMatch = location.pathname.match(/\/(video|note)\/(\d+)/);
    if (urlMatch) return urlMatch[2];

    return null;
  }

  // --- Send download request to background ---
  async function requestDownload(vid) {
    if (!vid) {
      LOG('No video ID found');
      return false;
    }
    LOG('Requesting download for vid:', vid);
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_VIDEO_REQ',
        data: { vid }
      });
      LOG('Download response:', resp);
      return resp?.ok;
    } catch (e) {
      LOG('Error:', e.message);
      return false;
    }
  }

  // --- SVG download icon (inline, no external file dependency) ---
  const DOWNLOAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  // --- Create download button ---
  function createButton() {
    const btn = document.createElement('div');
    btn.classList.add('tikdownload-btn');
    btn.innerHTML = DOWNLOAD_SVG;
    btn.title = 'Download';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      btn.style.opacity = '0.4';
      btn.style.pointerEvents = 'none';

      const vid = getVidFromElement(btn);
      const ok = await requestDownload(vid);

      btn.style.pointerEvents = 'auto';
      btn.style.opacity = btnConfig.opacity;
      if (ok) {
        btn.style.background = 'rgba(76, 175, 80, 0.7)';
        setTimeout(() => btn.style.background = '', 3000);
      }
    }, { capture: true });
    applyButtonConfig(btn);
    return btn;
  }

  // --- Inject buttons ---
  function injectButtons() {
    if (isDouyin) injectDouyinButtons();
    if (isTikTok) injectTikTokButtons();
  }

  function injectDouyinButtons() {
    // Strategy 1: All containers with data-e2e-vid
    document.querySelectorAll('[data-e2e-vid]').forEach(el => {
      if (el.querySelector('.tikdownload-btn')) return;
      if (el.closest('[data-e2e="feed-live"]')) return;
      if (el.closest('.liveSearchPlayer')) return;
      el.style.position = 'relative';
      const btn = createButton();
      el.appendChild(btn);
      attachHover(el, btn);
    });

    // Strategy 2: Video elements not covered by strategy 1
    document.querySelectorAll('#root video').forEach(video => {
      const container = video.parentElement;
      if (!container || container.querySelector('.tikdownload-btn')) return;
      if (container.closest('[data-e2e="feed-live"]')) return;
      if (container.closest('[data-e2e-vid]')) return;
      container.style.position = 'relative';
      const btn = createButton();
      container.appendChild(btn);
      attachHover(container, btn);
    });

    // Strategy 3: Links to /note/ (image posts in feed/search)
    document.querySelectorAll('a[href*="/note/"]').forEach(link => {
      if (link.querySelector('.tikdownload-btn')) return;
      const container = link.closest('li') || link.closest('[class*="card"]') || link.closest('[class*="item"]') || link;
      if (container.querySelector('.tikdownload-btn')) return;
      container.style.position = 'relative';
      const btn = createButton();
      container.appendChild(btn);
      attachHover(container, btn);
    });

    // Strategy 4: Fixed button on single post/note detail pages
    const pathMatch = location.pathname.match(/\/(video|note)\/(\d+)/);
    if (pathMatch && !document.querySelector('.tikdownload-btn-fixed')) {
      const btn = createButton();
      btn.classList.add('tikdownload-btn-fixed');
      document.body.appendChild(btn);
      LOG('Fixed download button added for', pathMatch[1], pathMatch[2]);
    }
  }

  function injectTikTokButtons() {
    // TikTok video containers
    document.querySelectorAll('video').forEach(video => {
      const container = video.parentElement;
      if (!container || container.querySelector('.tikdownload-btn')) return;
      container.style.position = 'relative';
      const btn = createButton();
      container.appendChild(btn);
      attachHover(container, btn);
    });

    // TikTok photo posts (similar pattern)
    document.querySelectorAll('[data-e2e="photo-detail"], [data-e2e="browse-photo"]').forEach(el => {
      if (el.querySelector('.tikdownload-btn')) return;
      el.style.position = 'relative';
      const btn = createButton();
      el.appendChild(btn);
      attachHover(el, btn);
    });

    // Fixed button on single video/photo page
    const pathMatch = location.pathname.match(/\/@[\w.]+\/(video|photo)\/(\d+)/);
    if (pathMatch && !document.querySelector('.tikdownload-btn-fixed')) {
      const btn = createButton();
      btn.classList.add('tikdownload-btn-fixed');
      document.body.appendChild(btn);
    }
  }

  // --- Init ---
  function init() {
    LOG('Content script loaded:', location.href);
    loadButtonConfig(() => {
      injectButtons();
      setInterval(injectButtons, 800);
    });
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
