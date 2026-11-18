# Settings

Per-user settings: how many articles a feed keeps (SET-FEED), which fetcher turns a web page into article text — Jina, or a browser service the user runs (SET-FETCH) — and reading, changing and clearing those values. This file owns the rules, the `/settings` page and its endpoints. Which fetcher a request uses is decided here and consumed by extraction in [later.md](later.md) and [feeds.md](feeds.md); what retention does during a refresh is [feeds-refresh.md](feeds-refresh.md). The `账号` section of the same page is [account.md](account.md); the routes, the session every route needs and the shared loading and error messages are in [SKILL.md](SKILL.md).

## Rules

### SET-VAL — Value types

- SET-VAL-1 `Retention`: a positive integer, default 100.
- SET-VAL-2 `JinaKey`: trimmed, non-empty, redacted.
- SET-VAL-3 `BrowserEndpoint`: a URL with protocol http, https, ws or wss, redacted. The value is the URL's standard serialization (CM-URL-6), so `ws://127.0.0.1:9222` is stored as `ws://127.0.0.1:9222/`; surrounding whitespace is trimmed before decoding.
- SET-VAL-4 Redacted means never written to logs, error messages or debug output, and never sent to the browser: no response, no error body and no log line carries either value. A read reports only whether each one is stored (SET-GET-2).
- SET-VAL-5 The range and the default of a business value belong to its entity type, not to an operation or to the deployment.
- SET-VAL-6 The boundary decodes input into these types. For the optional `key` of "use Jina" and the optional `endpoint` of "use browser", a field that is omitted, empty or blank counts as not given, so the stored value is kept: the client trims the field and omits it when nothing is left, and the server treats a blank string the same way. A required value that is well formed but breaks its value rule is rejected at the boundary under that value's own tag, as the API section of this file lists. A key cannot break a value rule, because a blank key already counts as not given. Which provider is chosen is given by the entry point, never by an input field.

### SET-GET — Read

- SET-GET-1 A user without stored settings reads the schema defaults (retention 100, provider `jina`, no key, no endpoint).
- SET-GET-2 `get` returns the full `Setting`. What of it is shown to the user is decided at the boundary, which never reveals the key or the endpoint (SET-VAL-4): a read answers exactly `retention`, `provider`, `jinaKeyConfigured` and `browserEndpointConfigured`, and no other field of the `Setting` and no secret value ever appears in a response.

### SET-FEED — Retention

- SET-FEED-1 Setting the retention stores the value. Nothing else happens.
- SET-FEED-2 It takes effect on the next feed refresh. Existing items are not trimmed immediately.

### SET-FETCH — Choose the fetcher

Two operations, one per provider, because they write different fields and fail differently: `useJina(owner, key?)` and `useBrowser(owner, endpoint?)`. No operation takes the provider as a value.

- SET-FETCH-1 `useJina`: provider becomes `jina`. If `key` is given it replaces the stored key, in the same write as the provider; if omitted the stored key is kept. The stored browser endpoint is untouched.
- SET-FETCH-2 `useBrowser`: provider becomes `browser`. If `endpoint` is given it replaces the stored endpoint, in the same write as the provider; if omitted the stored endpoint is kept. The stored Jina key is untouched.
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

`activeFetcher(setting)` tells the outer layer which fetcher the owner's setting selects, as a closed union `ActiveFetcher`: `Jina { key: Option<JinaKey> }` or `Browser { endpoint: BrowserEndpoint }`.

- SET-ACTIVE-1 Provider `jina` gives `Jina` with the stored key, which may be none; provider `browser` with a stored endpoint gives `Browser` with that endpoint.
- SET-ACTIVE-2 Provider `browser` with no stored endpoint cannot occur (SET-FETCH-4). `activeFetcher` treats it as a defect: it never falls back to Jina and never hides the broken state. The state can only come from a bug or a hand-edited database, so it is surfaced, not masked.
- SET-ACTIVE-3 The outer layer maps `ActiveFetcher` to a `WebpageFetcher` by exhaustive match and reads no other setting field for that purpose (CM-FETCH-2). No business condition about providers lives outside business.

### SET-OWN — Ownership

- SET-OWN-1 Every operation reads and writes only the settings of the owner passed in (CM-OWN). The scheduler reads the retention of the feed's owner.

**The set of operations.** Two operations exist, `useJina` and `useBrowser`. The other operations — read, set retention and clear the Jina key — are a single port call each and therefore get no operation of their own; their behavior is port-contract JSDoc (CM-PORT). The only branch is on whether the optional input was given, at the place where that difference arises; below the operation every call is one fixed write (CM-PORT-3), and each writer leaves every field it does not name as it is. `activeFetcher` (SET-ACTIVE) reads no port, and a broken SET-FETCH-4 dies as a defect.

**Known risk.** `useBrowser` without an endpoint reads then writes. Because an endpoint once stored can never be cleared, the read cannot be invalidated. The only effect of concurrent `useJina` and `useBrowser` calls is that the last provider written wins.

## Interface

### The settings page

- `/settings` is one page with a header and three sections, `账号`, `文章` and `提取`, in that order. The header shows the page heading, its subtitle and the back link to the library, which leads to `稍后阅读` (`/` redirects there) (Messages: page heading, page subtitle, back to the library).
- A navigation labelled with the section navigation label lists the three sections in the same order, marks the open one as selected and points each item at its section (Messages: section navigation, accessible label; section navigation items).
- On a wide screen the navigation stands beside the sections and switches between them: only the open section is shown. When the navigation does not fit beside the content — decided by measuring the two areas, not by a screen-width breakpoint — the three sections are stacked in the order above and an item scrolls to its section instead of hiding the others, so nothing typed is discarded. The page starts on `账号`.
- Reading the settings: while they load the page shows the reading label. If the read fails, an alert shows the wording of the failure with the retry button, which reads them again; the sections appear only after a successful read, so a failed read also hides `账号` until it succeeds (Messages: reading the settings; load error, retry button).
- The page is only reachable with a session (see [SKILL.md](SKILL.md) and [account.md](account.md)).

### 文章 — retention

- The section shows its description line (Messages: retention section description).
- One required number field, labelled with the retention field label, is prefilled with the stored retention and accepts positive whole numbers only (`min` 1, `step` 1). Its hint is also the field's message, shown when the value is missing or not a positive whole number (Messages: retention field label; retention field hint).
- The retention save button stores the value (SET-FEED-1); while the request is in flight the button shows its pending label with a spinner, and the fields, the buttons and the section navigation are disabled. On success the saved-retention toast is shown and the field shows the stored value. On failure the error toast carries the wording of the failure (Messages: retention save button; retention saved) and the typed value stays, so the section stays changed.
- Saving the retention trims nothing and reloads nothing: existing articles are untouched (SET-FEED-2).

### 提取 — the fetcher

- The section shows its description line (Messages: fetcher section description).
- Below that line one line reports the two stored configurations and never their values, each half saying whether that value is stored (SET-VAL-4) (Messages: configuration line).
- The provider select, labelled with the provider select label, offers the two provider options and is preselected with the stored provider. Changing it only changes which of the two fields is shown and makes the section changed; nothing is sent until the form is saved (SET-FETCH-1, SET-FETCH-2 pick the request) (Messages: provider select label; provider option, Jina; provider option, browser service).
- Exactly one field is shown, for the selected provider:
  - the Jina key field — a password field, always empty when the page is read. Its hint is the one for a stored key, or the one for anonymous access when none is stored (Messages: Jina key field label and its two hints).
  - the browser address field — a URL field, always empty when the page is read. Its hint is the one for a stored address or, when none is stored, the one that names the accepted protocols (Messages: browser address field label and its two hints).
- A blank field keeps the stored value when the form is saved (SET-VAL-6); a typed value replaces it. A typed key or address that belongs to the other provider is not sent and stays in its field, because only the selected provider's request is made.
- The fetcher save button saves the selected provider in one request (SET-FETCH-1, SET-FETCH-2); while it is in flight the button shows its pending label with a spinner, and the fields, the buttons and the section navigation are disabled. On success the fetcher-saved toast is shown, the saved field is emptied, the provider select shows the saved provider and the configuration line reports the saved half as stored. On failure the error toast carries the wording of the failure (Messages: fetcher save button; fetcher settings saved), including the one for a browser provider with no address given or stored (SET-FETCH-3), and the typed values stay.
- When a Jina key is stored, the section ends with a separated row: the clear-key row text and the clear-key button. The button asks the clear-key confirmation; confirming deletes the key (SET-KEY-1) and shows the key-cleared toast, with the configuration line reporting the key as not stored; cancelling keeps it, and the provider is unchanged either way (Messages: clear-key row text; clear-key button; clear-key confirmation; key cleared). Without a stored key the row is not shown.
- There is no control that removes the browser service address (SET-ENDPOINT-1); typing a new one replaces it (SET-FETCH-2).
- Switching the select and saving never discards the other provider's stored configuration (SET-FETCH-5), so a saved browser address stays stored while Jina is in use and vice versa.

### Saving and unsaved changes

- One write runs at a time per page: while a request is in flight every field and button of the sections is disabled, the saving status line is shown, and each section navigation item is disabled with that text as its title (Messages: saving status line). Submitting again, switching section or leaving is ignored while a write is in flight (with the single exception below).
- A section counts as changed when its draft differs from what was read: `文章` when the number differs from the stored retention, `提取` when the provider differs from the stored one or either secret field holds a non-blank value, `账号` when any of its three password fields is non-empty.
- Switching section with a changed section in the switching layout asks the confirmation for a section switch with unsaved changes (Messages). Confirming discards the current section's drafts (the retention is refilled from storage, the secret fields are emptied, the provider returns to the stored one) and opens the target section; cancelling stays where it is. In the stacked layout switching only scrolls, so nothing is asked and nothing is discarded.
- Leaving the page with any changed section asks the confirmation for leaving with unsaved changes (Messages); confirming leaves, cancelling stays. A reload or a closed tab with a changed section raises the browser's own leave prompt.
- While a write is in flight a navigation is blocked and shows the saving status line as an error toast, so a save cannot be lost; the one navigation that always goes through is the redirect to `/login` when the session ends.
- Every toast is dismissed automatically after a few seconds or with its dismiss button (Messages: toast dismiss button).

### 账号 — password change

The `账号` section changes the password of the signed-in account. Its fields, validation, pending label, success toast and error wordings are in [account.md](account.md).

## API

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/settings` | — | 200 `{ retention: number, provider: "jina" \| "browser", jinaKeyConfigured: boolean, browserEndpointConfigured: boolean }` | `SettingRepositoryError` 500 |
| PUT | `/api/settings/retention` | body `{ retention: number }` (required positive integer) | 204 | `InvalidRetention` 400, `SettingRepositoryError` 500 |
| PUT | `/api/settings/fetcher/jina` | body `{ key?: string }` | 204 | `SettingRepositoryError` 500 |
| PUT | `/api/settings/fetcher/browser` | body `{ endpoint?: string }` | 204 | `InvalidEndpoint` 400, `BrowserEndpointRequired` 422, `SettingRepositoryError` 500 |
| DELETE | `/api/settings/fetcher/jina/key` | — | 204 | `SettingRepositoryError` 500 |

- `GET /api/settings` answers exactly the four fields of the table, in any order: never the key, never the endpoint (SET-VAL-4, SET-GET-2). A user who never saved anything gets `{ retention: 100, provider: "jina", jinaKeyConfigured: false, browserEndpointConfigured: false }` (SET-GET-1).
- `PUT /api/settings/retention` takes `{ retention: number }`. An absent `retention` or one that is not a number is a decode failure (400, empty body). A number that is zero, negative or not an integer answers 400 `InvalidRetention` (SET-VAL-1).
- `PUT /api/settings/fetcher/jina` takes `{ key?: string }`; a `key` that is absent, empty or blank counts as not given (SET-VAL-6) and a given key is trimmed before storing (SET-VAL-2).
- `PUT /api/settings/fetcher/browser` takes `{ endpoint?: string }`; an `endpoint` that is absent, empty or blank counts as not given (SET-VAL-6). A given endpoint that is not an http, https, ws or wss URL — including one of another protocol — answers 400 `InvalidEndpoint` (SET-VAL-3). No endpoint given and none stored answers 422 `BrowserEndpointRequired` (SET-FETCH-3).
- `DELETE /api/settings/fetcher/jina/key` answers 204 also when no key was stored (SET-KEY-2). No request removes the browser endpoint (SET-ENDPOINT-1).
- All five need a session, and the four writes are Origin-checked (see API conventions in [SKILL.md](SKILL.md)). A repository failure answers 500 `SettingRepositoryError` and changes nothing.
- Errors carry only `_tag` (see API conventions); the wordings are the web client's (Messages).

## Messages

| Situation or error tag | Text |
| --- | --- |
| page heading | 设置 |
| page subtitle | 管理账号、文章保留与正文提取。 |
| back to the library | 返回阅读 |
| section navigation, accessible label | 设置分区 |
| section navigation items | 账号 / 文章 / 提取 |
| saving status line, and the title of a disabled section item | 正在保存设置，完成前无法切换分区或离开本页。 |
| reading the settings | 正在读取设置… |
| load error, retry button | 重试 |
| `InvalidRetention` (400) | 保留数量必须是正整数 |
| `InvalidEndpoint` (400) | 请输入有效的浏览器服务地址 |
| `BrowserEndpointRequired` (422) | 请填写浏览器服务地址 |
| `SettingRepositoryError` (500) | 暂时无法访问设置，请稍后重试 |
| retention section heading | 文章 |
| retention section description | 每个订阅源最多保留最近的文章，超出数量的旧文章会自动清理。默认保留 100 篇。 |
| retention field label | 每个订阅源保留文章数 |
| retention field hint (also its invalid-value message) | 请输入正整数。 |
| retention save button | 保存文章设置 / 保存中… |
| retention saved | 文章保留数量已保存 |
| fetcher section heading | 提取 |
| fetcher section description | Jina 会把文章地址发送给 Jina 并消耗额度，未保存 Key 时使用匿名访问；服务器提取服务使用你填写的浏览器服务地址。 |
| configuration line | Jina Key：已保存 · 浏览器服务地址：未保存 (each half `已保存` or `未保存`) |
| provider select label | 提取方式 |
| provider option, Jina | Jina（可匿名使用） |
| provider option, browser service | 服务器提取服务 |
| Jina key field label | Jina API Key |
| Jina key field hint, key stored | 已保存 Key，留空保持不变。 |
| Jina key field hint, no key stored | 留空则使用 Jina 匿名访问。 |
| browser address field label | 浏览器服务地址 |
| browser address field hint, address stored | 已保存地址，留空保持不变。 |
| browser address field hint, no address stored | 支持 http、https、ws 或 wss。 |
| fetcher save button | 保存提取设置 / 保存中… |
| fetcher settings saved | 提取设置已保存 |
| clear-key row text | 删除已保存的 Jina Key 后，Jina 提取使用匿名访问。 |
| clear-key button | 删除 Key |
| clear-key confirmation | 删除已保存的 Jina Key？删除后 Jina 提取将使用匿名访问。 |
| key cleared | Jina Key 已删除 |
| section switch with unsaved changes | 当前分区有未保存的修改，切换后将被丢弃。确定继续吗？ |
| leaving the page with unsaved changes | 有未保存的修改，确定离开设置页吗？ |
| toast dismiss button | 关闭 |

## Acceptance

```gherkin
Feature: Settings

  Rule: The page shows the sections and the stored values without their secrets

    Scenario: A user who never saved settings
      Given a signed-in user without stored settings
      When I open "/settings"
      Then the page shows the heading "设置" and the link "返回阅读"
      And the section navigation shows "账号", "文章" and "提取"
      And the retention field shows "100"
      And the extraction section shows "Jina Key：未保存 · 浏览器服务地址：未保存"
      And the provider select shows "Jina（可匿名使用）"

    Scenario: A configured key and address are reported, never shown
      Given a stored Jina key "sk-live" and a stored browser address "ws://browser:9222"
      When I open "/settings"
      Then the configuration line shows "已保存" for both
      And the Jina key field is empty
      And the browser address field is empty
      And no part of the page contains "sk-live" or "ws://browser:9222"

    Scenario: Reading the settings fails
      Given reading the settings fails
      When I open "/settings"
      Then the error wording of the failure is shown with a "重试" button
      And no section is shown
      When the read succeeds and I press "重试"
      Then the sections appear

  Rule: The retention is one stored number per user

    Scenario: Saving a new retention
      Given the stored retention is 100
      When I open "/settings", choose "文章", set the number to 60 and press "保存文章设置"
      Then the request "PUT /api/settings/retention" carries 60
      And the toast "文章保留数量已保存" is shown
      And the field shows "60"

    Scenario: The retention must be a positive whole number
      Given I choose "文章"
      When I clear the number and press "保存文章设置"
      Then nothing is sent and the field shows "请输入正整数。"
      When I enter 0 and press "保存文章设置"
      Then nothing is sent and the field shows "请输入正整数。"

    Scenario: The server rejects a retention below one
      Given a client sends the retention 0
      Then the request "PUT /api/settings/retention" answers 400 with "InvalidRetention"
      And the toast "保留数量必须是正整数" is shown

    Scenario: Existing articles are not trimmed at once
      Given a feed kept 100 articles and the retention is now 60
      When I save the retention
      Then the feed still has its 100 stored articles
      And they are trimmed only by the next refresh of that feed

  Rule: Choosing the fetcher is one operation per provider

    Scenario: Saving a Jina key
      Given no Jina key is stored
      When I select "Jina（可匿名使用）", type "sk-live" in "Jina API Key" and press "保存提取设置"
      Then the request "PUT /api/settings/fetcher/jina" carries the key
      And the toast "提取设置已保存" is shown
      And the key field is empty and the configuration line says "已保存"

    Scenario: A blank key keeps the stored key
      Given a Jina key is stored
      When I choose "提取" and press "保存提取设置" without typing a key
      Then the request carries no key
      And the configuration line still says "已保存" for the Jina key

    Scenario: Changing the provider alone does not save
      Given the stored provider is "jina"
      When I choose "提取" and select "服务器提取服务"
      Then the browser address field replaces the key field
      And no request is sent
      When I then choose "账号"
      Then the page asks "当前分区有未保存的修改，切换后将被丢弃。确定继续吗？"
      And cancelling keeps "提取" open with "服务器提取服务" selected

    Scenario: Switching to the browser service with a new address
      Given a stored Jina key
      When I select "服务器提取服务", type "ws://127.0.0.1:9222" in "浏览器服务地址" and save
      Then the request "PUT /api/settings/fetcher/browser" carries the address
      And the configuration line says "已保存" for the address
      And the stored Jina key is still there

    Scenario: The browser service without an address
      Given no browser address is stored
      When I select "服务器提取服务" and press "保存提取设置"
      Then the request answers 422 "BrowserEndpointRequired"
      And the toast "请填写浏览器服务地址" is shown
      And the provider select still shows "服务器提取服务"

    Scenario: An address that is not a URL the browser service can use
      When I select "服务器提取服务", type "ftp://host" and save
      Then the toast "请输入有效的浏览器服务地址" is shown
      And nothing is stored

    Scenario: A typed address that was not sent stays in its field
      Given a stored browser address
      When I type "ws://other:9222", switch to Jina and the save fails
      Then the toast shows the error
      And the typed address is still in its field
      And the stored browser address is unchanged

    Scenario: There is no way to remove the browser address
      Given a stored browser address
      When I choose "提取"
      Then the section offers no control that removes the address
      And the address can only be replaced by saving a new one

  Rule: The Jina key can be cleared

    Scenario: Clearing the stored key
      Given a stored Jina key and the provider "browser"
      When I press "删除 Key" and confirm "删除已保存的 Jina Key？删除后 Jina 提取将使用匿名访问。"
      Then the request "DELETE /api/settings/fetcher/jina/key" is sent
      And the toast "Jina Key 已删除" is shown
      And the configuration line says "未保存" for the Jina key
      And the provider is still "browser"

    Scenario: Cancelling the confirmation keeps the key
      Given a stored Jina key
      When I press "删除 Key" and cancel the confirmation
      Then no request is sent
      And the configuration line still says "已保存"

    Scenario: No clear button without a stored key
      Given no Jina key is stored
      Then the extraction section shows no "删除 Key" button

  Rule: One write at a time, and nothing typed is lost silently

    Scenario: The page is blocked while a write runs
      Given a save is in flight
      Then the status line "正在保存设置，完成前无法切换分区或离开本页。" is shown
      And the section items "账号", "文章" and "提取" are disabled with that text as their title
      And the fields and the save button are disabled

    Scenario: A save cannot be lost by leaving
      Given a save is in flight
      When I navigate to "/later"
      Then I stay on "/settings"
      And the toast "正在保存设置，完成前无法切换分区或离开本页。" is shown

    Scenario: The session ending during a save still leaves the page
      Given a save is in flight
      When the session ends and the page is redirected to "/login"
      Then the redirect is not blocked

    Scenario: Leaving with unsaved changes
      Given I typed 60 in the retention field
      When I navigate to "/later"
      Then the page asks "有未保存的修改，确定离开设置页吗？"
      When I cancel
      Then I stay on "/settings" with "60" in the field
      When I confirm
      Then I am on "/later"

    Scenario: Closing the tab with unsaved changes
      Given I typed a new password
      When I reload or close the tab
      Then the browser asks before leaving the page

    Scenario: A narrow screen stacks the sections without discarding drafts
      Given the navigation does not fit beside the sections
      And I typed 60 in the retention field
      When I press "提取"
      Then the page scrolls to "提取" and no confirmation is asked
      When I press "文章" again
      Then the field still shows "60"
```
