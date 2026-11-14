---
name: project-business
description: Follow the reader's business rules when changing packages/business entities, ports, use cases, repository contracts or their tests, or outer-layer behavior that depends on them: feeds, feed folders and feed items, saved pages, settings, ids, URL normalization, paging, read state, unread counts, refresh, retention and extraction.
---

# Business rules

The reader is a self-hosted read-later and feed reader: a user saves web pages to read later, subscribes to feeds and groups them into folders, and reads the articles in one place. `packages/business` holds the business core. Accounts, sessions, HTTP, the refresh scheduler, page fetching and the front end are outer layers.

## Workflow

1. Read [Common rules](common.md) and the rule file of every domain the change touches (table below) before changing behavior. Rules are numbered (`FD-SEL-3`, `SP-ADD-1`); tests name the rule they cover.
2. Change the rule file in the same change as the behavior. Keep existing ids stable, give a new rule a new id, and do not reuse a removed id. A rule stated in `common.md` is referred to by id from the domain files, not repeated.
3. Implement within the layout and rules below, then run the repository checks from `AGENTS.md`.

| Domain    | Owns                                                                                                                                                                         | Rules                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Feed      | Subscriptions, their folders and their items: preview, subscribe, refresh (selection, retention, sync), folders, listing, extraction, read state, unread counts, unsubscribe | [feed.md](feed.md) `FD-`             |
| SavedPage | Pages saved to read later: add a link, save a feed item, listing, read state, removal, unread count                                                                          | [saved-page.md](saved-page.md) `SP-` |
| Setting   | Per-user settings: article retention and how pages are fetched (Jina or a browser service)                                                                                   | [setting.md](setting.md) `SET-`      |
| Common    | URL normalization, article values, ids, fetch-and-extract, feed-text cleaning, paging and cursors, ownership, the clock, shared port contracts                               | [common.md](common.md) `CM-`         |

Dependencies point one way: `SavedPage -> Feed -> Setting -> Common`. SavedPage reads feed items to save a copy; Feed reads the retention setting; every domain may use Common.

## Terms

- **Owner**: the signed-in user a row belongs to, taken from the session; the scheduler takes it from the stored feed.
- **Feed**: one owner's subscription to one source address. **Folder**: a named group of one owner's feeds, one level deep; a feed is in at most one folder; the UI calls it `目录`. **Source**: the remote RSS, Atom or JSON Feed document. **Entry**: one article as the source lists it. **Feed item**: a stored entry; the UI calls it an article. **Saved page**: a page in the read-later list.
- **Retention**: N, the number of items a feed keeps. **Sync**: bringing a feed's items in line with its source; refresh is fetch plus sync and always runs through the refresh queue.
- **Arrival order**: feed items and saved pages are listed by `id` descending; ids are made in creation order, so the newest is on top, and a stored row's id never changes.
- **Boundary**: where outside data becomes typed values: HTTP handlers, adapters (fetchers, feed parser, article extractor, sanitizer) and configuration. **Port**: an interface business depends on, implemented by an adapter and provided by injection.

## Code layout

```text
packages/business/src/
  entity/
    common/        normalized-url, owner-id, article, option-from-optional-non-empty
    feed/          feed, feed-item, folder
    saved-page/    saved-page
    setting/       setting, retention, fetcher
  port/            webpage-fetcher, html-parser, document-sanitizer, article-extractor,
                   feed-repository, feed-item-repository, folder-repository,
                   feed-parser, saved-page-repository, setting-repository
  usecase/
    common/        fetch-and-extract, paging, errors
    feed/          fetch-parsed-feed, preview-feed, subscribe-feed, refresh-feed,
                   list-items, extract-item, create-folder, rename-folder,
                   move-feed, errors
    saved-page/    add-saved-page, save-feed-item, list-saved-pages, errors
    setting/       use-jina, use-browser, active-fetcher, errors
  index.ts         re-exports the public modules
```

- Group by layer first. `entity/` and `usecase/` are split by domain; `port/` is flat because port interfaces are generic.
- `entity/` holds only business entities and the value types of their fields; article values shared by feed items and saved pages live in `entity/common`. Paging, cursors, queries, use-case inputs and values a port returns (`ParsedFeed`, `ExtractedArticle`) are not entities.
- A port file holds the port interface (`interface I<Port>` next to its `Context.Service` class, key `@reader/business/<Port>`), the types it takes and returns (`FeedItemQuery`, `ParsedFeed`), and its own error. Use-case errors live in `usecase/<domain>/errors.ts`.
- `usecase/` holds every core function, pure or effectful. A function only one use case calls lives in that use case's module (the sync, the selection and the text cleaning are inside `refresh-feed`); `selectItems` is exported from that module only for its FD-SEL unit tests, not from the barrel. The paging arithmetic of CM-PAGE-4 (`pageQuery`, `pageOf`) is shared by the four list use cases from `usecase/common/paging.ts`; a few lines shared by only two use cases are repeated (the saved-page duplicate check).
- Inside the package, modules import each other by relative path. Every other package imports `@reader/business`; tests import the in-memory doubles and contract suites from `@reader/business/testing` (`packages/business/test/support/index.ts`).
- `packages/business/src` imports only `effect` and its submodules (`effect/schema`, `effect/http`): no other package, no `node:` module, nothing from `test/`. Check this on every new import.

## Implementation rules

- Use entities as the shared data types across ports and use cases; do not add repository-value or input variants that only omit or rename fields. Write methods take the values they write as parameters and are named by what they do; there are no patch types and no method that branches on which fields were given (CM-PORT-3).
- Ids are lower-case version-7 UUIDs: each id brand checks `Schema.isUUID(7)` and `Schema.isLowercased()`, and the entity's `id` field takes `Model.UuidV7WithGenerate` (`effect/schema`) as its constructor default. Use cases build new rows with the entity's `makeEffect` inside their own fiber, leave `id` out, and treat a construction failure as a defect (`Effect.orDie`). There is no id port; never compute an id from content (CM-ID).
- "Now" is only the injected `Clock`, read once per use case; ids are not times (CM-TIME).
- Value rules live in the entity schemas (URL normalization, article title and text, retention, Jina key, browser endpoint). The boundary decodes input into them once; use cases never re-validate or re-normalize. Keep context-dependent checks such as ownership, missing rows and duplicates; do not check a cursor against the scope or filter it is used with (CM-PAGE-7).
- Define use cases as plain functions returning `Effect.gen`, not `Effect.fn`. Propagate port errors unchanged; HTTP handlers map them. Return entities and business results; HTTP wrappers such as `{ item }` belong to the boundary. Do not read a row back after a successful write only to build the return value.
- An operation that forwards one port call gets no use case: find one, mark, mark all, mark folders, remove, unread counts, list feeds, list folders, unsubscribe, remove folders, read settings, set retention and clear the Jina key are direct port calls, and their rules are port contracts (CM-PORT).
- Behavior is switched by injection: the outer layer reads the owner's fetcher setting, asks `activeFetcher` which fetcher is in effect and provides the matching `WebpageFetcher` by exhaustive match; business takes no provider or owner parameter for fetching (CM-FETCH-2, SET-ACTIVE). Feed sources are fetched with Effect's `HttpClient` directly; there is no feed-fetcher port.
- Add no limits: no text-length cut, request-size, batch-size or page-size maximum, timeout or concurrency bound. The page size is a positive parameter from the caller. Add a limit only when running the application shows it is needed.

## Decisions behind the rules

- Saved pages and feed items are independent: saving an item copies it, and afterwards neither affects the other.
- Uniqueness is by URL, enforced by unique indexes: one feed per owner and URL, one item per feed and URL, one saved page per owner and URL; folders are unique per owner and name, case-sensitive. A saved-page duplicate is found with `findByUrl` before fetching; concurrent creates are decided inside `create` (CM-ID-6, CM-PORT-6).
- URLs: http and https only, tracking parameters and the fragment removed, credentials kept and never rejected by a fetcher (CM-URL). Every feed item has a URL, so every item can be saved; entries without a valid URL are dropped by the parser (FD-PARSE-2). What the parser takes from each format (the entry URL, text typing and escaping, the publish time field, the titles) is the FD-PARSE port contract, so a change of parsing library cannot change it unnoticed.
- Stored description and content are always sanitized: feed text by the cleaning step of the refresh through `DocumentSanitizer`, extracted pages by `ArticleExtractor` (CM-ART-4).
- Lists: feed items and saved pages by `id` descending, feeds by title then `id`, folders by name then `id`; feed items are listed by three use cases (all, one feed, one folder), each one port method, so no layer branches on a scope value (FD-LIST-1); `unreadOnly` is a boolean; the cursor is a row's `id`; reload means listing again from the first page, with no background reload or refresh-through (CM-PAGE).
- Retention follows the source's order: the first N listed entries are retained, stored items the source no longer lists are kept from the top of the list, the rest is removed from the bottom; read state plays no role (FD-SEL).
- A missing publish time stays none and is for display only; stored items are never updated from the source (FD-IMPORT-5, FD-SYNC-1).
- Subscribing creates the feed with the previewed title and enqueues a refresh; nothing is fetched in the request (FD-SUB). Refresh runs only through the application's refresh queue: at most one refresh per feed, failures logged and invisible to the user, a feed removed meanwhile is not an error (FD-SCHED, FD-REFRESH).
- Folders are one level deep and a feed is in at most one (`Feed.folderId`). The repository keeps `folderId` pointing at an existing folder of the owner with an atomic check; removing a folder unsubscribes its feeds; an unknown folder is an error only for rename, move into and subscribe into (FD-FOLDER, FD-MOVE).
- There is no feed-not-found error; `FeedItemNotFound` is raised only where an operation cannot go on without the item (FD-OWN-2).
- Repository write methods are named by intent (`markRead`, `markReadByFeeds`, `markAllRead`, `setExtractedContent`, `moveToFolder`, `recordSync`, `rename`, the setting writers); each is one fixed statement in the adapter; `moveToFolder`, `rename` and `setExtractedContent` return whether the row was written, `recordSync` returns nothing (CM-PORT-3, CM-PORT-5).
- Settings are grouped by category; choosing the fetcher is one operation per provider (`useJina`, `useBrowser`), each with its own optional input; the Jina key can be cleared, the browser endpoint only replaced; both are redacted and never sent to the browser (SET-FETCH, SET-VAL-4).

Done when the changed behavior matches the rule files, those files describe the new behavior, and the tests that name the affected rules pass.
