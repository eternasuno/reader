# Setting

Domain: per-user settings. Settings are grouped by category so that new categories never collide with existing fields.

Scope: business contract only. The HTTP interface, how values are written in a request, and the settings form are not specified here; `features/setting.feature` has reference scenarios for them.

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

- `Retention`: integer from 30 to 300.
- `JinaKey`: trimmed, non-empty, a single line of at most 2048 characters, redacted.
- `BrowserEndpoint`: URL with protocol http, https, ws or wss.
- These are the rules of the value types. Values are decoded into them at the boundary.
- Both providers' configuration is stored at the same time.

## Rules

### SET-GET — Read

- SET-GET-1 A user without stored settings reads the defaults above.
- SET-GET-2 `get` returns the full `Setting`. What of it is shown to the user is decided at the boundary.

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
- SET-FETCH-4 Invariant: provider is `browser` only if an endpoint is stored. It is enforced when writing, never at extraction time. The outer layer that builds the `WebpageFetcher` from the setting (CM-FETCH-2) relies on it.
- SET-FETCH-5 Switching provider never discards the other provider's configuration.

### SET-KEY — Clear Jina key

- SET-KEY-1 Clearing removes the stored key. The provider is unchanged.
- SET-KEY-2 Clearing when no key is stored succeeds and changes nothing.
- SET-KEY-3 The key can be cleared and the endpoint cannot (SET-ENDPOINT-1), because Jina works without a key while the browser provider cannot work without an endpoint.

### SET-ENDPOINT — Browser endpoint

- SET-ENDPOINT-1 There is no operation to clear the endpoint. It can only be replaced through SET-FETCH-2.
- SET-ENDPOINT-2 Consequence: once configured, an endpoint stays stored, even while the provider is `jina`.

### SET-OWN — Ownership

- SET-OWN-1 Every operation reads and writes only the signed-in user's settings.

## Use cases

Only one use case exists. The other operations call the port directly.

| Operation       | Implementation                                                   |
| --------------- | ---------------------------------------------------------------- |
| Read            | `SettingRepository.get`                                          |
| Set retention   | `SettingRepository.update({ feed: { retention } })`              |
| Clear Jina key  | `SettingRepository.update({ fetcher: { jina: { key: none } } })` |
| **Set fetcher** | Use case `setFetcher` (below)                                    |

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

## Errors

| Error                     | Carries | Meaning                                                            | Raised by                |
| ------------------------- | ------- | ------------------------------------------------------------------ | ------------------------ |
| `BrowserEndpointRequired` | nothing | The browser provider was chosen and no endpoint is given or stored | SET-FETCH-3              |
| `SettingRepositoryError`  | message | Storage failure                                                    | `SettingRepository` port |

## Port: SettingRepository

- `get(owner)`: returns the stored `Setting` with defaults filled in for anything not stored.
- `update(owner, patch)`: `patch` mirrors `Setting` by group. A missing field means no change; `Option.none` means clear. An empty patch writes nothing.
- The patch type is defined by hand per group (`feed`, `fetcher`) with all fields optional.

## Known risk

`setFetcher` reads then writes and is not atomic. A single user editing their own settings concurrently is not expected, so no lock is added.
