// fetcher.js - Runs in page context to fetch API when service worker can't
window.addEventListener("message", async (event) => {
  if (event.data?.type !== "FETCH_AWEME_DETAIL_REQ") return;
  const url = event.data.data?.url;
  if (!url) return;
  try {
    await fetch(url, { method: "GET" });
  } catch (e) {}
});
