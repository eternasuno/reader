# The Reader Pane

Displays one saved page or feed item alongside the article list.

## Rules

- `RD-ARTICLE-1`: The open article is determined solely by the route (`/later/:pageId`, `/all/:itemId`, `/feed/:feedId/:itemId`, `/folder/:folderId/:itemId`). While loading, any row already in memory renders immediately; if the fetch returns `null`, the empty reader is shown without an error toast. Latest navigation always wins.
- `RD-CONTENT-1`: Default view renders stored `content`, else `description`, else `暂无内容`. Above it sits a header: source line (site icon + feed title, or hostname for saved pages), the article title (linking to `url` in a new tab), then the source hostname link (omitted when identical to the source line) and the localized absolute publish date-time when present, separated from the body by a subtle divider.
- `RD-EXTRACT-1`: Header icon `提取正文` / `切换回原文` toggles extracted content. For saved pages (which only have one `content`), it toggles nothing remote; for feed items, it shows `extractedContent` immediately if cached, or calls `POST /api/feed-items/:id/extract` (showing spinner + `正在提取正文…`). Switching articles discards any in-flight extraction result and resets the mode to the new article's starting mode.
- `RD-MODE-1`: Starting mode for a feed item is its feed's `readerMode` (`default`, `extracted` — triggering extraction automatically if uncached — or `embedded`). Saved pages start in `default`. Reader mode is never encoded in the URL.
- `RD-WEBPAGE-1`: Overflow menu item `嵌入式网页视图` embeds the original `http`/`https` URL (without credentials and never same-origin with the app) in a full-pane isolated iframe (`sandbox="allow-scripts allow-forms allow-popups allow-same-origin"`, `referrerpolicy="no-referrer"`) directly below the toolbar without the article header or footer. Unsafe URLs show `此地址不支持安全内嵌，请使用上方链接打开原文。`.
- `RD-FRAME-1`: Article HTML renders inside an isolated `srcdoc` iframe without `allow-same-origin`, linked to the app's compiled stylesheet, protected by CSP (`default-src 'none'; img-src https: http:; style-src 'unsafe-inline' <app-origin>; script-src 'nonce-<nonce>'; base-uri 'none'; form-action 'none'`), and communicates via a per-render random-token `postMessage` bridge: resizing height, opening an in-app full-screen lightbox (`图片预览`, dismissed via `关闭`, backdrop click, or `Escape`) when clicking an unlinked `http(s)` image, and forwarding unmodified shortcut keys to the library shortcut handler.
- `RD-READ-1`: Opening an unread article optimistically marks it read; the header toggle switches between `标为已读` and `标为未读`.
- `RD-NAV-1`: `上一篇` / `下一篇` step through the currently loaded list rows (both disabled if the article is not in the loaded list). `返回文章列表` navigates back to the scope list URL. Switching articles resets the reader scroll position to the top, and scrolling the article body adds a subtle elevation shadow to the toolbar.
- `RD-APPEAR-1`: In non-embedded views, overflow menu `更多操作` includes a `视图选项` (`AA`) sub-panel with a back header, a `主题` row (sub-page `自动` / `浅色` / `深色`), a `字体` row (sub-page `无衬线` / `衬线`), numeric steppers for `字体大小` (`14`–`22`, default `16`), `行高` (`1.4`–`2.0`) and `正文宽度` (`1`–`6`; the increase button disables at the maximum), `恢复默认` (when modified), and `更多选项…` (opens `/settings`). Appearance is persisted in `localStorage` (`reader.appearance`).

## Interface & Messages

- **Header (`文章操作`)**: icon-only buttons whose accessible name and tooltip carry the label, gaining a subtle elevation shadow when the article body is scrolled. Left `返回文章列表` (close icon in the 3-column layout, back arrow otherwise), `上一篇` (up chevron), `下一篇` (down chevron); right extraction icon and `保存到稍后阅读` (feed items only), read toggle (filled dot when unread → `标为已读`, hollow circle when read → `标为未读`), overflow `更多操作` (`发送电子书`, `在新页面打开源网页`, `内嵌网页视图` checkbox, `全屏显示` checkbox, `视图选项` (`AA`) sub-panel in non-embedded views, `订阅源选项…` for feed items, and destructive `删除` for saved pages only). The article header has no divider below it and a large title; on narrow viewports (`< 640px`) the article column uses wider side padding; images stay inside the padding (never edge-to-edge). The article ends after its body: there is no end-of-article `下一篇` card, and the body iframe is sized to its content (no trailing blank space).
- **Empty reader**: `给阅读留一点空间` / `从左侧选择一篇文章，开始阅读`.

## Acceptance

```gherkin
Feature: Reader pane
  Scenario: Switching articles during extraction discards the stale response
    Given extraction for article "A" is in flight
    When I open article "B" before "A" finishes
    And "A" finishes later
    Then "B" remains open in its own starting mode

  Scenario: Same-origin URL cannot be embedded
    Given an article whose URL points to the app's own origin
    When I enable "嵌入式网页视图"
    Then the notice "此地址不支持安全内嵌，请使用上方链接打开原文。" is shown instead of an iframe
```
