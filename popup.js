// TikDownload Popup (Quick Actions Panel)
'use strict';

function flashStatus(text) {
  const el = document.getElementById('status');
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; }, 2000);
}

// Load session stats from background
async function loadStats() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_SESSION_STATS' });
    if (resp?.ok) {
      document.getElementById('downloaded').textContent = resp.stats.downloaded;
      document.getElementById('failed').textContent = resp.stats.failed;
    }
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}

// Load current quality setting
chrome.storage.local.get(['quality'], (data) => {
  document.getElementById('quality').value = data.quality || 'highest';
});

// Quality quick-switch
document.getElementById('quality').addEventListener('change', (e) => {
  chrome.storage.local.set({ quality: e.target.value }, () => flashStatus('画质已切换'));
});

// Batch download button
document.getElementById('batch-download').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_BATCH_DOWNLOAD' }, (resp) => {
    if (chrome.runtime.lastError) {
      flashStatus('请在抖音/TikTok 页面使用');
    } else {
      flashStatus(resp?.message || '已触发批量下载');
    }
  });
});

// Open history (switch to history tab in options page)
document.getElementById('open-history').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  // Note: can't directly switch to history tab from here; user clicks in options
});

// Open full settings
document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Init
loadStats();
setInterval(loadStats, 2000); // refresh stats every 2s