# Settings

Application-wide settings for retention, OPML/quick-save, webpage extraction, and Kindle delivery.

## Rules

- `SET-VAL-1`: `Retention` is a positive integer `>= 1` (default `100`). Takes effect on the next refresh of each feed without immediately deleting stored items.
- `SET-VAL-2`: Webpage extractor provider is `"direct"` (default: built-in Go HTTP + Readability), `"jina"` (optional `JinaKey` for higher rate limits), or `"browser"` (external CDP `BrowserEndpoint` with `http`/`https`/`ws`/`wss`). Switching to `"browser"` without a given or stored endpoint fails `422 BrowserEndpointRequired`.
- `SET-VAL-3`: `JinaKey`, `BrowserEndpoint`, and `smtpPassword` are secrets: never returned in `GET /api/settings` (which only returns `jinaKeyConfigured`, `browserEndpointConfigured`, `smtpPasswordConfigured` booleans) and never logged. Omitted/blank secret fields on save preserve existing stored secrets; `JinaKey` and `smtpPassword` can be explicitly cleared via `DELETE`.
- `SET-VAL-4`: All external service settings and secrets (`JinaKey`, `BrowserEndpoint`, Kindle email & SMTP credentials) live in SQLite and are managed solely via `/settings` (never via container environment variables). Saved changes take effect immediately on the next webpage extraction, manual send, or scheduled tick without restarting the container.
- `SET-KINDLE-1`: Kindle group stores `kindleEmail`, `senderEmail`, `smtpHost`, `smtpPort` (`1..65535`), `smtpSecurity` (`"tls"` | `"starttls"`), optional `smtpUser`, optional `smtpPassword`, and optional `sendTime` (`HH:00` or `HH:30`, 24-hour). Saving computes `nextSendAt` as the next occurrence strictly after now in server `TZ` (`KD-SCHED-1`).

## Interface

`/settings` has three sections in order: **`文章与订阅`**, **`提取`**, and **`Kindle`**. Wide viewports show sidebar navigation beside the active section; narrow viewports stack sections and scroll on click.

- **`文章与订阅`**: retention number input + save (`保存文章设置`); **OPML 导入 / 导出** buttons; **快速保存 Bookmarklet** copyable link (`javascript:location.href='<APP_URL>/save?url='+encodeURIComponent(location.href)`).
- **`提取`**: status summary (`Jina Key：已保存/未保存 · 浏览器服务地址：已保存/未保存`), provider selector (`内置直接抓取（默认，低占用）` / `Jina（可匿名使用）` / `外部浏览器提取服务`), conditional secret input (only when `jina` or `browser` is selected), save button, and `删除 Key` when a Jina key is stored.
- **`Kindle`**: delivery form + `保存 Kindle 设置`, `删除密码` (when stored), separated `立即发送` row (disabled while a send is running), and the recent sends history list ([kindle.md](kindle.md)).
- **Save guard**: one save runs at a time (inputs/nav disabled while saving); switching sections or leaving `/settings` with unsaved changes prompts confirmation.

## API

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/settings` | — | `200 { retention, provider, jinaKeyConfigured, browserEndpointConfigured, kindle? }` | `SettingRepositoryError` 500 |
| PUT | `/api/settings/retention` | `{ retention }` | `204` | `InvalidRetention` 400, 500 |
| PUT | `/api/settings/fetcher/direct` | — | `204` | `SettingRepositoryError` 500 |
| PUT | `/api/settings/fetcher/jina` | `{ key? }` | `204` | `SettingRepositoryError` 500 |
| PUT | `/api/settings/fetcher/browser` | `{ endpoint? }` | `204` | `InvalidEndpoint` 400, `BrowserEndpointRequired` 422, 500 |
| DELETE | `/api/settings/fetcher/jina/key` | — | `204` | `SettingRepositoryError` 500 |
| PUT | `/api/settings/kindle` | Kindle settings object | `204` | `InvalidKindleSetting` 400, 500 |
| DELETE | `/api/settings/kindle/password` | — | `204` | `SettingRepositoryError` 500 |

## Messages

| Code / Situation | Text |
| --- | --- |
| `InvalidRetention` / `InvalidEndpoint` / `BrowserEndpointRequired` | 保留数量必须是正整数 / 请输入有效的浏览器服务地址 / 请填写浏览器服务地址 |
| `InvalidKindleSetting` / `SettingRepositoryError` | Kindle 发送设置有误，请检查填写内容 / 暂时无法访问设置，请稍后重试 |
| saved toasts | 文章保留数量已保存 / 提取设置已保存 / Jina Key 已删除 / Kindle 设置已保存 / SMTP 密码已删除 |
| unsaved prompts | 当前分区有未保存的修改，切换后将被丢弃。确定继续吗？ / 有未保存的修改，确定离开设置页吗？ |

## Acceptance

```gherkin
Feature: Settings
  Scenario: Secrets are never returned to the client
    Given Jina key, browser endpoint, and SMTP password are stored
    When I open "/settings"
    Then GET /api/settings returns only "*Configured: true" and never the secret strings

  Scenario: Switching to browser provider without a stored endpoint fails
    Given no browser endpoint is stored
    When I select "外部浏览器提取服务" and save with an empty address
    Then the server answers 422 BrowserEndpointRequired
```
