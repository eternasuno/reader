# Folders (`目录`)

Single-level folders for grouping feeds in the sidebar, reading combined lists, and marking read together.

## Rules

- `FD-FOLDER-1`: Folder names (`FolderName`) are trimmed, non-empty, case-sensitive, and unique.
- `FD-FOLDER-2`: Folders are 1-level deep; a feed belongs to at most one folder (`folderId` or `null` for top level).
- `FD-FOLDER-3`: Renaming to the current name is a no-op (`204`). Missing folder fails `404 FolderNotFound`; name conflict fails `409 FolderAlreadyExists`.
- `FD-FOLDER-4`: **Deleting a folder** (`DELETE /api/folders/:id`) removes only the folder and moves any feeds inside it to the top level (`folderId = null`); **no feeds or articles are deleted**.
- `FD-FOLDER-5`: Folders list by `(name ASC, id ASC)` in UTF-8 byte order; empty folders are kept and listed.
- `FD-MOVE-1`: Moving a feed (`PATCH /api/feeds/:id`) sets `folderId` (`FolderId | null`). Moving to a missing folder fails `404 FolderNotFound`. Moving updates sidebar feeds and folder unread counts without issuing a list reload; if moving a feed out of the currently viewed `/folder/:folderId` scope, the client removes that feed's rows from the loaded list (and navigates to `/folder/:folderId` keeping `?unread` if the open article belonged to that feed).

## Interface & Messages

- **Sidebar**: folders appear first (ordered by name), with indented child feeds beneath each; top-level feeds follow. Folder collapse state persists in `localStorage` (`reader.collapsedFolders`). Selecting a feed inside a collapsed folder auto-expands it.
- **Menus**: folder `⋯` menu offers `只显示未读`, `全部标记为已读`, `重命名目录`, and `删除目录`. Folder scope (`/folder/:folderId`) list menu offers `只显示未读` and `全部标记为已读`.
- **Dialogs**: `新建目录` / `重命名目录` share one name dialog (`目录名称`); `移动到` is an in-menu sub-panel (back header `移动到`, one checkbox per folder showing the current folder as checked, a divider, and `新建目录` which opens the name dialog and moves the feed into the newly created folder); choosing an unchecked folder moves the feed there, choosing the checked folder moves it back to the top level; the menu stays open and the checkboxes update in place. Deleting a folder asks `window.confirm` and refreshes the sidebar; if `/folder/:folderId` or `/folder/:folderId/:itemId` was active, redirects to `/all` while preserving `?unread`.

| Code / Situation | Text |
| --- | --- |
| `InvalidFolderName` / `FolderAlreadyExists` / `FolderNotFound` | 请输入目录名称 / 该目录名称已存在 / 目录不存在，可能已被删除 |
| created / renamed / deleted / moved | 目录已创建 / 目录已重命名 / 目录已删除 / 已移动 |
| delete confirm | 删除目录「name」？其中的订阅源将移至顶层，不会取消订阅。 |
| empty folder (no feeds / no items) | 这个目录还没有订阅源 / 这个目录还没有文章 |

## API

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/folders` | — | `200 { items: Folder[] }` | `FolderRepositoryError` 500 |
| POST | `/api/folders` | `{ name }` | `201 { item }` | `InvalidFolderName` 400, `FolderAlreadyExists` 409, 500 |
| PATCH | `/api/folders/:id` | `{ name }` | `204` | `InvalidFolderName` 400, `FolderNotFound` 404, `FolderAlreadyExists` 409, 500 |
| DELETE | `/api/folders/:id` | `id` | `204` | `FolderRepositoryError` 500 |
| POST | `/api/folders/:id/read-all` | `id`, `{ before }` | `204` | `RequestFailed` 400, `FeedItemRepositoryError` 500 |
| GET | `/api/folders/:id/items` | `limit`, `unread`, `order?`, `cursor?`, `boundary?` | `200 { items, cursor, boundary }` | `RequestFailed` 400, `FeedItemRepositoryError` 500 |
| PATCH | `/api/feeds/:id` | `{ folderId: FolderId \| null }` | `204` | `FolderNotFound` 404, 500 |

## Acceptance

```gherkin
Feature: Folders
  Scenario: Deleting a folder preserves its feeds at top level
    Given folder "Tech" contains "Go Blog" and I am viewing "/folder/<techId>"
    When I confirm deleting "Tech"
    Then "Tech" disappears, "Go Blog" appears at the top level with its articles intact, and the view returns to "/all"
```
