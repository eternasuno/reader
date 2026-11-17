# The library screen

The library is the one screen where a signed-in user reads: the sidebar of scopes, the article list of the selected scope and the reader beside it. This file covers what is common to every scope — layout, the sidebar frame and its shared scope row and menu, the list, read state and unread counts shown across scopes, paging, reloading, toasts and the URL. The scopes themselves live in [later.md](later.md) (`稍后阅读`), [feeds.md](feeds.md) (feed items) and [folders.md](folders.md) (folders); the reader pane, a row's article, extraction and the embedded page are in [reader.md](reader.md); accounts and sign-out in [account.md](account.md). Routes and shared rules are in [SKILL.md](SKILL.md).

## Rules

The screen has no business rules of its own. It behaves according to these rules, which live in their own files and are not repeated here:

- **CM-PAGE-1 … CM-PAGE-10** — lists are ordered by `id` descending, a cursor is a row's id, `unread` narrows the list, and seeing current data means listing again from the first page.
- **CM-ID-1, CM-ID-2, CM-ID-6** — ids are made in creation order, so the newest row sorts first and a stored row keeps its id.
- **FD-LIST-1** — each feed-item scope is one use case and one port call, so no layer branches on a scope value.
- **FD-READ, SP-READ** — marking is idempotent, unknown and foreign ids change nothing, and "mark everything read" is each domain's own mark-all, invoked separately.
- **FD-COUNT, SP-COUNT** — feed items are counted per feed (absent means 0) and saved pages as one number; a folder's count is the sum of its feeds (`FD-COUNT-3`).

The screen-level rules below are the ones no domain file holds.

### LIB-SCOPE — The selected scope

- LIB-SCOPE-1 The library shows exactly one scope at a time: `稍后阅读`, `全部订阅`, one folder, or one feed. The sidebar lists the scopes; only the selected one has a list.
- LIB-SCOPE-2 Each scope reads, counts and marks through its own requests, never through a scope parameter (FD-LIST-1; the table is under API). Choosing the scope chooses the requests.
- LIB-SCOPE-3 Two scopes are equal when their kind and their id match. Selecting the scope that is already selected neither reloads the list nor changes the URL, except that it closes an open article: while an article is open, selecting its scope navigates back to that scope's list route (LIB-URL-1) and the already-loaded list shows unchanged.

### LIB-LIST — The list and its pages

- LIB-LIST-1 The list holds the scope's rows in arrival order, newest on top (CM-PAGE-1), 30 rows per page.
- LIB-LIST-2 A page request carries `limit` 30, the filter, and, for a next page, the cursor of the last returned row (CM-PAGE-4). The next page is asked for when the scrolled content comes within 600 px of its end and the cursor is not `null`; a `null` cursor ends paging. One page request is in flight at a time.
- LIB-LIST-3 A page is appended to the loaded rows. A row already loaded is not added a second time and keeps its optimistic read state; a row whose delete is still in flight is not added back.
- LIB-LIST-4 A page that fails keeps the rows already loaded and shows the list error banner. `重试` repeats the request that failed: the next page with the same cursor when rows were loaded, the first page otherwise. Paging continues after a successful retry.

### LIB-RELOAD — When the list is read again

- LIB-RELOAD-1 The list reloads from the first page only when the library is entered, when a scope is selected, or when the filter changes. There is no refresh button: to see new items the user enters a scope again or reloads the page. It never reloads in the background, when the user comes back from an article, or after a feed move, a folder creation or a folder rename.
- LIB-RELOAD-2 A reload replaces the loaded rows, clears the banner and starts from the first page. A page that resolves after a newer reload or filter change is discarded instead of mixing two lists.
- LIB-REFRESH-1 Retired: there is no refresh button. Entering the library or a scope also reads the sidebar's feeds, folders and unread counts again.
- LIB-REFRESH-2 Retired with LIB-REFRESH-1.

### LIB-FILTER — The unread filter

- LIB-FILTER-1 One unread filter is shared by all scopes: on means unread rows only, off means all rows. Its route parameter is the one SKILL.md Routes defines, so switching scope keeps it and a reload restores it.
- LIB-FILTER-2 Changing the filter starts a new list from the first page, with no cursor; setting it to the value it already has does nothing.
- LIB-FILTER-3 A read mark never removes a loaded row, also under the unread filter: the row stays, shown as read, until the list reloads and the row no longer belongs to it.

### LIB-READ — Read state across the screen

- LIB-READ-1 A read-state change is shown at once and rolled back with an error toast when its request fails. A row whose own read write is in flight cannot be marked again until it settles.
- LIB-READ-2 Opening an unread article marks it read with the same write and keeps its row in the list, shown as read; opening an article never reloads the list.
- LIB-READ-3 `将已加载文章标为已读` marks the loaded rows that are unread, not already being written and belong to the scope when the operation runs — for a folder, the rows of its current feeds ([folders.md](folders.md) FD-MOVE-4) — in one bulk request that carries their ids. It is disabled when no such row is unread.
- LIB-READ-4 `全部标记为已读` marks the whole scope, including the rows not loaded, through the scope's mark-all endpoint. The optimistic update turns read only the loaded unread rows that belong to the scope when the operation runs — for a folder, the rows of its current feeds, so a moved-out feed's still-shown rows stay unread ([folders.md](folders.md) FD-MOVE-4) — and the scope's unread counters go to zero.
- LIB-READ-5 `全部标记为已读` is never disabled, in the list menu and in every sidebar menu, whatever the counts say and whether or not another request is in flight. When nothing in the scope is unread it still sends the request, which changes nothing.
- LIB-READ-6 A failed mark-all restores the rows it turned read and the counters it cleared, reloads the counts, and shows an error toast.

### LIB-COUNT — Unread counts

- LIB-COUNT-1 A scope's unread count is the number of its unread rows: saved pages come from the saved-page count, feed items from the per-feed counts, `全部订阅` is their sum, and a folder is the sum over the feeds it contains (FD-COUNT-3).
- LIB-COUNT-2 A count moves with each mark (one more or one fewer) and is read from the server again once the mark settles, including after a failed one; a failed count request keeps the last known counts.
- LIB-COUNT-3 The sidebar shows a scope's count only when it is above zero; the list heading always shows the number.

### LIB-MENU — Menus act on the scope they belong to

- LIB-MENU-1 Every scope row has one menu holding `只显示未读` and `全部标记为已读`; the remaining items belong to the scope ([later.md](later.md), [feeds.md](feeds.md), [folders.md](folders.md)).
- LIB-MENU-2 A menu action applies to the scope whose trigger opened the menu, not to the selected scope: the screen selects that scope and navigates to its URL first, then applies the filter or the mark-all. If the scope changed before that navigation finished, the action is dropped rather than applied to the new scope.
- LIB-MENU-3 The list's overflow menu holds the filter and the mark-all of the selected scope plus the items that scope allows; it never offers another scope's action.

### LIB-ROW — A row

- LIB-ROW-1 A row shows its source, its publish time as relative time when it has one, its title over three lines, and its summary as two lines of plain text when it has a description. The source is the feed's title; when there is no loaded feed to name — a saved page, or a feed item whose feed is not loaded — it is the article URL's hostname, and `稍后阅读` when the article has no URL to read a hostname from.
- LIB-ROW-2 The read control is a control of its own inside the row, not part of the link: it exposes its pressed state (`aria-pressed`) and its own accessible name, and it toggles read to unread or unread to read.
- LIB-ROW-3 A plain left click on the title opens the article in the reader and updates the URL. A modified click (Ctrl, Meta, Shift, Alt) or a middle click is left to the browser, which follows the row's URL in a new tab.
- LIB-ROW-4 An unread row is emphasized (bold title, full-strength text), a read row is dimmed, and the row of the open article shows the selected surface.

### LIB-STATE — The states of the list

- LIB-STATE-1 The list is loading (no rows yet), showing rows, empty, or showing the error banner with or without rows.
- LIB-STATE-2 The empty state names the current scope and filter and offers the one recovery that belongs to it: `查看全部文章` turns the unread filter off, `稍后阅读` offers its add action ([later.md](later.md)), the feed-item scopes offer no action and point to the sidebar. The folder states are in [folders.md](folders.md).

### LIB-URL — The URL

- LIB-URL-1 Every scope and every open article has its own URL (SKILL.md routes). Selecting a scope, opening an article, closing the article and changing the filter update it; a reload and the browser's back and forward restore the scope, the filter and the open article from it.
- LIB-URL-2 The path decides the scope, and an id that does not exist is not an error (SKILL.md routes). An unknown or foreign feed or folder id selects that scope and its list answers with no rows, so the list shows that scope's empty state ([later.md](later.md), [feeds.md](feeds.md), [folders.md](folders.md)). An unknown or foreign article id leaves the list as it is and leaves the reader empty (RD-ARTICLE-3, RD-EMPTY).

### LIB-VIEW — Layout

- LIB-VIEW-1 Wide screens show three columns: sidebar, list, reader. Intermediate screens keep the sidebar and show the list, or the reader while an article is open. Small screens show one panel at a time under a mobile bar. The choice is made in CSS and focus stays usable when a panel becomes hidden.
- LIB-VIEW-2 Selecting a scope on a small screen closes the navigation; opening an article replaces the list with the reader, and closing it brings the list back.

### LIB-TOAST — Toasts

- LIB-TOAST-1 One toast at a time, at the bottom end of the screen. A new message replaces the current one; a success is announced as a status, a failure as an alert; it disappears after 6 s and can be closed at once with `关闭`.

## Interface

**Layout and mobile bar.** The layout and its breakpoints are LIB-VIEW. The mobile bar holds a navigation toggle (icon changes between menu and close, `aria-expanded` reflects whether the navigation is open), the breadcrumb `留白 / <scope name>` and the account menu.

**Sidebar.** The header shows the brand `留白` and the account menu. Below it the reading sources: `稍后阅读`, then `全部订阅`, each a scope row. Then the `订阅源` section, whose rows, ordering and add menu are [folders.md](folders.md) and [feeds.md](feeds.md). The selected row uses the filled selected surface and `aria-current="page"`.

**A scope row.** The name, and at the right end one slot that shows the unread count, or, on hover, on keyboard focus inside the row and while the menu is open, the `⋯` trigger in exactly that place; on coarse pointers the trigger is always visible instead of the count. Every scope (later, all subscriptions, a folder, a feed) shares this row and the same menu: `只显示未读` as a checkbox, then `全部标记为已读`, then the items of the scope. `全部标记为已读` is never disabled (LIB-READ-5) and acts on the clicked scope even when another scope is selected (LIB-MENU-2).

**Account menu.** The trigger opens the account menu; its items, the sign-out pending label and sign-out failure are [account.md](account.md).

**List pane.** The heading is one compact row: the scope's name — its feed or folder name, `目录` for a folder that is not loaded, `订阅` for a feed that is not loaded — with the scope's unread count beside it, on the left. On the right only `将已加载文章标为已读` and the `⋯` list menu. The list menu holds `只显示未读`, `全部标记为已读` (never disabled, LIB-READ-5), the add action of `稍后阅读` ([later.md](later.md) Messages), and `删除 RSS 源` for a single feed, which asks first ([feeds.md](feeds.md)). Folder rename and delete are only in the sidebar ([folders.md](folders.md)). `将已加载文章标为已读` is disabled according to LIB-READ-3.

**Rows.** Each row is full width with a hover surface and a selected surface, its height follows its content. It carries the source and, when the row has a publish time, the relative time at the right of that line (SKILL.md shared messages); the title over at most three lines; the summary over at most two. The read control sits at the left of the row, as a ring for read and a ring with a solid centre for unread, visible while hovering the row or focusing it, always visible on coarse pointers, and disabled while its own write is in flight. Activating the title opens the article; modified clicks are left to the browser (LIB-ROW-3).

**Paging.** LIB-LIST-1 and LIB-LIST-2 give the page size and the next page; the list is virtualized: only the visible rows and a small margin are rendered, and a row's height is measured after it is mounted.

**States.** The pane shows one of the states of LIB-STATE-1, each with the copy of its Messages row; the empty state's action is the one LIB-STATE-2 names.

**Toasts.** LIB-TOAST-1. Read marks report only failures; the success toasts of adding, saving and subscribing belong to [later.md](later.md) and [feeds.md](feeds.md).

**Unread counts.** The sidebar row of each scope and the heading of the selected scope show their count as LIB-COUNT-3 says.

**URL.** LIB-URL-1.

## API

No endpoint of its own. The list, count and mark-all of a scope are the endpoints of the scope's file, which owns their parameters, replies and errors; the screen only chooses which one to call (LIB-SCOPE-2).

| Scope | List | Unread count | Mark all |
| --- | --- | --- | --- |
| `稍后阅读` | `GET /api/saved-pages` ([later.md](later.md) API) | `GET /api/saved-pages/unread-count` (later.md) | `POST /api/saved-pages/read-all` (later.md) |
| `全部订阅` | `GET /api/feed-items` ([feeds.md](feeds.md) API) | `GET /api/feeds/unread-counts` (feeds.md) | `POST /api/feed-items/read-all` (feeds.md) |
| one feed | `GET /api/feeds/:feedId/items` (feeds.md) | `GET /api/feeds/unread-counts` (feeds.md) | `POST /api/feeds/:feedId/read-all` (feeds.md) |
| one folder | `GET /api/folders/:folderId/items` ([folders.md](folders.md) API) | `GET /api/feeds/unread-counts` summed over the folder's feeds (feeds.md) | `POST /api/folders/:folderId/read-all` (folders.md) |

- A list request carries `limit`, the filter and the cursor (LIB-LIST-2); paging, the cursor and the reply are CM-PAGE and the API conventions of [SKILL.md](SKILL.md).
- Marking the loaded rows is one request per row kind: `POST /api/saved-pages/read` with `{ids}` (later.md) for saved pages and `POST /api/feed-items/read` with `{ids}` (feeds.md) for feed items.
- A row's read control is the row's own domain endpoint ([later.md](later.md) `SP-READ`, [feeds.md](feeds.md) `FD-READ`); reading an open article marks it read through the same endpoint ([reader.md](reader.md)).
- The sidebar's feeds and folders come from `GET /api/feeds` and `GET /api/folders` ([feeds.md](feeds.md), [folders.md](folders.md)); the library reads them with the counts, on the first list and on a refresh. Such a request failing keeps the last values and shows one error toast, once, until the same request succeeds again.

## Messages

| Situation or error tag | Text |
| --- | --- |
| while the first page loads | `正在加载文章…` |
| first page failed, no rows — title | `暂时无法加载文章` |
| first page failed, no rows — hint | `请点击上方重试。` |
| retry of a failed page | `重试` |
| unread filter, no rows — title | `没有未读文章` |
| unread filter, no rows — hint | `所有文章都已读过了。` |
| unread filter, no rows — action | `查看全部文章` |
| heading mark-loaded | `将已加载文章标为已读` |
| heading list menu | `文章列表菜单` |
| list menu accessible name | `文章列表操作` |
| list heading accessible name | `<scope name>清单工具` |
| filter item | `只显示未读` |
| mark-all item | `全部标记为已读` |
| sidebar menu trigger, `稍后阅读` | `「稍后阅读」菜单` |
| sidebar menu trigger, `全部订阅` | `「全部订阅」菜单` |
| sidebar menu name, `稍后阅读` | `「稍后阅读」操作` |
| sidebar menu name, `全部订阅` | `「全部订阅」操作` |
| sidebar navigation name | `阅读导航` |
| sidebar reading sources name | `阅读来源` |
| sidebar count, accessible | `N 篇未读文章` |
| heading count, accessible | `N 篇未读` |
| mobile navigation toggle | `切换导航` |
| mobile breadcrumb | `留白 / <scope name>` |
| a scope's name in a heading when it is not loaded | `目录`, `订阅` |
| row read control, unread | `未读：<title>，点击标为已读` |
| row read control, read | `已读：<title>，点击标为未读` |
| row read control title, unread | `未读，点击标为已读` |
| row read control title, read | `已读，点击标为未读` |
| toast dismiss | `关闭` |
| failed read mark, failed mark-loaded, failed mark-all | the message of the error tag (SKILL.md shared messages) |

The copy of another domain stays in that domain's Messages: the add action, its dialog and the saved-page states of `稍后阅读` in [later.md](later.md); the `订阅源` section, its plus menu and the feed-item states in [feeds.md](feeds.md); the folder states in [folders.md](folders.md); the account menu, its items and the sign-out pending label and failure in [account.md](account.md).

## Acceptance

```gherkin
Feature: The library screen

  Rule: A scope lists through its own request, newest first, in pages of 30
    Scenario: Opening the library lists the newest rows first
      Given I am signed in
      When I open "/later"
      Then the list shows "正在加载文章…" until the first page arrives
      And the rows are ordered newest first
      And the heading shows "稍后阅读" with its unread count
      And the sidebar shows "稍后阅读" as the current scope

    Scenario: Each scope calls its own list request
      When I select "全部订阅"
      Then the list is requested from the all-items endpoint
      And the URL is "/all"
      When I select a feed
      Then the list is requested from that feed's items endpoint
      When I select a folder
      Then the list is requested from that folder's items endpoint
      And no list request carries the scope as a parameter

    Scenario: Selecting the scope that is already selected closes the open article
      Given an article of "全部订阅" is open at "/all/<itemId>"
      When I select "全部订阅" in the sidebar
      Then the URL is "/all" and the reader is empty
      And the list shows the same rows without a reload

    Scenario: The next page loads near the end of the list
      Given a scope has 30 loaded rows and more rows exist
      When I scroll to within 600 pixels of the end
      Then the next page is requested with the cursor of the last loaded row
      And its rows are appended after the loaded ones
      When the last page arrives with a null cursor
      Then scrolling further requests no page

    Scenario: A failed page keeps the rows already loaded
      Given a scope with 30 loaded rows
      When the next page fails
      Then the loaded rows stay
      And the error banner shows the message with "重试"
      When I press "重试"
      Then the next page is requested again with the same cursor
      And paging continues after it succeeds

    Scenario: A failed first page shows the error copy
      Given the first page of "稍后阅读" fails
      Then the list shows "暂时无法加载文章" and "请点击上方重试。"

  Rule: The list reloads only when the library is entered, a scope is selected, the filter changes or refresh is pressed
    Scenario: Entering the library reloads the current scope
      Given I reload the page on "/all"
      Then the library lists the first page of "全部订阅" and reloads the sidebar

    Scenario: Returning from an article does not reload
      Given I opened an article from a feed's list
      When I close the reader
      Then the list shows the same rows without a reload
      And the URL is the feed's list URL

    Scenario: A read mark does not reload the list
      Given a loaded row
      When I toggle its read control
      Then the row changes at once
      And the list is not requested again

    Scenario: A page that resolves after a filter change is discarded
      Given the list is loading with the filter off
      When I turn the filter on before that page arrives
      Then only the rows of the new filter are shown

  Rule: One unread filter is shared by all scopes
    Scenario: Turning on the filter from a scope menu
      When I open the menu of the selected scope and check "只显示未读"
      Then the list is requested again from the first page with unread only
      And the URL carries "?unread"

    Scenario: The filter is kept when switching scope
      Given the unread filter is on
      When I select "全部订阅"
      Then the all-items list is requested with unread only

    Scenario: An empty unread list restores all articles
      Given the unread filter is on and the scope has no unread row
      Then the list shows "没有未读文章" and "所有文章都已读过了。"
      When I press "查看全部文章"
      Then the filter is off and all rows of the scope are listed

    Scenario: A marked row stays listed until the list reloads
      Given the unread filter is on
      When I mark a loaded row read
      Then the row stays in the list, shown as read
      When I select another scope and come back
      Then the row is gone from the list

  Rule: Read state changes at once and rolls back on failure
    Scenario: Toggling the read control of a row
      Given an unread row in a scope with 3 unread rows
      When I activate its read control
      Then the row shows as read at once
      And the unread counts of the scope drop by one
      When I activate the control again
      Then the row shows as unread and the counts rise by one

    Scenario: A failed read mark rolls back
      Given an unread row
      When I mark it read and the request fails
      Then the row shows as unread again
      And an error toast shows the message of the failure
      And the unread counts are read again

    Scenario: A row being written cannot be marked again
      Given a read mark is in flight for a row
      Then that row's read control is disabled
      And the other rows can still be marked

    Scenario: Opening an unread article keeps its row as read
      Given an unread row
      When I open its title
      Then the reader shows the article and the URL names it
      And the row stays in the list, shown as read
      And the unread counts drop by one

  Rule: Marking the loaded rows
    Scenario: The loaded rows are marked in one request
      Given 40 loaded rows of which 12 are unread
      When I press "将已加载文章标为已读"
      Then one request carries the ids of the 12 unread rows
      And all 12 rows show as read
      And the unread counts of the scope drop by 12

    Scenario: The action is disabled when no loaded row is unread
      Given every loaded row is read
      Then "将已加载文章标为已读" is disabled

  Rule: Marking the whole scope
    Scenario: The whole scope is marked, including rows not loaded
      Given a scope with 40 unread rows of which 30 are loaded
      When I choose "全部标记为已读" in the list menu
      Then the scope's mark-all endpoint is called once
      And the loaded unread rows show as read at once
      And the scope's unread count goes to zero

    Scenario: A stale counter does not disable marking the whole scope
      Given the scope's unread count is zero but a loaded row is unread
      Then "全部标记为已读" is enabled
      When I choose it
      Then the scope's mark-all endpoint is called

    Scenario: A failed mark-all rolls back
      Given 5 loaded unread rows and an unread count of 9
      When "全部标记为已读" fails
      Then the 5 rows show as unread again
      And the counts are restored and read again
      And an error toast shows the message of the failure

  Rule: A scope menu acts on the scope it belongs to
    Scenario: Marking another scope read from the sidebar
      Given "稍后阅读" is selected with unread rows
      When I open the menu of "全部订阅" and choose "全部标记为已读"
      Then the URL is "/all"
      And everything in "全部订阅" is marked read
      And the unread count of "稍后阅读" is unchanged

    Scenario: A delayed menu action does not hit another scope
      Given I chose "全部标记为已读" in the menu of a feed and its list is still loading
      When I select another scope before the navigation settles
      Then the mark is not applied to the new scope

    Scenario: The filter item marks the checkbox of the shared filter
      Given the unread filter is off
      Then every scope menu shows "只显示未读" unchecked
      When I check it in the menu of one scope
      Then the menu of every scope shows it checked

  Rule: The list's states
    Scenario: An empty saved-page scope invites adding a link
      Given "稍后阅读" has no pages
      Then the list shows "留一篇，慢慢读" and "保存感兴趣的文章链接，在这里专注阅读。"
      When I press "新增文章链接"
      Then the add dialog opens

    Scenario: An empty all-items scope points at the sidebar
      Given no feed has items
      Then the list shows "从一个订阅源开始" and "添加 RSS 订阅，让新的文章汇集到这里。"
      And it offers no action

  Rule: The URL restores the screen
    Scenario: Reloading restores the scope, the filter and the article
      Given I opened an article in a folder's list with the unread filter on
      When I reload the page
      Then the folder's list is shown with the unread filter on
      And that article is open in the reader

    Scenario: An unknown id is not an error
      When I open a URL with a feed or folder id that does not exist
      Then that scope is selected and its list shows the scope's empty state
      And no error page is shown
      When I open a URL with an article id that does not exist
      Then the reader is empty, the list is unchanged and no error page is shown

  Rule: Small and intermediate screens
    Scenario: The mobile bar opens the navigation
      Given a small screen
      When I press "切换导航"
      Then the sidebar is shown and the toggle reports itself expanded
      When I select a scope
      Then the navigation closes and the list of that scope is shown

    Scenario: Reading replaces the list on an intermediate screen
      Given an intermediate screen with the sidebar and the list
      When I open an article
      Then the reader replaces the list
      When I close the reader
      Then the list is shown again

  Rule: Toasts
    Scenario: A toast dismisses by itself and on request
      When an error toast appears
      Then it sits at the bottom end of the screen and is announced as an alert
      When I press "关闭"
      Then it disappears at once
      Given a toast is showing for 6 seconds without being closed
      Then it disappears
```
