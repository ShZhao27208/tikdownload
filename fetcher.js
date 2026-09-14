// fetcher.js - Runs in page context (MAIN world)
// Intercepts Douyin API responses to cache aweme details for download
(() => {
  const _fetch = window.fetch;
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;

  function cacheAwemeItem(item) {
    if (!item?.aweme_id) return;
    window.postMessage({
      type: 'TIKDOWNLOAD_AWEME_CACHE',
      vid: item.aweme_id,
      detail: item
    }, '*');
  }

  function extractAndCache(data) {
    if (!data) return;
    if (data.aweme_detail) cacheAwemeItem(data.aweme_detail);
    const list = data.aweme_list || data.data;
    if (Array.isArray(list)) {
      for (const item of list) cacheAwemeItem(item);
    }
  }

  window.fetch = async function(...args) {
    const response = await _fetch.apply(this, args);
    try {
      const url = (typeof args[0] === 'string') ? args[0] : args[0]?.url || '';
      if (url.includes('/aweme/v1/web/')) {
        const clone = response.clone();
        extractAndCache(await clone.json());
      }
    } catch (e) {}
    return response;
  };

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._tikdlUrl = typeof url === 'string' ? url : '';
    return _xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this._tikdlUrl.includes('/aweme/v1/web/')) {
      this.addEventListener('load', function() {
        try { extractAndCache(JSON.parse(this.responseText)); } catch (e) {}
      });
    }
    return _xhrSend.apply(this, args);
  };
})();
