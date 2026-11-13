# Setting

Domain: per-user settings. Settings are grouped by category so that new categories never collide with existing fields.

Scope: business contract only. The HTTP interface, how values are written in a request, and the settings form are not specified here; the HTTP boundary rules are in the `project-effect-api` skill and the settings form in the `project-architecture` skill's `reader-ui.md`.

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
- SET-VAL-6 The boundary decodes input into these types. For the optional `key` of `useJina` and the optional `endpoint` of `useBrowser`, a field that is omitted, empty or blank counts as not given. A required input that is missing, empty or invalid is rejected at the boundary: `retention` of "set retention". Which provider is chosen is given by the entry point, never by an input field.

### SET-GET — Read

- SET-GET-1 A user without stored settings reads the defaults above.
- SET-GET-2 `get` returns the full `Setting`. What of it is shown to the user is decided at the boundary, which never reveals the key or the endpoint (SET-VAL-4).

### SET-FEED — Retention

- SET-FEED-1 Setting the retention stores the value. Nothing else happens.
- SET-FEED-2 It takes effect on the next feed refresh. Existing items are not trimmed immediately.

### SET-FETCH — Choose the fetcher

Two operations, one per provider, because they write different fields and fail differently: `useJina(owner, key?)` and `useBrowser(owner, endpoint?)`. No operation takes the provider as a value.

- SET-FETCH-1 `useJina`: provider becomes `jina`. If `key` is given it replaces the stored key, in the same write as the provider (`selectJinaWithKey`); if omitted the stored key is kept (`selectJina`). The stored browser endpoint is untouched.
- SET-FETCH-2 `useBrowser`: provider becomes `browser`. If `endpoint` is given it replaces the stored endpoint, in the same write as the provider (`selectBrowserWithEndpoint`); if omitted the stored endpoint is kept (`selectBrowser`). The stored Jina key is untouched.
- SET-FETCH-3 `useBrowser` with no `endpoint` and no stored endpoint fails with `BrowserEndpointRequired`. Nothing is stored.
- SET-FETCH-4 Invariant: provider is `browser` only if an endpoint is stored. The operations hold it, not the port: only `useJina`, `useBrowser` and "clear Jina key" write these fields, `useBrowser` refuses `browser` without an endpoint and writes a given endpoint together with the provider, "clear Jina key" never touches the provider or the endpoint, and no operation clears the endpoint. The port does not check it. `activeFetcher` (SET-ACTIVE) relies on it and reports a violation as a defect.
- SET-FETCH-5 Switching provider never discards the other provider's configuration.

### SET-KEY — Clear Jina key

- SET-KEY-1 Clearing removes the stored key. The provider is unchanged.
- SET-KEY-2 Clearing when no key is stored changes nothing observable through `get`.
- SET-KEY-3 The key can be cleared and the endpoint cannot (SET-ENDPOINT-1), because Jina works without a key while the browser provider cannot work without an endpoint.

### SET-ENDPOINT — Browser endpoint

- SET-ENDPOINT-1 No operation clears the endpoint. It can only be replaced through SET-FETCH-2.
- SET-ENDPOINT-2 Consequence: once configured, an endpoint stays stored, even while the provider is `jina`.

### SET-ACTIVE — The fetcher in effect

`activeFetcher(setting)` (`usecase/setting/active-fetcher.ts`) tells the outer layer which fetcher the owner's setting selects, as a closed union `ActiveFetcher`: `Jina { key: Option<JinaKey> }` or `Browser { endpoint: BrowserEndpoint }`.

- SET-ACTIVE-1 Provider `jina` gives `Jina` with the stored key, which may be none; provider `browser` with a stored endpoint gives `Browser` with that endpoint.
- SET-ACTIVE-2 Provider `browser` with no stored endpoint cannot occur (SET-FETCH-4). `activeFetcher` treats it as a defect: it never falls back to Jina and never hides the broken state. The state can only come from a bug or a hand-edited database, so it is surfaced, not masked.
- SET-ACTIVE-3 The outer layer maps `ActiveFetcher` to a `WebpageFetcher` by exhaustive match and reads no other setting field for that purpose (CM-FETCH-2). No business condition about providers lives outside business.

### SET-OWN — Ownership

- SET-OWN-1 Every operation reads and writes only the settings of the owner passed in (CM-OWN). The scheduler reads the retention of the feed's owner.

## Use cases

Two use cases exist, `useJina` and `useBrowser` (`usecase/setting/use-jina.ts`, `use-browser.ts`). The other operations call the port directly.

| Operation       | Input                | Output    | Errors                                              | Implementation                   |
| --------------- | -------------------- | --------- | --------------------------------------------------- | -------------------------------- |
| Read            | `owner`              | `Setting` | `SettingRepositoryError`                            | `SettingRepository.get`          |
| Fetcher in effect | `setting`          | `Effect<ActiveFetcher>` | none (a broken SET-FETCH-4 dies as a defect) | `activeFetcher` (SET-ACTIVE), reads no port |
| Set retention   | `owner`, `retention` | nothing   | `SettingRepositoryError`                            | `SettingRepository.setRetention` |
| Clear Jina key  | `owner`              | nothing   | `SettingRepositoryError`                            | `SettingRepository.clearJinaKey` |
| **Use Jina**    | `owner`, `key?`      | nothing   | `SettingRepositoryError`                            | Use case `useJina` (below)       |
| **Use browser** | `owner`, `endpoint?` | nothing   | `SettingRepositoryError`, `BrowserEndpointRequired` | Use case `useBrowser` (below)    |

```text
useJina(owner, key?)
  key given:   selectJinaWithKey(owner, key)
  key omitted: selectJina(owner)

useBrowser(owner, endpoint?)
  endpoint given:   selectBrowserWithEndpoint(owner, endpoint)
  endpoint omitted: current = get(owner)
                    if current.fetcher.browser.endpoint is none: fail BrowserEndpointRequired
                    selectBrowser(owner)
```

The only branch is on whether the optional input was given, at the place where that difference arises; below the use case every call is one fixed write.

## Errors

| Error                     | Carries | Meaning                                                            | Raised by                |
| ------------------------- | ------- | ------------------------------------------------------------------ | ------------------------ |
| `BrowserEndpointRequired` | nothing | The browser provider was chosen and no endpoint is given or stored | SET-FETCH-3              |
| `SettingRepositoryError`  | message | Storage failure                                                    | `SettingRepository` port |

## Port: SettingRepository

- `get(owner)`: returns the stored `Setting` with defaults filled in for anything not stored.
- Six writers, each one fixed write of the named fields that leaves every other field as it is (CM-PORT-3); none returns anything. The first write creates the owner's row with the defaults for the other fields. Two concurrent writers of different fields both survive; for the same field the last write wins.

| Writer                                       | Writes                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `setRetention(owner, retention)`             | `feed.retention`                                                            |
| `selectJina(owner)`                          | `fetcher.provider = "jina"`                                                 |
| `selectJinaWithKey(owner, key)`              | `fetcher.provider = "jina"`, `fetcher.jina.key = some(key)`                 |
| `clearJinaKey(owner)`                        | `fetcher.jina.key = none`                                                   |
| `selectBrowser(owner)`                       | `fetcher.provider = "browser"`                                              |
| `selectBrowserWithEndpoint(owner, endpoint)` | `fetcher.provider = "browser"`, `fetcher.browser.endpoint = some(endpoint)` |

- The port does not check SET-FETCH-4; the operations that write these fields hold it. There is no writer that clears the endpoint (SET-ENDPOINT-1).

## Known risk

`useBrowser` without an endpoint reads then writes. Because an endpoint once stored can never be cleared, the read cannot be invalidated. The only effect of concurrent `useJina` and `useBrowser` calls is that the last provider written wins.
