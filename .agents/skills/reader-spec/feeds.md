# Feeds and feed items

The feeds a user subscribes to and the items collected from them: preview, subscribe, unsubscribe, the feed-item lists, read state, unread counts and extracting an item. Refresh, selection, retention and the parser are in `feeds-refresh.md`; folders and moving a feed are in `folders.md`; the library screen as a whole (sidebar, article list, unread filter, paging, toasts) is in `library.md`; the reader pane is in `reader.md`; saving an item to read later is in `later.md`. A feed item and a saved page are independent: saving an item makes a copy.

## Rules

### FD-ID — Identity

- FD-ID-1 A feed's id is a new id (CM-ID), made when the feed is created. Feeds are unique per owner and URL: one owner follows a normalized URL at most once (the unique URL key, CM-ID-6). Two owners subscribing to one URL get two feeds.
- FD-ID-2 An item's id is a new id (CM-ID), made when the item is imported (FD-SYNC step 3). Items are unique per feed and URL: one item per feed for a normalized URL (CM-ID-6); the URL is the one the parser selects for the entry (FD-PARSE-2, FD-PARSE-3), so changing that selection would turn stored items into new ones. Title and description take no part in identity, so a source that edits them does not create a new item or reset its read state. Entries with the same URL collapse to the first one in source order (FD-SEL-1).
- FD-ID-3 The same URL in two feeds is two items.

### FD-PREVIEW — Preview a subscription

1. Fetch and parse the source (`fetchParsedFeed`, FD-FETCH).
2. Return the feed title, its description if any, and the titles of its entries.

- FD-PREVIEW-1 Nothing is stored. No subscription and no item is created.
- FD-PREVIEW-2 Errors are those of FD-FETCH.
- FD-PREVIEW-3 The title is returned as a `FeedTitle`. The client sends it back when subscribing (FD-SUB).

### FD-SUB — Subscribe

Input: `owner`, `url`, `title` — the title the user saw in the preview — and `folderId`, an `Option` of the folder to put the feed in. The boundary decodes the title as a `FeedTitle`: trimmed, empty becomes the URL's host. Nothing is fetched or synced by the use case, and it reads no clock.

1. Build the feed `{ ownerId: owner, url, title, folderId, updatedAt: none }`; its constructor makes a new id (CM-ID-3).
2. Create it with `FeedRepository.create`. If nothing was created: when `folderId` is some folder that `FolderRepository.find` does not return, fail `FolderNotFound(folderId)`; otherwise fail `FeedAlreadyExists(url)`.
3. Return the feed.

The HTTP layer enqueues the new feed for refresh after the use case succeeds (FD-SCHED-7) and returns at once. The client gets a feed with no items; the items appear when the user lists again after the first refresh.

- FD-SUB-1 A duplicate is found without any network call: the owner's unique URL key makes `create` skip the row (CM-ID-6, CM-PORT-6), so no lookup happens first.
- FD-SUB-2 Two requests subscribing at once create one feed: the unique URL key makes exactly one of them succeed; the other fails `FeedAlreadyExists`, naming the URL.
- FD-SUB-3 The title is the one from the preview until the first successful refresh, which replaces it with the source's title (FD-SYNC step 5).
- FD-SUB-4 A source with no entries gives a subscription with no items. Each refresh succeeds and imports nothing.
- FD-SUB-5 An address that is not a feed (the preview was bypassed) creates a feed that stays empty; each refresh logs a failure. Accepted.
- FD-SUB-6 With a folder, the feed is created in that folder. The folder check and the insert are one atomic write (FD-FOLDER-6); a folder that is not the owner's fails `FolderNotFound` and creates nothing. The folder is looked up only after `create` created nothing, to tell the two failures apart.
- FD-SUB-7 Subscribing to a URL the owner already follows fails `FeedAlreadyExists` and leaves the existing feed's folder unchanged, also when another folder of the owner was asked for. When the folder asked for does not exist for the owner, `FolderNotFound` takes precedence (step 2): feeds have no lookup by URL (CM-ID-7), and nothing is created or changed either way.

### FD-LIST — List items

There are three item lists: all items, the items of one feed, and the items of the feeds in one folder (the folder list is stated here because it shares the ordering and paging rules; the folder scope is in `folders.md`). Each takes `unread`, `limit` and an optional `cursor` and pages by CM-PAGE.

- FD-LIST-1 Each scope is one use case and one port call, with no branching on a scope value anywhere: listing all items lists the items of all of the owner's feeds (`listAll`), listing one feed only that feed's items (`listByFeed`), listing one folder the items of the feeds in that folder (`listByFolder`). No feed or folder is looked up first.
- FD-LIST-2 A `feedId` that does not exist, or is not the owner's, gives an empty page (CM-OWN-3).
- FD-LIST-3 Feeds themselves are listed by title ascending, then id ascending, titles compared in UTF-8 byte order (SQLite `BINARY`; test doubles must match); the client shows this order without sorting again.
- FD-LIST-4 Items are listed by `id` descending (CM-PAGE-1), so the newest item is on top; the single-feed and single-folder lists are that same order restricted to their scope.
- FD-LIST-5 Items keep their position while they are stored (CM-PAGE-10): a row's id never changes. An item that retention removes and a later sync imports again gets a new id: it is a new arrival, on top, and unread.
- FD-LIST-6 A folder lists the items of the feeds that are in it when the page is listed. A feed moved in or out between two pages changes the following pages; nothing checks a cursor against the scope (CM-PAGE-7).
- FD-LIST-7 A `folderId` that does not exist, or is not the owner's, gives an empty page (CM-OWN-3); so does an empty folder.

### FD-OPEN — Find one item

- FD-OPEN-1 `find(owner, id)` returns `Option.some(item)` or `Option.none()`. A missing item is a normal result, not an error.
- FD-OPEN-2 An item of another owner is reported as missing.
- FD-OPEN-3 No feed is looked up.

### FD-EXTRACT — Extract an item's article

1. Find the item for this owner, else `FeedItemNotFound`.
2. If it already has `extractedContent`, return the item. Nothing is fetched.
3. `fetchAndExtract(item.url)` (CM-FETCH).
4. Store the content with `FeedItemRepository.setExtractedContent(owner, item.id, content)` and return the item with it. If it returns `false`, the item vanished: fail `FeedItemNotFound`.

- FD-EXTRACT-1 Extraction failure or empty content fails the operation and stores nothing.
- FD-EXTRACT-2 Later requests reuse the stored content. Two requests at once may both fetch; each stores and returns what it extracted, and the last write wins.

### FD-READ — Read state

Each is a single port call, so there is no use case. They are listed separately because callers need them distinct:

| Operation               | Port call                              | Effect                                                                                       |
| ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Mark items (by id list) | `markRead(owner, ids, read)`           | Sets `read` on exactly those items. Used for single items and "the items loaded in the list" |
| Mark feeds              | `markReadByFeeds(owner, feedIds)`      | Sets `read = true` on every item of the given feeds                                          |
| Mark folders            | `markReadByFolders(owner, folderIds)`  | Sets `read = true` on every item of the feeds that are in the given folders when the call runs |
| Mark all                | `markAllRead(owner)`                   | Sets `read = true` on every item of every feed of the owner                                  |

- FD-READ-1 Marking unknown ids, or ids of another owner, succeeds and changes nothing.
- FD-READ-2 Marking feeds affects only feeds of the owner. Feed ids that are not the owner's are ignored.
- FD-READ-3 "Mark all unread articles read" across the library is not a Feed operation. The caller invokes this domain's "mark all" and the SavedPage domain's "mark all" separately.
- FD-READ-4 Marking is idempotent.
- FD-READ-5 Marking folders affects only folders of the owner, and only the feeds in them when the call runs; a feed that left the folder is unchanged. Folder ids that are not the owner's are ignored.

### FD-COUNT — Unread counts

- FD-COUNT-1 `unreadCounts(owner)` returns, per feed of the owner, the number of unread items. A feed with no unread items may be absent; absent means 0.
- FD-COUNT-2 The total is the sum over feeds.
- FD-COUNT-3 There is no count per folder in storage. A folder's unread count is the sum of the counts of the feeds whose `folderId` is that folder; the caller computes it from `unreadCounts` and the list of feeds.

### FD-UNSUB — Unsubscribe

- FD-UNSUB-1 Removes the listed feeds of the owner and, with them, all their items.
- FD-UNSUB-2 Ids that do not exist, or belong to another owner, succeed and change nothing.
- FD-UNSUB-3 Saved pages created from the feed's items stay.
- FD-UNSUB-4 Unread counts no longer include the removed feeds.
- FD-UNSUB-5 Subscribing again to the same URL creates a new feed with a new id. Its refresh runs on its own (FD-SCHED-2); a refresh of the old feed that is still running finds the old feed gone and creates nothing (FD-SYNC-5).

### FD-OWN — Ownership

- FD-OWN-1 Every operation is scoped to the session's owner (CM-OWN).
- FD-OWN-2 An unknown feed is never an error. An unknown item is an error only where the operation cannot go on without it (FD-EXTRACT, and SP-SAVE in `later.md`). An unknown folder is an error only where the operation cannot go on without it: renaming it, moving a feed into it and subscribing into it (FD-FOLDER-5, FD-MOVE-3, FD-SUB-6); listing, marking and removing treat it as absent.

Finding one item, marking items, marking feeds, marking folders, marking all, unread counts, listing feeds and unsubscribing are one port call each and have no use case. The contracts of `FeedRepository`, `FolderRepository` and `FeedItemRepository` are JSDoc on the port interfaces; write semantics are those of CM-PORT.

### Known risks

- A skipped feed create is classified by a lookup after the write (FD-SUB step 2). If the folder is removed between the write and the lookup, the error reported is `FolderNotFound` even when the URL was also taken. Both are failures and nothing was written, so this is accepted.

## Interface

### Sidebar `订阅源` section

- Feeds are rows under the section label `订阅源`; folders come first, then top-level feeds (the grouping and the folder rows are in `folders.md`; the sidebar frame is in `library.md`). A feed row shows the feed's title and, on the right, that feed's unread count (FD-COUNT-1); its `title` is the feed's address. Selecting the row opens `/feed/:feedId`.
- The feed row menu offers `只显示未读` and `全部标记为已读`, applied to the clicked feed, then `移动到目录` (only when at least one folder exists; `folders.md`) and `删除 RSS 源`.
- The plus button beside the `订阅源` label opens the add menu, whose subscribe entry opens this file's dialog (`folders.md`).
- With no feeds and no folders the section shows the empty-subscription hint of Messages.
- The `全部订阅` row's count is the sum of the feeds' unread counts (FD-COUNT-2). A feed's count drops to zero when its items are read and rises when a refresh imports unread items.

### The `新增 RSS 订阅` dialog

- Header `新增 RSS 订阅`, a description line, and one required URL field `网址` with its placeholder and hint, all worded in Messages. It is a native URL field marked required, so the browser blocks an empty or malformed value before any request, and an address the browser accepts but the server does not (for example `ftp://…`) is answered with its error toast. Enter submits the preview. There is no folder field here.
- `预览订阅` (pending `获取预览…`) previews; a failure shows its toast and keeps the dialog, the address and the form.
- On success the form is replaced by the preview panel (`订阅预览`): the feed title, its description when the source has one, the feed address, and the titles of at most the first three entries in source order. Below them come the folder choice (`folders.md`) and the buttons `确认订阅` (pending `订阅中…`, disabled while busy) and `返回修改`.
- `返回修改` drops the preview and shows the address form again with the address still filled in.
- `确认订阅` subscribes with the previewed URL and title and the chosen folder, closes the dialog, shows the success toast `订阅已添加` and opens the new feed at `/feed/:feedId`. That list is empty, with its empty state, until the first refresh brings items.
- When the address is already followed, the dialog closes, shows `该订阅已存在` (a success toast, not an error) and opens the existing feed. The existing feed is found by the address the `FeedAlreadyExists` error carries in the already loaded feed list; when it is not there the feed list is loaded once more; when it is still not there (removed meanwhile), the toast stays, the dialog closes and the current scope is left as it was. Its folder is unchanged (FD-SUB-7).
- Any other failure keeps the dialog and the preview open, shows the error toast and leaves the current reading scope as it was.
- Opening the dialog again resets the address, the preview and the folder choice.

### `全部订阅` (`/all`) and single-feed (`/feed/:feedId`) scopes

- `全部订阅` lists the items of all feeds, newest first (FD-LIST-4). The sidebar row and the list heading show `全部订阅`.
- A single-feed scope lists only that feed's items, newest first, and its heading is the feed's title with that feed's unread count. Its list overflow menu additionally offers `删除 RSS 源`; aggregates do not.
- Row source label: the title of the item's feed. When no feed row matches (a saved page, or a feed the list does not know yet) the label is the host of the item's address, and `稍后阅读` when there is none.
- Empty list: `全部订阅` and a single feed each have their own empty state in Messages; a single feed's says the feed has no items yet, because the user already follows it (the unread-filter empty state and the other scopes' copies are in `library.md`).
- Read state, marking, the unread filter and paging behave as in `library.md`; what is specific here is which operation each scope maps to (FD-READ): one feed's `全部标记为已读` marks every item of that feed, the list's mark-loaded action marks the loaded ids only, and `全部订阅` marks every item of the owner.
- Extracting an item never changes the list; the extracted article, its status line and re-extraction are in `reader.md` (FD-EXTRACT).

### Unsubscribing

- `删除 RSS 源` in the feed row menu and in the single-feed list menu, both targeting that feed without a picker.
- A `window.confirm` asks the question worded in Messages; cancelling changes nothing.
- Confirming removes the feed from the sidebar and its items with it in the same interaction, drops its unread count, and keeps saved pages (FD-UNSUB-3). When the removed feed was the open scope the list moves to `全部订阅` and reloads; otherwise the open list is left alone.
- There is no success toast. On failure the feed row, its count and its items come back and the error toast is shown.

## API

Every endpoint needs a session and the owner is the session's user (see API conventions in `SKILL.md`). `Feed`:

```json
{ "id": "FeedId", "ownerId": "OwnerId", "url": "https://…",
  "title": "…", "folderId": "FolderId?", "updatedAt": "ISO 8601?" }
```

`folderId` is omitted at the top level; `updatedAt` is omitted until the first successful sync. `FeedItem`:

```json
{ "id": "FeedItemId", "ownerId": "OwnerId", "feedId": "FeedId", "url": "https://…",
  "title": "…", "description": "<p>…</p>?", "content": "<p>…</p>?",
  "extractedContent": "<p>…</p>?", "publishedAt": "ISO 8601?", "read": false }
```

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/feeds` | — | 200 `{items: Feed[]}` | `FeedRepositoryError` 500 |
| POST | `/api/feeds/preview` | `{url: string}` | 200 `{preview: {url, title, description?, titles: string[]}}` | `FeedUrlInvalid` 400, `FetchFeedError` 422, `FeedParserError` 422 |
| POST | `/api/feeds` | `{url: string, title?: string, folderId?: FolderId}` | 201 `{item: Feed}` | `FeedUrlInvalid` 400, `FolderNotFound` 404 `{id}`, `FeedAlreadyExists` 409 `{url}`, `FolderRepositoryError` 500, `FeedRepositoryError` 500 |
| DELETE | `/api/feeds/:id` | `id` | 204 | `FeedRepositoryError` 500 |
| GET | `/api/feeds/unread-counts` | — | 200 `{items: [{feedId, count}]}` | `FeedItemRepositoryError` 500 |
| POST | `/api/feeds/:id/read-all` | `id` | 204 | `FeedItemRepositoryError` 500 |
| GET | `/api/feeds/:id/items` | `id`, `limit`, `unread`, `cursor?` | 200 `{items: FeedItem[], cursor: FeedItemId\|null}` | `FeedItemRepositoryError` 500 |
| GET | `/api/feed-items` | `limit`, `unread`, `cursor?` | 200 `{items: FeedItem[], cursor: FeedItemId\|null}` | `FeedItemRepositoryError` 500 |
| GET | `/api/feed-items/:id` | `id` | 200 `{item: FeedItem \| null}` | `FeedItemRepositoryError` 500 |
| PATCH | `/api/feed-items/:id` | `id`, `{read: boolean}` | 204 | `FeedItemRepositoryError` 500 |
| POST | `/api/feed-items/read` | `{ids: FeedItemId[]}` | 204 | `FeedItemRepositoryError` 500 |
| POST | `/api/feed-items/read-all` | — | 204 | `FeedItemRepositoryError` 500 |
| POST | `/api/feed-items/:id/extract` | `id` | 200 `{item: FeedItem}` | `FeedItemNotFound` 404 `{id}`, `ArticleEmptyContent` 422, `WebpageFetcherError` 422, `ArticleExtractorError` 422, `SettingRepositoryError` 500, `FeedItemRepositoryError` 500 |

- `GET /api/feeds` answers the owner's feeds ordered by title, then id (FD-LIST-3). It is not paged.
- `POST /api/feeds/preview` stores nothing (FD-PREVIEW-1). Its `preview.url` is the submitted address after normalization, not a redirect target; the client sends that address back when subscribing. `titles` holds every entry title in source order; the client shows the first three. It is a POST that changes nothing, so the origin check of the API conventions applies to it like to the other writes.
- `POST /api/feeds` takes the optional `title` from the preview (blank or absent becomes the address's host, FD-SUB) and the optional `folderId`; it enqueues a refresh of the new feed and answers 201 at once (FD-SUB, FD-SCHED-7). A duplicate answers 409 with the URL, so the client can find the existing feed (CM-ID-7).
- Moving a feed (`PATCH /api/feeds/:id`), the folder endpoints, the folder's item list and marking a folder's items read are in `folders.md`; saving an item (`POST /api/feed-items/:id/save`) is in `later.md`.
- The three item lists follow CM-PAGE: `limit` is a required positive integer, `unread` is a boolean defaulting to `false`, `cursor` is the id of the last row of the previous page. `GET /api/feed-items` is the `全部订阅` list, `GET /api/feeds/:id/items` the single-feed list; an unknown or foreign feed id answers an empty page, not an error (FD-LIST-2).
- `GET /api/feeds/unread-counts` answers one row per feed that has unread items (FD-COUNT-1); a feed that is absent counts as 0, and the client sums the rows for the `全部订阅` count and per folder (FD-COUNT-3).
- `PATCH /api/feed-items/:id` sets `read` to the given value, so it reads and unreads one item. `POST /api/feed-items/read` sets `read = true` on exactly the given ids (the items loaded in the list), `POST /api/feed-items/read-all` on every item of the owner, and `POST /api/feeds/:id/read-all` on every item of that feed. Unknown and foreign ids change nothing and still succeed (FD-READ-1, FD-READ-2); marking is idempotent (FD-READ-4).
- `GET /api/feed-items/:id` answers `{item: null}` for an unknown or foreign id (FD-OPEN). Nothing looks up the feed.
- `POST /api/feed-items/:id/extract` answers the item with `extractedContent`; a later request reuses it without fetching (FD-EXTRACT-2). An empty extraction is `ArticleEmptyContent`; a page that cannot be parsed is reported as `ArticleExtractorError`.

## Messages

| Situation or error tag | Text |
| --- | --- |
| `FeedUrlInvalid` | 请输入有效的订阅地址 |
| `FetchFeedError` | 无法获取订阅内容，请稍后重试 |
| `FeedParserError` | 无法解析订阅源，请确认地址正确 |
| `FeedAlreadyExists` (never shown as an error; the client opens the existing feed and shows it as the success toast below) | 该订阅已存在 |
| `FeedRepositoryError` | 暂时无法访问订阅，请稍后重试 |
| `FeedItemRepositoryError` | 暂时无法访问订阅文章，请稍后重试 |
| `FeedItemNotFound` | 文章不存在，可能已被删除 |
| Subscribe dialog title, RSS mode, and the add-menu entry that opens it | 新增 RSS 订阅 |
| Subscribe dialog description | 粘贴 RSS / Atom 链接，预览后确认订阅。 |
| Address field label, placeholder, hint | 网址 / 粘贴 RSS / Atom 链接… / 请输入有效的 http 或 https 链接 |
| Preview submit and its pending label | 预览订阅 / 获取预览… |
| Preview panel label | 订阅预览 |
| Confirm submit and its pending label | 确认订阅 / 订阅中… |
| Discard the preview | 返回修改 |
| Subscribe succeeded (toast) | 订阅已添加 |
| Section label above the feed rows | 订阅源 |
| Sidebar with no feeds | 尚未订阅。点击订阅源右侧的加号添加 RSS 源。 |
| Feed row menu and single-feed list menu: unsubscribe | 删除 RSS 源 |
| Confirmation before unsubscribing | 取消订阅并删除该源的文章？已保存的稍后阅读不会删除。 |
| Empty list of `全部订阅`: title | 从一个订阅源开始 |
| Its hint | 添加 RSS 订阅，让新的文章汇集到这里。 |
| Empty list of one feed: title (new) | 这个订阅源还没有文章 |
| Its hint (new) | 订阅源刷新后，新的文章会出现在这里。 |
| `全部订阅` sidebar row and list heading | 全部订阅 |

## Acceptance

```gherkin
Feature: Feeds and feed items
  To read articles from the sources I follow
  As a signed-in user
  I want to subscribe to feeds and read their articles in one place

  Background:
    Given I am signed in
    And I follow the feeds "Go Blog" and "Rust Blog"

  Rule: Previewing a subscription

    Scenario: The preview shows the source without storing it
      When I open "新增 RSS 订阅" and preview the address "https://example.com/feed.xml"
      Then the preview panel shows the feed title, its description, the address and the first three entry titles
      And no feed has been added to my subscriptions
      And no article has been stored

    Scenario: The address is not an http or https URL
      When I open "新增 RSS 订阅" and submit "ftp://example.com/feed.xml" with "预览订阅"
      Then the toast shows "请输入有效的订阅地址"
      And the dialog stays open with the address still in the field

    Scenario: The address cannot be parsed as a feed
      When I preview the address of a web page that is not a feed
      Then the toast shows "无法解析订阅源，请确认地址正确"
      And the dialog stays open with the form

  Rule: Subscribing

    Scenario: Confirming the preview adds the feed and opens it
      Given I have previewed a new feed titled "New Blog"
      When I click "确认订阅"
      Then the dialog closes
      And the toast shows "订阅已添加"
      And the feed "New Blog" is in the sidebar and selected
      And its article list is empty until its first refresh

    Scenario: Returning to edit keeps the address
      Given I have previewed a feed
      When I click "返回修改"
      Then the address form is shown again with the same address and no preview panel

    Scenario: Subscribing to a feed I already follow opens it
      Given "Go Blog" is in my subscriptions
      When I preview the address of "Go Blog" and confirm the subscription
      Then the toast shows "该订阅已存在"
      And the existing feed "Go Blog" is selected
      And its articles and its place in the sidebar are unchanged

    Scenario: The subscription fails
      Given the server cannot handle the request
      When I confirm a previewed subscription
      Then the dialog stays open with the preview
      And the error toast is shown
      And my current reading scope does not change

  Rule: Reading the item lists

    Scenario: All subscriptions list every feed's articles newest first
      When I open "全部订阅"
      Then the list shows the articles of both feeds with the newest on top

    Scenario: A feed's list holds only that feed's articles
      When I open the feed "Go Blog"
      Then the list shows the articles of "Go Blog" only
      And each row shows "Go Blog" as its source
      And the heading shows the title "Go Blog" and its unread count

    Scenario: An unknown feed in the URL is not an error
      When I open the address "/feed/00000000-0000-7000-8000-000000000000"
      Then the list is empty with the empty state
      And no error is shown

    Scenario: The sidebar shows each feed's unread count
      Given "Go Blog" has 3 unread articles and "Rust Blog" has 2
      When I open the reader
      Then the row of "Go Blog" shows "3" and the row of "Rust Blog" shows "2"
      And the row of "全部订阅" shows "5"

    Scenario: The empty all-subscription list points at the sidebar
      Given I follow no feeds and have no folders
      When I open "全部订阅"
      Then the list shows "从一个订阅源开始"
      And the sidebar shows "尚未订阅。点击订阅源右侧的加号添加 RSS 源。"

    Scenario: A feed without items yet
      Given I just subscribed to "Go Blog" and it has not been refreshed yet
      When I open "Go Blog"
      Then the list shows "这个订阅源还没有文章" and "订阅源刷新后，新的文章会出现在这里。"

  Rule: Read state

    Scenario: Toggling one article
      When I mark an article of "Go Blog" as read
      Then the article is shown as read and the unread count of "Go Blog" drops by one

    Scenario: Marking a read article unread again
      Given an article of "Go Blog" is read
      When I mark it as unread
      Then the article is shown as unread and the count of "Go Blog" rises by one

    Scenario: Marking the loaded articles read
      Given the list has loaded some unread articles
      When I mark the loaded articles as read
      Then exactly those loaded articles are read
      And the articles not loaded yet stay unread

    Scenario: Marking one feed read leaves other feeds alone
      When I choose "全部标记为已读" from the menu of "Go Blog"
      Then every article of "Go Blog" is read
      But the articles of "Rust Blog" keep their read state

  Rule: Extracting an article

    Scenario: The extracted article is stored and reused
      When I extract the article body of an item
      Then the reader shows the extracted content
      When I open another article and come back to it
      Then the reader shows the default content
      When I turn extraction on
      Then the extracted content is shown without fetching the page again

    Scenario: The article is gone
      Given the article was deleted in another window
      When I extract it
      Then the toast shows "文章不存在，可能已被删除"

  Rule: Unsubscribing

    Scenario: Confirming the removal
      When I choose "删除 RSS 源" from the menu of "Go Blog"
      Then I am asked "取消订阅并删除该源的文章？已保存的稍后阅读不会删除。"
      When I confirm
      Then "Go Blog" is gone from the sidebar with its articles
      And the unread counts no longer include it
      And the saved pages taken from its articles stay in "稍后阅读"

    Scenario: Cancelling the removal changes nothing
      When I choose "删除 RSS 源" from the menu of "Go Blog" and cancel the confirmation
      Then "Go Blog" and its articles are still there

    Scenario: Removing the feed I am reading returns to all subscriptions
      Given the current reading scope is the feed "Go Blog"
      When I remove "Go Blog" and confirm
      Then the reader shows "全部订阅" and its list is reloaded

    Scenario: The removal fails
      Given the server cannot handle the request
      When I remove "Go Blog" and confirm
      Then the feed row, its unread count and its articles come back
      And the error toast shows "暂时无法访问订阅，请稍后重试"
```
