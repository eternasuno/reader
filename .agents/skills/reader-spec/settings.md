# Settings

Application-wide settings for retention, OPML/quick-save, webpage extraction, Kindle delivery, and the external services they use.

## Rules

- `SET-VAL-1`: `Retention` is a positive integer `>= 1` (default `100`). Takes effect on the next refresh of each feed without immediately deleting stored items.
- `SET-VAL-2`: Webpage extractor provider is `"direct"` (default: built-in Go HTTP + Readability), `"jina"` (anonymous, or with the optional stored `JinaKey` for higher rate limits), or `"browser"` (the stored external CDP `BrowserEndpoint`). Switching to `"browser"` without a stored endpoint fails `422 BrowserEndpointRequired`. Clearing the browser endpoint while `"browser"` is active switches the provider to `"direct"` in the same transaction.
- `SET-VAL-3`: `JinaKey`, `BrowserEndpoint`, and the SMTP password are secrets: never returned in `GET /api/settings` (which only returns `jinaKeyConfigured`, `browserEndpointConfigured`, `smtp.passwordConfigured`) and never logged. An omitted, empty, or whitespace-only SMTP password on save keeps the stored one; a non-blank password is stored exactly as typed (no trimming).
- `SET-VAL-4`: All external service settings and secrets live in SQLite and are managed solely via `/settings` (never via container environment variables). Saved changes take effect immediately on the next webpage extraction, manual send, or scheduled tick without restarting the container.
- `SET-SVC-1`: External services are configured independently of the features that use them, so one service can serve several features: `Jina Key` (optional, `jina` provider), `浏览器服务地址` (`http`/`https`/`ws`/`wss`, `browser` provider), and the **SMTP mail service** (`senderEmail`, `host`, `port` `1..65535`, `security` `"tls"` | `"starttls"`, optional `user`, optional `password`). SMTP counts as configured when sender, host, port, and security are stored.
- `SET-KINDLE-1`: Kindle delivery stores only `kindleEmail` and optional `sendTime` (`HH:00` or `HH:30`, 24-hour). Saving requires a configured SMTP service (`422 SMTPNotConfigured`) and computes `nextSendAt` as the next occurrence strictly after now in server `TZ` (`KD-SCHED-1`). Kindle sending is usable only while both SMTP and Kindle delivery are configured; clearing SMTP keeps the stored Kindle address but disables sending until SMTP is configured again.

## Interface

`/settings` has four sections in order: **`文章与订阅`**, **`提取`**, **`Kindle`**, and **`外部服务`**. The header holds an icon-only `返回阅读器` button and the `设置` title. Wide viewports show icon + label sidebar navigation beside the active section (content max width ~42 rem); narrow viewports show the four sections as equal-width icon-over-label tabs above the active section. Each section is built from grouped cards: a small uppercase group heading (optional status on its right), divided rows (label + description left, control right, or stacked full-width fields), and a footer with destructive actions on the left and the group's save button on the right.

- **`文章与订阅`**: group `文章保留` with an inline narrow retention number input + save (`保存文章设置`); group **OPML 导入与导出** with hint `从其他阅读器迁移订阅，或备份当前的订阅列表。` and equal `导入 OPML` / `导出 OPML` buttons; group **快速保存 Bookmarklet** with a draggable button-styled link (`javascript:location.href='<APP_URL>/save#url='+encodeURIComponent(location.href)`).
- **`提取`**: provider selector rows, each a radio + name + one-line description (`内置直接抓取（默认，低占用）` — `由服务器直接抓取网页，速度快、占用低，适合大多数页面。` / `Jina（可匿名使用）` — `通过 Jina Reader 抓取，可处理部分动态页面；配置 Key 可提高速率限制。` / `外部浏览器提取服务` — `通过外部浏览器（CDP）渲染页面，适合依赖 JavaScript 的网站。`) + `保存提取设置`. Jina is always selectable. While no browser endpoint is stored, the browser option is disabled and shows `需先在「外部服务」中配置浏览器服务地址` with a `前往外部服务` button.
- **`Kindle`**: without SMTP, the form is disabled and a warning banner shows `发送到 Kindle 需要先在「外部服务」中配置 SMTP。` with `前往外部服务`. Otherwise: group `投递设置` with `Kindle 接收邮箱` (required) and `每日定时发送（可选）` + `保存 Kindle 设置`; group `手动发送` with hint `立即把所有未读文章打包成 EPUB 发送到 Kindle，发送成功的文章会标为已读。` and `立即发送` (disabled while a send is running or until both SMTP and Kindle delivery are saved); group `最近发送记录` listing each send as status pill, trigger, time, and result text ([kindle.md](kindle.md)).
- **`外部服务`**: three independent cards, each with its status pill in the group heading and its own save and clear controls:
  - **Jina**: status `Jina Key：已保存/未保存`, password input, `保存 Key`, `删除 Key` (when stored).
  - **浏览器提取服务**: status, URL input, `保存地址`, `清除地址` (when stored; confirms `清除浏览器服务地址？使用浏览器提取的设置将改回内置直接抓取。`).
  - **SMTP 邮件服务** (two columns on wide screens: server + port, sender + security, user + password): `发件人邮箱`, `SMTP 服务器`, `SMTP 端口`, `加密方式` (required, native validation; an unset port shows empty), optional `SMTP 用户名` and `SMTP 密码` (`留空则保持已保存的密码`), `保存 SMTP 设置`, `删除密码` (when stored), `清除 SMTP 设置` (when configured; confirms `清除 SMTP 设置？发送到 Kindle 将无法使用，直到重新配置。`).
- **Save guard**: one save runs at a time (inputs/nav disabled while saving); switching sections or leaving `/settings` with unsaved changes (return button, in-app links, browser back/forward, reload/close) prompts confirmation. Entering `Kindle` refreshes the send history.

## API

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/settings` | — | `200 { retention, provider, jinaKeyConfigured, browserEndpointConfigured, smtp?: { senderEmail, host, port, security, user?, passwordConfigured }, kindle?: { kindleEmail, sendTime?, nextSendAt? } }` | `SettingRepositoryError` 500 |
| PUT | `/api/settings/retention` | `{ retention }` | `204` | `InvalidRetention` 400, 500 |
| PUT | `/api/settings/provider` | `{ provider }` | `204` | `InvalidProvider` 400, `BrowserEndpointRequired` 422, 500 |
| PUT | `/api/settings/services/jina` | `{ key }` | `204` | `InvalidJinaKey` 400, 500 |
| DELETE | `/api/settings/services/jina` | — | `204` | 500 |
| PUT | `/api/settings/services/browser` | `{ endpoint }` | `204` | `InvalidEndpoint` 400, 500 |
| DELETE | `/api/settings/services/browser` | — | `204` | 500 |
| PUT | `/api/settings/services/smtp` | `{ senderEmail, host, port, security, user?, password? }` | `204` | `InvalidSMTPSetting` 400, 500 |
| DELETE | `/api/settings/services/smtp` | — | `204` | 500 |
| DELETE | `/api/settings/services/smtp/password` | — | `204` | 500 |
| PUT | `/api/settings/kindle` | `{ kindleEmail, sendTime? }` | `204` | `InvalidKindleSetting` 400, `SMTPNotConfigured` 422, 500 |

## Messages

| Code / Situation | Text |
| --- | --- |
| `InvalidRetention` / `InvalidProvider` / `InvalidJinaKey` | 保留数量必须是正整数 / 提取方式无效 / 请输入 Jina Key |
| `InvalidEndpoint` / `BrowserEndpointRequired` | 请输入有效的浏览器服务地址 / 请填写浏览器服务地址 |
| `InvalidSMTPSetting` / `SMTPNotConfigured` | SMTP 设置有误，请检查填写内容 / 请先在「外部服务」中配置 SMTP |
| `InvalidKindleSetting` / `SettingRepositoryError` | Kindle 发送设置有误，请检查填写内容 / 暂时无法访问设置，请稍后重试 |
| saved toasts | 文章保留数量已保存 / 提取设置已保存 / Kindle 设置已保存 / Jina Key 已保存 / Jina Key 已删除 / 浏览器服务地址已保存 / 浏览器服务地址已清除 / SMTP 设置已保存 / SMTP 密码已删除 / SMTP 设置已清除 |
| unsaved prompts | 当前分区有未保存的修改，切换后将被丢弃。确定继续吗？ / 有未保存的修改，确定离开设置页吗？ |

## Acceptance

```gherkin
Feature: Settings
  Scenario: Secrets are never returned to the client
    Given Jina key, browser endpoint, and SMTP password are stored
    When I open "/settings"
    Then GET /api/settings returns only "*Configured: true" and never the secret strings

  Scenario: Browser extraction requires a stored endpoint
    Given no browser endpoint is stored
    Then "外部浏览器提取服务" is disabled in "提取"
    And PUT /api/settings/provider with "browser" answers 422 BrowserEndpointRequired

  Scenario: Kindle requires SMTP
    Given no SMTP service is stored
    Then the "Kindle" form and "立即发送" are disabled
    And PUT /api/settings/kindle answers 422 SMTPNotConfigured
```
