// TikDownload Background - Service Worker
const LOG = (...args) => console.log('[TikDownload BG]', ...args);

// --- Session stats ---
const sessionStats = { downloaded: 0, failed: 0 };

// --- Saved API parameters (captured from webRequest) ---
const savedParams = new Map(); // timestamp -> [[key, value], ...]
const PARAMS_TO_SKIP = new Set(['a_bogus', 'X-Bogus', 'fp', 'verifyFp', 'msToken', '_signature']);
let lastCaptureLogAt = 0;

// --- Cached aweme details (intercepted from page API responses) ---
const awemeDetailCache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

// --- Capture Douyin API request parameters ---
function setupWebRequestListener() {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.initiator && details.initiator.includes('extension://')) return;
      const url = details.url;
      if (!url) return;

      try {
        const params = new URL(url).searchParams;
        const entries = Array.from(params.entries());
        if (entries.length < 20) return; // Real API calls have many params

        const capturedAt = Date.now();
        savedParams.set(capturedAt, entries);

        // Keep only last 20 entries
        if (savedParams.size > 20) {
          const oldest = savedParams.keys().next().value;
          savedParams.delete(oldest);
        }
        if (capturedAt - lastCaptureLogAt >= 3000) {
          LOG('Captured fresh API params, cache size:', savedParams.size);
          lastCaptureLogAt = capturedAt;
        }
      } catch (e) {}
    },
    { urls: ['https://*.douyin.com/aweme/v1/web/*', 'https://*.tiktok.com/api/*'] }
  );
}

// --- Get latest saved params ---
function getLatestParams() {
  if (savedParams.size === 0) return null;
  const keys = Array.from(savedParams.keys());
  const latest = keys[keys.length - 1];
  return savedParams.get(latest);
}

// --- Build Douyin detail API URL ---
function buildDouyinDetailUrl(vid, params) {
  const url = new URL('https://www.douyin.com/aweme/v1/web/aweme/detail/');
  for (const [key, value] of params) {
    if (PARAMS_TO_SKIP.has(key)) continue;
    if (key === 'aweme_id') {
      url.searchParams.append('aweme_id', vid);
    } else {
      url.searchParams.append(key, value);
    }
  }
  if (!url.searchParams.has('aweme_id')) {
    url.searchParams.append('aweme_id', vid);
  }
  return url.toString();
}

// --- Fetch via page context (same-origin with cookies) ---
async function fetchViaTab(url) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (fetchUrl) => {
        try {
          const r = await fetch(fetchUrl, { credentials: 'include' });
          if (!r.ok) return { _err: r.status };
          return await r.json();
        } catch (e) {
          return { _err: String(e) };
        }
      },
      args: [url]
    });
    return results?.[0]?.result || null;
  } catch (e) {
    LOG('Page-context fetch error:', e.message);
    return null;
  }
}

// --- Fetch aweme detail ---
async function fetchAwemeDetail(vid) {
  // 1. Check intercepted cache
  const cached = awemeDetailCache.get(vid);
  if (cached && (Date.now() - cached.cachedAt < CACHE_TTL)) {
    LOG('Using cached aweme detail for', vid);
    return cached.detail;
  }

  const params = getLatestParams();
  if (!params) {
    LOG('No saved params available');
    return null;
  }

  const url = buildDouyinDetailUrl(vid, params);
  LOG('Fetching aweme detail:', url.substring(0, 100));

  // 2. Page-context fetch (same-origin, has cookies)
  const pageResult = await fetchViaTab(url);
  if (pageResult && !pageResult._err) {
    if (pageResult.aweme_detail) {
      LOG('Page-context fetch succeeded');
      awemeDetailCache.set(vid, { detail: pageResult.aweme_detail, cachedAt: Date.now() });
      return pageResult.aweme_detail;
    }
  }
  if (pageResult?._err) LOG('Page-context fetch failed:', pageResult._err);

  // 3. Fallback: service worker fetch
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        LOG('Fetch attempt', attempt + 1, 'failed:', resp.status);
        continue;
      }
      const text = await resp.text();
      if (!text || text.length === 0) continue;
      const data = JSON.parse(text);
      if (data.aweme_detail) return data.aweme_detail;
    } catch (e) {
      LOG('Fetch error:', e.message);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return null;
}

// --- Extract video info from aweme_detail ---
function extractVideoInfo(detail) {
  if (!detail) return null;

  const info = {
    vid: detail.aweme_id || '',
    creator: detail.author?.nickname || '',
    description: detail.desc || '',
    timestamp: detail.create_time || 0,
    videos: [],
    videoGroups: [],
    images: []
  };

  // Video with bit_rate (best quality)
  if (detail.video?.bit_rate?.length > 0) {
    const mp4Rates = detail.video.bit_rate
      .filter(r => r.format === 'mp4' || !r.format)
      .sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));

    if (mp4Rates.length > 0) {
      const best = mp4Rates[0];
      const urlList = best.play_addr?.url_list || [];
      if (urlList.length > 0) {
        info.videoGroups.push([...new Set(urlList)]);
        info.videos.push(urlList[0]);
      }
    }
  }

  // Fallback: play_addr directly
  if (info.videos.length === 0 && detail.video?.play_addr?.url_list?.length > 0) {
    const urlList = [...new Set(detail.video.play_addr.url_list)];
    info.videoGroups.push(urlList);
    info.videos.push(urlList[0]);
  }

  // Images (photo slideshow / 图集)
  if (detail.images && detail.images.length > 0) {
    for (const img of detail.images) {
      // Animated image (动图) has video
      if (img.video?.play_addr?.url_list?.length > 0) {
        const urls = [...new Set(img.video.play_addr.url_list)];
        info.videoGroups.push(urls);
        info.videos.push(urls[0]);
      } else if (img.url_list?.length > 0) {
        // Static image - prefer jpeg
        const url = pickBestImageUrl(img.url_list);
        if (url) info.images.push(url);
      }
    }
    // If we got images, clear the video (it's just a slideshow preview)
    if (info.images.length > 0 || info.videos.length > 1) {
      // Keep only image/动图 URLs, remove the slideshow preview video
      if (detail.images.length > 0 && info.videos.length === 1 && !detail.video?.bit_rate?.length) {
        info.videos = [];
      }
    }
  }

  // image_post_info (alternative structure)
  if (info.images.length === 0 && detail.image_post_info?.images?.length > 0) {
    for (const img of detail.image_post_info.images) {
      const urlList = img.display_image?.url_list || img.url_list || [];
      const url = pickBestImageUrl(urlList);
      if (url) info.images.push(url);
    }
  }

  return info;
}

function pickBestImageUrl(urlList) {
  if (!urlList || urlList.length === 0) return '';
  for (const url of urlList) {
    if (url.includes('.jpeg') || url.includes('.jpg') || url.includes('.png')) return url;
  }
  for (const url of urlList) {
    if (!url.includes('webp')) return url;
  }
  return urlList[urlList.length - 1] || urlList[0];
}

// --- Build filename ---
function sanitize(name) {
  // Whitelist: ASCII word chars, CJK, kana, hangul, safe punctuation
  return name
    .replace(/[^\w\s一-鿿㐀-䶿぀-ヿ가-힯.\-]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/^[.\s_]+|[.\s_]+$/g, '')
    .substring(0, 150) || 'untitled';
}

async function buildFilename(info, url, index) {
  const ext = (url.includes('.mp4') || url.includes('video')) ? 'mp4'
    : url.includes('.png') ? 'png' : 'jpg';

  const settings = await chrome.storage.local.get(['folder', 'filenameBlocks']);
  const folder = settings.folder || 'TikDownload';
  const blocks = settings.filenameBlocks || ['caption', 'sep_', 'date', 'sep_', 'author'];

  const date = info.timestamp ? new Date(info.timestamp * 1000).toISOString().slice(0, 10) : '';
  const author = info.creator || 'unknown';
  const caption = info.description ? info.description.substring(0, 50).trim() : '';

  const values = {
    caption: caption || '',
    date: date,
    author: author,
    vid: info.vid || '',
    index: String(index),
    'sep_': '_',
    'sep-': '-'
  };

  let parts = blocks.map(b => values[b] ?? '').filter(v => v !== '');
  let filename = parts.join('');

  // Fallback if empty
  if (!filename || filename.replace(/[_-]/g, '').length === 0) {
    filename = info.vid || author + '_' + Date.now();
  }

  filename = sanitize(filename) + '.' + ext;
  return `${folder}/${sanitize(author)}/${filename}`;
}

// --- Download history persistence ---
async function recordDownload(vid, info, status, error) {
  const { downloadHistory = [] } = await chrome.storage.local.get(['downloadHistory']);
  const existing = downloadHistory.findIndex(h => h.vid === vid);
  const record = {
    vid,
    title: info?.description?.substring(0, 80) || '',
    creator: info?.creator || 'unknown',
    status,
    error: error || null,
    timestamp: Date.now()
  };
  if (existing >= 0) {
    downloadHistory[existing] = record;
  } else {
    downloadHistory.push(record);
  }
  if (downloadHistory.length > 500) downloadHistory.splice(0, downloadHistory.length - 500);
  await chrome.storage.local.set({ downloadHistory });
}

// --- Download ---
function downloadAndWait(url, filename, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    let downloadId = null;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
    };
    const fail = (reason) => {
      cleanup();
      reject(new Error(reason));
    };
    const onChanged = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete') {
        cleanup();
        LOG('Download completed, id:', downloadId);
        resolve(downloadId);
      } else if (delta.state.current === 'interrupted') {
        const reason = delta.error?.current || 'UNKNOWN_INTERRUPT';
        LOG('Download interrupted, id:', downloadId, 'reason:', reason);
        fail(`Chrome download interrupted: ${reason}`);
      }
    };

    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify' },
      (id) => {
        if (chrome.runtime.lastError || !Number.isInteger(id)) {
          fail(chrome.runtime.lastError?.message || 'Chrome did not return a download id');
          return;
        }
        downloadId = id;
        LOG('Download started, id:', downloadId, '(waiting for final state)');
        timer = setTimeout(() => {
          chrome.downloads.search({ id: downloadId }, (items) => {
            const item = items?.[0];
            if (item?.state === 'complete') {
              cleanup();
              resolve(downloadId);
            } else {
              fail(`Download status timeout${item?.error ? `: ${item.error}` : ''}`);
            }
          });
        }, timeoutMs);
      }
    );
  });
}

async function selectReachableMediaUrl(candidates, expectedKind) {
  const unique = [...new Set(candidates)].filter(url => /^https?:\/\//i.test(url));
  for (const candidate of unique) {
    try {
      const response = await fetch(candidate, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        redirect: 'follow',
        cache: 'no-store'
      });
      const contentType = response.headers.get('content-type') || '';
      const validType = expectedKind === 'video'
        ? /video|octet-stream/i.test(contentType)
        : /image|octet-stream/i.test(contentType);
      const reachable = (response.status === 200 || response.status === 206) && validType;
      const finalUrl = response.url || candidate;
      try { await response.body?.cancel(); } catch (_) {}
      if (reachable) {
        LOG('Selected reachable media mirror:', new URL(finalUrl).hostname, response.status, contentType);
        return finalUrl;
      }
      LOG('Media mirror rejected:', new URL(candidate).hostname, response.status, contentType || 'no content-type');
    } catch (error) {
      LOG('Media mirror probe failed:', new URL(candidate).hostname, error?.message || error);
    }
  }
  return unique[0] || '';
}

async function downloadPost(vid) {
  LOG('Download requested for vid:', vid);

  const detail = await fetchAwemeDetail(vid);
  if (!detail) {
    await recordDownload(vid, null, 'failed', 'Failed to fetch video detail');
    sessionStats.failed++;
    return { ok: false, error: 'Failed to fetch video detail. Browse more to capture API params.' };
  }

  const info = extractVideoInfo(detail);
  if (!info || (info.videos.length === 0 && info.images.length === 0)) {
    await recordDownload(vid, info, 'failed', 'No downloadable media found');
    sessionStats.failed++;
    return { ok: false, error: 'No downloadable media found' };
  }

  LOG('Found:', info.videos.length, 'videos,', info.images.length, 'images');
  LOG('Creator:', info.creator, 'Desc:', info.description?.substring(0, 30));

  const videoGroups = info.videoGroups.length > 0
    ? info.videoGroups
    : info.videos.map(url => [url]);
  const mediaItems = [
    ...videoGroups.map(candidates => ({ kind: 'video', candidates })),
    ...info.images.map(url => ({ kind: 'image', candidates: [url] }))
  ];
  let count = 0;
  const errors = [];

  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    const url = await selectReachableMediaUrl(item.candidates, item.kind);
    if (!url) {
      errors.push(`No valid URL for item ${i + 1}`);
      continue;
    }
    const filename = await buildFilename(info, url, i + 1);
    LOG('Downloading:', filename);

    try {
      await downloadAndWait(url, filename);
      count++;
    } catch (e) {
      const message = e?.message || String(e);
      errors.push(message);
      LOG('Download failed for item', i + 1, ':', message);
    }

    if (i < mediaItems.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  if (count > 0) {
    await recordDownload(vid, info, 'success', null);
    sessionStats.downloaded++;
  } else {
    await recordDownload(vid, info, 'failed', errors.join('; ') || 'All downloads failed');
    sessionStats.failed++;
  }

  return { ok: count > 0, count, errors };
}

// --- Message handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'DOWNLOAD_VIDEO_REQ') {
    const { vid } = msg.data;
    downloadPost(vid).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'GET_SESSION_STATS') {
    sendResponse({ ok: true, stats: sessionStats });
    return false;
  }

  if (msg.type === 'AWEME_DETAIL_CACHE') {
    const { vid, detail } = msg.data || {};
    if (vid && detail) {
      awemeDetailCache.set(vid, { detail, cachedAt: Date.now() });
      if (awemeDetailCache.size > 200) {
        const oldest = awemeDetailCache.keys().next().value;
        awemeDetailCache.delete(oldest);
      }
    }
    return false;
  }

});

// --- Init ---
setupWebRequestListener();
LOG('TikDownload background initialized');
