# Send to Kindle

Mailing the unread articles to the user's Kindle as one EPUB: what is sent, how each article's text is chosen, how the book is built, the daily schedule and the send-now button. Where and how to mail (the Kindle address, the SMTP server, the send time) are settings (`settings.md` SET-KINDLE); extracting an item is `feeds.md` FD-EXTRACT; a feed's reader mode is `feeds.md` FD-PREF; read state is `feeds.md` FD-READ and `later.md`.

## Rules

### KD-SEND — One send

A send runs for one owner, by the schedule (KD-SCHED) or by the send-now request. Its steps, in order:

1. Read the setting. No Kindle delivery saved fails with `KindleNotConfigured` and does nothing else (KD-SEND-1).
2. Collect every unread feed item of the owner's feeds and every unread saved page, at the moment of the send.
3. When nothing is unread, stop: no mail is sent and nothing changes (KD-SEND-2).
4. Choose each article's text (KD-TEXT) and build the book (KD-BOOK), split into several books when it is too large (KD-SPLIT).
5. Mail each book in order to the Kindle address through the saved SMTP server (KD-SEND-4), and after each accepted mail mark the articles of that book read: those feed items and those saved pages (KD-SEND-3).

- KD-SEND-1 Without a saved Kindle delivery the send fails with `KindleNotConfigured`; nothing is read, extracted or marked.
- KD-SEND-2 With no unread article the send succeeds with a count of 0 and sends no mail.
- KD-SEND-3 Articles are marked read only after the mail was accepted by the SMTP server, and only the articles in the book: an article that arrives during the send stays unread and goes with the next send. An article of the book that the user marks unread while the send runs is marked read again when it ends, since the book holds it; no read-state revision is kept for this rare case. A failed build marks nothing; a failed mail marks nothing of its book and of the books after it (KD-SPLIT-4).
- KD-SEND-4 One mail per book, from the sender address to the Kindle address, subject `留白 YYYY-MM-DD`, with the book attached as `liubai-YYYY-MM-DD.epub` (`application/epub+zip`); the date is the server-local date of the send. A send of several books numbers them (KD-SPLIT-2). The login is used only when both the SMTP user and the password are saved.
- KD-SEND-5 A failure to build the book fails the send with `EpubBuilderError`.
- KD-SEND-6 A failure of the SMTP server — unreachable, refused login, refused mail — fails the send with `MailSenderError`. Its message never carries the password (SET-VAL-4).
- KD-SEND-7 One send runs per owner at a time. A send-now request while that owner's send runs answers `KindleSendInProgress` and starts nothing; a scheduled send that comes due while one runs is skipped.
- KD-SEND-8 The send answers the number of articles its books held.

### KD-TEXT — The text of each article

- KD-TEXT-1 A saved page uses its stored content.
- KD-TEXT-2 A feed item whose feed's reader mode is `default` uses its content, else its description, else nothing (a chapter with its heading only) — the default content of RD-CONTENT-1.
- KD-TEXT-3 A feed item whose feed's reader mode is `extracted` or `embedded` uses the extracted content: the stored extracted content when there is one, otherwise extraction runs as FD-EXTRACT does — through the owner's fetcher (SET-ACTIVE) — and stores what it extracted, so the reader reuses it (FD-EXTRACT-2).
- KD-TEXT-4 A failed extraction does not fail the send: that item falls back to the text of KD-TEXT-2 and is still sent and marked read.
- KD-TEXT-5 The feed of an item is the one the owner follows when the send reads the feeds; an item whose feed is not found uses KD-TEXT-2.
- KD-TEXT-6 Extractions run one after another within a send.

### KD-BOOK — The book

- KD-BOOK-1 One EPUB 3 file, title `留白 YYYY-MM-DD` (the send's local date), language `zh`, with a table of contents listing every article.
- KD-BOOK-2 Order: the saved pages first, oldest first (`id` ascending); then the feed items grouped by feed, the feeds in the order of the feed list (FD-LIST-3), each group in its feed's stored order (FD-PREF-3): oldest first under `oldest`, newest first under `newest`. Items whose feed is not found come last, oldest first. Splitting keeps this order (KD-SPLIT-2).
- KD-BOOK-3 Each article is one chapter: its title as heading, a line with its source (the feed title, `稍后阅读` for a saved page), its publish time when it has one and its address, then its text.
- KD-BOOK-4 Images the text references are downloaded and embedded. An image that cannot be fetched, or is not JPEG, PNG or GIF, is removed from its chapter; it never fails the book.
- KD-BOOK-5 The text is the stored sanitized HTML (CM-ART-4); the builder only converts it to XHTML and rewrites image references, it does not sanitize again.

### KD-SPLIT — Books too large for one mail

- KD-SPLIT-1 A book may be at most 20 MiB (`MAX_BOOK_BYTES`, about 27 MiB once base64-encoded in the mail, which common SMTP providers accept). The limit is fixed, not a setting.
- KD-SPLIT-2 When the whole book is larger, the articles are halved in book order, and each half that is still larger is halved again, until every book fits. The books keep book order and are numbered: titles `留白 YYYY-MM-DD (1)`, `(2)`, …; mail subjects `留白 YYYY-MM-DD (1/N)`; attachments `liubai-YYYY-MM-DD-1.epub`, …. A send that fits in one book is not numbered.
- KD-SPLIT-3 A single article larger than the limit with its images is built as text only: no image is downloaded and every image is removed. It is sent as it then is, even if still larger.
- KD-SPLIT-4 The books are mailed one after another. Each book's articles are marked read once its mail is accepted; when a mail fails the send stops with that error, and the articles of that book and of the later books stay unread for the next send.
- KD-SPLIT-5 Every split builds the books again, so images may be downloaded more than once in a large send. Accepted.

### KD-SCHED — The daily schedule (system behavior)

- KD-SCHED-1 An owner with a saved send time has a stored next scheduled send (`nextSendAt`, SET-KINDLE-6), an instant computed in the server-local time zone (`TZ` of the server process, `deployment.md`). No send time means none: no scheduled send; send-now still works and never changes `nextSendAt`.
- KD-SCHED-2 The server checks once when it starts and then at every whole and half hour. A check takes every owner whose `nextSendAt` is not later than the check, moves their `nextSendAt` to the next occurrence of their send time strictly after the check, then starts their send. An owner whose time passed while the server was down is therefore sent at the first check after it comes back, once, however many days were missed.
- KD-SCHED-4 The next occurrence is the send time on today's server-local date, or tomorrow's when that is not later than now. On a daylight-saving change a send time that does not exist that day comes due at the first instant after the gap (an hour later), and one that occurs twice comes due at its first occurrence only; the check compares instants, so neither case needs handling of its own.
- KD-SCHED-5 An owner whose send is running when it comes due is skipped for that day (KD-SEND-7); its `nextSendAt` still moves on.
- KD-SCHED-3 A failed scheduled send is logged with the owner and the error tag, never the password, and is not retried until its next scheduled send; the articles stay unread.

## Interface

### `Kindle` section of the settings page

The fields and saving of the section are in `settings.md`. Below the save button the section ends with a separated row:

- The send-now button sends at once (KD-SEND). It is shown only when a Kindle delivery is stored; unsaved changes of the section are not used — the stored delivery is. While the request runs it shows its pending label with a spinner and is disabled; the rest of the page stays usable.
- Success with a count above 0 shows the sent toast with the count; a count of 0 shows the nothing-unread toast. The sidebar counts and the current list are not reloaded by the settings page; returning to the library reloads them (LIB-RELOAD-1).
- A failure shows the error toast with the wording of its tag.

## API

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| POST | `/api/kindle/send` | — | 200 `{ count: number }` | `KindleNotConfigured` 422, `KindleSendInProgress` 409, `MailSenderError` 422, `EpubBuilderError` 500, `SettingRepositoryError` 500, `FeedRepositoryError` 500, `FeedItemRepositoryError` 500, `SavedPageRepositoryError` 500 |

- The request runs the whole send and answers when it is done (KD-SEND-8). It needs a session and is Origin-checked.

## Messages

| Situation or error tag | Text |
| --- | --- |
| `KindleNotConfigured` | 请先保存 Kindle 发送设置 |
| `KindleSendInProgress` | 正在发送，请稍后再试 |
| `MailSenderError` | 邮件发送失败，请检查 SMTP 设置 |
| `EpubBuilderError` | 电子书生成失败，请稍后重试 |
| Send-now button and its pending label | 立即发送 / 发送中… |
| Send-now row text | 把当前所有未读文章打包成 EPUB 发送到 Kindle，发送后标为已读。 |
| Sent (toast) | 已发送 N 篇文章到 Kindle |
| Nothing unread (toast) | 没有未读文章 |

## Acceptance

```gherkin
Feature: Send to Kindle

  Rule: A send mails the unread articles and marks them read

    Scenario: Sending the unread articles
      Given a Kindle delivery is saved
      And "Go Blog" has two unread items and one read item
      And one saved page is unread
      When a send runs
      Then one mail with one EPUB holding three chapters goes to the Kindle address
      And the saved page is the first chapter
      And those three articles are read
      And the send answers 3

    Scenario: Nothing unread sends nothing
      Given a Kindle delivery is saved and nothing is unread
      When a send runs
      Then no mail is sent and the send answers 0

    Scenario: A large send is split into numbered mails
      Given the unread articles make an EPUB larger than 20 MiB
      When a send runs
      Then they go as books of at most 20 MiB, each in its own mail
      And the subjects read "留白 2026-11-18 (1/2)" and "留白 2026-11-18 (2/2)"

    Scenario: A failed second mail keeps its articles unread
      Given the send is split into two books
      And the SMTP server refuses the second mail
      When a send runs
      Then the articles of the first book are read
      And the articles of the second book stay unread

    Scenario: A failed mail marks nothing read
      Given the SMTP server refuses the login
      When a send runs
      Then it fails with "MailSenderError"
      And every article stays unread

    Scenario: No delivery saved
      Given no Kindle delivery is saved
      When I choose "立即发送"
      Then the toast "请先保存 Kindle 发送设置" is shown

  Rule: The text follows the feed's reader mode

    Scenario: An extracted feed uses the stored extraction
      Given "Go Blog" stores the reader mode "extracted"
      And its unread item has stored extracted content
      When a send runs
      Then the chapter holds the extracted content and nothing is fetched

    Scenario: An extracted feed extracts once and keeps it
      Given "Go Blog" stores the reader mode "embedded"
      And its unread item has no extracted content
      When a send runs
      Then the item is extracted and the extracted content is stored
      And the chapter holds it

    Scenario: A failed extraction falls back to the feed's content
      Given "Go Blog" stores the reader mode "extracted"
      And extraction of its unread item fails
      When a send runs
      Then the chapter holds the item's own content
      And the item is read after the mail is sent

  Rule: The schedule

    Scenario: The daily send time
      Given my send time is "07:00"
      When the server checks at 07:00
      Then a send runs for me
      And my next scheduled send is tomorrow at 07:00

    Scenario: A time passed during downtime is sent once on return
      Given my send time is "07:00"
      And the server is down from 06:50 until 10:00 two days later
      When the server starts
      Then one send runs for me
      And my next scheduled send is tomorrow at 07:00

    Scenario: Changing the send time never sends at once
      Given it is 10:00
      When I save the send time "07:00"
      Then no send runs
      And my next scheduled send is tomorrow at 07:00

    Scenario: Sending while a send runs
      Given my send is running
      When I choose "立即发送"
      Then the toast "正在发送，请稍后再试" is shown
```
