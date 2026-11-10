# Documentation index

This directory specifies the behavior of the reader: a self-hosted read-later and feed reader. A user saves web pages to read later, subscribes to feeds, and reads the articles in one place.

The specs describe the **target** behavior and structure. The code has not been aligned with them yet; see "Gaps against the current code" at the end.

## Overview

The business core (`packages/business`) is split into four domains. Each domain owns its entities, its use cases and the ports it needs.

| Domain    | What it owns                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feed      | Subscriptions and their items: preview, subscribe, scheduled refresh, item selection and retention, listing, extraction, read state, unread counts, unsubscribe |
| SavedPage | Pages saved to read later: add a link, save a feed item, listing, read state, removal, unread count                                                             |
| Setting   | Per-user settings: article retention and how pages are fetched (Jina or a browser service)                                                                      |
| Common    | Rules and helpers used by more than one domain: URL normalization, article values, id helper, fetching and extracting an article, cleaning feed text, paging    |

Accounts, sessions and the HTTP and browser layers are outside the business core. They are described by scenarios only (`features/account.feature`).

Dependencies between domains point one way and have no cycles:

```text
SavedPage -> Feed -> Setting -> Common
```

SavedPage reads feed items to save a copy. Feed reads the retention setting to decide how many items to keep. Every domain may use Common.

## Principles that apply everywhere

| Principle                                                        | Meaning                                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Parse at the boundary                                            | Parsing and validation happen only at the HTTP edge. Past it, branded values are trusted and never re-validated               |
| Entities carry the rules of their values                         | URL normalization and article values live in the entity schemas, not in use cases                                             |
| A use case exists only when a rule needs more than one port call | Operations that merely call a port have no use case; they are still listed in the specs so callers know they exist            |
| Ownership by owner                                               | The owner comes from the session. Every read and write is scoped by owner, so foreign ids behave as absent                    |
| Deterministic ids                                                | Ids are hashes of the identifying parts, so "already exists" is decided by id and duplicates are caught without a lookup race |
| Page size and similar limits are parameters                      | Business defines no page size and no text-length limit                                                                        |
| No background list refresh                                       | Lists are loaded from the first page on entering, on switching scope or filter, and on an explicit refresh                    |

## Documents

### `usecases/` — specifications

Each spec states entities, numbered rules, use cases, error cases and the port contracts. Rules are numbered (for example `FD-SUB-1`) so tests, code and scenarios can point at them.

| File                     | Prefix | Content                                                                                                                                                                                               |
| ------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usecases/common.md`     | `CM-`  | URL normalization, article values, the id helper, fetch-and-extract, text cleaning, paging and cursors, ownership                                                                                     |
| `usecases/setting.md`    | `SET-` | Settings entity grouped by category, setting the fetcher as a union by provider, clearing the Jina key, the "browser needs an address" invariant, the user flow                                       |
| `usecases/saved-page.md` | `SP-`  | Entity and id, add a link, save a feed item, listing and reloading, read state, removal, unread count, port contract                                                                                  |
| `usecases/feed.md`       | `FD-`  | Entities and ids, fetch-and-parse helper, preview, subscribe, item selection and retention, import, scheduled refresh, listing, find, extract, read state, unread counts, unsubscribe, port contracts |

Reading order: `common.md`, `setting.md`, `saved-page.md`, `feed.md`.

### `features/` — reference scenarios in Gherkin

Scenarios written from the user's side. They are a reference and a guide for changes in the outer layers (HTTP handlers, adapters, front end). They are not the source of truth for rules: when a scenario and a spec disagree, the spec wins. Comments above a scenario give the rule number it exercises.

| File                          | Domain                                           |
| ----------------------------- | ------------------------------------------------ |
| `features/feed.feature`       | Feed                                             |
| `features/saved-page.feature` | SavedPage                                        |
| `features/setting.feature`    | Setting                                          |
| `features/account.feature`    | Accounts and sessions (outer layer, Better Auth) |

Tags:

| Tag         | Meaning                                                     |
| ----------- | ----------------------------------------------------------- |
| `@ui`       | Front-end behavior. Not a business rule                     |
| `@boundary` | Parsing done at the HTTP edge                               |
| `@system`   | Behavior with no user action, such as the scheduled refresh |

## Decisions that shaped the specs

| Topic                      | Decision                                                                                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domains                    | Split by entity: Feed (with its items), SavedPage, Setting; shared logic in Common                                                                                                                                                                                |
| Saved pages and feed items | Independent. Saving an item copies it; afterwards they never affect each other                                                                                                                                                                                    |
| Identity                   | Feed `hashId(owner, url)`; feed item `hashId(feedId, url)` or, without a URL, `hashId(feedId, title, description)`; saved page `hashId(owner, url)`. No entity-type prefix                                                                                        |
| Saved page URL             | Required. A feed item without a URL cannot be saved                                                                                                                                                                                                               |
| URL normalization          | In the entity schema: http and https only, tracking parameters and fragment removed, credentials allowed                                                                                                                                                          |
| Duplicates                 | Detected by id before any fetching; `create` skipping an existing id covers concurrent requests                                                                                                                                                                   |
| Listing                    | Newest published first, id descending as tie-break; `unreadOnly` boolean; page size from the caller                                                                                                                                                               |
| Cursor                     | A position `{ publishedAt, id }`, handled as a structured value in business; encoding is a boundary concern; changing scope or filter starts a new list                                                                                                           |
| Reloading                  | No refresh-through operation and no background refresh; reload means listing again from the first page                                                                                                                                                            |
| Read state                 | Marking by id list, by feed, and all, each stated separately; unknown ids are ignored; everything is idempotent                                                                                                                                                   |
| Retention                  | Only by publish time; read state plays no role; the initial import also uses the retention setting                                                                                                                                                                |
| Source changes             | Stored items are never updated from the source; items the source drops stay until retention removes them                                                                                                                                                          |
| Subscribing                | Duplicate check, then fetch, then create, then import; if the import fails the subscription is kept and the error carries its id                                                                                                                                  |
| Feed refresh               | Only by the scheduler, every 30 minutes; failures are logged and invisible to the user; the writes are not atomic                                                                                                                                                 |
| Unsubscribing              | Idempotent; removes the feed and its items; saved pages stay                                                                                                                                                                                                      |
| Not found                  | `FeedNotFound` only when listing the items of one feed and in the scheduled refresh; elsewhere an unknown feed or item means "nothing there"                                                                                                                      |
| Settings                   | Grouped by category; setting the fetcher is one operation with a union by provider; a stored key or address is kept when omitted; the Jina key can be cleared after confirmation; the browser address can only be replaced; secrets are never sent to the browser |
| Provider choice            | Which provider fetches pages is decided outside business                                                                                                                                                                                                          |

## Target code layout

Entities, ports and use cases are grouped by domain, and every domain has the same shape. This is the target; the code is currently grouped by layer.

```text
packages/business/src/
  common/
    entity/        normalized-url, owner-id, article, option-from-optional-non-empty
    port/          webpage-fetcher, html-parser, document-sanitizer, article-extractor
    usecase/       hash-id, fetch-and-extract, clean-html, paging
    index.ts
  feed/
    entity/        feed, feed-item
    port/          feed-repository, feed-item-repository, feed-fetcher, feed-parser
    usecase/       fetch-parsed-feed, preview-feed, subscribe-feed, refresh-feed,
                   select-items, import-items, list-items, extract-item, errors
    index.ts
  saved-page/
    entity/        saved-page
    port/          saved-page-repository
    usecase/       add-saved-page, save-feed-item, list-saved-pages, errors
    index.ts
  setting/
    entity/        setting, retention, fetcher
    port/          settings-repository
    usecase/       set-fetcher, errors
    index.ts
  index.ts         re-exports the four domains
```

Rules for the layout:

- Each domain has `entity/`, `port/`, `usecase/` and an `index.ts`. A domain with nothing to put in a folder omits it.
- Errors of a domain live in `usecase/errors.ts` of that domain.
- Tests mirror the layout: `test/<domain>/entity/` and `test/<domain>/usecase/`.
- Imports follow the dependency direction `SavedPage -> Feed -> Setting -> Common`. A domain imports another only through its `index.ts`.
- Adapters, HTTP handlers and the front end stay in their packages and apps; they import from the domain `index.ts` files.

## Gaps against the current code

The specs differ from the code in these main places. The list is a summary, not exhaustive.

| Area           | Gap                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout         | Code is grouped by layer (`entity/`, `port/`, `usecase/` at the top), not by domain                                                                                                                                                                                                      |
| Read filter    | `ReadFilter` has `all`, `unread`, `read`; the spec uses a boolean `unreadOnly`                                                                                                                                                                                                           |
| Refresh        | The list refresh use cases, `through` queries, `listThrough` on both repositories, the `boundary` field of list results, the two refresh endpoints, the 30-second polling and the in-place merge of refreshed rows exist; the spec has none of them. The front end has no refresh button |
| Cursor         | Business encodes the cursor and checks owner, scope and filter, and raises `InvalidCursor`; the spec uses a plain position, encoded at the boundary                                                                                                                                      |
| Page size      | `PAGE_SIZE = 30` is fixed in business; the spec takes it as a parameter                                                                                                                                                                                                                  |
| Text cleaning  | The 100,000 character cut is a constant; the spec takes it as a parameter                                                                                                                                                                                                                |
| Ids            | Items and saved pages are hashed with title and description; the spec uses the URL, and requires a URL for saved pages                                                                                                                                                                   |
| URL            | The fragment is kept, and the saved-page route rejects credentials (`InvalidPageUrl`); the spec removes the fragment and allows credentials                                                                                                                                              |
| SavedPage      | Duplicates are found after fetching, and a feed item without a URL can be saved; the spec checks before fetching and forbids it                                                                                                                                                          |
| Feed items     | Items have no `ownerId` and every operation resolves the feed first; the spec scopes by owner                                                                                                                                                                                            |
| Feed use cases | Preview and unsubscribe live in the route; the spec puts preview in business and makes unsubscribe a single port call with cascading removal                                                                                                                                             |
| Subscribing    | The initial import is fixed at 30; the spec uses the retention setting. The import-failure mapping is in the route                                                                                                                                                                       |
| Retention      | Matches the spec (by time, read state ignored)                                                                                                                                                                                                                                           |
| Not found      | Several item operations raise `FeedNotFound`; the spec limits it to listing one feed and the scheduled refresh                                                                                                                                                                           |
| Settings       | Separate set and delete endpoints for the key and the address, auto-fallback of the provider, `updateSettings` use case with `BrowserEndpointRequired`; the spec has set-retention, set-fetcher, clear-key, no address clearing, and the key's length limit at the boundary              |
