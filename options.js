// TikDownload Options Page
'use strict';

const DOWNLOAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

const DEFAULTS = {
  folder: 'TikDownload',
  quality: 'highest',
  filenameBlocks: ['caption', 'sep_', 'date', 'sep_', 'author'],
  buttonConfig: {
    corner: 'top-right', offsetX: 12, offsetY: 12,
    size: 36, opacity: 0.6, trigger: 'hover', shape: 'circle'
  },
  queueSettings: {
    concurrency: 3, retryTimes: 3, retryDelay: 1000,
    notifyOnComplete: true, autoDedupe: true
  }
};

// In-memory draft state (committed to storage only on save)
let buttonDraft = { ...DEFAULTS.buttonConfig };

function flashStatus(id, text = '已保存') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; }, 2000);
}

// ===== Tab navigation =====
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.panel').forEach(p => {
        p.classList.toggle('active', p.dataset.panel === target);
      });
      if (target === 'history') renderHistory();
    });
  });
}

// ===== Button position config =====
function applyPreview() {
  const btn = document.getElementById('preview-btn');
  const { corner, offsetX, offsetY, size, opacity, shape } = buttonDraft;

  btn.style.top = btn.style.bottom = btn.style.left = btn.style.right = '';
  btn.style.transform = '';

  const pos = {
    'top-left': { top: `${offsetY}px`, left: `${offsetX}px` },
    'top-right': { top: `${offsetY}px`, right: `${offsetX}px` },
    'bottom-left': { bottom: `${offsetY}px`, left: `${offsetX}px` },
    'bottom-right': { bottom: `${offsetY}px`, right: `${offsetX}px` },
    'center': { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  };
  Object.assign(btn.style, pos[corner] || pos['top-right']);
  btn.style.width = btn.style.height = `${size}px`;
  btn.style.opacity = opacity;
  btn.style.borderRadius = shape === 'circle' ? '50%' : '8px';
  btn.innerHTML = DOWNLOAD_SVG;
}

function syncButtonControls() {
  // corner grid
  document.querySelectorAll('#corner-grid .corner-cell').forEach(cell => {
    cell.classList.toggle('active', cell.dataset.corner === buttonDraft.corner);
  });
  // sliders
  document.getElementById('offsetX').value = buttonDraft.offsetX;
  document.getElementById('offsetX-val').textContent = `${buttonDraft.offsetX}px`;
  document.getElementById('offsetY').value = buttonDraft.offsetY;
  document.getElementById('offsetY-val').textContent = `${buttonDraft.offsetY}px`;
  document.getElementById('size').value = buttonDraft.size;
  document.getElementById('size-val').textContent = `${buttonDraft.size}px`;
  document.getElementById('opacity').value = buttonDraft.opacity;
  document.getElementById('opacity-val').textContent = buttonDraft.opacity;
  // radio groups
  document.querySelectorAll('#shape-group .radio-opt').forEach(o => {
    o.classList.toggle('active', o.dataset.shape === buttonDraft.shape);
  });
  document.querySelectorAll('#trigger-group .radio-opt').forEach(o => {
    o.classList.toggle('active', o.dataset.trigger === buttonDraft.trigger);
  });
  applyPreview();
}

function initButtonConfig() {
  document.querySelectorAll('#corner-grid .corner-cell.selectable').forEach(cell => {
    cell.addEventListener('click', () => {
      buttonDraft.corner = cell.dataset.corner;
      syncButtonControls();
    });
  });

  const bind = (id, key, fmt) => {
    const input = document.getElementById(id);
    const val = document.getElementById(`${id}-val`);
    input.addEventListener('input', () => {
      const num = parseFloat(input.value);
      buttonDraft[key] = num;
      if (val) val.textContent = fmt ? fmt(num) : num;
      applyPreview();
    });
  };
  bind('offsetX', 'offsetX', v => `${v}px`);
  bind('offsetY', 'offsetY', v => `${v}px`);
  bind('size', 'size', v => `${v}px`);
  bind('opacity', 'opacity', v => v.toFixed(2));

  document.querySelectorAll('#shape-group .radio-opt').forEach(o => {
    o.addEventListener('click', () => { buttonDraft.shape = o.dataset.shape; syncButtonControls(); });
  });
  document.querySelectorAll('#trigger-group .radio-opt').forEach(o => {
    o.addEventListener('click', () => { buttonDraft.trigger = o.dataset.trigger; syncButtonControls(); });
  });

  document.getElementById('save-button').addEventListener('click', () => {
    chrome.storage.local.set({ buttonConfig: { ...buttonDraft } }, () => flashStatus('status-button'));
  });
}

// ===== Filename rules (drag-and-drop blocks) =====
const BLOCK_LABELS = {
  caption: '标题', date: '日期', author: '作者',
  vid: '视频ID', index: '序号', resolution: '分辨率', 'sep_': '_', 'sep-': '-'
};
const BLOCK_CLASSES = {
  caption: 'block-caption', date: 'block-date', author: 'block-author',
  vid: 'block-vid', index: 'block-index', resolution: 'block-resolution',
  'sep_': 'block-separator', 'sep-': 'block-separator'
};
const PREVIEW_VALUES = {
  caption: 'This is a post title', date: '2025-05-15', author: 'username',
  vid: '7639241511754832808', index: '1', resolution: '1080p', 'sep_': '_', 'sep-': '-'
};

let activeBlocks = [];

function renderActiveBlocks() {
  const area = document.getElementById('active-blocks');
  area.innerHTML = '';
  if (activeBlocks.length === 0) {
    area.innerHTML = '<span style="color:#666;font-size:12px;">点击下方积木添加字段</span>';
  }
  activeBlocks.forEach((type, i) => {
    const el = document.createElement('span');
    el.className = `block ${BLOCK_CLASSES[type]}`;
    el.draggable = true;
    el.dataset.index = i;
    el.innerHTML = `${BLOCK_LABELS[type]} <span class="remove">&times;</span>`;

    el.querySelector('.remove').addEventListener('click', (e) => {
      e.stopPropagation();
      activeBlocks.splice(i, 1);
      renderActiveBlocks();
      updateFnPreview();
    });

    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', i);
      el.style.opacity = '0.4';
    });
    el.addEventListener('dragend', () => el.style.opacity = '1');
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('text/plain'));
      const to = i;
      if (from !== to) {
        const item = activeBlocks.splice(from, 1)[0];
        activeBlocks.splice(to, 0, item);
        renderActiveBlocks();
        updateFnPreview();
      }
    });

    area.appendChild(el);
  });
}

function updateFnPreview() {
  const preview = document.getElementById('fn-preview');
  if (activeBlocks.length === 0) {
    preview.innerHTML = '<span>unknown_video.mp4</span>';
    return;
  }
  const result = activeBlocks.map(type => PREVIEW_VALUES[type] || '').join('');
  preview.innerHTML = `<span>${result}.mp4</span>`;
}

function initFilename() {
  document.querySelectorAll('#available-blocks .block').forEach(el => {
    el.addEventListener('click', () => {
      activeBlocks.push(el.dataset.type);
      renderActiveBlocks();
      updateFnPreview();
    });
  });

  document.getElementById('save-filename').addEventListener('click', () => {
    const folder = document.getElementById('folder').value.trim() || 'TikDownload';
    chrome.storage.local.set({ folder, filenameBlocks: activeBlocks }, () => flashStatus('status-filename'));
  });
}

// ===== Download settings =====
let queueDraft = { ...DEFAULTS.queueSettings };

function syncDownloadControls() {
  document.getElementById('concurrency').value = queueDraft.concurrency;
  document.getElementById('concurrency-val').textContent = queueDraft.concurrency;
  document.getElementById('retryTimes').value = queueDraft.retryTimes;
  document.getElementById('retryDelay').value = queueDraft.retryDelay;
  document.getElementById('notifyOnComplete').classList.toggle('on', queueDraft.notifyOnComplete);
  document.getElementById('autoDedupe').classList.toggle('on', queueDraft.autoDedupe);
}

function initDownload() {
  const concurrency = document.getElementById('concurrency');
  concurrency.addEventListener('input', () => {
    queueDraft.concurrency = parseInt(concurrency.value);
    document.getElementById('concurrency-val').textContent = queueDraft.concurrency;
  });

  document.getElementById('retryTimes').addEventListener('input', (e) => {
    queueDraft.retryTimes = Math.max(0, parseInt(e.target.value) || 0);
  });
  document.getElementById('retryDelay').addEventListener('input', (e) => {
    queueDraft.retryDelay = Math.max(0, parseInt(e.target.value) || 0);
  });

  document.getElementById('notifyOnComplete').addEventListener('click', (e) => {
    queueDraft.notifyOnComplete = !queueDraft.notifyOnComplete;
    e.currentTarget.classList.toggle('on', queueDraft.notifyOnComplete);
  });
  document.getElementById('autoDedupe').addEventListener('click', (e) => {
    queueDraft.autoDedupe = !queueDraft.autoDedupe;
    e.currentTarget.classList.toggle('on', queueDraft.autoDedupe);
  });

  document.getElementById('save-download').addEventListener('click', () => {
    const quality = document.getElementById('quality').value;
    chrome.storage.local.set(
      { quality, queueSettings: { ...queueDraft } },
      () => flashStatus('status-download')
    );
  });
}

// ===== History =====
let historyFilter = 'all';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderHistory() {
  const container = document.getElementById('history-content');
  chrome.storage.local.get(['downloadHistory'], (data) => {
    let list = data.downloadHistory || [];
    if (historyFilter !== 'all') {
      list = list.filter(item => item.status === historyFilter);
    }
    // newest first
    list = [...list].reverse();

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无下载记录</div>';
      return;
    }

    const rows = list.map(item => `
      <tr>
        <td><span class="h-status ${item.status}">${item.status === 'success' ? '成功' : '失败'}</span></td>
        <td class="h-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title || '(无标题)')}</td>
        <td>${escapeHtml(item.creator)}</td>
        <td>${formatTime(item.timestamp)}</td>
        <td><span class="h-action" data-vid="${escapeHtml(item.vid)}">重新下载</span></td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table class="history-table">
        <thead>
          <tr><th>状态</th><th>标题</th><th>作者</th><th>时间</th><th>操作</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    container.querySelectorAll('.h-action').forEach(el => {
      el.addEventListener('click', () => {
        const vid = el.dataset.vid;
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_VIDEO_REQ', data: { vid } }, (resp) => {
          el.textContent = resp?.ok ? '✓ 已开始' : (resp?.error || '失败');
          setTimeout(() => { el.textContent = '重新下载'; }, 2500);
        });
      });
    });
  });
}

function initHistory() {
  document.querySelectorAll('#history-filter .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      historyFilter = chip.dataset.filter;
      document.querySelectorAll('#history-filter .chip').forEach(c => c.classList.toggle('active', c === chip));
      renderHistory();
    });
  });

  document.getElementById('clear-history').addEventListener('click', () => {
    if (confirm('确定清空所有下载历史？此操作不可撤销。')) {
      chrome.storage.local.set({ downloadHistory: [] }, renderHistory);
    }
  });
}

// ===== Advanced: export / import / reset =====
function initAdvanced() {
  document.getElementById('export-settings').addEventListener('click', () => {
    chrome.storage.local.get(
      ['folder', 'quality', 'filenameBlocks', 'buttonConfig', 'queueSettings'],
      (data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tikdownload-settings.json';
        a.click();
        URL.revokeObjectURL(url);
      }
    );
  });

  const fileInput = document.getElementById('import-file');
  document.getElementById('import-settings').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        const allowed = ['folder', 'quality', 'filenameBlocks', 'buttonConfig', 'queueSettings'];
        const clean = {};
        for (const k of allowed) {
          if (imported[k] !== undefined) clean[k] = imported[k];
        }
        chrome.storage.local.set(clean, () => {
          alert('设置已导入');
          loadAllSettings();
        });
      } catch (e) {
        alert('导入失败：文件格式无效');
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  document.getElementById('reset-settings').addEventListener('click', () => {
    if (confirm('确定恢复默认设置？所有自定义配置将被清除（历史记录保留）。')) {
      chrome.storage.local.set({
        folder: DEFAULTS.folder,
        quality: DEFAULTS.quality,
        filenameBlocks: [...DEFAULTS.filenameBlocks],
        buttonConfig: { ...DEFAULTS.buttonConfig },
        queueSettings: { ...DEFAULTS.queueSettings }
      }, () => {
        alert('已恢复默认设置');
        loadAllSettings();
      });
    }
  });
}

// ===== Load settings into all controls =====
function loadAllSettings() {
  chrome.storage.local.get(
    ['folder', 'quality', 'filenameBlocks', 'buttonConfig', 'queueSettings'],
    (data) => {
      buttonDraft = { ...DEFAULTS.buttonConfig, ...(data.buttonConfig || {}) };
      syncButtonControls();

      document.getElementById('folder').value = data.folder || DEFAULTS.folder;
      activeBlocks = data.filenameBlocks || [...DEFAULTS.filenameBlocks];
      renderActiveBlocks();
      updateFnPreview();

      document.getElementById('quality').value = data.quality || DEFAULTS.quality;
      queueDraft = { ...DEFAULTS.queueSettings, ...(data.queueSettings || {}) };
      syncDownloadControls();
    }
  );
}

// ===== Bootstrap =====
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initButtonConfig();
  initFilename();
  initDownload();
  initHistory();
  initAdvanced();
  loadAllSettings();
});
