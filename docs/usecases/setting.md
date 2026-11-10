# Setting

Domain: per-user settings. Settings are grouped by category so that new categories never collide with existing fields.

Principle: parsing and validation happen only at the boundary (HTTP). Past the boundary, brand types are trusted and never re-validated. Use cases exist only where a rule needs more than a single port call.

## Entity

```text
Setting
  ownerId
  feed
    retention        Retention        integer 30..300, default 100
  fetcher
    provider         FetcherProvider  "jina" | "browser", default "jina"
    jina
      key            Option<JinaKey>             default none
    browser
      endpoint       Option<BrowserEndpoint>     default none
```

- `JinaKey`: trimmed, non-empty, redacted.
- `BrowserEndpoint`: URL with protocol http, https, ws or wss.
- Both providers' configuration is stored at the same time.

## Rules

### SET-GET — Read

- SET-GET-1 A user without stored settings reads the defaults above.
- SET-GET-2 `get` returns the full `Setting`.
- SET-GET-3 The API never sends the Jina key or the browser endpoint to the browser. It sends only whether each is configured.

### SET-FEED — Retention

- SET-FEED-1 Setting the retention stores the value. Nothing else happens.
- SET-FEED-2 It takes effect on the next feed refresh. Existing items are not trimmed immediately.

### SET-FETCH — Set fetcher

Input is a union by provider:

| Variant | Fields                             |
| ------- | ---------------------------------- |
| Jina    | `provider: "jina"`, `key?`         |
| Browser | `provider: "browser"`, `endpoint?` |

- SET-FETCH-1 Jina variant: provider becomes `jina`. If `key` is given it replaces the stored key; if omitted the stored key is kept. The stored browser endpoint is untouched.
- SET-FETCH-2 Browser variant: provider becomes `browser`. If `endpoint` is given it replaces the stored endpoint; if omitted the stored endpoint is kept. The stored Jina key is untouched.
- SET-FETCH-3 Browser variant with no `endpoint` and no stored endpoint fails with `BrowserEndpointRequired`. Nothing is stored.
- SET-FETCH-4 Invariant: provider is `browser` only if an endpoint is stored. It is enforced when writing, never at extraction time.
- SET-FETCH-5 Switching provider never discards the other provider's configuration.

### SET-KEY — Clear Jina key

- SET-KEY-1 Clearing removes the stored key. The provider is unchanged.
- SET-KEY-2 Clearing when no key is stored succeeds and changes nothing.
- SET-KEY-3 The user interface asks for confirmation before calling it.

### SET-ENDPOINT — Browser endpoint

- SET-ENDPOINT-1 There is no operation to clear the endpoint. It can only be replaced through SET-FETCH-2.
- SET-ENDPOINT-2 Consequence: once configured, an endpoint stays stored, even while the provider is `jina`.

### SET-OWN — Ownership

- SET-OWN-1 Every operation reads and writes only the signed-in user's settings.

## Use cases

Only one use case exists. The other operations call the port directly.

| Operation       | Implementation                                                    |
| --------------- | ----------------------------------------------------------------- |
| Read            | `SettingsRepository.get`                                          |
| Set retention   | `SettingsRepository.update({ feed: { retention } })`              |
| Clear Jina key  | `SettingsRepository.update({ fetcher: { jina: { key: none } } })` |
| **Set fetcher** | Use case `setFetcher` (below)                                     |

```text
setFetcher(owner, input)
  jina:
    update { fetcher: { provider: "jina", jina?: { key: some(key) } } }
  browser:
    if input.endpoint is absent:
      current = get(owner)
      if current.fetcher.browser.endpoint is none: fail BrowserEndpointRequired
    update { fetcher: { provider: "browser", browser?: { endpoint: some(endpoint) } } }
```

Errors: `BrowserEndpointRequired`, `SettingsRepositoryError`.

## Port: SettingsRepository

- `get(owner)`: returns the stored `Setting` with defaults filled in for anything not stored.
- `update(owner, patch)`: `patch` mirrors `Setting` by group. A missing field means no change; `Option.none` means clear. An empty patch writes nothing.
- The patch type is defined by hand per group (`feed`, `fetcher`) with all fields optional.

## Boundary (not business)

| Concern                                        | Where                                              |
| ---------------------------------------------- | -------------------------------------------------- |
| Jina key: single line, at most 2048 characters | HTTP boundary, then converted to `JinaKey`         |
| Browser endpoint protocol                      | HTTP boundary, then converted to `BrowserEndpoint` |
| Retention integer 30..300                      | HTTP boundary, then converted to `Retention`       |
| Blank key or blank endpoint in the request     | Treated as omitted                                 |

HTTP interface:

| Operation      | Request                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| Read           | `GET settings` returns retention, provider, `jinaConfigured`, `browserConfigured` |
| Set retention  | `PUT settings/retention`                                                          |
| Set fetcher    | `PUT settings/fetcher` with the union above                                       |
| Clear Jina key | `DELETE settings/jina-key`                                                        |

## User flow

One form, one save:

1. The user picks a provider. This only changes the draft and shows that provider's fields.
2. The user fills that provider's field. A configured key or endpoint shows "configured"; leaving it empty keeps the stored value.
3. For the browser with no stored endpoint the field is required.
4. Save submits the provider and its field together (SET-FETCH).
5. A configured Jina key has a Clear button next to it, with a confirmation (SET-KEY).

| Scenario                               | Result                                                |
| -------------------------------------- | ----------------------------------------------------- |
| New user                               | Jina, no key, anonymous fetching                      |
| Use Jina with a key                    | Jina variant with `key`                               |
| First use of the browser               | Browser variant must carry `endpoint`                 |
| Back to Jina                           | Jina variant without `key`; endpoint and key are kept |
| Browser again, endpoint already stored | Browser variant without `endpoint` succeeds           |
| Change browser endpoint                | Browser variant with the new `endpoint`               |
| Remove the Jina key                    | Clear Jina key, after confirmation                    |

## Known risk

`setFetcher` reads then writes and is not atomic. A single user editing their own settings concurrently is not expected, so no lock is added.
