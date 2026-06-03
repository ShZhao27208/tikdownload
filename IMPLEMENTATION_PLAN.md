# TikDownload 增强实现路线图

## 总体架构变更

### 现有架构
```
manifest.json
├── background.js (Service Worker) - 监听API请求 + 下载引擎
├── content.js - 注入按钮 + 转发消息
├── popup.html/js - 简单设置界面
└── content.css - 按钮样式(硬编码位置)
```

### 目标架构
```
manifest.json
├── background.js - 下载引擎增强(队列/历史/重试/通知)
├── content.js - 动态按钮系统(storage驱动位置)
├── options.html/js - Tab分区设置页(按钮/文件名/下载/历史)
├── popup.html/js - 快捷面板(统计/批量/快捷切换)
└── content.css - 基础样式(无硬编码)
```

---

## Phase 1: 存储层扩展

### 新增 Storage Schema
```javascript
// chrome.storage.local 完整结构
{
  // === 原有字段（保留兼容） ===
  folder: 'TikDownload',
  quality: 'highest',  // BUG: background.js未读取此字段
  filenameBlocks: ['caption', 'sep_', 'date', 'sep_', 'author'],
  
  // === 新增字段 ===
  
  // 按钮外观与位置配置
  buttonConfig: {
    corner: 'top-right',        // top-left|top-right|bottom-left|bottom-right|center
    offsetX: 12,                 // 距离选定角的水平偏移(px)
    offsetY: 12,                 // 距离选定角的垂直偏移(px)
    size: 36,                    // 按钮直径(px), 范围20-60
    opacity: 0.6,                // 默认透明度, 范围0.3-1.0
    trigger: 'hover',            // hover(悬停显示) | always(常驻)
    shape: 'circle'              // circle | square
  },
  
  // 下载队列设置
  queueSettings: {
    concurrency: 3,              // 并发数(1-5)
    retryTimes: 3,               // 下载失败重试次数
    retryDelay: 1000,            // 重试延迟(ms)
    notifyOnComplete: true,      // 完成时桌面通知
    autoDedupe: true             // 自动去重
  },
  
  // 下载历史记录(最多1000条)
  downloadHistory: [
    {
      vid: '7639241511754832808',
      creator: 'username',
      title: 'This is a post title',
      url: 'https://v26-web.douyinvod.com/...',
      filename: 'title_2025-05-15_author.mp4',
      timestamp: 1715788800000,
      status: 'success' | 'failed',
      error: '',                 // 失败原因
      size: 12345678             // 文件大小(bytes)
    }
  ],
  
  // Session 统计(不持久化,仅内存)
  sessionStats: {
    downloaded: 0,
    failed: 0,
    startTime: Date.now()
  }
}
```

### 迁移函数(background.js)
```javascript
// 在 background.js 启动时执行一次性迁移
async function migrateStorage() {
  const data = await chrome.storage.local.get(null);
  
  // 补全缺失的新字段
  const defaults = {
    buttonConfig: {
      corner: 'top-right',
      offsetX: 12,
      offsetY: 12,
      size: 36,
      opacity: 0.6,
      trigger: 'hover',
      shape: 'circle'
    },
    queueSettings: {
      concurrency: 3,
      retryTimes: 3,
      retryDelay: 1000,
      notifyOnComplete: true,
      autoDedupe: true
    },
    downloadHistory: []
  };
  
  const updated = { ...defaults, ...data };
  await chrome.storage.local.set(updated);
}
```

---

## Phase 2: 按钮位置自定义

### 2.1 创建 options.html
基础结构：
- Tab导航(常规/按钮/文件名/下载/历史)
- 每个Tab独立内容区
- 底部保存按钮+状态提示

### 2.2 按钮配置区UI组件

#### 9宫格角度选择器
```html
<div class="corner-grid">
  <button data-corner="top-left">↖</button>
  <button data-corner="top-center">↑</button>
  <button data-corner="top-right" class="active">↗</button>
  <button data-corner="middle-left">←</button>
  <button data-corner="center">●</button>
  <button data-corner="middle-right">→</button>
  <button data-corner="bottom-left">↙</button>
  <button data-corner="bottom-center">↓</button>
  <button data-corner="bottom-right">↘</button>
</div>
```

#### 实时预览组件
```html
<div class="preview-container">
  <div class="preview-thumbnail">
    <span class="preview-label">视频预览</span>
    <div class="preview-button" id="preview-btn">
      <!-- 下载图标SVG -->
    </div>
  </div>
</div>
```

预览按钮会实时响应配置变化(JS监听input事件)。

### 2.3 content.js 改造

#### 关键函数: applyPosition()
```javascript
function applyPosition(btn, config) {
  const { corner, offsetX, offsetY, size, opacity, shape } = config;
  
  // 清除所有定位属性
  btn.style.top = btn.style.bottom = btn.style.left = btn.style.right = '';
  
  // 根据corner设置对应的定位
  const positions = {
    'top-left': { top: `${offsetY}px`, left: `${offsetX}px` },
    'top-right': { top: `${offsetY}px`, right: `${offsetX}px` },
    'bottom-left': { bottom: `${offsetY}px`, left: `${offsetX}px` },
    'bottom-right': { bottom: `${offsetY}px`, right: `${offsetX}px` },
    'center': { 
      top: '50%', 
      left: '50%', 
      transform: 'translate(-50%, -50%)' 
    }
  };
  
  Object.assign(btn.style, positions[corner]);
  btn.style.width = btn.style.height = `${size}px`;
  btn.style.opacity = opacity;
  btn.style.borderRadius = shape === 'circle' ? '50%' : '8px';
}
```

#### 实时更新监听
```javascript
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.buttonConfig) return;
  
  const newConfig = changes.buttonConfig.newValue;
  
  // 更新所有已存在的按钮
  document.querySelectorAll('.tikdownload-btn').forEach(btn => {
    applyPosition(btn, newConfig);
  });
});
```

### 2.4 content.css 精简

删除这些硬编码：
```css
/* 删除 */
.tikdownload-btn {
  position: absolute;
  top: 12px;      /* ← 删除 */
  right: 12px;    /* ← 删除 */
  ...
}

.tikdownload-btn-fixed {
  position: fixed !important;
  top: 80px !important;     /* ← 删除 */
  right: 20px !important;   /* ← 删除 */
  ...
}
```

保留基础样式：
```css
.tikdownload-btn {
  position: absolute;  /* 保留,但top/right由JS控制 */
  width: 36px;         /* 默认值,会被JS覆盖 */
  height: 36px;
  cursor: pointer;
  z-index: 999;
  display: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  padding: 8px;
  transition: transform 0.2s, opacity 0.2s, background 0.2s;
}
```

---

## Phase 3: 下载引擎增强(第一档)

### 3.1 修复画质BUG

**问题根源**:  
`popup.js:104` 保存了 `quality: 'highest'|'resolution'`  
但 `background.js:117` 的 `extractVideoInfo()` 永远只执行：
```javascript
const mp4Rates = detail.video.bit_rate
  .filter(r => r.format === 'mp4' || !r.format)
  .sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));  // 只按码率排序
```

**修复方案**:
```javascript
async function extractVideoInfo(detail) {
  const settings = await chrome.storage.local.get(['quality']);
  const quality = settings.quality || 'highest';
  
  // ...
  
  if (detail.video?.bit_rate?.length > 0) {
    const mp4Rates = detail.video.bit_rate
      .filter(r => r.format === 'mp4' || !r.format);
    
    // 根据策略排序
    if (quality === 'resolution') {
      mp4Rates.sort((a, b) => {
        const aRes = (a.play_addr?.width || 0) * (a.play_addr?.height || 0);
        const bRes = (b.play_addr?.width || 0) * (b.play_addr?.height || 0);
        return bRes - aRes;
      });
    } else if (quality === 'nowatermark') {
      // URL最短的通常无水印
      mp4Rates.sort((a, b) => {
        const aUrl = a.play_addr?.url_list?.[0] || '';
        const bUrl = b.play_addr?.url_list?.[0] || '';
        return aUrl.length - bUrl.length;
      });
    } else {
      // 默认: highest bitrate
      mp4Rates.sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
    }
    
    // 选择第一个
    const best = mp4Rates[0];
    // ...
  }
}
```

### 3.2 进度状态反馈

**按钮状态机**:
```
idle (默认) → loading (点击) → success/error (完成)
    ↑                                  ↓
    └────────────── 3秒后 ──────────────┘
```

**content.js 实现**:
```javascript
btn.addEventListener('click', async (e) => {
  e.stopPropagation();
  e.preventDefault();
  
  // 进入loading态
  btn.classList.add('loading');
  btn.style.pointerEvents = 'none';
  
  const vid = getVidFromElement(btn);
  const result = await requestDownload(vid);
  
  // 根据结果切换状态
  btn.classList.remove('loading');
  if (result.ok) {
    btn.classList.add('success');
    setTimeout(() => btn.classList.remove('success'), 3000);
  } else {
    btn.classList.add('error');
    btn.title = result.error || 'Download failed';
    setTimeout(() => {
      btn.classList.remove('error');
      btn.title = 'Download';
    }, 5000);
  }
  
  btn.style.pointerEvents = 'auto';
});
```

**CSS 状态样式**:
```css
.tikdownload-btn.loading {
  animation: spin 1s linear infinite;
  opacity: 0.4;
}

.tikdownload-btn.success {
  background: rgba(76, 175, 80, 0.8) !important;
}

.tikdownload-btn.error {
  background: rgba(244, 67, 54, 0.8) !important;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

### 3.3 失败重试

已有 `fetchAwemeDetail()` 的3次重试，保留。  
新增下载失败重试：

```javascript
async function downloadWithRetry(url, filename, retryTimes) {
  for (let i = 0; i < retryTimes; i++) {
    try {
      const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download(
          { url, filename, conflictAction: 'uniquify' },
          (id) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError.message);
            } else {
              resolve(id);
            }
          }
        );
      });
      
      return { ok: true, downloadId };
    } catch (error) {
      LOG(`Download attempt ${i + 1} failed:`, error);
      if (i < retryTimes - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  
  return { ok: false, error: 'Max retries exceeded' };
}
```

### 3.4 完成通知

**manifest.json 加权限**:
```json
{
  "permissions": ["storage", "downloads", "webRequest", "notifications"]
}
```

**background.js 发送通知**:
```javascript
async function notifyComplete(count, failed) {
  const settings = await chrome.storage.local.get(['queueSettings']);
  if (!settings.queueSettings?.notifyOnComplete) return;
  
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/128.png',
    title: 'TikDownload',
    message: `✓ ${count} downloaded${failed > 0 ? `, ✗ ${failed} failed` : ''}`,
    priority: 1
  });
}
```

---

## Phase 4: 下载引擎增强(第二档)

### 4.1 下载队列系统

**DownloadQueue 类**:
```javascript
class DownloadQueue {
  constructor(concurrency = 3) {
    this.queue = [];          // { vid, status, result }
    this.running = new Set(); // 正在下载的vid
    this.concurrency = concurrency;
  }
  
  add(vid) {
    if (this.queue.some(item => item.vid === vid)) {
      LOG('Already in queue:', vid);
      return;
    }
    this.queue.push({ vid, status: 'pending', result: null });
    this.process();
  }
  
  async process() {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const item = this.queue.find(i => i.status === 'pending');
      if (!item) break;
      
      item.status = 'running';
      this.running.add(item.vid);
      
      // 异步下载
      downloadPost(item.vid).then(result => {
        item.status = result.ok ? 'completed' : 'failed';
        item.result = result;
        this.running.delete(item.vid);
        this.process(); // 继续处理队列
      });
    }
  }
  
  getStats() {
    return {
      total: this.queue.length,
      pending: this.queue.filter(i => i.status === 'pending').length,
      running: this.running.size,
      completed: this.queue.filter(i => i.status === 'completed').length,
      failed: this.queue.filter(i => i.status === 'failed').length
    };
  }
}

// 全局队列实例
const downloadQueue = new DownloadQueue(3);
```

### 4.2 下载历史记录

**写入历史**:
```javascript
async function addToHistory(vid, info, result) {
  const history = await chrome.storage.local.get(['downloadHistory']);
  const list = history.downloadHistory || [];
  
  list.push({
    vid: vid,
    creator: info.creator,
    title: info.description?.substring(0, 50) || '',
    url: result.urls?.[0] || '',
    filename: result.filename || '',
    timestamp: Date.now(),
    status: result.ok ? 'success' : 'failed',
    error: result.error || '',
    size: result.size || 0
  });
  
  // 最多保留1000条
  if (list.length > 1000) {
    list.shift();
  }
  
  await chrome.storage.local.set({ downloadHistory: list });
}
```

### 4.3 去重检测

```javascript
async function checkDuplicate(vid) {
  const data = await chrome.storage.local.get(['downloadHistory', 'queueSettings']);
  if (!data.queueSettings?.autoDedupe) return false;
  
  const exists = data.downloadHistory?.some(
    item => item.vid === vid && item.status === 'success'
  );
  
  return exists;
}

// 在downloadPost开头调用
async function downloadPost(vid) {
  const isDupe = await checkDuplicate(vid);
  if (isDupe) {
    LOG('Already downloaded:', vid);
    // 通知content.js显示"已下载"提示
    return { ok: false, error: 'Already downloaded', isDuplicate: true };
  }
  
  // 继续原有逻辑...
}
```

### 4.4 批量下载

**content.js 添加批量按钮**:
```javascript
function createBatchButton() {
  const btn = document.createElement('div');
  btn.className = 'tikdownload-batch-btn';
  btn.innerHTML = '📥 批量下载';
  btn.title = 'Download all videos on this page';
  
  btn.addEventListener('click', async () => {
    // 扫描所有视频ID
    const vids = [];
    document.querySelectorAll('[data-e2e-vid]').forEach(el => {
      const vid = el.dataset.e2eVid;
      if (vid) vids.push(vid);
    });
    
    if (vids.length === 0) {
      alert('No videos found on this page');
      return;
    }
    
    // 批量入队
    const result = await chrome.runtime.sendMessage({
      type: 'BATCH_DOWNLOAD_REQ',
      data: { vids }
    });
    
    alert(`Added ${result.count} videos to download queue`);
  });
  
  document.body.appendChild(btn);
}
```

**background.js 处理批量请求**:
```javascript
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BATCH_DOWNLOAD_REQ') {
    const { vids } = msg.data;
    vids.forEach(vid => downloadQueue.add(vid));
    sendResponse({ ok: true, count: vids.length });
    return true;
  }
});
```

### 4.5 图集归类

```javascript
async function buildFilename(info, url, index, totalCount) {
  // ...原有逻辑
  
  // 如果是图集(多个文件)
  if (totalCount > 1) {
    const folderName = sanitize(info.description?.substring(0, 30) || info.vid);
    return `${folder}/${sanitize(info.creator)}/${folderName}/${index}.${ext}`;
  }
  
  // 单文件保持原逻辑
  return `${folder}/${sanitize(info.creator)}/${filename}`;
}
```

---

## Phase 5-6: Options页 & Popup页

(详细UI实现代码略,参见后续commits)

---

## 实现顺序

1. ✅ Phase 1: 存储层迁移函数
2. ✅ Phase 2: 按钮位置自定义(options.html + content.js改造)
3. ✅ Phase 3: 第一档引擎增强(修bug + 状态 + 重试 + 通知)
4. ✅ Phase 4: 第二档引擎增强(队列 + 历史 + 去重 + 批量)
5. ✅ Phase 5-6: 完整UI集成
6. ✅ Phase 7: 测试

预计总耗时: 4-6小时
