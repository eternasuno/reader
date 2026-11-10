# Feed: item selection and retention

Domain: Feed (a subscription and its items). Covers which parsed entries become stored `FeedItem`s on subscribe and on refresh, and which stored items are kept.

Status legend: **[change]** = decided target that differs from the current code.

## Terms

- **Entry**: a `ParsedFeedItem` returned by `FeedParser` (title, description, content, url, publishedAt).
- **Inventory**: `(id, publishedAt)` of every item currently stored for the feed (`FeedItemRepository.inventory`).
- **N**: the owner's `Setting.feed.retention` (integer 30–300, default 100).

## Rules

### FI-ID — Item identity

- FI-ID-1 **[change]** An entry with a URL is identified by `hash(feedId, url)`. Title and description do not take part.
- FI-ID-2 An entry without a URL is identified by `hash(feedId, title, description or "")`.
- FI-ID-3 Identity is scoped by feed: the same article in two feeds is two items.
- FI-ID-4 Consequence of FI-ID-1: a source that edits the title or description of an entry with a URL does not create a new item and does not reset its read state.

### FI-ORD — Ordering and de-duplication

- FI-ORD-1 Candidates are ordered by `publishedAt` descending.
- FI-ORD-2 Tie on `publishedAt`: stored items come before new entries; stored items among themselves by `id` descending; new entries among themselves by their order in the source.
- FI-ORD-3 Candidates with the same id are collapsed to the first one in this order.

### FI-SUB — Initial import (subscribe)

- FI-SUB-1 **[change]** Order and de-duplicate the entries, keep the first N, store them. N is the owner's retention setting, not a fixed 30.
- FI-SUB-2 Every stored item starts with `read = false` and no `extractedContent`.
- FI-SUB-3 If the feed has no entries, no items are stored and the subscription is still created.

### FI-REF — Refresh

1. Read the stored feed (`FeedNotFound` if it does not exist for this owner).
2. Fetch and parse the source.
3. Read inventory and N.
4. Fresh entries = de-duplicated entries whose id is not in the inventory.
5. Merge inventory and fresh entries, order by FI-ORD, keep the first N. This is the **retained set**.
6. Store the retained entries that are new. Then delete every stored item of this feed that is not in the retained set. Then update the feed's title and `updatedAt`.

- FI-REF-1 **[change]** Retention is by recency only: the newest N items stay. Read state plays no role; unread items beyond N are removed like read ones.
- FI-REF-2 An item the source no longer lists stays until the retention rule removes it (FI-REF-1).
- FI-REF-3 Stored items are never modified by refresh: their title, content, read state and `extractedContent` are untouched, even if the source changed them.
- FI-REF-4 Lowering N takes effect on the next refresh. It does not delete anything immediately.
- FI-REF-5 A new entry older than all N retained items is not stored.
- FI-REF-6 Refresh updates only this feed. Saved pages created from its items are unaffected.

### FI-CONTENT — Content of stored entries

- FI-CONTENT-1 `description` and `content` are cut to 100,000 characters, parsed as HTML and sanitized before storage.
- FI-CONTENT-2 Absent or empty description, content or URL are stored as none.

### FI-SCHED — Scheduled refresh

- FI-SCHED-1 Every owner that has at least one feed is refreshed every 30 minutes, and immediately when first discovered.
- FI-SCHED-2 Within one owner, feeds are refreshed one after another. A failing feed is logged and the rest continue.
- FI-SCHED-3 At most one refresh job per owner is queued or running at a time.

## Examples

Retention N = 3. Items are named by publish time.

| Case | Stored before | Source entries | Stored after |
| --- | --- | --- | --- |
| New entry displaces oldest | t5 t4 t3 | t6 t5 t4 t3 | t6 t5 t4 |
| Unread is not protected | t5 t4 t3 (t3 unread) | t6 t5 t4 | t6 t5 t4 |
| Source dropped an entry | t5 t4 t3 | t5 t4 | t5 t4 t3 |
| Same time, stored first | a@t5 (stored), b@t5 (new), c@t4, d@t3 | b@t5 c@t4 d@t3 | a@t5 b@t5 c@t4 |
| Entry older than all kept | t5 t4 t3 | t2 t5 t4 t3 | t5 t4 t3 |
| Title edited, has URL | x@t5 (read) | x@t5 with a new title | x@t5 (still read, old title) |

## Ports used

| Port | Method | Contract needed here |
| --- | --- | --- |
| `FeedItemRepository` | `inventory(feedId)` | Returns `(id, publishedAt)` for every stored item of the feed |
| | `create(items)` | Stores new items; ids that already exist are not duplicated |
| | `retain(feedId, ids)` | Deletes every item of the feed whose id is not in `ids` (all items if `ids` is empty) |
| `SettingsRepository` | `get(owner)` | Returns settings with defaults filled in |
| `FeedRepository` | `find`, `update` | Owner-scoped |

## Open points

- OP-1 `retain` runs after `create` but they are not one transaction. If the process stops in between, the feed temporarily holds more than N items. Is that acceptable, or must the two be atomic?
- OP-2 If `retention` is read at subscribe time, `addFeed` gains a dependency on `SettingsRepository`. Confirm this is wanted.
- OP-3 FI-REF-3: should refresh ever update a stored item when the source changes its content (for example a corrected article)? The target above says no.
