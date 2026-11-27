# Settings

Application-wide settings for retention, OPML/quick-save, Kindle delivery, and the external services (Browserless webpage-fetch fallback, SMTP) they use.

## Rules

- `SET-VAL-1`: `Retention` is an integer in `1..10000` (default `100`). Out-of-range values fail `400 InvalidRetention`. Feed item budget: the sum over all feeds of `max(stored items of the feed, retention)` must be at most `10000` (normally feed count × retention; a feed still holding more items than retention counts its stored items until its next refresh prunes it). In one write transaction, the server updates retention, prunes every feed to its newest items by ID up to the new limit when retention decreases, then checks the budget; an over-budget update fails `400 FeedItemBudgetExceeded` and rolls back everything, including the prune. Saving an equal or higher value deletes nothing. If a source reorders entries, an older article still listed by the source can be pruned and re-imported as unread on the next refresh.
- `SET-VAL-2`: Browserless is an optional fallback for webpage extraction (`CM-FETCH-1`); there is no extractor provider setting. Its settings are `url` (required `http`/`https` base URL with a host, no userinfo, query, or fragment; trimmed and trailing `/` removed), optional `token`, and `residentialProxy` (boolean, default `false`). An invalid URL fails `400 InvalidBrowserlessSetting`. Browserless counts as configured when its `url` is stored; `GET /api/settings` omits `browserless` until then. Clearing Browserless removes the URL, token, and residential-proxy flag together; deleting only the token keeps the URL and flag.
- `SET-VAL-3`: The Browserless token and the SMTP password are secrets: never returned in `GET /api/settings` (which only returns `browserless.tokenConfigured` and `smtp.passwordConfigured`) and never logged. An omitted, empty, or whitespace-only Browserless token or SMTP password on save keeps the stored one; a non-blank value is stored exactly as typed (no trimming).
- `SET-VAL-4`: All external service settings and secrets live in SQLite and are managed solely via `/settings` (never via container environment variables). Saved changes take effect immediately on the next webpage extraction, manual send, or scheduled tick without restarting the container.
- `SET-SVC-1`: External services are configured independently of the features that use them, so one service can serve several features: **Browserless** (`url`, optional `token`, `residentialProxy`; the webpage-extraction fallback, `CM-FETCH-1`) and the **SMTP mail service** (`senderEmail`, `host`, `port` `1..65535`, `security` `"tls"` | `"starttls"`, optional `user`, optional `password`). SMTP counts as configured when sender, host, port, and security are stored. The Browserless URL may point to a private or Docker host: it is not SSRF-filtered, and redirects from it are not followed so the token never leaves that host (`CM-FETCH-2`).
- `SET-KINDLE-1`: Kindle delivery stores only `kindleEmail`, the EPUB primary `language` (`zh` | `en` | `ja`, required on save; `zh` for deliveries saved before the setting existed, `KD-BOOK-1`), and an optional `schedule { hour, minute, timezone }` (`hour` `0..23`, `minute` `0..55` in steps of `5`, `timezone` an IANA zone name such as `Asia/Shanghai`; `Local` and unknown names are invalid). There is no server-wide time zone setting. Saving requires a configured SMTP service (`422 SMTPNotConfigured`). The next send time is stored with the schedule (`KD-SCHED-1`): saving computes it when the schedule is enabled or its hour, minute, or time zone changes, and keeps it when the schedule is unchanged. `GET /api/settings` returns the stored value as `nextSendAt` only while a schedule is set, as stored even when overdue (delivery unconfigured or a send running). Kindle sending is usable only while both SMTP and Kindle delivery are configured; clearing SMTP keeps the stored Kindle address but disables sending until SMTP is configured again.

## Interface

`/settings` has three sections in order: **`文章与订阅`**, **`Kindle`**, and **`外部服务`**. The header holds an icon-only `返回阅读器` button and the `设置` title. Wide viewports show icon + label sidebar navigation beside the active section (content max width ~42 rem); narrow viewports show the three sections as equal-width icon-over-label tabs above the active section. Each section is built from grouped cards: a small uppercase group heading (optional status on its right), divided rows (label + description left, control right, or stacked full-width fields), and a footer with destructive actions on the left and the group's save button on the right.

- **`文章与订阅`**: group `文章保留` with an inline narrow retention number input (`1..10000`), hint `调低后立即删除每个订阅源超出的旧文章；订阅源数量与保留篇数的乘积不能超过 10000。`, and save (`保存文章设置`); group **OPML 导入与导出** with hint `从其他阅读器迁移订阅，或备份当前的订阅列表。` and equal `导入 OPML` / `导出 OPML` buttons; group **快速保存 Bookmarklet** with a draggable button-styled link (`javascript:location.href='<APP_URL>/save#url='+encodeURIComponent(location.href)`).
- **`Kindle`**: without SMTP, the form is disabled and a warning banner shows `发送到 Kindle 需要先在「外部服务」中配置 SMTP。` with `前往外部服务`. Otherwise: group `投递设置` with `Kindle 接收邮箱` (required), an `EPUB 主语言` select (options named in their own language: `中文`, `English`, `日本語`; defaults to `中文` until saved) with hint `Kindle 按主语言选择查词典的词典；书里的目录等固定文字也使用这个语言。`, row 1 a `每日定时发送` toggle, row 2 hour (`00`–`23`), minute (`00`–`55`, step 5), and `时区` selects (disabled while the toggle is off; turning it on defaults to `08:00` and the draft time zone, which is the saved zone or, with no saved schedule, the browser's zone (`UTC` when the browser reports none)). `时区` is a native select whose options read `UTC±HH:MM · <城市>` (offset for today, so DST is current; zones without a curated city show their IANA name, unknown zones show only the name) in groups: `当前` (the browser zone marked `（本机）`, then the selected zone if different), `常用` (the curated list in `web/src/routes/kindleTimezones.ts`, city labels in `zh-timezones.ts` / `en-timezones.ts`), and, after the `显示全部时区` link (`只显示常用时区` hides it again), `其他时区` with every remaining supported zone. Groups sort by UTC offset and each zone appears once (aliases such as `Asia/Calcutta` / `Asia/Kolkata` count as one); and `保存 Kindle 设置`; group `手动发送` with hint `立即把所有未读文章打包成 EPUB 发送到 Kindle，发送成功的文章会标为已读。` and `立即发送` (disabled while a send is running or until both SMTP and Kindle delivery are saved); group `最近发送记录` listing each send as status pill, trigger, time, and result text ([kindle.md](kindle.md)).
- **`外部服务`**: two independent cards, each with its status pill in the group heading and its own save and clear controls:
  - **Browserless**: heading `Browserless`, status `Browserless：已保存/未保存`, hint `直接抓取失败（如遇到人机验证）时，自动改用 Browserless 抓取。`, a required URL input `Browserless 地址` (placeholder `https://production-sfo.browserless.io`), an optional password input `Token（选填）` (`留空则保持已保存的 Token`), a `使用住宅代理` toggle (default off) with hint `提高通过人机验证的成功率，Browserless 云服务会额外计费。`, `保存 Browserless 设置`, `删除 Token` (when a token is stored), `清除 Browserless 设置` (when configured; confirms `清除 Browserless 设置？直接抓取失败时将不再自动重试。`).
  - **SMTP 邮件服务** (two columns on wide screens: server + port, sender + security, user + password): `发件人邮箱`, `SMTP 服务器`, `SMTP 端口`, `加密方式` (required, native validation; an unset port shows empty), optional `SMTP 用户名` and `SMTP 密码` (`留空则保持已保存的密码`), `保存 SMTP 设置`, `删除密码` (when stored), `清除 SMTP 设置` (when configured; confirms `清除 SMTP 设置？发送到 Kindle 将无法使用，直到重新配置。`).
- **Save guard**: one save runs at a time (inputs/nav disabled while saving); switching sections or leaving `/settings` with unsaved changes (return button, in-app links, browser back/forward, reload/close) prompts confirmation. Entering `Kindle` refreshes the send history.

## API

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/settings` | — | `200 { retention, browserless?: { url, tokenConfigured, residentialProxy }, smtp?: { senderEmail, host, port, security, user?, passwordConfigured }, kindle?: { kindleEmail, language, schedule?: { hour, minute, timezone }, nextSendAt? } }` | `SettingRepositoryError` 500 |
| PUT | `/api/settings/retention` | `{ retention }` | `204` | `InvalidRetention` 400, `FeedItemBudgetExceeded` 400, 500 |
| PUT | `/api/settings/services/browserless` | `{ url, token?, residentialProxy }` | `204` | `InvalidBrowserlessSetting` 400, 500 |
| DELETE | `/api/settings/services/browserless` | — | `204` | 500 |
| DELETE | `/api/settings/services/browserless/token` | — | `204` | 500 |
| PUT | `/api/settings/services/smtp` | `{ senderEmail, host, port, security, user?, password? }` | `204` | `InvalidSMTPSetting` 400, 500 |
| DELETE | `/api/settings/services/smtp` | — | `204` | 500 |
| DELETE | `/api/settings/services/smtp/password` | — | `204` | 500 |
| PUT | `/api/settings/kindle` | `{ kindleEmail, language, schedule?: { hour, minute, timezone } }` | `204` | `InvalidKindleSetting` 400, `SMTPNotConfigured` 422, 500 |

## Messages

| Code / Situation | Text |
| --- | --- |
| `FeedItemBudgetExceeded` | 订阅源数量与每源保留篇数的乘积不能超过 10000 |
| `InvalidRetention` / `InvalidBrowserlessSetting` | 保留数量必须是正整数 / 请输入有效的 Browserless 地址 |
| `InvalidSMTPSetting` / `SMTPNotConfigured` | SMTP 设置有误，请检查填写内容 / 请先在「外部服务」中配置 SMTP |
| `InvalidKindleSetting` / `SettingRepositoryError` | Kindle 发送设置有误，请检查填写内容 / 暂时无法访问设置，请稍后重试 |
| saved toasts | 文章保留数量已保存 / Kindle 设置已保存 / Browserless 设置已保存 / Browserless Token 已删除 / Browserless 设置已清除 / SMTP 设置已保存 / SMTP 密码已删除 / SMTP 设置已清除 |
| unsaved prompts | 当前分区有未保存的修改，切换后将被丢弃。确定继续吗？ / 有未保存的修改，确定离开设置页吗？ |

## Acceptance

```gherkin
Feature: Settings
  Scenario: Secrets are never returned to the client
    Given the Browserless token and SMTP password are stored
    When I open "/settings"
    Then GET /api/settings returns only "tokenConfigured: true" and "passwordConfigured: true" and never the secret strings

  Scenario: A blank Browserless token keeps the stored token
    Given a Browserless URL and token are stored
    When I save the Browserless settings with a blank token
    Then the stored token is unchanged and GET /api/settings still returns "tokenConfigured: true"

  Scenario: Browserless requires a valid URL
    When PUT /api/settings/services/browserless is sent with a URL that is not an http/https base URL
    Then it answers 400 InvalidBrowserlessSetting and the stored settings are unchanged

  Scenario: Kindle requires SMTP
    Given no SMTP service is stored
    Then the "Kindle" form and "立即发送" are disabled
    And PUT /api/settings/kindle answers 422 SMTPNotConfigured
```
