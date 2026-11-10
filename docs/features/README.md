# Behavior specification (Gherkin)

User-visible behavior of the reader, one `.feature` file per domain.

| File | Domain |
| --- | --- |
| `account.feature` | Registration, login, logout, password change, route protection |
| `saved-pages.feature` | Read-later pages |
| `subscriptions.feature` | Feed preview, subscribe, unsubscribe, refresh, retention |
| `feed-items.feature` | Browsing and reading subscription articles |
| `reader.feature` | Reader modes and on-demand extraction |
| `settings.feature` | Retention and extraction settings |
| `unread-counts.feature` | Unread badges |

Conventions:

- Saved pages and feed items are independent. Saving a feed item copies it into the read-later list; afterwards the two never affect each other.
- Every library operation is scoped to the signed-in user.
- Scenarios tagged `@known-gap` describe intended behavior that the current code does not implement yet.
- Out of scope (not implemented): password recovery, email verification, account deletion, unsubscribing confirmation rules beyond the UI, background-scheduler internals.
