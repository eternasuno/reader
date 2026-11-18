# Folders

Folders (`目录`) group one owner's feeds so they can be listed, counted and marked read together, and a feed can be moved between them. This file covers folder rules, the sidebar folder rows, the folder scope, the folder and move dialogs, and the folder choice made when subscribing. Feeds themselves, subscribing, the plan of a feed's items and the item lists are in [feeds.md](feeds.md); the refresh in [feeds-refresh.md](feeds-refresh.md); the library screen, sidebar rows as a whole, the article list and read marking in [library.md](library.md).

## Rules

### FD-FOLDER — Folders

A folder groups some of one owner's feeds so they can be listed, counted and marked read together.

- FD-FOLDER-1 A folder's id is a new id (CM-ID), made when the folder is created. Folders are unique per owner and name (CM-ID-6); two owners may each have a folder of the same name.
- FD-FOLDER-2 The name is a `FolderName`: trimmed, and not empty after trimming; the boundary rejects an empty name. Names are compared exactly as stored, so they are case-sensitive: `Tech` and `tech` are two folders.
- FD-FOLDER-3 Folders are one level deep: a folder holds feeds only. A feed is in at most one folder (`Feed.folderId`); a feed with none is at the top level.
- FD-FOLDER-4 Create (`createFolder(owner, name)`): build the folder with its constructor, which makes the id (CM-ID-3), and create it with `FolderRepository.create`. If nothing was created, fail `FolderAlreadyExists(folderName)`. Two creates of one name at once create one folder. A new folder is empty.
- FD-FOLDER-5 Rename (`renameFolder(owner, folderId, name)`): `FolderRepository.rename(owner, folderId, name)`. If it returns `false`, find the folder: none fails `FolderNotFound(folderId)`, some fails `FolderAlreadyExists(folderName)`. Renaming a folder to its current name succeeds and changes nothing. Renaming changes no feed and no item.
- FD-FOLDER-6 A feed's `folderId` always names an existing folder of the same owner. `FeedRepository.create` skips a row whose folder is not the owner's, and `FeedRepository.moveToFolder` writes nothing when given such a folder; in both the folder check and the write are one atomic write, so no feed is ever left pointing at a removed folder.
- FD-FOLDER-7 Removing folders (`FolderRepository.remove`, a single port call) removes the owner's listed folders, every feed in them and those feeds' items, in one atomic write: removing a folder unsubscribes its feeds (FD-UNSUB). Saved pages stay (FD-UNSUB-3). Unknown and foreign ids succeed and change nothing. A feed moved into the folder at the same time is either removed with it or not moved (FD-MOVE-3).
- FD-FOLDER-8 `FolderRepository.list(owner)` returns the owner's folders by name, then id, ascending, names compared in UTF-8 byte order (SQLite `BINARY`; test doubles must match), the same order the client shows; it is not paged. An empty folder is kept and listed, also after its last feed left it.
- FD-FOLDER-9 Refresh never changes a feed's folder: the sync writes only `title` and `updatedAt` through `recordSync` (FD-SYNC step 5).

### FD-MOVE — Move a feed

`moveFeed(owner, feedId, folderId)`, where `folderId` is an `Option`: some folder puts the feed in it, none takes it out to the top level. The request carries the folder id, and `null` for none.

1. `FeedRepository.moveToFolder(owner, feedId, folderId)`.
2. If it returns `true`, the feed was moved.
3. Otherwise, when `folderId` is some folder that `FolderRepository.find` does not return, fail `FolderNotFound(folderId)`.
4. Otherwise the feed does not exist for the owner: succeed without change (FD-OWN-2).

- FD-MOVE-1 Moving a feed to the folder it is already in, or taking a top-level feed out, succeeds and changes nothing.
- FD-MOVE-2 Moving keeps the feed's items, their ids and read state, and the feed's title and `updatedAt`.
- FD-MOVE-3 A target folder that does not exist or is not the owner's fails `FolderNotFound` and moves nothing (FD-FOLDER-6).
- FD-MOVE-4 A move is visible at once to the folder scope: listing, marking and counting by folder resolve the folder's feeds when they run (FD-LIST-6, FD-READ-5, FD-COUNT-3).

## Interface

- Order: the sidebar shows folders and feeds in the order the server returns them (FD-FOLDER-8, FD-LIST-3); the client never sorts them itself. After creating or renaming a folder, moving a feed or subscribing, it lists folders and feeds again (`GET /api/folders`, `GET /api/feeds`) to place the row; the article list is not reloaded.

### Sidebar folder rows

- Folder rows and feed rows share one row and one menu behavior (see `library.md` for the row slot, hover/focus replacement of the count by the `⋯` trigger, and coarse-pointer behavior). A folder row shows a folder icon, the folder name, and on the right its unread count: the sum of the unread counts of the feeds whose folder it is (FD-COUNT-3); a zero count is shown the way a feed with no unread items shows it (LIB-COUNT-3).
- A chevron button starts each folder row. It toggles the folder's collapse state and never selects the folder or changes the current scope. It exposes `aria-expanded` and is labeled `折叠目录「name」` while expanded and `展开目录「name」` while collapsed.
- The `订阅源` section lists the folders first, by name then id, and under each folder its feeds by title, indented relative to the folder row; after the folders, the feeds that belong to no folder, by title. A collapsed folder hides its feed rows and keeps its count. A feed that names no existing folder is shown at the top level.
- Collapse state is kept per browser: the ids of collapsed folders are stored under the localStorage key `reader.collapsedFolders` as a JSON array of ids; a missing or undecodable value is no state. A folder with no stored state is expanded, so every folder is expanded in a browser that has not collapsed one. Collapse state belongs to the folder id, so renaming a folder keeps it.
- Selecting a feed that is inside a collapsed folder expands that folder; the feed is then selected in the usual way. This also covers a feed that arrives already selected, such as the feed created by subscribing into a collapsed folder.
- The always-visible plus to the right of the `订阅源` label opens a popup with `新增 RSS 订阅` (`feeds.md`) and `新建目录`, in this order. Its accessible label is `新增订阅源或目录`. Choosing an item closes the popup before opening the dialog.

### The sidebar folder menu

The folder row's `⋯` menu shows, in this order, `只显示未读` (a checkbox item reflecting the shared unread filter), `全部标记为已读`, `重命名目录`, and then, separated from the items above and in the destructive color, `删除目录`. The menu's labels are `目录「name」菜单` for the trigger and `「name」目录操作` for the popover.

- `只显示未读` and `全部标记为已读` act on the clicked folder, even when another scope is selected: the folder scope is selected (`library.md` LIB-MENU-2) and the mark-all requests that folder's own endpoint with its id, so the action names its target instead of depending on the selection. `全部标记为已读` marks every item of the folder's current feeds (FD-READ-5). Both are the shared scope-menu actions of `library.md`.
- `重命名目录` opens the folder dialog for that folder; `删除目录` asks for confirmation and deletes it (below). Neither changes the selected scope.

### The folder scope

- A folder is a scope with its own URL, `/folder/:folderId`, and optionally an open article at `/folder/:folderId/:itemId`. Selecting the folder name navigates there and lists the items of the feeds that are in the folder when the page is listed, in arrival order (FD-LIST-4, FD-LIST-6); the unread filter applies as in every scope. An unknown or foreign folder id in the URL shows the scope's empty state, not an error (FD-LIST-7).
- The list heading shows the folder name and the folder's unread count. The sidebar folder row is shown selected. The list reloads from the first page when the scope is entered or the filter changes, as for every scope (`library.md`).
- The list's `⋯` menu offers only `只显示未读` and `全部标记为已读` (FD-READ-5). It has no `新增文章链接`, no `删除 RSS 源`, and no folder rename or delete; those live in the sidebar.
- The empty state depends on the folder: a folder without feeds shows the no-feeds empty state of Messages, and a folder with feeds but no articles the no-articles one. Under the unread filter the shared filtered empty state applies (`library.md`).
- Marking the loaded articles as read affects every loaded unread item of the list, as in every scope (`library.md`); marking the whole folder read affects the items of the folder's current feeds, including unloaded ones, so a moved-out feed's items still shown are not marked. Both show their effect and roll back on failure as in `library.md`.

### Creating and renaming a folder

- `新建目录` and `重命名目录` use the shared dialog with one required name field: label `目录名称`, the hint of Messages, focus in the field when the dialog opens, native required validation, Esc and the close button. The rename dialog is prefilled with the current name.
- When the dialog opens, the name is reset to empty for create and to the current name for rename. Submitting sends the name as typed; the server trims it (FD-FOLDER-2), so `  Design  ` creates `Design`.
- While the request is in flight the field and the submit button are disabled and the button reads `创建中…` or `保存中…`. On success the dialog closes, the sidebar shows the created or renamed folder in name order, a success toast appears, and the current scope and the article list are unchanged (renaming the selected folder only updates the list title): creating or renaming never reloads the list.
- On failure the toast shows the wording of the error (a taken name, an empty name, a folder removed meanwhile) and the dialog stays open with the typed name, so the user can correct it.
- Closing an unsubmitted dialog creates and renames nothing, and focus returns to the control that opened it.

### Moving a feed

- A single feed's sidebar menu offers `移动到目录` between `全部标记为已读` and `删除 RSS 源`, and only when at least one folder exists.
- `移动到目录` opens a dialog titled `移动到目录` with the line naming the feed (Messages) and a `目录` select. The select lists `不放入目录` first and then the folders by name; it preselects the feed's current folder, or `不放入目录` for a feed at the top level. The submit button reads `移动`.
- Moving is a quick action ([SKILL.md](SKILL.md) Client conventions): the select and the `移动` button stay enabled and keep no pending state or pending label, and every submit of the form sends the selected folder, the feed's current folder included.
- On success the dialog closes, the toast says `已移动`, and the sidebar regroups at once: the feed appears under its new folder (or among the top-level feeds) by title, and both folders' counts change. The feed's items, their read state and the feed's title are unchanged (FD-MOVE-2). Confirming the feed's current folder takes the same success path — the dialog closes and the toast says `已移动` — and the server changes nothing (FD-MOVE-1).
- Moving never reloads the article list, so a list that has loaded articles of the moved feed still shows them until it is reloaded, while the folders' counts already reflect the move. Marking the old folder read afterwards leaves those still-shown items of the moved-out feed unread (FD-MOVE-4).
- On failure the toast shows the error, the dialog stays open, and the feed stays where it was.

### Choosing a folder when subscribing

- The `新增 RSS 订阅` address form has only the address field and `预览订阅`; the folder is chosen at the confirmation step, not in the address form (see `feeds.md` for the dialog and the preview).
- When folders exist, the confirmation area shows a `目录` select below the previewed feed information and above the confirmation buttons (their labels are in `feeds.md`). It lists `不放入目录` first, preselected, then the folders by name, and is disabled while the subscription is being confirmed. Without folders the confirmation shows no select.
- The choice is kept when the user returns to edit and previews again, and it is reset to `不放入目录` when the dialog opens.
- Confirming subscribes into the chosen folder (FD-SUB-6), closes the dialog, selects the new feed at `/feed/:feedId`, and expands the folder if it was collapsed. A feed that already exists is opened instead and keeps its folder (FD-SUB-7).

### Deleting a folder

- `删除目录` asks through the browser's confirm dialog: a folder with feeds gets the wording that names the folder and the number of feeds in it, a folder without feeds the shorter one (Messages). Cancelling changes nothing.
- Confirming deletes the folder, unsubscribes its feeds and removes their items (FD-FOLDER-7); saved pages made from those items stay. The sidebar loses the folder and its feeds, the counts update, and a `目录已删除` toast appears.
- If the current scope is that folder, or a feed that was in it, the app returns to `全部订阅` at `/all` and reloads the list from the first page. Any other scope stays selected and the list is not reloaded (the sidebar itself is reloaded in both cases).
- On failure the toast shows the error and the folder, its feeds and their articles are all kept.

## API

Folder JSON, as returned by `POST /api/folders` and inside the list: `{ "id": FolderId, "ownerId": OwnerId, "name": string }`.

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/folders` | — | 200 `{ items: Folder[] }` | `FolderRepositoryError` 500 |
| POST | `/api/folders` | body `{ name: string }` | 201 `{ item: Folder }` | `InvalidFolderName` 400, `FolderAlreadyExists` 409, `FolderRepositoryError` 500 |
| PATCH | `/api/folders/:id` | path `FolderId`; body `{ name: string }` | 204 | `InvalidFolderName` 400, `FolderNotFound` 404 (`id`), `FolderAlreadyExists` 409, `FolderRepositoryError` 500 |
| DELETE | `/api/folders/:id` | path `FolderId` | 204 | `FolderRepositoryError` 500 |
| POST | `/api/folders/:id/read-all` | path `FolderId` | 204 | `FeedItemRepositoryError` 500 |
| GET | `/api/folders/:id/items` | path `FolderId`; query `limit` (required positive integer), `unread` (boolean, default `false`), `cursor` (optional `FeedItemId`) | 200 `{ items: FeedItem[], cursor: FeedItemId \| null }` | `FeedItemRepositoryError` 500 |
| PATCH | `/api/feeds/:id` | path `FeedId`; body `{ folderId: FolderId \| null }` | 204 | `FolderNotFound` 404 (`id`), `FeedRepositoryError` 500, `FolderRepositoryError` 500 |

- `GET /api/folders` returns the owner's folders by name, then id, ascending (FD-FOLDER-8). It is not paged and empty folders are included.
- `POST /api/folders` names the folder: the name is trimmed and must not be blank after trimming (`InvalidFolderName` otherwise, FD-FOLDER-2). A duplicate name of the owner is `FolderAlreadyExists`, and two concurrent creates of one name make one folder, the other answering 409 (FD-FOLDER-4).
- `PATCH /api/folders/:id` renames (FD-FOLDER-5). Renaming to the folder's current name answers 204 and changes nothing. An id that does not exist for the owner answers `FolderNotFound` carrying the `id`.
- `DELETE /api/folders/:id` removes the folder, its feeds and their items in one write (FD-FOLDER-7); saved pages of those items stay. An unknown or foreign id answers 204 and changes nothing.
- `POST /api/folders/:id/read-all` marks every item of the feeds that are in the folder when it runs; a feed that has left the folder is untouched (FD-READ-5). An unknown or foreign folder answers 204 and marks nothing.
- `GET /api/folders/:id/items` is the folder scope's list (FD-LIST-6, FD-LIST-7) and follows the paging conventions (CM-PAGE): `unread` is the unread filter, `cursor` is the id to pass for the next page, and the answer's `cursor` is that id or `null`. An unknown, foreign or empty folder answers 200 with an empty `items` and `cursor: null`.
- `PATCH /api/feeds/:id` with a `folderId` moves the feed: a folder id puts it there, `null` takes it to the top level (FD-MOVE). The field is required; a request without it is a decode failure (400). A target folder that does not exist or is not the owner's answers `FolderNotFound` with the folder `id`; when the target is `null` or a folder of the owner, a feed that does not exist for the owner answers 204 and changes nothing (FD-MOVE). The move is one atomic write (FD-FOLDER-6), changes no item, dispatches nothing and reloads nothing.
- Creating, renaming and deleting a folder and moving a feed enqueue no refresh and touch no item except where the rules say so (FD-FOLDER-7, FD-FOLDER-9).

## Messages

| Situation or error tag | Text |
| --- | --- |
| `InvalidFolderName` (400) | 请输入目录名称 |
| `FolderAlreadyExists` (409) | 该目录名称已存在 |
| `FolderNotFound` (404) | 目录不存在，可能已被删除 |
| `FolderRepositoryError` (500) | 暂时无法访问目录，请稍后重试 |
| folder created | 目录已创建 |
| folder renamed | 目录已重命名 |
| folder deleted | 目录已删除 |
| feed moved | 已移动 |
| delete confirm, folder with N feeds | 删除目录「name」并取消订阅其中的 N 个订阅源？这些源的文章会被删除，已保存的稍后阅读不会删除。 |
| delete confirm, folder without feeds | 删除目录「name」？ |
| collapse toggle, expanded | 折叠目录「name」 |
| collapse toggle, collapsed | 展开目录「name」 |
| folder menu popover / trigger | 「name」目录操作 / 目录「name」菜单 |
| folder menu item | 重命名目录 |
| folder menu item, danger | 删除目录 |
| subscribe section plus, trigger | 新增订阅源或目录 |
| plus menu item | 新建目录 |
| folder dialog title, create / rename | 新建目录 / 重命名目录 |
| name field label | 目录名称 |
| name field hint (also the native missing-name message) | 请输入目录名称 |
| folder dialog submit, create | 创建 / 创建中… |
| folder dialog submit, rename | 保存 / 保存中… |
| move dialog title | 移动到目录 |
| move dialog text | 将「feed title」移动到： |
| folder select label (move dialog and subscribe confirmation) | 目录 |
| folder select option, top level | 不放入目录 |
| move dialog submit | 移动 |
| empty folder, no feeds | 这个目录还没有订阅源 / 可以从订阅源的菜单把订阅源移动到这里。 |
| empty folder, feeds but no articles | 这个目录还没有文章 / 订阅源刷新后，新的文章会出现在这里。 |

## Acceptance

```gherkin
Feature: RSS feed folders
  To read subscriptions grouped by topic
  As a signed-in user
  I want to put multiple RSS feeds into one folder and, like "全部订阅", list articles, filter and mark as read within the folder scope

  Folders are single-level: a folder holds feeds, not folders. A feed belongs to at most one folder,
  and feeds that belong to no folder stay at the top level of the "订阅源" section of the sidebar.
  A folder name must not be empty after trimming leading and trailing spaces, and must not duplicate
  another folder of the same user.
  The article list reloads from the first page only when I enter a scope, select a scope, switch a filter
  or click refresh (the list rules of the library screen, see library.md).

  Background:
    Given I am signed in
    And I have the following folders: Empty, News, Tech
    And I have the following feeds:
      | Feed         | Folder | Unread |
      | Go Blog      | Tech   | 3      |
      | Rust Blog    | Tech   | 2      |
      | BBC          | News   | 4      |
      | Zeta Daily   |        | 5      |
      | Alpha Weekly |        | 1      |

  Rule: Sidebar display

    Scenario: Folders come first ordered by name, and feeds without a folder follow ordered by title
      When I open the reader
      Then the "订阅源" section of the sidebar shows the following from top to bottom:
        | Row          | Type   | Folder |
        | Empty        | Folder |        |
        | News         | Folder |        |
        | BBC          | Feed   | News   |
        | Tech         | Folder |        |
        | Go Blog      | Feed   | Tech   |
        | Rust Blog    | Feed   | Tech   |
        | Alpha Weekly | Feed   |        |
        | Zeta Daily   | Feed   |        |
      And the feeds inside a folder are shown indented relative to the folder

    Scenario: A folder's unread count is the sum of its feeds' unread counts
      When I open the reader
      Then the folder "Tech" shows unread count 5
      And the folder "News" shows unread count 4
      And the folder "Empty" shows its unread count the same way as a feed with 0 unread

    Scenario: "全部订阅" still includes the feeds in folders
      When I open the reader
      Then "全部订阅" shows unread count 15

    Scenario: Folder rows and feed rows share the interaction of the row and the menu
      When I hover over the folder "Tech" or focus it with the keyboard
      Then its unread count position is replaced by the ⋯ menu button
      And the menu button is aligned in size and position with the menu buttons of feed rows

  Rule: Collapsing and expanding

    Scenario: Clicking the arrow collapses the folder without changing the current reading scope
      Given the current reading scope is "全部订阅"
      When I click the arrow of the folder "Tech"
      Then Go Blog and Rust Blog are no longer shown in the sidebar
      And the current reading scope is still "全部订阅" and the article list does not reload

    Scenario: A collapsed folder still shows its unread count
      Given the folder "Tech" is collapsed
      Then the folder "Tech" shows unread count 5

    Scenario: Clicking the arrow expands the folder
      Given the folder "Tech" is collapsed
      When I click the arrow of the folder "Tech"
      Then Go Blog and Rust Blog are shown under the folder "Tech" again

    Scenario: The collapsed state is kept in this browser
      Given I collapsed the folder "Tech"
      When I reopen the reader in the same browser
      Then the folder "Tech" is still collapsed
      And the folder "News" is still expanded

    Scenario: Folders without a saved collapsed state are expanded by default
      When I sign in in a browser that has never opened the reader
      Then all folders are expanded

    Scenario: Selecting a feed inside a collapsed folder expands that folder
      Given the folder "Tech" is collapsed
      When I subscribe to a new feed and choose the folder "Tech"
      Then the folder "Tech" expands
      And the new feed is selected

  Rule: The article list of a folder scope

    Scenario: Clicking a folder name lists the articles of all feeds in the folder
      When I click the name of the folder "Tech"
      Then the folder "Tech" is selected
      And the address is /folder/:folderId
      And the article list reloads from the first page
      And the article list contains only the articles of Go Blog and Rust Blog, ordered from newest to oldest by arrival order
      And the list title shows "Tech" and unread count 5

    Scenario Outline: A folder list shares the "只显示未读" filter
      Given "只显示未读" is <filter>
      When I click the name of the folder "Tech"
      Then the article list <content>
      When I click "全部订阅" again
      Then "只显示未读" is still <filter>

      Examples:
        | Filter    | Content                                                     |
        | Checked   | contains only the unread articles of Go Blog and Rust Blog  |
        | Unchecked | contains all the articles of Go Blog and Rust Blog          |

    Scenario: Toggling "只显示未读" in a folder list
      Given the current reading scope is the folder "Tech"
      And "只显示未读" is unchecked
      When I check "只显示未读" in the ⋯ menu of the article list
      Then the article list reloads from the first page
      And contains only the unread articles of Go Blog and Rust Blog

    Scenario: Marking the loaded articles as read
      Given the current reading scope is the folder "Tech"
      And the list has loaded only some of the articles of the folder "Tech"
      When I click the "将已加载文章标为已读" icon to the right of the list title
      Then the loaded unread articles are all shown as read
      And the unloaded articles stay unread
      And the unread count of the folder "Tech" decreases accordingly

    Scenario: Marking the whole folder as read from the article list menu
      Given the current reading scope is the folder "Tech"
      When I click "全部标记为已读" in the ⋯ menu of the article list
      Then all the articles of Go Blog and Rust Blog are marked as read, including the unloaded articles
      And the unread count of the folder "Tech" becomes 0
      And the unread counts of BBC, Zeta Daily and Alpha Weekly stay unchanged
      And the unread count of "全部订阅" becomes 10

    Scenario: The article list menu of a folder scope offers only filtering and mark-all-as-read
      Given the current reading scope is the folder "Tech"
      When I open the ⋯ menu of the article list
      Then the menu contains only "只显示未读" and "全部标记为已读"
      And does not contain "新增文章链接", "删除 RSS 源", "重命名目录" or "删除目录"

    Scenario: An empty folder shows the empty state
      When I click the name of the folder "Empty"
      Then the article list is empty
      And the empty state says that this folder has no feeds yet and that a feed can be moved here from a feed's menu

    Scenario: Marking all as read rolls back when it fails
      Given the current reading scope is the folder "Tech"
      And the server cannot handle the request
      When I click "全部标记为已读" in the ⋯ menu of the article list
      Then an error message is shown
      And the read state of the articles and the unread counts return to what they were before the operation

  Rule: The sidebar folder menu

    Scenario: The contents of the sidebar folder menu
      When I open the ⋯ menu of the sidebar folder "Tech"
      Then the menu shows "只显示未读", "全部标记为已读", "重命名目录" and "删除目录" in this order
      And "删除目录" is separated from the items above and shown in the danger color

    Scenario: Marking all as read from the sidebar folder menu applies to the clicked folder
      Given the current reading scope is the feed "Zeta Daily"
      When I click "全部标记为已读" in the ⋯ menu of the sidebar folder "Tech"
      Then the folder "Tech" is selected and the article list switches to the folder "Tech"
      And all the articles of Go Blog and Rust Blog are marked as read
      And the unread count of Zeta Daily is still 5

    Scenario: Toggling "只显示未读" from the sidebar folder menu applies to the clicked folder
      Given the current reading scope is "全部订阅"
      And "只显示未读" is unchecked
      When I check "只显示未读" in the ⋯ menu of the sidebar folder "Tech"
      Then the folder "Tech" is selected
      And the article list contains only the unread articles of Go Blog and Rust Blog

  Rule: Creating a folder

    Scenario: The plus next to "订阅源" opens the add menu
      When I click the plus to the right of "订阅源" in the sidebar
      Then the popup menu shows "新增 RSS 订阅" and "新建目录"

    Scenario: Creating a folder
      When I click "新建目录" in the plus menu
      Then the popup menu closes and the "新建目录" dialog opens with an empty name input that has focus
      When I type "Design" and submit
      Then the dialog closes
      And an expanded empty folder "Design" appears in the sidebar in name order
      And the current reading scope stays unchanged

    Scenario: Folder names are trimmed of leading and trailing spaces
      When I create a folder named "  Design  "
      Then the sidebar shows the folder "Design"

    Scenario Outline: Invalid folder names
      Given the "新建目录" dialog is open
      When I type <input> into the name and submit
      Then <message>
      And no folder is created
      And the dialog stays open and keeps my input

      Examples:
        | Input                         | Message                                             |
        | Empty content                 | Browser-native validation says the name is required |
        | Only spaces                   | Shows the error "请输入目录名称"                     |
        | "Tech"                        | Shows the error "该目录名称已存在"                   |
        | "Tech" with surrounding spaces | Shows the error "该目录名称已存在"                  |

    Scenario: Closing the new folder dialog
      Given the "新建目录" dialog is open
      When I press Esc or click the close button
      Then the dialog closes and no folder is created
      And focus returns to the plus button

  Rule: Renaming a folder

    Scenario: Renaming a folder
      When I click "重命名目录" in the ⋯ menu of the sidebar folder "Tech"
      Then the "重命名目录" dialog opens with "Tech" prefilled in the name input
      When I change the name to "Engineering" and submit
      Then the dialog closes
      And the folder "Engineering" is shown in the sidebar in name order and still contains Go Blog and Rust Blog
      And the current reading scope stays unchanged

    Scenario: Renaming the currently selected folder
      Given the current reading scope is the folder "Tech"
      When I rename the folder "Tech" to "Engineering"
      Then the list title shows "Engineering"
      And the address still names the same folder
      And the article list does not reload

    Scenario: Renaming to an existing name
      When I rename the folder "Tech" to "News"
      Then an error that the folder name already exists is shown
      And the dialog stays open
      And the name of the folder "Tech" stays unchanged

    Scenario: Submitting without changing the name
      When I open the "重命名目录" dialog of the folder "Tech" and submit directly
      Then the dialog closes
      And the folder "Tech" stays unchanged

  Rule: Moving feeds into or out of a folder

    Scenario: The feed menu offers "移动到目录"
      When I open the ⋯ menu of the sidebar feed "Zeta Daily"
      Then the menu shows "只显示未读", "全部标记为已读", "移动到目录" and "删除 RSS 源" in this order

    Scenario: The move dialog preselects the current folder
      When I click "移动到目录" in the ⋯ menu of the feed "Go Blog"
      Then the popup menu closes and the "移动到目录" dialog opens
      And the folder dropdown lists "不放入目录", "Empty", "News" and "Tech" in this order
      And "Tech" is preselected

    Scenario: Moving a feed that has no folder into a folder
      When I move the feed "Zeta Daily" to the folder "News"
      Then the dialog closes
      And Zeta Daily is shown under the folder "News" in title order
      And the unread count of the folder "News" becomes 9
      And the articles and read state of Zeta Daily stay unchanged

    Scenario: Moving a feed out of a folder
      When I move the feed "Go Blog" to "不放入目录"
      Then Go Blog is shown among the top-level feeds without a folder in title order
      And the unread count of the folder "Tech" becomes 2

    Scenario: Moving a feed between folders
      When I move the feed "Go Blog" to the folder "News"
      Then Go Blog is shown under the folder "News" and is no longer shown under the folder "Tech"
      And the unread count of the folder "Tech" becomes 2
      And the unread count of the folder "News" becomes 7

    Scenario: Confirming the original folder makes no change
      When I open the "移动到目录" dialog of the feed "Go Blog" and confirm directly
      Then the dialog closes and the toast says "已移动"
      And Go Blog is still under the folder "Tech"
      And the unread count of the folder "Tech" is unchanged

    Scenario: The move dialog stays enabled while a move is in flight
      When I open the "移动到目录" dialog of the feed "Zeta Daily"
      And I choose the folder "News" and click "移动"
      Then the folder dropdown and the "移动" button are still enabled
      And no pending label replaces "移动"

    Scenario: Moving a feed does not automatically reload the current list
      Given the current reading scope is the folder "Tech"
      And the article list has loaded the articles of Go Blog
      When I move the feed "Go Blog" to "不放入目录"
      Then the unread count of the folder "Tech" immediately becomes 2
      But the article list does not reload and still shows the loaded articles of Go Blog
      When I select another scope and then the folder "Tech" again
      Then the article list no longer contains the articles of Go Blog

    Scenario: Marking the original folder as read after moving a feed out does not affect the moved-out articles that are still shown
      Given the current reading scope is the folder "Tech"
      And the article list has loaded the unread articles of Go Blog and Rust Blog
      And I just moved the feed "Go Blog" to "不放入目录"
      When I click "全部标记为已读" in the ⋯ menu of the article list
      Then the articles of Rust Blog are all marked as read
      But the Go Blog articles still shown in the list stay unread and the unread count of Go Blog stays unchanged

    Scenario: A folder is kept after its last feed is moved away
      When I move the feed "BBC" to "不放入目录"
      Then the folder "News" is still shown in the sidebar without feeds

    Scenario: "移动到目录" is not offered when there are no folders
      Given I have no folders
      When I open the ⋯ menu of the sidebar feed "Zeta Daily"
      Then the menu does not contain "移动到目录"

    Scenario: The move fails
      Given the server cannot handle the request
      When I move the feed "Zeta Daily" to the folder "News"
      Then an error is shown
      And the dialog stays open
      And Zeta Daily is still among the top-level feeds without a folder

  Rule: Choosing a folder when subscribing (after the preview and before confirming the subscription)

    Scenario: The address form has no folder selection
      When I click "新增 RSS 订阅" in the plus menu
      Then the "新增 RSS 订阅" dialog has only an address input and the "预览订阅" button
      And has no folder dropdown

    Scenario: After a successful preview I choose the folder in the confirmation area, defaulting to no folder
      Given the "新增 RSS 订阅" dialog is open
      When I fill in the address of a new feed and preview it
      Then the preview area shows a folder dropdown below the feed information, listing "不放入目录", "Empty", "News" and "Tech" in this order
      And "不放入目录" is preselected
      And the dropdown is above the "确认订阅" and "返回修改" buttons

    Scenario: Subscribing into a given folder
      Given I have completed the preview of a new feed in the "新增 RSS 订阅" dialog
      When I choose the folder "Tech" in the preview area and confirm the subscription
      Then the dialog closes
      And the new feed is shown under the folder "Tech" and is selected
      And the address is /feed/:feedId
      And the new feed has no articles before its first refresh

    Scenario: Subscribing without putting the feed into a folder
      Given I have completed the preview of a new feed in the "新增 RSS 订阅" dialog
      When I keep "不放入目录" and confirm the subscription
      Then the new feed is shown among the top-level feeds without a folder and is selected

    Scenario: Previewing again after returning to edit keeps the folder choice
      Given I chose the folder "Tech" in the preview area
      When I click "返回修改"
      Then the address stays in the form
      When I preview again
      Then the folder dropdown in the preview area still preselects "Tech"

    Scenario: Reopening the subscribe dialog resets the folder choice
      Given I closed the dialog after choosing the folder "Tech" in the preview area last time
      When I open the "新增 RSS 订阅" dialog again and complete a preview
      Then the folder dropdown preselects "不放入目录"

    Scenario: The folder cannot be changed while the subscription is being confirmed
      Given I have chosen the folder "Tech" in the preview area and clicked "确认订阅"
      When the subscription request has not completed yet
      Then the folder dropdown and both buttons are not operable

    Scenario: Subscribing to a feed that is already subscribed does not change its folder
      When I preview the address of Zeta Daily, choose the folder "Tech" in the preview area and confirm the subscription
      Then the existing feed "Zeta Daily" opens
      And Zeta Daily is still among the top-level feeds without a folder

    Scenario: The preview area shows no folder selection when there are no folders
      Given I have no folders
      When I complete a preview in the "新增 RSS 订阅" dialog
      Then the preview area has no folder dropdown and shows "确认订阅" and "返回修改" directly

  Rule: Deleting a folder also unsubscribes the feeds in it

    Scenario: Confirming before deleting a folder
      When I click "删除目录" in the ⋯ menu of the sidebar folder "Tech"
      Then a confirmation pops up: "删除目录「Tech」并取消订阅其中的 2 个订阅源？这些源的文章会被删除，已保存的稍后阅读不会删除。"

    Scenario: Cancelling the deletion
      When I cancel in the confirmation for deleting the folder "Tech"
      Then the folder "Tech", Go Blog and Rust Blog are all kept

    Scenario: Confirming the deletion of a folder
      Given I saved an article of Go Blog to "稍后阅读"
      When I confirm deleting the folder "Tech"
      Then the folder "Tech", Go Blog and Rust Blog disappear from the sidebar
      And the articles of Go Blog and Rust Blog are deleted
      And the article saved in "稍后阅读" still exists
      And the unread count of "全部订阅" becomes 10
      And BBC, Zeta Daily and Alpha Weekly are unaffected

    Scenario: Deleting an empty folder
      When I click "删除目录" in the ⋯ menu of the sidebar folder "Empty"
      Then a confirmation pops up: "删除目录「Empty」？"
      When I confirm
      Then the folder "Empty" disappears from the sidebar

    Scenario Outline: Deleting a folder that contains the current reading scope returns to "全部订阅"
      Given the current reading scope is <scope>
      When I confirm deleting the folder "Tech"
      Then the current reading scope becomes "全部订阅", at /all
      And the article list reloads from the first page

      Examples:
        | Scope              |
        | the folder "Tech"  |
        | the feed "Go Blog" |

    Scenario: Deleting a folder unrelated to the current reading scope
      Given the current reading scope is the feed "Zeta Daily"
      When I confirm deleting the folder "Tech"
      Then the current reading scope is still the feed "Zeta Daily"
      And the article list does not reload

    Scenario: The deletion fails
      Given the server cannot handle the request
      When I confirm deleting the folder "Tech"
      Then an error is shown
      And the folder "Tech", Go Blog and Rust Blog are all kept
```
