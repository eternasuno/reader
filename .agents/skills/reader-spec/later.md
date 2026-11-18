# Saved pages (`稍后阅读`)

Pages a user saved from a link or copied from a feed item, to read later. Saved pages are independent of feed items: saving an item makes a copy, and afterwards neither side changes the other. This file owns the page itself, adding and saving, read state, removal and the unread count. The library screen, the list, paging, the unread filter, marking the loaded rows or the whole scope and the sidebar live in [library.md](library.md); the reader pane is [reader.md](reader.md); feed items and their URLs are [feeds.md](feeds.md); which fetcher reads a page is [settings.md](settings.md).

## Rules

### SP-ID — Identity

- SP-ID-1 A saved page's id is a new id (CM-ID). Each id is larger than the ids made before it in the same process, so the newest page sorts first (CM-ID-1).
- SP-ID-2 The same URL saved by two owners gives two pages. Each owner has at most one page per normalized URL: the repository enforces that with a unique key (CM-PORT-6).
- SP-ID-3 Title, description and content do not take part in identity.
- SP-ID-4 `SavedPageRepository.findByUrl(owner, url)` returns the owner's page with that URL, or none. It is how a duplicate is found before anything is fetched (SP-ADD-1, SP-SAVE-3), and it is the lookup the client uses to open the page that already exists instead of reporting an error (Interface).

### SP-ADD — Add a link

Input: `owner`, `url` (a `NormalizedUrl`).

1. `findByUrl(owner, url)` (SP-ID-4). If a page is found, fail `SavedPageAlreadyExists(url)`. Nothing is fetched.
2. `fetchAndExtract(url)` (CM-FETCH).
3. Build the page (unread); its constructor makes a new id (CM-ID-3). Create it and return it. If nothing was created, fail `SavedPageAlreadyExists(url)`.

- SP-ADD-1 A duplicate is detected before any fetching.
- SP-ADD-2 The saved `url` is the submitted normalized URL, not a redirect target.
- SP-ADD-3 Fetch, parse or extraction failure, or empty content, fails the operation and saves nothing.
- SP-ADD-4 `publishedAt` is the publish time reported by `fetchAndExtract`, or none when the page has none. A missing time stays none; nobody invents one (CM-FETCH-1).
- SP-ADD-5 If two requests add the same link at once, the unique URL key lets exactly one `create` succeed. The loser gets nothing created and fails `SavedPageAlreadyExists(url)`; no extra lookup is needed.

### SP-SAVE — Save a feed item

Input: `owner`, `itemId`.

Every feed item has a URL (feeds.md), so every item can be saved.

1. Find the item for this owner, else `FeedItemNotFound` (SP-SAVE-1).
2. `findByUrl(owner, item.url)`. If a page is found, fail `SavedPageAlreadyExists(url)`. Nothing is fetched.
3. Choose the content (SP-SAVE-8). `fetchAndExtract(item.url)` runs only when the item has neither extracted nor feed content.
4. Build the page (SP-SAVE-9, SP-SAVE-10); its constructor makes a new id (CM-ID-3). Create it and return it. If nothing was created, fail `SavedPageAlreadyExists(url)`.

- SP-SAVE-1 The item is looked up by owner and id only; no feed is looked up. An item that does not exist, or belongs to another owner, fails `FeedItemNotFound` and nothing is saved.
- SP-SAVE-2 The copy takes title and description from the item.
- SP-SAVE-3 Duplicate detection happens before any fetching.
- SP-SAVE-4 Saving does not change the feed item, and later changes to either side do not reach the other.
- SP-SAVE-5 `publishedAt` is the feed item's publish time, or none when the item has none.
- SP-SAVE-6 Fetch, parse or extraction failure, or empty content, fails the operation and saves nothing when the content must be fetched (SP-SAVE-8).
- SP-SAVE-7 A concurrent duplicate is handled as in SP-ADD-5: the unique URL key decides, and the loser fails `SavedPageAlreadyExists(url)`.
- SP-SAVE-8 Content priority: the item's extracted content; else its feed content; else the content of `fetchAndExtract(item.url)`. Nothing is fetched when the item has content.
- SP-SAVE-9 The copy is a new page with a new id: unread, `url` and `publishedAt` from the item (SP-SAVE-5), and its title and description from the item (SP-SAVE-2). Its id is larger than the ids of the pages saved before it in the same process, so it is on top.
- SP-SAVE-10 The item found in step 1 is used even if it is deleted (by retention or by unsubscribing) before the page is created; the save succeeds.

### SP-LIST — List

Input: `owner`, `unread`, `limit`, optional `cursor`. Paging follows CM-PAGE with `id` descending as the sort key.

- SP-LIST-1 Order is `id` descending, so the newest saved page is on top. A page just saved is at the top, however old the article is.
- SP-LIST-2 Only the owner's pages are ever returned.
- SP-LIST-3 Listing again from the first page applies `unread` afresh, so pages read since are absent under `unread = true` and pages saved since are at the top.

### SP-READ — Read state

Each operation is a single port call, so there is no use case. They are listed separately because callers need them distinct:

| Operation               | Port call                    | Effect                                                                                       |
| ----------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| Mark pages (by id list) | `markRead(owner, ids, read)` | Sets `read` on exactly those pages. Used for "the pages loaded in the list" and single pages |
| Mark all                | `markAllRead(owner)`         | Sets `read = true` on every page of the owner, loaded or not                                  |

- SP-READ-1 Marking unknown ids, or ids of another owner, succeeds and changes nothing.
- SP-READ-2 Marking is idempotent.
- SP-READ-3 "Mark all unread articles read" across the library is not a SavedPage operation. The caller invokes this domain's "mark all" and the Feed domain's "mark all" separately.

### SP-REMOVE — Remove

- SP-REMOVE-1 Removes the listed pages of the owner. Unknown ids, or ids of another owner, succeed and change nothing.
- SP-REMOVE-2 After removal the same URL can be added again: a new unread page with a new id, at the top of the list.

### SP-OPEN — Find one

- SP-OPEN-1 Returns `Option.some(page)` or `Option.none()`. A missing page is a normal result, not an error.
- SP-OPEN-2 Another owner's page is reported as missing.

### SP-COUNT — Unread count

- SP-COUNT-1 Returns the number of the owner's unread saved pages.

### SP-OWN — Ownership

- SP-OWN-1 Every operation is scoped to the owner passed in (CM-OWN).

Adding a link, saving a feed item and listing saved pages are the three use cases. Finding one page, finding by URL, marking read, marking all, removing and counting unread are one repository port call each, and their write semantics are the port contracts of CM-PORT. `FeedItemNotFound` belongs to the Feed domain (feeds.md); `ArticleEmptyContent` and the fetch and extraction errors belong to CM-FETCH-4.

## Interface

### The `稍后阅读` scope

- The scope is reached at `/later` and lists saved pages; `/later/:pageId` shows the same list with that page open in the reader. Rows, paging, the `只显示未读` filter, `全部标记为已读`, the heading and its unread count are library.md.
- A row's source label is the host of the page's URL (`example.com`), or `稍后阅读` when the URL cannot be read as one. The time is the page's publish time in the relative format of SKILL.md; a page without a publish time shows no time. The title is the stored title, the summary is the description as plain text in at most two lines (library.md).
- Empty state, no filter: `留一篇，慢慢读` with `保存感兴趣的文章链接，在这里专注阅读。` and the action `新增文章链接`, which opens the add dialog in article mode. With the unread filter on, the empty state is the shared one (library.md).
- The scope menu in the sidebar and the article-list overflow menu both offer `新增文章链接` for this scope; no other scope has an add action in a menu.

### Adding a link

- `新增文章链接` opens the shared dialog in article mode: title `新增文章链接`, the line `粘贴文章链接，保存到稍后阅读。`, one required URL field labelled `网址` with the hint `请输入有效的 http 或 https 链接` and the placeholder `粘贴文章链接…`, and the submit button `添加文章`. There is no preview step and no folder choice.
- Opening the dialog empties the field. Enter submits the form. Esc and the close button close it and return focus to the control that opened it.
- The field is a required URL field with the browser's native validation: an empty or clearly malformed value is refused before any request. An address that is a URL but not `http` or `https` reaches the server and fails `InvalidPageUrl`.
- While the request runs the field and the button are disabled and the button reads `添加中…`; the dialog stays open.
- Success: the dialog closes, the toast `文章已添加` appears, and the new page opens in the reader at `/later/:pageId`, so the later list is what shows behind it, with the new page on top. The page is created unread, and opening it marks it read like any opening ([reader.md](reader.md) RD-READ-1): the row stays in the list shown as read until the list reloads, so the unread filter drops it on the next load (LIB-FILTER-3). The count of the scope grows by one when the page is created and drops back when the opening marks it read. This holds wherever the dialog was opened, including from a feed or folder scope.
- A link that is already saved is opened, not reported: the server answers `SavedPageAlreadyExists` with the normalized URL, and the client looks that URL up (SP-ID-4). When a page is found it opens in the reader at `/later/:pageId`, as if it had just been added; the dialog closes and no toast appears.
- When that lookup finds nothing, the toast `该文章已在稍后阅读中` appears and nothing opens. When the lookup request itself fails, the toast of that failure appears and nothing opens. In both cases the dialog stays open with the typed link, so submitting again is possible.
- Any other failure keeps the dialog open with the typed link and shows the toast of the error (see Messages). Nothing is saved.

### Saving a feed item to later

- The reader header of a feed item has the action `保存到稍后阅读`; a saved page has no such action (reader.md has the rest of the header).
- The reader stays on the feed item afterwards: the item is unchanged (SP-SAVE-4), the copy is unread (SP-SAVE-9), and the row appears in the `稍后阅读` list on its next load, at the top.
- Success shows the toast `已保存到稍后阅读`, and the scope's count grows at once.
- Saving an item whose page was already saved fails `SavedPageAlreadyExists`: the toast `该文章已在稍后阅读中` appears, nothing opens, and the reader stays on the item. The duplicate page is not opened here; only adding a link does that.
- An item that no longer exists shows `文章不存在，可能已被删除`.

### Removing a saved page

- A saved page's reader overflow menu has a destructive `删除`, separated from the other entries. Choosing it asks for confirmation first (Messages); cancelling changes nothing. Feed items have no delete entry.
- Removing drops the row from the list immediately.
- Success: the reader closes, the selection is cleared and the list shows without the row (`/later`, keeping `?unread` when the filter is on). The scope's count drops by one only when the removed page was unread.
- Failure: the row returns to its place in the list, a count the removal had lowered is read again, the page stays open and the toast of the error appears.
- A removed link can be added again and comes back as a new unread page at the top (SP-REMOVE-2).

### Content and reading

- A saved page carries exactly one content, so its reader shows it in place of the body and treats it as the extracted text as well: the extract action never fetches for a saved page (reader.md).
- Opening a saved page marks it read, like any article; the list behaviour around that is library.md.

## API

The boundary adds 400 for a request that does not decode, 401 without a session, 403 for a cross-origin write and 500 `AuthUnavailable` (API conventions in SKILL.md). No endpoint of this domain takes an owner.

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/saved-pages` | query `limit` (required positive integer), `unread` (boolean, default `false`), `cursor` (optional page id) | 200 `{items: SavedPage[], cursor: string \| null}` | `SavedPageRepositoryError` 500 |
| GET | `/api/saved-pages/unread-count` | — | 200 `{count: number}` | `SavedPageRepositoryError` 500 |
| GET | `/api/saved-pages/lookup` | query `url` (any string) | 200 `{item: SavedPage \| null}` | `SavedPageRepositoryError` 500 |
| GET | `/api/saved-pages/:id` | path `id` (page id) | 200 `{item: SavedPage \| null}` | `SavedPageRepositoryError` 500 |
| POST | `/api/saved-pages` | JSON `{url: string}` | 201 `{item: SavedPage}` | `InvalidPageUrl` 400, `SavedPageAlreadyExists` 409 (`url`), `ArticleEmptyContent` 422, `WebpageFetcherError` 422, `ArticleExtractorError` 422, `SettingRepositoryError` 500, `SavedPageRepositoryError` 500 |
| POST | `/api/feed-items/:id/save` | path `id` (feed item id) | 201 `{item: SavedPage}` | `FeedItemNotFound` 404 (`id`), `SavedPageAlreadyExists` 409 (`url`), `ArticleEmptyContent` 422, `WebpageFetcherError` 422, `ArticleExtractorError` 422, `SettingRepositoryError` 500, `FeedItemRepositoryError` 500, `SavedPageRepositoryError` 500 |
| PATCH | `/api/saved-pages/:id` | path `id`, JSON `{read: boolean}` | 204, no body | `SavedPageRepositoryError` 500 |
| POST | `/api/saved-pages/read` | JSON `{ids: string[]}` | 204, no body | `SavedPageRepositoryError` 500 |
| POST | `/api/saved-pages/read-all` | no body | 204, no body | `SavedPageRepositoryError` 500 |
| DELETE | `/api/saved-pages/:id` | path `id` | 204, no body | `SavedPageRepositoryError` 500 |

The extraction failures are `ArticleEmptyContent`, `WebpageFetcherError` and `ArticleExtractorError`; a page that cannot be parsed is answered as `ArticleExtractorError`, as CM-FETCH-4 in [SKILL.md](SKILL.md) maps it, so no endpoint lists `HtmlParserError`.

The SavedPage JSON shape (SP-ADD, SP-SAVE, SP-OPEN):

- `id` — the page id (CM-ID).
- `ownerId` — the owner (CM-OWN-1).
- `url` — the normalized URL as a string (CM-URL); the submitted URL for an added link (SP-ADD-2), the item's URL for a copy (SP-SAVE-9).
- `title` — the article title, trimmed; a blank title is stored as `Untitled` (CM-ART-1).
- `description` — optional, absent when the article has none or it is blank (CM-ART-3); sanitized HTML (CM-ART-4).
- `content` — required and never blank (CM-ART-5); sanitized HTML (CM-ART-4).
- `publishedAt` — optional ISO 8601 date-time, absent when the article has none (SP-ADD-4, SP-SAVE-5). Display only: no rule reads it.
- `read` — boolean, `false` when the page is created.

Behavior of the endpoints:

- `POST /api/saved-pages`: the body's `url` must be a string; a missing field or another type is a structural failure, 400 with an empty body (SKILL.md API conventions), while a string that is not a usable `http`/`https` address is the domain failure `InvalidPageUrl`, 400 with that tag (CM-URL-1). The fetch and extraction run inside the request, with the owner's fetcher setting read for it (CM-FETCH-2), which is why `SettingRepositoryError` can appear. The 409 carries the normalized URL, so the client can look the page up; `SavedPageAlreadyExists` is also the answer when the unique key lost a race (SP-ADD-5).
- `GET /api/saved-pages/lookup`: `url` is a plain string, and a string that does not decode as a normalized URL is not an error — the answer is `{item: null}`. This is the endpoint the client uses after `SavedPageAlreadyExists`, with the URL the error carries.
- `POST /api/feed-items/:id/save`: the article is fetched only when the item has no content (SP-SAVE-8), so `SettingRepositoryError`, the fetch and the extraction errors appear only then. `FeedItemRepositoryError` is the item lookup, `SavedPageRepositoryError` the page lookup and create.
- `GET /api/saved-pages/:id` answers `{item: null}` for an unknown id and for another owner's page (SP-OPEN-1, SP-OPEN-2).
- `PATCH /api/saved-pages/:id` sets `read`; `POST /api/saved-pages/read` sets `read = true` on the listed ids; `POST /api/saved-pages/read-all` sets `read = true` on every page of the owner. All three are idempotent and ignore unknown and foreign ids (SP-READ-1, SP-READ-2).
- `DELETE /api/saved-pages/:id` removes the page; an unknown or foreign id is a success that changes nothing (SP-REMOVE-1).
- Adding, saving, removing and marking move the unread count; the client reads `unread-count` again after each of them, so the count of the scope follows at once (LIB-COUNT-2). How the list itself is updated is library.md.

## Messages

| Situation or error tag | Text |
| --- | --- |
| `InvalidPageUrl` | 请输入有效的 http 或 https 链接 |
| `SavedPageAlreadyExists` | 该文章已在稍后阅读中 |
| `SavedPageRepositoryError` | 暂时无法访问稍后阅读，请稍后重试 |
| adding a link succeeded | 文章已添加 |
| saving a feed item succeeded | 已保存到稍后阅读 |
| add dialog title, and its action in the sidebar menu, the list menu and the empty list | 新增文章链接 |
| add dialog description | 粘贴文章链接，保存到稍后阅读。 |
| add dialog URL field label | 网址 |
| add dialog URL field hint | 请输入有效的 http 或 https 链接 |
| add dialog URL field placeholder | 粘贴文章链接… |
| add dialog submit | 添加文章 |
| add dialog submit while adding | 添加中… |
| later list empty state title | 留一篇，慢慢读 |
| later list empty state hint | 保存感兴趣的文章链接，在这里专注阅读。 |
| list row source fallback when the URL cannot be read | 稍后阅读 |
| reader action saving a feed item | 保存到稍后阅读 |
| reader overflow entry on a saved page | 删除 |
| confirmation before removing a saved page (new) | 删除这篇稍后阅读？删除后无法恢复。 |

## Acceptance

```gherkin
Feature: Saved pages

  Rule: A link is added to the later list

    Scenario: Adding a link from the "稍后阅读" scope menu
      Given the user is on a scope other than "稍后阅读"
      When the user chooses "新增文章链接" from the "稍后阅读" row menu
      And the user submits a link whose page can be extracted
      Then the dialog closes
      And the toast "文章已添加" appears
      And the extracted page is open in the reader at "/later/<pageId>"

    Scenario: Adding a link from the article-list menu and from the empty list
      Given the later list is empty
      When the user clicks the empty state action "新增文章链接" and adds a link
      Then the page is saved and opens exactly as from the scope menu
      When the user clicks "新增文章链接" in the article-list overflow menu instead
      Then the same article-mode dialog opens, with no feed preview

    Scenario: The added page is created unread and opening it marks it read
      Given the unread filter is on and no saved page is unread
      When the user adds a link
      Then the new page is created unread and is the first row of the later list
      And opening it marks it read, so the row stays listed as read until the list reloads
      And the unread count of "稍后阅读" is back to zero

    Scenario: The dialog keeps the typed link while the request runs
      Given the user pasted a link into "新增文章链接"
      When the user submits the form
      Then the field and the button are disabled and the button reads "添加中…"
      And the dialog stays open until the answer arrives

    Scenario: Adding a link that is already saved opens the existing page
      Given the user already saved the page at "https://example.com/post"
      When the user adds "https://example.com/post?utm_campaign=x"
      Then the existing page opens in the reader
      And no toast appears and the dialog closes

    Scenario: Adding a link that is already saved fails to be looked up
      Given the user already saved that page
      And the lookup of the page by URL fails
      Then the toast of the lookup error appears
      And nothing opens and the dialog stays open with the typed link

    Scenario: Adding a link that is not a usable address
      When the user submits "ftp://example.com/post"
      Then the toast "请输入有效的 http 或 https 链接" appears
      And the dialog stays open and nothing is saved

    Scenario: Adding a link whose page cannot be read
      Given the page cannot be fetched, parsed or extracted, or has no content
      When the user adds its link
      Then the toast of that error appears
      And the dialog stays open and no page is saved

    Scenario: Two adds of one link at once
      Given two requests add the same link at the same moment
      Then exactly one page is created
      And the other request answers that the article is already in "稍后阅读"

  Rule: A feed item is saved to later

    Scenario: Saving an open feed item
      Given a feed item is open in the reader
      When the user clicks "保存到稍后阅读"
      Then the toast "已保存到稍后阅读" appears
      And the reader still shows the feed item, unchanged
      And an unread saved page with the item's title, description and publish time exists

    Scenario: The saved page is listed only in "稍后阅读"
      Given the user saved a feed item while reading "全部订阅"
      Then the item list does not show the new page
      And the later list shows it on top when the user enters "稍后阅读"
      And the unread count of "稍后阅读" is one higher

    Scenario: Saving an item that has no content
      Given a feed item has neither extracted nor feed content
      When the user saves it
      Then the page's content is fetched from its URL

    Scenario: Saving a feed item that is already saved
      When the user clicks "保存到稍后阅读" for an item whose page exists
      Then the toast "该文章已在稍后阅读中" appears
      And no page opens and the reader stays on the item

    Scenario: Saving an item that no longer exists
      Given the item was removed with its feed
      When the user saves it
      Then the toast "文章不存在，可能已被删除" appears

    Scenario: The item disappears while it is being saved
      Given the item is removed by a refresh while its save is running
      Then the save still succeeds and the page is created

    Scenario: Saving a page with no publish time
      Given an article or feed item has no publish time
      Then the saved page has no publish time and the list row shows no time

  Rule: The later list shows the owner's pages

    Scenario: Rows of the later list
      Then each row shows the title, the description in at most two lines, the host of the page's URL as its source and the relative publish time
      And the source reads "稍后阅读" when the URL cannot be read as one

    Scenario: Another account's pages are invisible
      Given another account saved pages
      Then this account's later list does not contain them
      And opening or removing one of their ids changes nothing

    Scenario: The empty later list
      Given the account has no saved page and the unread filter is off
      Then the list shows "留一篇，慢慢读" and "保存感兴趣的文章链接，在这里专注阅读。"
      And the action "新增文章链接" opens the add dialog

    Scenario: Listing the later scope again after reading
      Given the user read a saved page while the unread filter was on
      When the list loads again from the first page
      Then the page is absent from the list
      And a page saved since is the first row

  Rule: Read state of saved pages

    Scenario: Marking the loaded pages read
      When the user presses the mark-loaded action on the later list
      Then exactly the loaded saved pages become read

    Scenario: Marking all saved pages read
      Given the later list has more pages than are loaded
      When the user chooses "全部标记为已读" for "稍后阅读"
      Then every saved page of the account is read, loaded or not
      And the unread count of "稍后阅读" is zero

    Scenario: Marking an unknown page read
      Given the id does not belong to a saved page of this account
      When the client marks it read or unread
      Then the request succeeds and nothing changes

    Scenario: Marking the same page read twice
      When the client marks one saved page read twice
      Then both requests succeed and the page stays read

  Rule: Removing a saved page

    Scenario: Removing the open saved page
      Given a saved page is open in the reader
      When the user chooses "删除" in the reader overflow menu
      And confirms the deletion
      Then the row leaves the list at once
      And the reader closes and the later list shows without the row
      And the unread count drops by one when the page was unread

    Scenario: Cancelling the removal
      Given a saved page is open in the reader
      When the user chooses "删除" in the reader overflow menu
      And cancels the confirmation
      Then nothing is removed and the page stays open

    Scenario: Removal fails
      Given the delete request fails
      Then the row returns to its place in the list
      And the page stays open and the toast of the error appears
      And an unread count the removal had lowered is read again

    Scenario: Adding a removed link again
      Given the user removed a saved page
      When the user adds the same link again
      Then a new unread page with a new id is created on top of the list
```
