# TikDownload v1.0.1

## Changes

- **Fix: Invalid filename errors** — Downloads now work for posts with special characters in creator names or captions
  - Added `#` to blocked characters (rejected by Chrome downloads API)
  - Added Chinese punctuation filtering (`。！？` etc.)
  - Fixed folder names ending with `.` (e.g. `椰奶冻.` → `椰奶冻`)
  - Added empty filename fallback to prevent blank paths
- **New icon** — Cleaner Douyin-style design with download arrow

## Technical Details

The `sanitize()` function now strips:
- OS-illegal characters: `<>:"/\|?*`
- Chrome-rejected characters: `#`
- Chinese punctuation: `。，！？；：""''【】《》（）～…·`
- Leading/trailing dots, spaces, and underscores from path segments
