# Documentation index

This directory specifies the behavior of the reader: a self-hosted read-later and feed reader. A user saves web pages to read later, subscribes to feeds, and reads the articles in one place.

The specs describe the **target** behavior and structure, and state it without reference to the present code. The business core will be rewritten from them. The present code still matters as a reference, so everything about it is kept in one place: "The current code" at the end says where it differs and which parts can be carried over.

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

## Terms

| Term       | Meaning                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Owner      | The signed-in user a row belongs to. Always taken from the session                                 |
| Feed       | A subscription of one owner to one source address                                                  |
| Source     | The remote document (RSS, Atom, JSON Feed) a feed points at                                        |
| Entry      | One article as listed by a source, before it is stored                                             |
| Feed item  | A stored entry. The specs say "item"; the scenarios say "article", which is the word the user sees |
| Saved page | A page in the read-later list. The scenarios also say "page"                                       |
| Retention  | N, the number of items a feed keeps                                                                |
| Sync       | Bringing a feed's items in line with its source. Refresh is fetch plus sync, run by the scheduler  |
| Boundary   | Where outside data becomes typed values: HTTP handlers, the scheduler, adapters                    |
| Port       | An interface business depends on. An adapter implements it and is provided by dependency injection |

## Principles that apply everywhere

| Principle                                                        | Meaning                                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Parse at the boundary                                            | Parsing and validation happen only at the HTTP edge. Past it, branded values are trusted and never re-validated               |
| Entities carry the rules of their values                         | URL normalization and article values live in the entity schemas, not in use cases                                             |
| A use case exists only when a rule needs more than one port call | Operations that merely call a port have no use case; they are still listed in the specs so callers know they exist            |
| Ownership by owner                                               | The owner comes from the session. Every read and write is scoped by owner, so foreign ids behave as absent                    |
| Deterministic ids                                                | Ids are hashes of the identifying parts, so "already exists" is decided by id and duplicates are caught without a lookup race |
| Numbers of the deployment are not business values                | Business defines no page size, no text-length limit and no schedule. They are parameters or come from an injected config      |
| Behavior is switched by injection, not by parameters             | The outer layer reads what it needs (for example the fetcher setting) and provides the matching adapter to the use case       |
| Port contracts are business rules                                | Each repository port has one contract test suite that every implementation passes (CM-PORT)                                   |
| A use case module holds every core function                      | `usecase/` holds pure functions and functions that need ports alike                                                           |

## Documents

### `usecases/` — specifications

Each spec states entities, numbered rules, a table of use cases with input, output and errors, a table of errors, and the port contracts. Rules are numbered (for example `FD-SUB-1`) so tests, code and scenarios can point at them. A rule stated in `common.md` is referred to from the domain specs, not repeated.

| File                     | Prefix | Content                                                                                                                                                                                            |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usecases/common.md`     | `CM-`  | URL normalization, article values, the id helper, fetch-and-extract, text cleaning, paging and cursors, ownership, port contracts                                                                  |
| `usecases/setting.md`    | `SET-` | Setting entity grouped by category, setting the fetcher as a union by provider, clearing the Jina key, the "browser needs an address" invariant. Core logic only, no HTTP interface                |
| `usecases/saved-page.md` | `SP-`  | Entity and id, add a link, save a feed item, listing, read state, removal, unread count, port contract                                                                                             |
| `usecases/feed.md`       | `FD-`  | Entities and ids, fetch-and-parse helper, preview, item selection and retention, import, sync, subscribe, scheduled refresh, listing, find, extract, read state, unread counts, unsubscribe, ports |

Reading order: `common.md`, `setting.md`, `saved-page.md`, `feed.md`.

### `features/` — reference scenarios in Gherkin

Scenarios written from the user's side. They are a reference and a guide for changes in the outer layers (HTTP handlers, adapters, front end). They are not the source of truth for rules: when a scenario and a spec disagree, the spec wins. A comment above a scenario gives the rule it exercises. HTTP and form behavior that the specs leave out is described only here, under `@boundary` and `@ui`.

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
| URL normalization          | In the entity schema: http and https only, tracking parameters removed, the fragment always removed, credentials allowed. Pages of a site that routes by fragment collapse into one URL; this is accepted                                                         |
| Id hashing                 | SHA-256 of the JSON array of the parts, so part boundaries are kept                                                                                                                                                                                               |
| Sanitized text             | Stored description and content are always sanitized. Feed text is cleaned by business through the sanitizer port; extracted pages are sanitized by the extractor port                                                                                             |
| Duplicates                 | Detected by id before any fetching; `create` skipping an existing id covers concurrent requests                                                                                                                                                                   |
| Listing                    | Feed items newest published first; saved pages newest saved first (`savedAt`); id descending as tie-break; `unreadOnly` boolean; page size from the caller                                                                                                        |
| Cursor                     | A position (sort time and id), handled as a structured value in business; encoding is a boundary concern; changing scope or filter starts a new list                                                                                                              |
| Reloading                  | No refresh-through operation and no background refresh; reload means listing again from the first page                                                                                                                                                            |
| Read state                 | Marking by id list, by feed, and all, each stated separately; unknown ids are ignored; everything is idempotent                                                                                                                                                   |
| Retention                  | By the source's own order: the first N entries listed are imported and kept; beyond N, stored items the source no longer lists go first, oldest first. Read state plays no role. One rule serves a new feed and a refresh                                         |
| Missing publish time       | The extractor and the feed parser report it as none. The fallback to the current time is in the use cases (`fetchAndExtract`, `syncItems`). A time the source gives is used as given, even a future or wrong one                                                  |
| Source changes             | Stored items are never updated from the source; items the source drops stay until retention removes them                                                                                                                                                          |
| Subscribing                | Duplicate check, then fetch, then create, then sync. Once the feed is created subscribing succeeds; a failed sync is logged and the next refresh fills the feed                                                                                                   |
| Feed refresh               | Only by the scheduler; failures are logged and invisible to the user; the writes are not atomic; a feed removed meanwhile is not an error and leaves no items behind                                                                                              |
| Scheduler                  | In the application, not in business. Its interval, discovery interval and parallelism are its own configuration                                                                                                                                                   |
| Unsubscribing              | Idempotent; removes the feed and its items; saved pages stay                                                                                                                                                                                                      |
| Not found                  | There is no feed-not-found error: an unknown feed lists as empty and refreshes as a no-op. `FeedItemNotFound` only where an operation cannot go on without the item (extract, save to read later)                                                                 |
| Repository ports           | Generic patches (`update`, `updateByFeeds`, `updateAll`) rather than one method per intention; the boundary limits what may be patched                                                                                                                            |
| Limits                     | The text-length limit comes from an injected `FeedImportConfig`; the page size is a parameter bounded at the boundary                                                                                                                                             |
| Settings                   | Grouped by category; setting the fetcher is one operation with a union by provider; a stored key or address is kept when omitted; the Jina key can be cleared after confirmation; the browser address can only be replaced; secrets are never sent to the browser |
| Provider choice            | The outer layer reads the owner's fetcher setting and injects the matching `WebpageFetcher`. Business takes no provider or owner parameter for fetching                                                                                                           |

## Target code layout

Entities, ports and use cases are grouped by domain, and every domain has the same shape.

```text
packages/business/src/
  common/
    entity/        normalized-url, owner-id, article, option-from-optional-non-empty
    port/          webpage-fetcher, html-parser, document-sanitizer, article-extractor
    usecase/       hash-id, fetch-and-extract, clean-html, paging, errors
    index.ts
  feed/
    entity/        feed, feed-item, parsed-feed
    port/          feed-repository, feed-item-repository, feed-fetcher, feed-parser,
                   feed-import-config
    usecase/       fetch-parsed-feed, preview-feed, subscribe-feed, refresh-feed,
                   select-items, sync-items, list-items, extract-item, errors
    index.ts
  saved-page/
    entity/        saved-page
    port/          saved-page-repository
    usecase/       add-saved-page, save-feed-item, list-saved-pages, errors
    index.ts
  setting/
    entity/        setting, retention, fetcher
    port/          setting-repository
    usecase/       set-fetcher, errors
    index.ts
  index.ts         re-exports the four domains
```

Rules for the layout:

- Each domain has `entity/`, `port/`, `usecase/` and an `index.ts`. A domain with nothing to put in a folder omits it.
- `usecase/` holds every core function of the domain, whether it is pure (`hash-id`, `select-items`, `paging`) or needs ports.
- Errors of a domain live in `usecase/errors.ts` of that domain.
- Tests mirror the layout: `test/<domain>/entity/` and `test/<domain>/usecase/`. The contract suite of a repository port lives with the port's domain and is run by every implementation.
- Imports follow the dependency direction `SavedPage -> Feed -> Setting -> Common`. A domain imports another only through its `index.ts`.
- Adapters, HTTP handlers, the scheduler and the front end stay in their packages and apps; they import from the domain `index.ts` files.

## The current code

The business core is rewritten from the specs, not migrated step by step. The current code is the reference for details the specs leave to the implementation, so this section says what to carry over and where it must not be copied. It is the only place in `docs/` that describes the current code. The lists are a summary, not exhaustive.

### Parts that already match and can be carried over

| Part                           | Where                                                 | Note                                                                                      |
| ------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Id hashing                     | `usecase/identity.ts`                                 | SHA-256 over `JSON.stringify(parts)` is CM-ID-2. Only the parts change (see below)        |
| Fetch and extract              | `usecase/extract-page.ts`                             | Same flow as CM-FETCH                                                                     |
| Extractor sanitizes its output | `apps/api` `adapter/article-extractor.ts`             | Already satisfies CM-FETCH-3                                                              |
| Fetcher chosen by injection    | `apps/api` saved-page and feed-item handlers          | They read the setting and provide the `WebpageFetcher` layer, as CM-FETCH-2 asks          |
| Setting entity and value types | `entity/setting/`                                     | Same grouping                                                                             |
| Scheduler                      | `apps/api` `infrastructure/subscription-scheduler.ts` | Already outside business, with owner discovery as its own service. Same three numbers     |
| Repository patch semantics     | `port/*-repository.ts`, the SurrealDB stores          | Missing field means no change, `Option.none` means clear; skip-existing `create`; cascade |

### Differences

| Area           | Current code                                                                                                                                                                        | Spec                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Layout         | Grouped by layer (`entity/`, `port/`, `usecase/` at the top)                                                                                                                        | Grouped by domain                                                                                        |
| Read filter    | `ReadFilter` with `all`, `unread`, `read`                                                                                                                                           | Boolean `unreadOnly`                                                                                     |
| List refresh   | Refresh use cases, `through` queries, `listThrough` on both repositories, the `boundary` field of list results, two refresh endpoints, 30-second polling and in-place merge of rows | None of them. Reload means listing again from the first page                                             |
| Cursor         | Business encodes the cursor, checks owner, scope and filter, raises `InvalidCursor`                                                                                                 | A plain position, encoded at the boundary                                                                |
| Page size      | `PAGE_SIZE = 30` fixed in business                                                                                                                                                  | A parameter                                                                                              |
| Text limit     | `MAX_CONTENT_LENGTH = 100_000` in business and `MAX_FIELD_LENGTH = 100_000` in the parser adapter                                                                                   | `FeedImportConfig.maxTextLength`, injected                                                               |
| Ids            | Items and saved pages are hashed from URL, title, description and the parent id                                                                                                     | By URL; title and description only for items without a URL; a saved page requires a URL                  |
| URL            | The fragment is kept; the saved-page route rejects credentials (`InvalidPageUrl`)                                                                                                   | Fragment removed, credentials allowed                                                                    |
| SavedPage      | No `savedAt`, listed by `publishedAt`; duplicates found after fetching; an item without a URL can be saved; saving an item resolves the feed first                                  | `savedAt` and listing by it; duplicate check before fetching; URL required; item found by owner and id   |
| Feed items     | No `ownerId`; every operation resolves the feed first; `create` does not check that the feed exists                                                                                 | Scoped by owner; items created only while their feed exists; `updateAll` added                           |
| Feed use cases | Preview and unsubscribe live in the route                                                                                                                                           | Preview in business; unsubscribe is one port call with cascading removal                                 |
| Subscribing    | Initial import fixed at 30 through its own selection function; import failure is reported as `FeedImportFailed` (mapped in the route, handled by the front end)                     | Same sync as a refresh, using the retention setting; no `FeedImportFailed`, subscribing succeeds         |
| Selection      | Stored and new candidates are ordered by publish time and the newest N kept; a new entry older than all kept ones is not imported                                                   | The first N entries in source order are imported; publish time only orders the removal of unlisted items |
| Missing dates  | The extractor adapter and the feed parser adapter each fall back to the current time themselves                                                                                     | They return none; the fallback is in `fetchAndExtract` and `syncItems`                                   |
| Feed title     | Plain string, may be empty                                                                                                                                                          | `FeedTitle`; empty becomes the host                                                                      |
| Not found      | `FeedNotFound` raised by listing one feed, refresh and several item operations                                                                                                      | No `FeedNotFound`                                                                                        |
| Error names    | `FeedExists`, `DuplicateSavedPage`, `SettingsRepository`                                                                                                                            | `FeedAlreadyExists`, `SavedPageAlreadyExists`, `SettingRepository`                                       |
| Settings       | Separate set and delete endpoints for the key and the address, auto-fallback of the provider, `updateSettings` use case                                                             | Set retention, set fetcher, clear key; no address clearing                                               |
| Contract tests | Store tests exist per adapter; test doubles are not held to the same suite                                                                                                          | One contract suite per repository port (CM-PORT-2)                                                       |
