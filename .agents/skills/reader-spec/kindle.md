# Send to Kindle

Packages all unread saved pages and unread feed items into an EPUB 3 book and emails it to the configured Kindle address on a daily schedule or on demand.

## Rules

- `KD-SEND-1`: Manual trigger (`POST /api/kindle/send`) validates that both the SMTP service and Kindle delivery are configured (`422 KindleNotConfigured`, `SET-KINDLE-1`) and no send is currently running (`409 KindleSendInProgress`), snapshots the current delivery & SMTP configuration into the job, persists a `running` send record, hands the job to the background worker, and answers `202 Accepted` immediately. Subsequent edits on `/settings` never alter an already accepted job. Scheduled runs skip silently if a send is already running.
- `KD-SEND-2`: Collects all unread saved pages (`id ASC`) followed by unread feed items grouped by feed (`(title ASC, id ASC)`, each feed in its stored `order`). If 0 unread items exist, records `succeeded` with `articleCount = 0, bookCount = 0` and sends no email.
- `KD-TEXT-1`: Saved pages use stored `content`. Feed items with `readerMode == "default"` use `content`, else `description`, else heading only. Items with `readerMode == "extracted" | "embedded"` use cached `extractedContent`, or extract once via the active fetcher (`CM-FETCH-1`) and cache it; extraction failures fall back to `default` content without failing the send.
- `KD-BOOK-1`: Builds an EPUB 3 (`title: 留白 YYYY-MM-DD`, `language: zh`) in memory with TOC. Images are fetched with SSRF protection (`CM-FETCH-2`), bounded concurrency, and timeouts; unsupported/failed images (only JPEG/PNG/GIF kept) are stripped from that chapter without failing the build. Oversized JPEG/PNG images (`> 1200×1600` or `> 128 KiB`, guarded by a max decode dimension/pixel cap) are proportionally downscaled to fit `1200×1600` over a white background and re-encoded as JPEG (`Quality: 75`) whenever the re-encoded payload is smaller than the original.
- `KD-SPLIT-1`: Max EPUB size is `20 MiB`. Larger books are recursively halved by article count in book order and numbered (`留白 YYYY-MM-DD (1/N)`, `liubai-YYYY-MM-DD-1.epub`). If a single article with images exceeds `20 MiB`, it is rebuilt text-only.
- `KD-SEND-3`: Mails each book sequentially through the SMTP service (`SET-SVC-1`, sender = its `senderEmail`) using the job's snapshotted SMTP + Kindle address. After each accepted book, the book's articles are marked read and the record's `articleCount` / `bookCount` increment with accepted progress. If book 2 fails, book 1 remains read/counted and book 2+ stay unread (`status = "failed"`). (At-least-once trade-off: if the process crashes after SMTP accepts a book and before DB mark-read commits, that book's articles remain eligible for the next send.)
- `KD-LOG-1`: Every manual or scheduled run persists a history entry (`id`, `trigger`: `manual` | `scheduled`, `status`: `running` | `succeeded` | `failed`, `articleCount`, `bookCount`, sanitized `error?`, `startedAt`, `finishedAt?`), pruning history to the latest `20` entries. Any leftover `running` row after an unexpected restart is marked `failed` on startup.
- `KD-SCHED-1`: Scheduler wakes every 5 minutes (handling any `TZ` offset including `:15`/`:45` zones). It skips silently while SMTP or Kindle delivery is not configured. When `nextSendAt <= now`, it advances `nextSendAt` to the next local occurrence strictly after `now` in server `TZ`, then starts the send with a snapshot of the current delivery settings. Missed schedules during downtime fire once on startup.

## Interface, API & Messages

- **Settings → Kindle**:
  - Clicking `立即发送` sends `POST /api/kindle/send` (`202 { item: KindleSendRecord }`), shows toast `已加入 Kindle 发送任务`, prepends the running record to the recent sends list, and disables `立即发送` while `running` is true. **No background polling** is performed; if `POST /api/kindle/send` answers `409 KindleSendInProgress` (e.g. a scheduled send started after the page loaded), or whenever the Kindle section is entered/reloaded, the client fetches `GET /api/kindle/sends` once and derives the button state from `running`.
  - Below the button, a compact recent sends list (`GET /api/kindle/sends` → `200 { running: boolean, items: KindleSendRecord[] }`) shows up to 20 recent runs with timestamp, trigger (`定时` / `手动`), status (`发送中` / `成功` / `失败`), accepted counts, and sanitized error summary if failed.

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| POST | `/api/kindle/send` | — | `202 { item: KindleSendRecord }` | `KindleNotConfigured` 422, `KindleSendInProgress` 409, `SettingRepositoryError` 500 |
| GET | `/api/kindle/sends` | — | `200 { running: boolean, items: KindleSendRecord[] }` | `SettingRepositoryError` 500 |

| Code / Situation | Text |
| --- | --- |
| `KindleNotConfigured` / `KindleSendInProgress` | 请先配置 SMTP 和 Kindle 接收邮箱 / 正在发送，请稍后再试 |
| queued toast / button disabled | 已加入 Kindle 发送任务 / 正在发送中… |
| recent sends heading / empty | 最近发送记录 / 暂无发送记录 |
| status labels | 发送中 / 已发送 N 篇（M 封邮件） / 无未读文章 / 发送失败 |

## Acceptance

```gherkin
Feature: Send to Kindle
  Scenario: Enqueueing a manual send snapshots settings, returns 202, and recovers on 409
    Given Kindle settings point to "a@kindle.com" and no send is running
    When I click "立即发送"
    Then POST /api/kindle/send answers 202 with a "running" record
    And the toast "已加入 Kindle 发送任务" appears without polling
    And "立即发送" is disabled as "正在发送中…"
    When I edit the Kindle address to "b@kindle.com" while book 1 is sending
    Then book 2 of the running job still goes to "a@kindle.com"
    When another tab triggers "立即发送" and receives 409 KindleSendInProgress
    Then it fetches GET /api/kindle/sends once and updates its button to "正在发送中…"

  Scenario: Partial failure across split books records accepted counts only
    Given unread articles split into 2 EPUB books of 3 and 2 articles
    And the SMTP server accepts book 1 and rejects book 2
    When Send to Kindle runs
    Then book 1's 3 articles are marked read, book 2's 2 stay unread
    And the failed send record reports articleCount 3 and bookCount 1
```
