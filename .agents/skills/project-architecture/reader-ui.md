# Reader layout and interaction contract

Read this reference when changing the reader workspace, sidebar navigation, list toolbar, list reloading and read state, article modes, add and subscribe dialogs, the settings page, or shared menu/status icons. These conventions record explicit user decisions; preserve them unless the current request changes them. Use source for exact classes and dimensions.

## Layout and visual system

- Preserve the dark neutral surfaces, purple interactive/selected accents, and warm brand accent. Use the existing Tailwind/daisyUI tokens and shared atoms.
- Wide screens use three columns: sidebar, article list, reader. Intermediate screens retain the sidebar and show either the list or reader. Small screens show one panel with a mobile navigation bar. Keep layout responsive through CSS; preserve focus when panels become hidden.
- The article-list heading is a compact single row. Group the title and unread count together on the left. On the right show only the mark-loaded-read icon and overflow-menu icon. Keep filter controls and add actions inside menus.
- Article rows use full-width hover/selected surfaces, content-sized heights, three-line titles and two-line summaries. Keep read/unread controls separate from article-link activation and within the row hit area.

## Sidebar navigation and menus

- Later reading (`稍后阅读`), all subscriptions (`全部订阅`), and each RSS source share the same row/menu component and behavior.
- Default state shows an unread count on the right. Hover or keyboard focus replaces it with the overflow trigger in the same position. Keep the trigger visible while its popover is open; coarse-pointer devices keep it visible without requiring hover.
- Count and trigger must use equal-size, equally centered slots and identical right offsets. Remove the count atom's auto margin inside this slot. Align the RSS-add button with these triggers, including coarse-pointer sizing.
- Every scope menu contains `只显示未读` and `全部标记为已读`. Invoke these against the clicked scope, even when another scope is selected. Select/navigate to that scope before acting; guard against asynchronous scope changes so a delayed action cannot target a different scope.
- Filtering currently uses one shared model filter (`unreadOnly`), retained across scope navigation. Checked means unread only; unchecked means all. Do not create independent per-source checkbox state without a new requirement.
- `稍后阅读` additionally offers `新增文章链接`. Individual RSS-source menus additionally offer `删除 RSS 源`; aggregate scopes have no delete-source option.
- Put an always-available plus icon to the right of the `订阅源` section label. It opens the RSS-only add flow.

## Article-list overflow menu

- Offer `只显示未读` with the shared icon checkbox, and `全部标记为已读` for the current list scope.
- `稍后阅读` offers `新增文章链接`, which opens only the article form. All-subscription and single-source lists have no add option; RSS creation belongs beside the sidebar section label.
- For a single selected RSS source, `删除 RSS 源` directly targets that source. Do not show a source picker. Hide deletion for all-subscription and later-reading scopes.
- Keep the existing deletion confirmation: unsubscribing removes source articles but preserves saved later-reading items.
- Mark-loaded affects loaded unread articles; mark-all affects the entire scope, including unloaded articles. A zero/stale unread counter must not disable mark-all when loaded unread articles exist.
- Empty states explain the current scope/filter and recovery. Later-reading can add an article; filtered emptiness can restore all articles. RSS emptiness directs users to the sidebar plus rather than adding a list creation control.

## List reloading and read state

- A list reloads, from the first page, only when the user enters it, selects a feed, changes the filter, or presses the toolbar refresh button. It never reloads in the background or when the user comes back from reading.
- Refresh is ignored while a read mark, a delete, or a whole-scope mark is in flight; the refresh button is disabled then.
- Opening an article from the unread list marks it read but keeps it listed, shown as read, until the list reloads.
- Read-state changes are optimistic and roll back with an error toast when the request fails.

## Creation dialogs

- Reuse the shared controlled native `Dialog`. Keep article and RSS modes explicit and distinct.
- Article mode: `新增文章链接`, article URL field, and article submit only. No RSS preview or subscribe actions.
- RSS mode: `新增 RSS 订阅`, RSS/Atom URL field, preview submit, then confirmation and return-to-edit. No add-article action. Enter submits the action appropriate to the mode. Confirming subscribes with the previewed URL and title and lands on the new feed, which stays empty until its first refresh.
- Adding a link that is already saved opens the existing page (looked up by the URL the error names) instead of showing an error. Subscribing to a feed already followed opens the feed in the list with the URL the error names.
- Reset form/preview on opening. Close on successful completion; preserve the open form on failure. Retain native validation, Esc, close button, and focus return. Close the invoking popover before opening a dialog.

## Reader header and content modes

- Keep extraction as an independent icon in the header action row, immediately before the overflow menu; do not add a separate action row below the header.
- Default article content is the original stored body/description. The menu has no separate `原文` mode option. Keep `打开原文` as an external link in overflow.
- Extraction toggle: outline icon outside extracted mode; click extracts or uses cached content and switches to extracted mode. Extracted mode shows a purple solid icon and exposes pressed state; click again returns to original content. During extraction, disable conflicting controls and show a spinner plus accessible status.
- First extraction must switch automatically after the returned article replaces the previous object. Reset mode on article ID changes only, not same-ID content updates. Memoize the ID before the reset effect. Preserve stale-result protection when navigating during extraction; cover same-ID replacement and different-ID reset in regression tests.
- Overflow contains `嵌入式网页视图` using `MenuCheckbox`. Checked shows the embedded page; clicking again unchecks and returns to original content. Keep this header accessible in embedded mode so the user can exit it.
- Keep sandboxing, CSP, iframe content isolation, and authenticated resize messages intact.

## Settings page

- Show only whether a Jina key and a browser service address are configured, never their values.
- Picking a provider only changes which field the form shows; nothing is saved until Save. A blank field keeps the stored value. Show the message of `BrowserEndpointRequired` when the browser provider has no address.
- Clearing the Jina key asks for confirmation; cancelling keeps it, and clearing leaves the provider unchanged.
- Offer no way to remove the browser address; typing a new one replaces it.

## Shared control appearance

- `MenuCheckbox` keeps a native checkbox visually hidden and renders the existing `ReaderIcon` square/squareCheck visuals. Match size, purple selected color, disabled feedback, and keyboard focus for unread filtering and embedded-page toggles; do not substitute a browser-styled checkbox or an unrelated selected icon.
- `ReadStatusIcon`: read is an empty ring; unread has an outer ring and smaller solid center separated by a transparent gap. Reuse it in article rows and reader actions.
- Shared buttons preserve hover/focus/disabled/loading contracts and accessible labels. Touch icon targets are 44px. Selected filled surfaces retain their state on hover.

## Verification

- Check scope targeting from another selected scope, checkbox on/off state, native popover dismissal, dialog close/reopen/focus return, and deletion confirmation without deleting unrelated content.
- Check title/count alignment, count-to-menu replacement, RSS-add alignment, long titles, hover/focus/open/disabled states, and actual narrow/coarse-pointer viewports.
- Check first extraction, cached extraction, toggle back, embedded view on/off, and changing articles during extraction. Existing Node/Vitest tests cover mode state; use a real rendered browser for layout and interaction claims.
- Run repository-required check/test/build commands and relevant type checks. A clean detector or static build does not establish visual acceptance. If the available browser renders only the app shell or lacks CJK glyphs, report that limitation and avoid claiming visual verification.
