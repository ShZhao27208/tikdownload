<div align="center">
<img src="docs/logo.gif" width="160" height="160" alt="瞾 — Shuo Zhao" style="border-radius:50%;"/>


# TikDownload

A lightweight Edge/Chrome extension to download TikTok and Douyin videos and images with one click. No external servers, no accounts required — everything runs locally in your browser.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

### Features

| Feature | TikTok | Douyin |
|---------|--------|--------|
| Video download (highest quality) | ✅ | ✅ |
| Image slideshow (图集) download | ✅ | ✅ |
| Animated images (动图) as video | — | ✅ |
| No watermark (when available) | ✅ | ✅ |
| Batch download from profile | 🚧 | 🚧 |
| Customizable filename rules | ✅ | ✅ |
| Configurable save folder | ✅ | ✅ |

### Installation

1. Download or clone this repository
2. Open `edge://extensions` (Edge) or `chrome://extensions` (Chrome)
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select this folder
5. The TikDownload icon appears in your toolbar

### Usage

#### Step 1: Capture API Tokens

Browse TikTok or Douyin normally — scroll through a few videos. The extension silently captures API authentication parameters in the background. You'll see `[TikDownload BG] Captured API params` in the Service Worker console when ready.

#### Step 2: Download

- **In feed**: Hover over any video/image post → download button appears (top-right corner)
- **On detail page** (`/video/xxx` or `/note/xxx`): A fixed download button appears at the top-right
- **Click the button** → file downloads to your configured folder

#### Step 3: Configure (Optional)

Click the extension icon to open settings:

- **Save Folder**: Where files go (relative to browser download directory)
- **Filename Rules**: Drag-and-drop building blocks to customize naming
  - Available blocks: `Title`, `Date`, `Author`, `Video ID`, `Index`, `Separator _`, `Separator -`
  - Real-time preview shows the resulting filename
- **Video Quality**: Highest bitrate or highest resolution

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│ 1. webRequest.onBeforeRequest                               │
│    Captures API request parameters (auth tokens)            │
│    from Douyin/TikTok's own network requests                │
├─────────────────────────────────────────────────────────────┤
│ 2. User clicks download button                              │
│    content.js extracts video/note ID from DOM               │
├─────────────────────────────────────────────────────────────┤
│ 3. background.js constructs API request                     │
│    /aweme/v1/web/aweme/detail/?aweme_id={id}&{saved_params} │
├─────────────────────────────────────────────────────────────┤
│ 4. Parse response → extract media URLs                      │
│    video.bit_rate[].play_addr.url_list (best quality)       │
│    images[].url_list (for slideshows)                       │
├─────────────────────────────────────────────────────────────┤
│ 5. chrome.downloads.download(url, filename)                 │
│    Direct download — URL contains embedded auth             │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
TikDownload/
├── manifest.json      # MV3 extension manifest
├── background.js      # Service worker: webRequest interception, API calls, downloads
├── content.js         # Content script: button injection, video ID extraction
├── content.css        # Download button styles
├── fetcher.js         # Page-context fetch helper (fallback)
├── popup.html         # Settings UI
├── popup.js           # Settings logic (building-block filename config)
├── icons/             # Extension icons (16/48/128px)
├── README.md
├── LICENSE
└── .gitignore
```

### Permissions Explained

| Permission | Why |
|-----------|-----|
| `downloads` | Trigger file downloads to disk |
| `webRequest` | Intercept Douyin/TikTok API requests to capture auth tokens |
| `storage` | Persist user settings (folder, filename rules, quality) |

### Troubleshooting

| Problem | Solution |
|---------|----------|
| Button doesn't appear | Refresh the page after installing the extension |
| "No saved params" error | Browse a few videos first to let the extension capture API tokens |
| Download fails | The API token may have expired — refresh the page and browse again |
| Wrong filename | Check settings (click extension icon) and adjust filename blocks |

### Legal and Responsible Use

This project is provided for educational and technical research purposes only. It must not be used for commercial activities, copyright infringement, unauthorized redistribution, piracy, or downloading resources without permission from the rights holder. Users are responsible for complying with TikTok/Douyin's terms of service, applicable laws, and the rights of content creators.

### Limitations

- Must browse at least one video before downloading (to capture API tokens)
- Tokens expire after some time — refresh the page if downloads stop working
- Some creators disable downloads — these videos cannot be saved
- Live streams are not supported

### License

MIT — see [LICENSE](LICENSE)

---

<a id="中文"></a>

## 中文

一个轻量级的 Edge/Chrome 浏览器扩展，一键下载 TikTok 和抖音的视频与图片。无需外部服务器，无需注册账号，所有处理都在本地浏览器中完成。

### 功能

| 功能 | TikTok | 抖音 |
|------|--------|------|
| 视频下载（最高画质） | ✅ | ✅ |
| 图集下载 | ✅ | ✅ |
| 动图保存为视频 | — | ✅ |
| 无水印（如可用） | ✅ | ✅ |
| 批量下载用户主页 | 🚧 | 🚧 |
| 自定义文件命名规则 | ✅ | ✅ |
| 自定义保存路径 | ✅ | ✅ |

### 安装

1. 下载或克隆本仓库
2. 打开 `edge://extensions`（Edge）或 `chrome://extensions`（Chrome）
3. 开启右上角的 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择本文件夹
5. 工具栏出现 TikDownload 图标

### 使用方法

#### 第一步：捕获 API 令牌

正常浏览抖音或 TikTok，滑动几个视频即可。扩展会在后台自动捕获 API 认证参数。Service Worker 控制台会显示 `Captured API params` 表示就绪。

#### 第二步：下载

- **信息流中**：鼠标悬停在视频/图文帖子上 → 右上角出现下载按钮
- **帖子详情页**（`/video/xxx` 或 `/note/xxx`）：右上角显示固定下载按钮
- **点击按钮** → 文件下载到配置的文件夹

#### 第三步：配置（可选）

点击扩展图标打开设置：

- **保存文件夹**：相对于浏览器下载目录的路径
- **命名规则**：积木式拖拽配置
  - 可用积木：`标题`、`日期`、`作者`、`视频ID`、`序号`、`分隔符_`、`分隔符-`
  - 实时预览最终文件名
- **视频画质**：最高码率 / 最高分辨率

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│ 1. webRequest.onBeforeRequest                               │
│    拦截抖音/TikTok 的 API 请求，保存认证参数                    │
├─────────────────────────────────────────────────────────────┤
│ 2. 用户点击下载按钮                                           │
│    content.js 从 DOM 中提取视频/图文 ID                       │
├─────────────────────────────────────────────────────────────┤
│ 3. background.js 构造 API 请求                               │
│    /aweme/v1/web/aweme/detail/?aweme_id={id}&{保存的参数}     │
├─────────────────────────────────────────────────────────────┤
│ 4. 解析响应 → 提取媒体 URL                                    │
│    video.bit_rate[].play_addr.url_list（最高画质）             │
│    images[].url_list（图集）                                  │
├─────────────────────────────────────────────────────────────┤
│ 5. chrome.downloads.download(url, filename)                  │
│    直接下载 — URL 自带认证信息                                 │
└─────────────────────────────────────────────────────────────┘
```

### 文件结构

```
TikDownload/
├── manifest.json      # MV3 扩展清单
├── background.js      # Service Worker：请求拦截、API 调用、下载
├── content.js         # 内容脚本：按钮注入、视频 ID 提取
├── content.css        # 下载按钮样式
├── fetcher.js         # 页面上下文 fetch 辅助（降级方案）
├── popup.html         # 设置界面
├── popup.js           # 设置逻辑（积木式命名配置）
├── icons/             # 扩展图标（16/48/128px）
├── README.md
├── LICENSE
└── .gitignore
```

### 权限说明

| 权限 | 用途 |
|------|------|
| `downloads` | 触发文件下载 |
| `webRequest` | 拦截 API 请求以捕获认证令牌 |
| `storage` | 保存用户设置 |

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| 看不到下载按钮 | 安装扩展后刷新页面 |
| 提示"No saved params" | 先浏览几个视频让扩展捕获 API 参数 |
| 下载失败 | API 令牌可能过期，刷新页面重新浏览 |
| 文件名不对 | 点击扩展图标检查命名规则设置 |

### 合规使用声明

本项目仅用于教学、学习和技术研究用途。不得用于任何商业活动，不得用于侵犯版权、未经授权的传播、盗版资源获取，或在未获得权利人许可的情况下下载和分发内容。使用者应自行遵守 TikTok/抖音服务条款、所在地法律法规以及内容创作者的合法权益。

### 限制

- 必须先浏览至少一个视频才能下载（用于捕获 API 令牌）
- 令牌会过期，如果下载停止工作请刷新页面
- 部分创作者禁止下载的视频无法保存
- 不支持直播

### 许可证

MIT — 见 [LICENSE](LICENSE)
