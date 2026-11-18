# The Library Screen

The single authenticated workspace: sidebar of scopes, virtualized article list, and reader pane.

## Rules

- `LIB-SCOPE-1`: Shows one scope at a time (`稍后阅读`, `全部订阅`, one folder, or one feed). Selecting the already-selected scope closes any open article without reloading the list.
- `LIB-LIST-1`: Lists load 30 rows per page (`CM-PAGE-1`). Scrolling within 600 px of the end loads the next page when `cursor != null` (at most one page request in flight). Failed page loads keep loaded rows and show a retry banner (`重试`).
- `LIB-RELOAD-1`: The list reloads from page 1 only when entering the library, switching scope, toggling `?unread`, or toggling `从旧到新` on the active feed (`FD-PREF-1`, resetting the cursor). There is no manual refresh button for normal feeds. Stale page responses from an earlier scope/filter/order are discarded. Entering the library or switching scope also refreshes sidebar feeds, folders, and unread counts.
- `LIB-FILTER-1`: Marking an item read never removes its row from the currently loaded list (even with `?unread` active); it stays shown as read until the next list reload.
- `LIB-READ-1`: Toggling read state, opening an unread article, `将已加载文章标为已读`, and `全部标记为已读` apply optimistically and roll back (restoring rows and reloading counts) with an error toast on failure.
- `LIB-READ-2`: `将已加载文章标为已读` sends the IDs of currently loaded unread rows matching the active scope; `全部标记为已读` calls the scope's own mark-all endpoint (`later.md`, `feeds.md`, `folders.md`). Neither button is ever disabled.
- `LIB-COUNT-1`: Sidebar hides zero unread counts; list heading always shows the count. Folder count = sum of its feeds' counts; `全部订阅` count = sum of all feeds' counts.
- `LIB-ROW-1`: Each row shows source (feed title for feed items; URL hostname for saved pages), relative publish time (when present), title (max 3 lines), summary plain text (max 2 lines), and an independent read-toggle control (`aria-pressed`). Left-click opens the article in the reader; modified/middle click opens the original URL in a new tab.
- `LIB-VIEW-1`: CSS responsive layout: wide = 3 columns (sidebar, list, reader); medium = sidebar + (list or reader); narrow = single column + mobile header bar (`切换导航`, breadcrumb `留白 / <scope>`). Focus moves safely when a panel hides.
- `LIB-TOAST-1`: At most one toast at a time (bottom-end), auto-dismissed after 6 s or on clicking `关闭`.

## Interface & Messages

- **Sidebar**: brand `留白` + menu (`设置`, `语言：中文 / English`, `退出登录`), `稍后阅读`, `全部订阅`, and `订阅源` section (plus `+` menu: `新增 RSS 订阅`, `新建目录`, `导入 OPML`). Every scope row swaps its unread count for a `⋯` menu (`只显示未读`, `全部标记为已读`, plus scope-specific actions) on hover/focus (always visible on touch).
- **List heading**: scope title + unread count on left; `将已加载文章标为已读` + `⋯` menu (`只显示未读`, `全部标记为已读`, plus scope-specific items) on right.

| Situation | Text |
| --- | --- |
| loading / error / retry | `正在加载文章…` / `暂时无法加载文章` `请点击上方重试。` / `重试` |
| unread filter empty / action | `没有未读文章` `所有文章都已读过了。` / `查看全部文章` |
| list tools & menu | `将已加载文章标为已读` / `只显示未读` / `全部标记为已读` |
| toast dismiss | `关闭` |

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
