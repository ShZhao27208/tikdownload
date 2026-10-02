// Paste into the extension service-worker console AND the Douyin page console.
// Then browse a few videos and run: await tikDiag.run('7684962245634394030')
(() => {
  'use strict';
  const g = globalThis;
  g.tikDiag?.stop?.();
  const background = !!g.chrome?.webRequest?.onBeforeRequest;
  const context = background ? 'extension-background' : 'page';
  if (!background && g.location?.origin !== 'https://www.douyin.com') {
    throw new Error('请在扩展 Service Worker 或 https://www.douyin.com 页面控制台运行');
  }
  const nativeFetch = g.fetch;
  const records = [];
  const pending = new Map();
  const cleanup = [];
  const secretKeys = ['a_bogus', 'X-Bogus', 'msToken', 'verifyFp', 'fp'];
  let running = false;
  let stopped = false;

  function remember(raw, meta = {}) {
    try {
      const url = new URL(raw, g.location?.href);
      if (url.origin !== 'https://www.douyin.com' ||
          !url.pathname.startsWith('/aweme/v1/web/')) return null;
      const item = { url: url.href, capturedAt: Date.now(), ...meta };
      records.push(item);
      if (records.length > 40) records.shift();
      return item;
    } catch { return null; }
  }

  function safeRecord(item) {
    const url = new URL(item.url);
    return {
      path: url.pathname,
      ageSeconds: Math.round((Date.now() - item.capturedAt) / 1000),
      method: item.method,
      status: item.status ?? null,
      networkError: !!item.networkError,
      tabId: item.tabId ?? null,
      parameterCount: [...url.searchParams].length,
      authParameterPresent: Object.fromEntries(secretKeys.map(k => [k, url.searchParams.has(k)]))
    };
  }

  if (background) {
    const filter = { urls: ['https://www.douyin.com/aweme/v1/web/*'] };
    const before = details => {
      if (details.tabId < 0 || details.initiator?.includes('extension://')) return;
      const item = remember(details.url, { method: details.method, tabId: details.tabId });
      if (item) pending.set(details.requestId, item);
      if (pending.size > 100) pending.delete(pending.keys().next().value);
    };
    const complete = details => {
      const item = pending.get(details.requestId);
      if (item) item.status = details.statusCode;
      pending.delete(details.requestId);
    };
    const error = details => {
      const item = pending.get(details.requestId);
      if (item) item.networkError = true;
      pending.delete(details.requestId);
    };
    chrome.webRequest.onBeforeRequest.addListener(before, filter);
    chrome.webRequest.onCompleted.addListener(complete, filter);
    chrome.webRequest.onErrorOccurred.addListener(error, filter);
    cleanup.push(() => {
      chrome.webRequest.onBeforeRequest.removeListener(before);
      chrome.webRequest.onCompleted.removeListener(complete);
      chrome.webRequest.onErrorOccurred.removeListener(error);
    });
  } else {
    const wrappedFetch = function(input, init) {
      const item = remember(input instanceof Request ? input.url : String(input), {
        method: init?.method || (input instanceof Request ? input.method : 'GET')
      });
      return nativeFetch.apply(this, arguments).then(response => {
        if (item) item.status = response.status;
        return response;
      }, error => {
        if (item) item.networkError = true;
        throw error;
      });
    };
    g.fetch = wrappedFetch;
    const proto = XMLHttpRequest.prototype;
    const open = proto.open;
    const send = proto.send;
    const xhrMeta = new WeakMap();
    const wrappedOpen = function(method, url) {
      const result = open.apply(this, arguments);
      xhrMeta.set(this, { method, url: String(url) });
      return result;
    };
    const wrappedSend = function() {
      const meta = xhrMeta.get(this);
      const item = meta && remember(meta.url, { method: meta.method });
      if (item) this.addEventListener('loadend', () => {
        item.status = this.status;
        item.networkError = this.status === 0;
      }, { once: true });
      return send.apply(this, arguments);
    };
    proto.open = wrappedOpen;
    proto.send = wrappedSend;
    cleanup.push(() => {
      if (g.fetch === wrappedFetch) g.fetch = nativeFetch;
      if (proto.open === wrappedOpen) proto.open = open;
      if (proto.send === wrappedSend) proto.send = send;
    });
  }

  async function probe(label, url, credentials, vid) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const start = Date.now();
    try {
      const response = await nativeFetch.call(g, url, {
        method: 'GET', credentials, signal: controller.signal
      });
      const body = await response.text();
      let data;
      try { data = JSON.parse(body); } catch { /* HTML/empty responses are diagnostic. */ }
      return {
        label, credentials, status: response.status,
        responseKind: data ? 'json' : !body ? 'empty' : /^\s*</.test(body) ? 'html' : 'other',
        bodyLength: body.length,
        apiStatusCode: typeof data?.status_code === 'number' ? data.status_code : null,
        hasDetail: !!data?.aweme_detail,
        targetMatches: data?.aweme_detail ? String(data.aweme_detail.aweme_id) === vid : null,
        elapsedMs: Date.now() - start
      };
    } catch (error) {
      return { label, credentials, errorType: error?.name || 'Error', elapsedMs: Date.now() - start };
    } finally { clearTimeout(timer); }
  }

  g.tikDiag = {
    report: null,
    async run(vid, tabId) {
      if (stopped) throw new Error('诊断已停止，请重新粘贴脚本');
      if (running) throw new Error('已有诊断正在运行');
      if (!/^\d{10,25}$/.test(String(vid))) throw new Error('请传入字符串形式的视频 ID');
      running = true;
      try {
        vid = String(vid);
        const observed = records.filter(r => tabId === undefined || r.tabId === tabId);
        const report = { context, time: new Date().toISOString(), observed: observed.map(safeRecord), probes: [], findings: [] };
        // In the service worker, use exactly the params the installed plugin would use.
        const pluginParams = background && typeof getLatestParams === 'function' ? getLatestParams() : null;
        const latest = [...observed].reverse().find(r => r.method === 'GET' && [...new URL(r.url).searchParams].length >= 20);
        const params = pluginParams || (latest && [...new URL(latest.url).searchParams]);
        report.parameterSource = pluginParams ? 'plugin-global-cache' : latest ? 'observed-page-request' : 'none';
        if (params) {
          const url = new URL('https://www.douyin.com/aweme/v1/web/aweme/detail/');
          for (const [key, value] of params) url.searchParams.append(key, key === 'aweme_id' ? vid : value);
          if (!url.searchParams.has('aweme_id')) url.searchParams.append('aweme_id', vid);
          report.rebuiltRequest = safeRecord({ url: url.href, capturedAt: Date.now(), method: 'GET' });
          report.probes.push(await probe('rebuilt-default-credentials', url.href, 'same-origin', vid));
          if (background) report.probes.push(await probe('rebuilt-include-credentials', url.href, 'include', vid));
          if (secretKeys.some(k => url.searchParams.has(k))) {
            report.findings.push('重建请求复用了认证/签名参数；其对新接口和视频是否有效，尚未验证。');
          }
        } else {
          report.findings.push('没有可用参数。保持诊断运行，回抖音浏览几个视频后重试。');
        }
        const detail = [...observed].reverse().find(r => {
          const url = new URL(r.url);
          return r.method === 'GET' && url.pathname === '/aweme/v1/web/aweme/detail/' && url.searchParams.get('aweme_id') === vid;
        });
        if (detail) report.probes.push(await probe('exact-observed-target-detail-replay', detail.url, 'include', vid));
        else report.findings.push('尚未捕获目标视频的原始详情请求，不能判断原始签名重放是否可用。');
        if (background && typeof fetchAwemeDetail === 'function') {
          const source = fetchAwemeDetail.toString();
          report.fallbackSourceCheck = {
            sendsPageRequest: source.includes('FETCH_AWEME_DETAIL_REQ'),
            endsWithNull: /return null;\s*\}$/.test(source),
            note: '仅静态检查已加载的函数，不代表页面回退已实际执行成功。'
          };
        }
        const [normal, include] = report.probes;
        if (background && normal?.status === 403 && include?.targetMatches) {
          report.findings.push('同一重建 URL 加 include 后成功：后台凭据策略是直接嫌疑，需重复验证排除时序影响。');
        } else if (report.probes.length && report.probes.every(p => p.status === 403)) {
          report.findings.push('本环境所有探测均为 403；仅凭状态码无法区分签名、会话、风控或请求环境问题。');
        }
        if (report.probes.some(p => p.targetMatches)) report.findings.push('至少一个请求取得了目标视频详情；可继续定位插件处理/回传链路。');
        if (!background) report.findings.push('页面探测可能经过网站对 fetch 的封装；与后台对比时请留意参数来源和时间可能不同。');
        this.report = report;
        console.table(report.probes);
        console.log('[TikDiag] 脱敏报告（可复制分享）\n' + JSON.stringify(report, null, 2));
        return report;
      } finally { running = false; }
    },
    stop() {
      cleanup.forEach(fn => fn());
      records.length = 0;
      pending.clear();
      stopped = true;
      console.log('[TikDiag] 已停止监听');
    }
  };
  console.log('[TikDiag] 已启动：' + context + '。浏览几个视频后执行 await tikDiag.run("视频ID")；结束执行 tikDiag.stop()。');
})();
