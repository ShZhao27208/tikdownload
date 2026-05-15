// TikDownload Background - Service Worker
const LOG = (...args) => console.log('[TikDownload BG]', ...args);

// --- Saved API parameters (captured from webRequest) ---
const savedParams = new Map(); // timestamp -> [[key, value], ...]
const PARAMS_TO_SKIP = new Set(['a_bogus', 'fp', 'verifyFp', 'msToken']);

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

        savedParams.set(Date.now(), entries);
        LOG('Captured API params, total saved:', savedParams.size);

        // Keep only last 20 entries
        if (savedParams.size > 20) {
          const oldest = savedParams.keys().next().value;
          savedParams.delete(oldest);
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

// --- Fetch aweme detail ---
async function fetchAwemeDetail(vid) {
  const params = getLatestParams();
  if (!params) {
    LOG('No saved params available');
    return null;
  }

  const url = buildDouyinDetailUrl(vid, params);
  LOG('Fetching aweme detail:', url.substring(0, 100));

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

  // Fallback: ask content script to fetch via page context
  LOG('Service worker fetch failed, trying page context...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'FETCH_AWEME_DETAIL_REQ',
        data: { url }
      });
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) {}

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
        // Pick shortest URL (usually no watermark)
        const sorted = [...urlList].sort((a, b) => a.length - b.length);
        info.videos.push(sorted[0]);
      }
    }
  }

  // Fallback: play_addr directly
  if (info.videos.length === 0 && detail.video?.play_addr?.url_list?.length > 0) {
    info.videos.push(detail.video.play_addr.url_list[0]);
  }

  // Images (photo slideshow / 图集)
  if (detail.images && detail.images.length > 0) {
    for (const img of detail.images) {
      // Animated image (动图) has video
      if (img.video?.play_addr?.url_list?.length > 0) {
        const urls = img.video.play_addr.url_list;
        info.videos.push(urls[urls.length - 1] || urls[0]);
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
  return name.replace(/[<>:"/\\|?*\n\r\t]/g, '_').replace(/_+/g, '_').trim().substring(0, 150);
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

// --- Download ---
async function downloadPost(vid) {
  LOG('Download requested for vid:', vid);

  const detail = await fetchAwemeDetail(vid);
  if (!detail) {
    return { ok: false, error: 'Failed to fetch video detail. Browse more to capture API params.' };
  }

  const info = extractVideoInfo(detail);
  if (!info || (info.videos.length === 0 && info.images.length === 0)) {
    return { ok: false, error: 'No downloadable media found' };
  }

  LOG('Found:', info.videos.length, 'videos,', info.images.length, 'images');
  LOG('Creator:', info.creator, 'Desc:', info.description?.substring(0, 30));

  const allUrls = [...info.videos, ...info.images];
  let count = 0;

  for (let i = 0; i < allUrls.length; i++) {
    const url = allUrls[i];
    const filename = await buildFilename(info, url, i + 1);
    LOG('Downloading:', filename);

    try {
      await new Promise((resolve, reject) => {
        chrome.downloads.download(
          { url, filename, conflictAction: 'uniquify' },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              LOG('Download error:', chrome.runtime.lastError.message);
              reject(chrome.runtime.lastError.message);
            } else {
              LOG('Download started, id:', downloadId);
              count++;
              resolve(downloadId);
            }
          }
        );
      });
    } catch (e) {
      LOG('Download failed for item', i, ':', e);
    }

    if (i < allUrls.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  return { ok: count > 0, count };
}

// --- Message handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'DOWNLOAD_VIDEO_REQ') {
    const { vid } = msg.data;
    downloadPost(vid).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

// --- Init ---
setupWebRequestListener();
LOG('TikDownload background initialized');
