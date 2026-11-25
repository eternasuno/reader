# The Library Screen

The single authenticated workspace: sidebar of scopes, virtualized article list, and reader pane.

## Rules

- `LIB-SCOPE-1`: Shows one scope at a time (`稍后阅读`, `全部订阅`, one folder, or one feed). Selecting the already-selected scope closes any open article without reloading the list.
- `LIB-LIST-1`: Lists load 30 rows per page (`CM-PAGE-1`). Scrolling within 600 px of the end loads the next page when `cursor != null` (at most one page request in flight). Failed page loads keep loaded rows and show a retry banner (`重试`).
- `LIB-RELOAD-1`: The list reloads from page 1 only when entering the library, switching scope, toggling `?unread`, or toggling `从旧到新` on the active list (`FD-PREF-1`, resetting the cursor). There is no manual refresh action for normal feeds, in any menu. Stale page responses from an earlier scope/filter/order are discarded. Entering the library or switching scope also refreshes sidebar feeds, folders, and unread counts.
- `LIB-FILTER-1`: Marking an item read never removes its row from the currently loaded list (even with `?unread` active); it stays shown as read until the next list reload.
- `LIB-READ-1`: Toggling read state, opening an unread article, `将已加载文章标为已读`, and `全部标记为已读` apply optimistically. Requests for one article are sent one at a time in the user's order; toggles made while a request is in flight are combined into the next request. On failure, a row whose latest choice is still the failed value rolls back to its last server-confirmed state with its unread count, and an error toast appears (once per failed batch); a failure the user has already superseded changes nothing and shows no toast. A failed `全部标记为已读` also reloads counts from the server, and still shows the toast.
- `LIB-READ-2`: `将已加载文章标为已读` sends the IDs of currently loaded unread rows matching the active scope; `全部标记为已读` calls the scope's own mark-all endpoint (`later.md`, `feeds.md`, `folders.md`). Neither button is ever disabled.
- `LIB-COUNT-1`: Sidebar hides zero unread counts; list heading always shows the count. Folder count = sum of its feeds' counts; `全部订阅` count = sum of all feeds' counts.
- `LIB-ROW-1`: Each row is a rounded card showing, left to right: an independent leading read-toggle control (`aria-pressed`; solid dot when unread, hollow circle on hover/focus when read), then source line (site icon + feed title for feed items / URL hostname for saved pages, relative publish time right-aligned when present), title (max 3 lines; bold when unread, dimmed when read), summary plain text (fixed max 3 lines, not configurable; no thumbnail). Feed icons (sidebar, rows, feed options) are the feed's own image (`iconUrl`: RSS channel `<image><url>`, Atom `icon` then `logo`, JSON Feed `favicon` then `icon`; absolute http(s) only, resolved against the feed URL, stored on refresh and returned as `iconUrl`), falling back to the feed origin's `/favicon.ico`, then a generic icon (each step used when the previous is absent or fails to load); saved pages use the page origin's `/favicon.ico`, then a generic icon. Images load directly in the browser with `referrerpolicy="no-referrer"`. Left-click opens the article in the reader; modified/middle click opens the original URL in a new tab.
- `LIB-VIEW-1`: CSS responsive layout: wide = 3 columns (sidebar, list, reader); medium = sidebar + (list or reader); narrow = single column with no separate top bar: the list heading starts with `切换导航` (opens the sidebar as a drawer, focusing the drawer panel; closing returns focus to `切换导航`), and the reader shows only its own toolbar. On medium/wide desktop screens (`md+`), the left sidebar can be collapsed (`收起侧边栏` in the brand bar) and re-expanded (`展开侧边栏` in the list heading), persisted in `localStorage` (`reader.sidebarCollapsed`). Both the desktop sidebar collapse/expand and the narrow-screen drawer animate with 200 ms transitions. When the active article changes, the virtual list automatically scrolls to keep the selected row in view. Focus moves safely when a panel hides. Narrow-screen icon controls are at least 40 px; touch screens always show the read-row hollow circle; layouts pad for device safe areas; toasts span the bottom and dialogs open as bottom sheets below 640 px.
- `LIB-KEY-1`: There are no keyboard shortcuts in the library screen or reader (no `j`/`k`/`m`/`s`/`f`/`v`/`o`/`u`/`[`/`?`, no `Esc` to close an article, no shortcuts dialog); only dialogs, menus, and the image lightbox handle their own `Escape`.
- `LIB-TOAST-1`: At most one toast at a time (bottom-end), auto-dismissed after 6 s or on clicking `关闭`.
- `LIB-LINK-1`: Stored and API URLs with an invalid port are rejected on read/decode (a response containing one fails to decode). Every write path validates URLs, so such rows cannot be created through the app. Source links and modified/middle-click on rows and `在新页面打开源网页` only act on URLs the browser can parse; for URLs the server accepts that the browser cannot parse (e.g. scoped IPv6 hosts), source links render as plain text (no link) and open-in-new-tab shows a toast `无法在浏览器中打开此链接`, without invalidating the rest of a list response.
- `LIB-FOCUS-1`: When a dialog opened from a menu item closes, focus returns to the previously focused element, then to the menu trigger (recorded only for items that open a dialog, valid for the same task), and finally to the `main` landmark when neither is connected and focusable.

## Interface & Messages

- **Sidebar**: brand icon + `Lantern` + desktop `收起侧边栏` button + menu (`设置`, `主题` sub-panel with `自动` / `浅色` / `深色`, `语言：中文 / English`, `退出登录`; no keyboard-shortcuts item), `稍后阅读`, `全部订阅`, and `订阅源` section (header `+` button opens `新增 RSS 订阅` directly; folders are created only from a feed's `移动到` sub-panel (`新建目录`); header `⋮` menu: `导入…`, `导出…`, no unread filter); feed rows show the feed's site icon. The selected scope row is filled with the accent surface; unread counts are plain muted numbers. Every scope row swaps its unread count for a `⋯` menu (`只显示未读`, `全部标记为已读`, plus scope-specific actions) on hover/focus (always visible on touch).
- **Narrow screens (`< 768px`)**: the list heading's navigation toggle uses the sidebar icon and opens the sidebar as a 16.5rem drawer with rounded right corners over a dimmed backdrop.
- **List heading**: `展开侧边栏` (when the desktop sidebar is collapsed) + scope title + plain muted unread count on left; 1-click `只显示未读` toggle button (highlighted when active) + `将已加载文章标为已读` + `⋯` menu (`只显示未读`, `全部标记为已读`, plus scope-specific items) on right.

| Situation | Text |
| --- | --- |
| loading / error / retry | `正在加载文章…` / `暂时无法加载文章` `请点击上方重试。` / `重试` |
| unread filter empty / action | `没有未读文章` `所有文章都已读过了。` / `查看全部文章` |
| list tools & menu | `将已加载文章标为已读` / `只显示未读` / `全部标记为已读` |
| toast dismiss | `关闭` |
| open original link the browser cannot parse (`LIB-LINK-1`) | `无法在浏览器中打开此链接` |

## Acceptance

```gherkin
Feature: Library screen behavior
  Scenario: Marking read under unread filter keeps the row until reload
    Given "?unread" is active on "全部订阅"
    When I open an unread article or toggle its read button
    Then the row stays visible as read and unread counts decrease by 1
    When I switch to "稍后阅读" and return to "全部订阅"
    Then the read article is no longer in the list

  Scenario: Failed mark-all rolls back rows and counts
    Given a scope has 5 loaded unread rows and total count 9
    When "全部标记为已读" fails on the server
    Then the 5 rows revert to unread, counts reload, and an error toast appears
```
