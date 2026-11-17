# The reader pane

The reader shows one article next to the article list: a saved page at `/later/:pageId` or a feed item at `/all/:itemId`, `/feed/:feedId/:itemId` and `/folder/:folderId/:itemId`. It covers the reader's own screen behavior: which article it shows, the content it shows by default, the extracted mode, the embedded web page, navigation, the read toggle and the empty state, and it places the save and delete actions whose behavior is [later.md](later.md). It has no rules of its own about what is stored or how it is produced: the article, its content, extraction, saving and read state are defined in [feeds.md](feeds.md), [later.md](later.md) and [library.md](library.md). Routes are in [SKILL.md](SKILL.md).

## Rules

The reader has no business rules. It depends on these:

- FD-OPEN — the feed item the reader shows is found by id; a missing item is not an error.
- FD-EXTRACT — extraction of a feed item, its cached content and its errors.
- SP-OPEN — the saved page the reader shows is found by id; a missing page is not an error.
- SP-SAVE — saving the open feed item to later reading.
- FD-READ, SP-READ — marking the open article read.
- CM-HTML, CM-ART-4 — the stored description and content are sanitized HTML, so the reader always renders stored HTML, never raw feed text.

Its own screen behavior:

### RD-ARTICLE — Which article is open

- RD-ARTICLE-1 The open article is named by the URL and by nothing else: `/later/:pageId` is a saved page, `/all/:itemId`, `/feed/:feedId/:itemId` and `/folder/:folderId/:itemId` are feed items. The same reader serves all four routes.
- RD-ARTICLE-2 When the URL's id changes, the article is fetched again (FD-OPEN, SP-OPEN). A row already loaded in the list is shown at once while the fetch runs; the fetched article replaces the shown one when it arrives. An article reached only through the URL, whose row is not in the loaded list, lives in the reader alone: it is not inserted into the list, which keeps the rows it loaded.
- RD-ARTICLE-3 A fetch that answers with no item (unknown id, or a row of another owner, CM-OWN-3) leaves the reader empty (RD-EMPTY) and leaves the list unchanged.
- RD-ARTICLE-4 A fetch that fails shows the error toast and leaves the reader as it was: the row already known from the list keeps being shown, otherwise the reader stays empty.
- RD-ARTICLE-5 Only the newest navigation counts. A fetch, an extraction or another write whose article is no longer the open one does not change what the open article shows.

### RD-CONTENT — Default content

- RD-CONTENT-1 The default content is the stored content; when the article has none, its description; when it has neither, the content area shows `暂无内容`.
- RD-CONTENT-2 The default content is the article's stored sanitized HTML (CM-ART-4), untouched: the reader sanitizes nothing again and cleans, rewrites or refetches nothing. It is rendered in an isolated frame, which applies only a presentation transform of its own (RD-FRAME-5).
- RD-CONTENT-3 Above the content the reader shows the article title, linked to the article's URL and opening it in a new tab, and below it the source hostname, also a link to the URL with the full URL as its tooltip. Neither is shown for an article without a URL.
- RD-CONTENT-4 The original content is what the reader shows by default; there is no `原文` mode in the overflow menu. The only ways to the original page are `打开原文` (RD-WEBPAGE-2) and the title link (RD-CONTENT-3).

### RD-EXTRACT — Extracted content

- RD-EXTRACT-1 Extraction is an independent icon in the header action row, immediately before the overflow menu; it is not a menu item and there is no second action row below the header.
- RD-EXTRACT-2 While the reader shows default content the icon is the outline icon, labelled `提取正文`. While it shows extracted content the icon is the solid icon in the accent (purple) and exposes its pressed state, labelled `切换回原文`.
- RD-EXTRACT-3 Turning extraction on when the article already has extracted content (FD-EXTRACT-2) shows it at once and calls nothing.
- RD-EXTRACT-4 Turning extraction on without extracted content requests extraction (FD-EXTRACT): the icon is replaced by a spinner and the status line `正在提取正文…` is announced; the control cannot be used again while it runs.
- RD-EXTRACT-5 The first extraction switches the reader to the extracted view only after the returned article replaces the open one; the reader never shows an empty extracted view while waiting.
- RD-EXTRACT-6 Turning extraction off returns to the default content (RD-CONTENT) and changes nothing on the server; the stored extracted content is kept and reused the next time (FD-EXTRACT-2).
- RD-EXTRACT-7 A failed extraction stores nothing and leaves the reader in the mode it had before the attempt, because the extracted mode is entered only after a successful answer (RD-EXTRACT-5): the spinner ends and the error toast shows the CM-FETCH-4 wording (Messages).
- RD-EXTRACT-8 Choosing a different article while an extraction runs abandons its result: the late result changes neither the new article's mode nor its controls, and the new article starts on the default content.
- RD-EXTRACT-9 Extraction and the embedded-page item are both disabled for an article without a URL and while an extraction runs (RD-EXTRACT-4), and `打开原文` is not shown for an article without a URL.

### RD-MODE — What a switch of article does to the mode

- RD-MODE-1 Changing the open article resets the view to the default content and stops any extraction state.
- RD-MODE-2 A change of the same article's content — the fetched article, a stored extracted content, a read mark — keeps the current mode; only a different article id resets it.
- RD-MODE-3 The reader's mode is not part of the URL: reloading the reader shows the default content again.

### RD-WEBPAGE — Embedded web page

- RD-WEBPAGE-1 `嵌入式网页视图` is a checkbox item in the header overflow menu; it is unchecked while the reader shows article content. Checking it shows the original page, unchecking returns to the default content.
- RD-WEBPAGE-2 The embedded view fills the reader below the header: a notice bar with `部分网站不允许内嵌或需要登录；若显示异常，请打开原文。`, where `打开原文` is a link that opens the page in a new tab, and below it the page itself.
- RD-WEBPAGE-3 The page loads in a sandboxed frame from its own address, with scripts, forms, popups and same-origin access allowed inside the frame and no referrer sent to the site. The reader header stays visible and usable, so the user can always uncheck the item and leave the view.
- RD-WEBPAGE-4 The view is offered only for an address that can be embedded safely: an `http`/`https` URL without a user name or password that does not point at the app itself. The item is disabled as RD-EXTRACT-9 says; for an address that cannot be embedded safely the area shows `此地址不支持安全内嵌，请使用上方链接打开原文。` instead of a frame, and `打开原文` remains available.
- RD-WEBPAGE-5 Choosing extraction while the embedded page is shown leaves the embedded view and shows the extracted content (RD-EXTRACT-5).

### RD-FRAME — How article HTML is rendered

- RD-FRAME-1 Article HTML renders in a frame whose document is built on every render: the content is placed in a document that is sandboxed without same-origin access to the app, and the app's own stylesheet is linked into it so the article follows the reader's typography.
- RD-FRAME-2 The framed document carries a Content-Security-Policy: no default sources at all, images only from `https:` and `http:`, styles only from inline and the app's own origin, scripts only with the document's nonce, no base URI and no form submission.
- RD-FRAME-3 Each rendered document gets a new script nonce and a new random secret. The document reports its body height to the app with that secret, and the app accepts a measurement only from that frame's own window, carrying the secret, of a finite height between 1 and 1 000 000; every other message is ignored.
- RD-FRAME-4 The frame starts as a tall scrollable area (65% of the viewport height) and takes the reported height once it is measured, so the whole article is readable by scrolling the reader pane.
- RD-FRAME-5 The frame applies a presentation transform to the stored HTML, which is not sanitized again (CM-ART-4, RD-CONTENT-2): every class of the source is removed, and each element gets one fixed class of its own by kind — headings, paragraphs, lists, quotes, code blocks, tables and media — so article text renders in the reader's own typography whatever the source page used.
- RD-FRAME-6 Links stored in the content open in a new tab (CM-HTML-3), so following one leaves the frame; images load over `https:` or `http:`.

### RD-READ — Read state of the open article

- RD-READ-1 Opening an unread article marks it read (FD-READ, SP-READ). The mark is optimistic, and the row stays in the list shown as read until the list reloads (see [library.md](library.md)).
- RD-READ-2 The header's read control shows the article's state and offers the opposite: `标为已读` for an unread article, `标为未读` for a read one. It uses the same read indicator as the list: an empty ring for read, a ring with a solid centre for unread.
- RD-READ-3 A failed read write rolls the state back and shows the error toast.

### RD-NAV — Moving between articles

- RD-NAV-1 Previous and next follow the order of the loaded list of the current scope: `上一篇` is the row above the open article, `下一篇` the row below it. At the first row previous is disabled, at the last row next is disabled.
- RD-NAV-2 Both are disabled when the open article has no neighbour in the loaded list, which includes an article that is not in the loaded list at all, for example one reached by a direct link (RD-ARTICLE-2).
- RD-NAV-3 Previous and next open the neighbour exactly as the list does: it becomes the open article, its URL replaces the current one, and an unread article is marked read (RD-READ-1).
- RD-NAV-4 `返回文章列表` returns to the list of the current scope: `/later`, `/all`, `/feed/:feedId` or `/folder/:folderId`, with no article open. On narrow layouts, where the reader replaces the list, this is the only way back to the list.

### RD-SAVE — Save to later reading

Placed by this screen, defined by [later.md](later.md) (Saving a feed item to later).

- RD-SAVE-1 The header offers `保存到稍后阅读` for a feed item only; a saved page has no such control.
- RD-SAVE-2 Saving leaves the reader on the feed item, which is unchanged and unaffected by later changes on either side (SP-SAVE-4); it shows later.md's success toast and raises the `稍后阅读` count.
- RD-SAVE-3 An item whose URL is already saved shows later.md's duplicate toast, creates nothing and leaves the reader on the item.

### RD-DELETE — Delete a saved page

Placed by this screen, defined by [later.md](later.md) (Removing a saved page).

- RD-DELETE-1 `删除` is an item of the header overflow menu, in the destructive color, shown for a saved page only; a feed item has no delete.
- RD-DELETE-2 Confirmation, removal and failure behavior are later.md's (Removing a saved page); there is no success toast, and after the removal succeeds the reader returns to the list of the current scope (RD-NAV-4).
- RD-DELETE-3 A failed removal keeps the page open (later.md, Removing a saved page).

### RD-EMPTY — No article open

- RD-EMPTY-1 With no article open, the reader shows the icon, the line `给阅读留一点空间` and the line `从左侧选择一篇文章，开始阅读`.
- RD-EMPTY-2 An unknown id in the URL, an id of another owner, or an article that disappeared shows this empty reader. It is not an error page and no error toast is shown for an id that simply does not exist.

### RD-ROUTE — The URL follows the reader

- RD-ROUTE-1 Opening an article, and moving with previous or next, writes that article's URL, so a reload, a shared link and a history step all restore the same article.
- RD-ROUTE-2 The route also decides the scope beside the reader: a saved page is read next to `稍后阅读`, a feed item next to the list of its route's scope.
- RD-ROUTE-3 A browser history step between two articles shows the article of that step, and a step back to a list route shows the empty reader.

## Interface

**Header.** One row above the content, labelled `文章操作`, present in every mode so the reader can always be left and the mode changed. Its text and states are the ones RD-READ-2, RD-EXTRACT-2 and RD-EXTRACT-4 describe.

- Left: `返回文章列表`, then `上一篇`, then `下一篇`, disabled as RD-NAV-1 and RD-NAV-2 say.
- Right: `保存到稍后阅读` for a feed item (RD-SAVE), the read toggle (RD-READ-2), the extraction icon (RD-EXTRACT), the overflow trigger `更多操作` opening the menu labelled `更多文章操作`.
- Overflow menu: `嵌入式网页视图` as a checkbox item (RD-WEBPAGE-1), `打开原文` opening a new tab (RD-CONTENT-4), then, for a saved page only, `删除` in the destructive color (RD-DELETE-1). There is no `原文` item (RD-CONTENT-4).
- While a write for the open article is in flight, its save, read and delete controls are disabled.

**Content.** One centered reading-width column that scrolls: the title and the source line (RD-CONTENT-3), then the article HTML in the isolated frame (RD-FRAME), with the fallbacks and the `暂无内容` state of RD-CONTENT-1.

**Embedded page.** The header stays; below it the notice bar of RD-WEBPAGE-2 and the page in its frame, or, for an address that cannot be embedded, that rule's notice in its place (RD-WEBPAGE-4).

**Empty reader.** The icon and the two lines of RD-EMPTY-1, centered in the reader column.

**Layout.** The reader takes the place the layout gives it (LIB-VIEW). A panel hidden by a narrow layout keeps its state: the reader keeps a list that is scrolled and a mode that is set, and its back control is how the list comes back (RD-NAV-4).

**States.** RD-ARTICLE-2 while a fetch runs, RD-EMPTY for no open article. Writes show no spinner of their own except the extraction spinner and status line in the header (RD-EXTRACT-4).

## API

The reader has no endpoints of its own. Each action calls an endpoint of the domain that owns it, and that file holds its parameters, replies and errors.

| Action | Endpoint | Owner |
| --- | --- | --- |
| open a feed item | `GET /api/feed-items/:id` | [feeds.md](feeds.md) API |
| open a saved page | `GET /api/saved-pages/:id` | [later.md](later.md) API |
| set the read state | `PATCH /api/feed-items/:id`, `PATCH /api/saved-pages/:id` | feeds.md, later.md |
| extract a feed item | `POST /api/feed-items/:id/extract` | feeds.md |
| save a feed item to later | `POST /api/feed-items/:id/save` | later.md |
| delete a saved page | `DELETE /api/saved-pages/:id` | later.md |

- Which request reads the open article is decided by the route (RD-ARTICLE-1), never by a parameter.
- The read answers the article, and its result replaces the article the reader displays (RD-ARTICLE-2).
- Of the writes, extraction is the only one whose result the reader shows directly: its reply replaces the open article (RD-EXTRACT-5), and a cached extraction sends no request (RD-EXTRACT-3). The other writes answer without a body or change stored data only, and the reader updates its own view from what it has (RD-READ, RD-SAVE, RD-DELETE).

## Messages

| Situation or error tag | Text |
| --- | --- |
| header row, accessible label | 文章操作 |
| back to the list | 返回文章列表 |
| previous article | 上一篇 |
| next article | 下一篇 |
| read toggle, article unread | 标为已读 |
| read toggle, article read | 标为未读 |
| extraction icon, default content | 提取正文 |
| extraction icon, extracted content | 切换回原文 |
| status line while extracting | 正在提取正文… |
| overflow trigger | 更多操作 |
| overflow menu, accessible label | 更多文章操作 |
| embedded page checkbox | 嵌入式网页视图 |
| open the original page | 打开原文 |
| notice bar above the embedded page | 部分网站不允许内嵌或需要登录；若显示异常，请打开原文。 |
| address that cannot be embedded | 此地址不支持安全内嵌，请使用上方链接打开原文。 |
| article frame, accessible title | 文章正文 |
| embedded page frame, accessible title | 内嵌原网页 |
| no article open, heading | 给阅读留一点空间 |
| no article open, hint | 从左侧选择一篇文章，开始阅读 |
| article without content or description | 暂无内容 |

The labels of the save action and the delete entry, and the toasts of saving and deleting, are in [later.md](later.md) Messages; the wording of every failure is in [SKILL.md](SKILL.md) shared messages or the domain that raises it.

## Acceptance

```gherkin
Feature: The reader pane

  Rule: The default content is the stored content

    Scenario: Opening a saved page shows its stored content
      Given the saved page "怎样阅读" has the content "<p>正文第一段</p>"
      When I open "/later/<id of the saved page>"
      Then the reader shows the title "怎样阅读" and the text "正文第一段"

    Scenario: An article without content shows its description
      Given a feed item with the description "<p>摘要</p>" and no content
      When I open the feed item in the reader
      Then the reader shows the text "摘要"

    Scenario: An article with neither content nor description
      Given a feed item with neither content nor description
      When I open the feed item in the reader
      Then the content area shows "暂无内容"
      And the header still offers all its controls

    Scenario: The title and the source link open the original page
      Given a saved page from "https://example.com/post"
      When I open the saved page in the reader
      Then the title is a link to "https://example.com/post" that opens a new tab
      And the line below it shows "example.com" linking to the same address

  Rule: Opening an unread article marks it read

    Scenario: Opening an unread article marks it read
      Given the list shows an unread feed item
      When I open that item
      Then the item is marked read on the server
      And the reader's read toggle reads "标为未读"

    Scenario: The row stays in the list until the list reloads
      Given the list is filtered with "只显示未读"
      When I open an unread item and go back to the list
      Then the item is still listed, shown as read
      And it disappears after the next reload of the list

    Scenario: Marking read fails
      Given marking an article read fails
      When I open the unread article
      Then the article is shown as unread again
      And the toast "暂时无法访问订阅文章，请稍后重试" is shown

  Rule: Previous and next follow the loaded list

    Scenario: Moving to the next and the previous article
      Given the list shows the articles "A", "B", "C" in this order
      And I opened "B"
      When I choose "下一篇"
      Then "C" is open and the URL names "C"
      When I choose "上一篇"
      Then "B" is open and the URL names "B"

    Scenario: The ends of the list
      Given I opened the first article of the list
      Then "上一篇" is disabled
      When I open the last article
      Then "下一篇" is disabled

    Scenario: An article that is not in the loaded list
      When I open "/all/<id of an article that is not loaded>"
      Then the article is shown
      And the list keeps its loaded rows and does not gain a row for it
      And "上一篇" and "下一篇" are disabled

    Scenario: Back returns to the list
      Given I opened "/feed/<feedId>/<itemId>"
      When I choose "返回文章列表"
      Then the URL is "/feed/<feedId>"
      And the reader shows "给阅读留一点空间"

  Rule: Extraction of the article content

    Scenario: Extracting an article for the first time
      Given a feed item with neither content nor extracted content
      When I open it and choose "提取正文"
      Then the header shows a spinner and the status "正在提取正文…"
      And "保存到稍后阅读", the read toggle and the extraction icon are disabled while it runs
      And "嵌入式网页视图" cannot be checked while it runs
      When the extraction answers with the item carrying extracted content
      Then the reader shows the extracted content
      And the icon is solid and pressed and reads "切换回原文"

    Scenario: Extraction uses cached content
      Given the open feed item already has extracted content
      When I choose "提取正文"
      Then the extracted content is shown at once
      And no extraction request is sent
      When I choose "切换回原文"
      Then the default content is shown again

    Scenario: Extraction fails
      Given extraction of the open feed item fails with "未能提取到文章内容"
      When I choose "提取正文"
      Then the toast "未能提取到文章内容" is shown
      And the view shown before the attempt is still shown and no extracted content is stored

    Scenario: The failure of the webpage fetcher is reported in its own words
      Given the page cannot be fetched
      When I extract the open item
      Then the toast "网页抓取失败，请稍后重试" is shown

    Scenario: Switching to another article during extraction
      Given an extraction of "A" is running
      When I open "B"
      Then "B" is shown with its default content
      When the extraction of "A" answers
      Then "B" keeps its default content and its controls are enabled

    Scenario: A different article resets the mode, the same article does not
      Given I am reading "A" in the extracted view
      When the same article "A" is fetched again
      Then the extracted view is kept
      When I open "B"
      Then "B" is shown with its default content

  Rule: The embedded web page

    Scenario: Turning the embedded view on and off
      Given the open saved page has a URL
      When I check "嵌入式网页视图" in the overflow menu
      Then the notice bar "部分网站不允许内嵌或需要登录；若显示异常，请打开原文。" is shown
      And the original page is loaded in a frame below it
      And the header is still shown
      When I uncheck "嵌入式网页视图"
      Then the default content is shown again

    Scenario: An address that cannot be embedded
      Given the open article's URL points at the app itself
      When I check "嵌入式网页视图"
      Then the area shows "此地址不支持安全内嵌，请使用上方链接打开原文。"
      And "打开原文" still opens the page in a new tab

    Scenario: Extracting while the embedded page is shown
      Given I am looking at the embedded web view
      When I choose "提取正文" and the extraction answers
      Then the extracted content is shown instead of the embedded page

    Scenario: Opening the original page
      Given an open article with a URL
      When I choose "打开原文" in the overflow menu
      Then the page opens in a new tab
      And the menu closes

  Rule: Saving a feed item to later reading

    Scenario: Saving a feed item
      Given an open feed item that is not saved
      When I choose "保存到稍后阅读"
      Then the toast "已保存到稍后阅读" is shown
      And the unread count of "稍后阅读" goes up
      And the reader still shows the feed item

    Scenario: The item is already saved
      Given a page with the same URL already exists in "稍后阅读"
      When I choose "保存到稍后阅读"
      Then the toast "该文章已在稍后阅读中" is shown
      And nothing is created

    Scenario: A saved page offers no save action
      Given I opened a page from "稍后阅读"
      Then the header has no "保存到稍后阅读"

  Rule: Deleting a saved page

    Scenario: A feed item offers no delete action
      Given I opened a feed item
      Then the overflow menu has no "删除"

  Rule: The empty reader

    Scenario: Entering the library without an article
      When I open "/later"
      Then the reader shows "给阅读留一点空间" and "从左侧选择一篇文章，开始阅读"

    Scenario: An unknown id in the URL
      When I open "/later/<id of a page that does not exist>"
      Then the reader shows "给阅读留一点空间" and "从左侧选择一篇文章，开始阅读"
      And no error toast is shown

  Rule: The URL restores the reader

    Scenario: Reloading a reader URL
      Given I opened "/feed/<feedId>/<itemId>"
      When I reload the page
      Then the same article is open in the reader
      And it is shown with its default content

    Scenario: Opening an article writes its URL
      Given the list of "全部订阅" is shown
      When I open an article from the list
      Then the URL becomes "/all/<itemId>"
      When I go back in the browser history
      Then the reader is empty and the list is shown

    Scenario: A saved page is read beside "稍后阅读"
      When I open "/later/<pageId>"
      Then the sidebar shows "稍后阅读" as the selected scope
      And the list beside the reader is the saved-page list
```
