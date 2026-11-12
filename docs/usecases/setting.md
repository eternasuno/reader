# Setting

Domain: per-user settings. Settings are grouped by category so that new categories never collide with existing fields.

Scope: business contract only. The HTTP interface, how values are written in a request, and the settings form are not specified here; `features/setting.feature` has reference scenarios for them.

## Entity

```text
Setting
  ownerId
  feed
    retention        Retention        positive integer, default 100
  fetcher
    provider         FetcherProvider  "jina" | "browser", default "jina"
    jina
      key            Option<JinaKey>             default none
    browser
      endpoint       Option<BrowserEndpoint>     default none
```

The rules of the value types are in SET-VAL. Values are decoded into them at the boundary. Both providers' configuration is stored at the same time.

## Rules

### SET-VAL — Value types

- SET-VAL-1 `Retention`: a positive integer, default 100.
- SET-VAL-2 `JinaKey`: trimmed, non-empty, redacted.
- SET-VAL-3 `BrowserEndpoint`: a URL with protocol http, https, ws or wss, redacted.
- SET-VAL-4 Redacted means never written to logs, error messages or debug output. Neither the key nor the endpoint is ever sent to the browser; the boundary returns only whether each is configured.
- SET-VAL-5 The range and the default of a business value belong to its entity type, not to a use case or to the deployment.
- SET-VAL-6 The boundary decodes input into these types. For the optional `key` and `endpoint` inputs of `setFetcher`, a field that is omitted, empty or blank counts as not given. A required input that is missing, empty or invalid is rejected at the boundary: `retention` of "set retention" and `provider` of `setFetcher`.

### SET-GET — Read

- SET-GET-1 A user without stored settings reads the defaults above.
- SET-GET-2 `get` returns the full `Setting`. What of it is shown to the user is decided at the boundary, which never reveals the key or the endpoint (SET-VAL-4).

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
- SET-FETCH-4 Invariant: provider is `browser` only if an endpoint is stored. The operations hold it, not the port: only `setFetcher` and "clear Jina key" write these fields, `setFetcher` refuses `browser` without an endpoint, "clear Jina key" never touches the provider or the endpoint, and no operation clears the endpoint. The port does not check it. The outer layer that builds the `WebpageFetcher` from the setting (CM-FETCH-2) relies on it.
- SET-FETCH-5 Switching provider never discards the other provider's configuration.

### SET-KEY — Clear Jina key

- SET-KEY-1 Clearing removes the stored key. The provider is unchanged.
- SET-KEY-2 Clearing when no key is stored changes nothing observable through `get`.
- SET-KEY-3 The key can be cleared and the endpoint cannot (SET-ENDPOINT-1), because Jina works without a key while the browser provider cannot work without an endpoint.

### SET-ENDPOINT — Browser endpoint

- SET-ENDPOINT-1 No operation clears the endpoint. It can only be replaced through SET-FETCH-2.
- SET-ENDPOINT-2 Consequence: once configured, an endpoint stays stored, even while the provider is `jina`.

### SET-OWN — Ownership

- SET-OWN-1 Every operation reads and writes only the settings of the owner passed in (CM-OWN). The scheduler reads the retention of the feed's owner.

## Use cases

Only one use case exists. The other operations call the port directly.

| Operation       | Input                    | Output    | Errors                                              | Implementation                                                   |
| --------------- | ------------------------ | --------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| Read            | `owner`                  | `Setting` | `SettingRepositoryError`                            | `SettingRepository.get`                                          |
| Set retention   | `owner`, `retention`     | nothing   | `SettingRepositoryError`                            | `SettingRepository.update({ feed: { retention } })`              |
| Clear Jina key  | `owner`                  | nothing   | `SettingRepositoryError`                            | `SettingRepository.update({ fetcher: { jina: { key: none } } })` |
| **Set fetcher** | `owner`, the input above | nothing   | `SettingRepositoryError`, `BrowserEndpointRequired` | Use case `setFetcher` (below)                                    |

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
- `update(owner, patch)`: the patch type is derived from the writable fields of `Setting` (everything except `ownerId`), by group, every field an optional key. A missing field means no change; `Option.none` means clear. One call merges the given leaf fields atomically, so two concurrent updates of different fields both survive; for the same field the last write wins. A patch with no leaf field, including nested empty groups such as `{ feed: {} }`, writes nothing. It returns nothing. The first write for an owner creates the stored setting. The repository patch can still express `endpoint: none`; no business operation and no HTTP operation builds such a patch, so the endpoint can never be cleared (SET-ENDPOINT-1). HTTP handlers build only the patches of the listed operations and never forward a client patch to the port.
- The port does not check SET-FETCH-4; the operations that write these fields hold it.
- Which fields a caller may patch is limited at the boundary (CM-PORT-3). Patch and write semantics follow CM-PORT.

## Known risk

`setFetcher` reads then writes. Because an endpoint once stored can never be cleared, the read cannot be invalidated. The only effect of concurrent `setFetcher` calls is that the last provider written wins.
