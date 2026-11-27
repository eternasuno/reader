# The Reader Pane

Displays one saved page or feed item alongside the article list.

## Rules

- `RD-ARTICLE-1`: The open article is determined solely by the route (`/later/:pageId`, `/all/:itemId`, `/feed/:feedId/:itemId`, `/folder/:folderId/:itemId`). While loading, any row already in memory renders immediately; if the fetch returns `null`, the empty reader is shown without an error toast. Latest navigation always wins.
- `RD-CONTENT-1`: Default view renders stored `content`, else `description`, else `暂无内容`. Above it sits a header: source line (site icon + feed title, or hostname for saved pages), the article title (linking to `url` in a new tab), then the source hostname link (omitted when identical to the source line) and the localized absolute publish date-time when present, separated from the body by a subtle divider.
- `RD-EXTRACT-1`: Header icon `提取正文` / `切换回原文` toggles extracted content. For saved pages (which only have one `content`), it toggles nothing remote; for feed items, it shows `extractedContent` immediately if cached, or calls `POST /api/feed-items/:id/extract` (the toolbar icon pulses in the primary colour while extracting and stays primary once extracted; the original body stays visible with no body loading indicator until the extracted body replaces it). Switching articles discards any in-flight extraction result and resets the mode to the new article's starting mode.
- `RD-MODE-1`: Starting mode for a feed item is its feed's `readerMode` (`default`, or `extracted` — triggering extraction automatically if uncached). The embedded webpage view is never a starting mode; it is only a temporary per-article toggle (`RD-WEBPAGE-1`). Saved pages start in `default`. Reader mode is never encoded in the URL.
- `RD-WEBPAGE-1`: Overflow menu item `嵌入式网页视图` embeds the original `http`/`https` URL (without credentials and never same-origin with the app) in a full-pane isolated iframe (`sandbox="allow-scripts allow-forms allow-popups allow-same-origin"`, `referrerpolicy="no-referrer"`) directly below the toolbar without the article header or footer. Unsafe URLs (credentials, same-origin) show `此地址不支持安全内嵌，请使用上方链接打开原文。`; URLs the browser cannot parse show `此地址无法被浏览器解析，无法内嵌或打开。` because no link is rendered for them (`LIB-LINK-1`).
- `RD-BODY-1`: Stored article HTML renders directly in the reader pane (no iframe) after the browser strips `class`, `id`, `name`, and `style` attributes, scoped typography under `.article-body`, and is protected by the app page CSP (`script-src 'self'`, no inline scripts). Clicking (or `Enter`/`Space` on) an unlinked `http(s)` image opens an in-app full-screen lightbox (`图片预览`, dismissed via `关闭`, backdrop click, or `Escape`).
- `RD-READ-1`: Opening an unread article optimistically marks it read; the header toggle switches between `标为已读` and `标为未读`.
- `RD-NAV-1`: `上一篇` / `下一篇` step through the currently loaded list rows (both disabled if the article is not in the loaded list). `返回文章列表` navigates back to the scope list URL. Switching articles resets the reader scroll position to the top, and scrolling the article body adds a subtle elevation shadow to the toolbar.
- `RD-APPEAR-1`: In non-embedded views, overflow menu `更多操作` includes a `视图选项` (`AA`) sub-panel with a back header, a `主题` row (sub-page `自动` / `浅色` / `深色`), and rows whose sub-pages pick a tier: `字体` (`无衬线` / `衬线`), `字体大小` (`小` / `中` / `大` / `特大`, default `中`), `行高` (`紧凑` / `适中` / `宽松`, default `适中`), and `正文宽度` (`窄` / `适中` / `宽`, default `宽`); each row shows its current tier. No numeric values are shown or entered. `恢复默认` appears when anything differs from the defaults; there is no `更多选项…` item. The sidebar app menu opens the same panel (`LIB-VIEW-1`). Font sizes are `rem`-based so the touch scale applies. Appearance is persisted in `localStorage` (`reader.appearance`, tier names; unknown stored values fall back to the default).

## Interface & Messages

- **Header (`文章操作`)**: icon-only buttons whose accessible name and tooltip carry the label, gaining a subtle elevation shadow when the article body is scrolled. Left `返回文章列表` (close icon in the 3-column layout, back arrow otherwise), `上一篇` (up chevron), `下一篇` (down chevron); right extraction icon and `保存到稍后阅读` (feed items only), read toggle (filled dot when unread → `标为已读`, hollow circle when read → `标为未读`), overflow `更多操作` (`发送电子书`, `在新页面打开源网页`, `内嵌网页视图` checkbox, `全屏显示` checkbox, `视图选项` (`AA`) sub-panel in non-embedded views, the `缺省视图` sub-panel for feed items (`FD-PREF-1`), and destructive `删除` for saved pages only). The article header has no divider below it and a large title; on narrow viewports (`< 640px`) the article column uses wider side padding; images stay inside the padding (never edge-to-edge). The article ends after its body: there is no end-of-article `下一篇` card, and the body is sized to its content (no trailing blank space).
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
