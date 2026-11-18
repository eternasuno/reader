# Accounts and sessions

Who the user is and how a request carries that: registration, sign-in, the session every route and every endpoint depends on, sign-out and the password change on the settings page. This file owns the forms of `/register` and `/login`, the session check and its guards, the sign-out control of the account menu, and the `账号` section of `/settings`. The settings page around that section, and every other setting, are in [settings.md](settings.md); the library screen that sign-out leaves is [library.md](library.md); the routes and the shared loading and error messages are in [SKILL.md](SKILL.md).

## Rules

### AC-ACCOUNT — Accounts

- AC-ACCOUNT-1 Accounts are Better Auth email/password accounts. Better Auth's defaults decide the password rules: 8 to 128 characters, and no other requirement (no character classes, no digits or symbols).
- AC-ACCOUNT-2 Registration does not sign in: a successful sign-up creates the account and starts no session, and the browser goes to `/login`, where the user signs in with the password just chosen.
- AC-ACCOUNT-3 Registration of an email that already exists creates no second account and reports no error: because sign-up does not sign in, Better Auth answers the same generic success as for a new account and the browser goes to `/login` as usual. Signing in afterwards with the password typed at registration therefore fails unless that is the stored password of the existing account. This is the anti-enumeration answer of the library, not a bug; the taken-email wording (`USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, Messages) only appears if sign-up is ever configured to sign in.
- AC-ACCOUNT-4 Signing in with the right credentials starts a session and opens the library at `/`.
- AC-ACCOUNT-5 Signing in with a wrong password, or with an email that has no account, shows an error and stays on `/login`; no session is started. The two cases answer the same code (`INVALID_EMAIL_OR_PASSWORD`) and therefore the same wording, so the page never tells an unknown address from a wrong password. A malformed email is rejected before the lookup and has its own message.
- AC-ACCOUNT-6 The nickname is required and must contain a non-blank character; the email must look like an address; the password must have 8 to 128 characters. The form checks these for the user's benefit and Better Auth checks the email format and the password length again at the boundary.
- AC-ACCOUNT-7 There is no password recovery, no email verification (an account is usable without verifying its address), no email change and no account deletion.

### AC-SESSION — The session

- AC-SESSION-1 Better Auth exclusively owns `/api/auth/*`: registration, sign-in, sign-out, the session read and the password change are its endpoints. The application adds no authentication endpoint and reimplements no part of the protocol.
- AC-SESSION-2 Identity comes only from the session cookie of the request. No endpoint accepts a user id or an owner from the client, and a request naming another owner is still handled as the session's user (CM-OWN-1). The owner of every stored row is the session's user.
- AC-SESSION-3 Every endpoint other than `/api/auth/*` needs a session: without one the answer is 401 with an empty body (API conventions). The browser sends its cookies with every request.
- AC-SESSION-4 Every route except `/login` and `/register` needs a session. A page whose session check answers "no session" redirects to `/login`, replacing the history entry, so going back does not return to the guarded page.
- AC-SESSION-5 `/login` with a session goes to `/`, replacing the entry. Only an answered session counts: while the session is being read again (after sign-out, on focus) the previous user is not yet confirmed, so `/login` waits for the answer instead of bouncing back to a guarded page. `/register` has no such redirect: a signed-in user who opens it sees the form.
- AC-SESSION-6 The session check has three states: pending, answered (a session or none) and failed. While it is pending the page shows the session-checking text and, when it fails, the session-check-failure text and no content; a failure does not redirect, because an unreachable auth server says nothing about whether the user is signed in. Only an answered "no session" redirects (AC-SESSION-4). The two texts are shared with every other page ([SKILL.md](SKILL.md) Shared messages).
- AC-SESSION-7 The auth server renews or clears the session cookie while it reads a session, and those headers reach the browser on every library response, error responses included. A session the server extended or ended is therefore never lost or kept in the browser because of a request that failed later.
- AC-SESSION-8 The client re-reads the session when the window regains focus, after sign-in, sign-up and sign-out, and when any request answers 401, so a session that ended elsewhere (another device signed out, the session expired) is noticed at the next check and the guard redirects.

### AC-PASSWORD — Changing the password

- AC-PASSWORD-1 Changing the password needs the current password. Better Auth verifies it and replaces the stored password of the signed-in account.
- AC-PASSWORD-2 The change revokes the other sessions and keeps this one: the request asks for that (`revokeOtherSessions`), so other devices must sign in again with the new password while this browser stays signed in.
- AC-PASSWORD-3 A wrong current password changes nothing and is reported with the wrong-password wording (Messages: change password `INVALID_PASSWORD`).
- AC-PASSWORD-4 The server does not compare the new password with the current one. The form refuses a new password equal to the current one before sending anything, so an unchanged password is never stored as a "change".
- AC-PASSWORD-5 The new password has 8 to 128 characters, checked by the form and again by the boundary.
- AC-PASSWORD-6 On success the three fields are cleared, the password-changed toast is shown (Messages), and the user stays on the settings page with the session intact.

## Interface

### Register page

- `/register` shows a centred card on the page background: the product label, the register title, the form, and below it the footer link to `/login` (Messages: auth page product label; register page title; register footer link).
- The form has four fields in this order: the nickname, the email (an email input), the password and the confirmation. The nickname is required and must hold a non-blank character, the email must look like an address, the password has at least 8 characters and the confirmation must equal the password typed above (Messages: their labels, hints and messages). The nickname and the email are trimmed before sending; the password is sent as typed.
- The form is not submitted while a field is invalid. A field that is invalid shows its message as a tooltip under it and takes the error styling; before the first submit attempt no message is shown, so the form does not shout at an untouched page.
- The submit button shows its label, or its pending label with a spinner while the request is in flight, when it is disabled together with the fields; a second submit while pending does nothing (Messages: register submit).
- A failure answers inside the form as an alert with the wording of the failure (Messages; the register rows); the entered values stay so the user can correct them.
- Success goes to `/login` without signing in (AC-ACCOUNT-2); no toast is shown, because the login page is the feedback.

### Login page

- `/login` shows the same centred card with the product label, the login title, the form, and below it the footer link to `/register` (Messages: login page title; login footer link).
- Two fields, the email and the password, both required and validated on submit as on the register page (Messages: email field label and message; login password field label and message).
- The submit button shows its label, or its pending label with a spinner while it is disabled; a second submit while pending does nothing (Messages: login submit).
- A failure answers as an alert inside the form and the page stays, wrong credentials included (AC-ACCOUNT-5, Messages). On success the session appears and the page goes to `/` (AC-ACCOUNT-4, AC-SESSION-5), so a signed-in user who opens `/login` lands in the library instead.

### The session check and its guards

- Every page except `/login` and `/register` waits for the session check: while it is pending the page shows the session-checking text in place of its content, and when it fails it shows the session-check-failure text as an alert in place of its content (AC-SESSION-6, [SKILL.md](SKILL.md) Shared messages).
- An answered "no session" redirects to `/login` with the entry replaced (AC-SESSION-4). Nothing else of the page is shown in the meantime.
- Because the session is re-read on focus (AC-SESSION-8), a session that ended elsewhere turns into that redirect the next time the window is focused; content already on screen is not re-checked on every render.

### Sign-out

- Sign-out lives in the account menu of the library screen: the trigger is the user icon carrying the account-menu trigger label, and the menu shows the settings item, which opens `/settings`, and then, separated, the sign-out item ([library.md](library.md) places the menu in the sidebar and on the mobile bar) (Messages: account menu trigger; account menu item, settings; account menu item, sign-out).
- Pressing the sign-out item ends the session on the server and expires the cookie; the client then reads the session again (AC-SESSION-8), and its answer "no session" takes the page to `/login` replacing the entry (AC-SESSION-4), so the page moves once. The item itself does not navigate: navigating before that read answers would let `/login` see the previous user. While the request is in flight the item is disabled and shows its pending label; a second press does nothing.
- A sign-out that fails leaves the session untouched and shows the sign-out wording inside the menu, under the item, so the user can press it again (Messages: sign-out).

### The `账号` section of the settings page

- The section `账号` of `/settings` shows its heading and its description line (Messages: account section heading / description) ([settings.md](settings.md) owns the page, its navigation and its save and unsaved-changes behavior.)
- Three password fields: the current password, the new password and the confirmation, the last two required and at least 8 characters long (Messages: their labels, hints and messages).
- Validation happens on submit: a new password equal to the current one is refused on the new-password field and a confirmation that differs from the new password is refused on the confirmation field (Messages: new password equal to the current one; confirmation differs from the new password). Neither is sent (AC-PASSWORD-4). A missing or too short field shows its own message.
- The submit button shows the password-change label, or its pending label with a spinner while it is disabled together with the fields and with everything else on the page; one action runs at a time (see [settings.md](settings.md)) (Messages: password change submit).
- On success the fields are cleared and the password-changed toast is shown (AC-PASSWORD-6). On failure the toast carries the wording of the failure (Messages, the change-password rows), including the one for a wrong current password, and the fields keep what was typed.
- The section is part of the settings form stack: typing any of the three fields makes the section changed, so switching section or leaving the page asks first (see [settings.md](settings.md)).

## API

Better Auth serves every endpoint below under `/api/auth`; the API passes the request through and returns Better Auth's own response, headers and cookie included, so the session cookie and its attributes are the library's, not the application's. Requests and bodies are JSON; an auth failure body is `{ "message": string, "code": string }` with the status of the table.

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/sign-up/email` | body `{ name: string, email: string, password: string }` | 200 `{ token: null, user }` and no session cookie | `INVALID_EMAIL` 400, `PASSWORD_TOO_SHORT` 400, `PASSWORD_TOO_LONG` 400, taken email: generic 200 without creating a user (AC-ACCOUNT-3) |
| POST | `/api/auth/sign-in/email` | body `{ email: string, password: string }` | 200 `{ redirect, token, url, user }` and the session cookie | `INVALID_EMAIL` 400, `PASSWORD_TOO_LONG` 400, `INVALID_EMAIL_OR_PASSWORD` 401, `FAILED_TO_CREATE_SESSION` 401 |
| GET | `/api/auth/get-session` | session cookie | 200 `{ session, user }`, or 200 `null` without a session | — |
| POST | `/api/auth/sign-out` | — | 200 `{ success: true }`; the session cookie is expired | `INVALID_ORIGIN` 403, `MISSING_OR_NULL_ORIGIN` 403 |
| POST | `/api/auth/change-password` | body `{ currentPassword: string, newPassword: string, revokeOtherSessions: true }`; session cookie | 200 `{ token, user }`; the session cookie is replaced and the other sessions are gone | `PASSWORD_TOO_SHORT` 400, `PASSWORD_TOO_LONG` 400, `INVALID_PASSWORD` 400, `CREDENTIAL_ACCOUNT_NOT_FOUND` 400, `UNAUTHORIZED` 401, `FAILED_TO_GET_SESSION` 500 |

- A request to any of them answers 500 `{ "error": "Authentication unavailable" }` when the auth handler itself throws; the client shows the operation's fallback wording.
- Better Auth's own origin check covers `/api/auth/*`; the application's Origin check (API conventions in [SKILL.md](SKILL.md)) covers its own endpoints only. It runs for state-changing auth requests that carry a cookie: the origin is the request's `Origin`, or its `Referer` when there is no `Origin`; it must be the origin of the configured auth base URL, otherwise 403 `INVALID_ORIGIN`, and a checked request carrying neither header, or `Origin: null`, answers 403 `MISSING_OR_NULL_ORIGIN`. Sign-in and sign-up are additionally checked while the request carries no cookie, through the browser's Fetch Metadata headers: `Sec-Fetch-Site: cross-site` with `Sec-Fetch-Mode: navigate` answers 403 `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED` and any other value of those headers leads to the same origin check, while a cookie-free request carrying none of them and no `Origin` or `Referer` passes. So sign-in and sign-up work without a session, and every request of the client itself carries an `Origin`.
- Better Auth's rate limiter is on in production and refuses excessive sign-in, sign-up and password-change attempts with 429 and a message but no code; the client then shows the operation's fallback wording.
- `GET /api/auth/get-session` answers `null` and no error when the request carries no valid session, which is how a guard learns there is none (AC-SESSION-4); when the library refreshes the session it renews the session cookie in the same response, and the application forwards those headers (AC-SESSION-7). There is no other session request.
- The password change takes `currentPassword` and `newPassword`, and `revokeOtherSessions` decides whether the other sessions are deleted and a new one started for this browser, whose cookie the response carries (AC-PASSWORD-1, AC-PASSWORD-2). The endpoint checks the session but not its age, so an old but valid session may change the password.
- Nothing about an account is reachable outside `/api/auth/*`: no endpoint of the application reads a user, an email or a password, and no endpoint creates, deletes or renames an account.

## Messages

Better Auth's own messages are English, so the client maps the `code` of an auth failure to Chinese, per operation: one code can carry one wording for sign-up and another for the password change. An unknown code, a failure without a code and a 500 use the operation's fallback. A request that gets no response at all is the shared transport failure ([SKILL.md](SKILL.md) Shared messages). The column `New` marks wordings written for this spec (today sign-in and sign-up show Better Auth's English text) and the user should review them; `existing` wordings are already in the app.

| Operation | Code | Text | New |
| --- | --- | --- | --- |
| sign-up | `INVALID_EMAIL` | 请输入有效的邮箱 | new |
| sign-up | `PASSWORD_TOO_SHORT` | 密码至少需要 8 个字符 | new |
| sign-up | `PASSWORD_TOO_LONG` | 密码过长，请缩短后重试 | new |
| sign-up | `FAILED_TO_CREATE_USER` | 注册失败，请稍后重试 | new |
| sign-up | fallback: unknown code, no code, 500 | 注册失败，请稍后重试 | new |
| sign-in | `INVALID_EMAIL` | 请输入有效的邮箱 | new |
| sign-in | `PASSWORD_TOO_LONG` | 密码过长，请缩短后重试 | new |
| sign-in | `INVALID_EMAIL_OR_PASSWORD` | 邮箱或密码不正确 | new |
| sign-in | `FAILED_TO_CREATE_SESSION` | 登录失败，请稍后重试 | new |
| sign-in | fallback: unknown code, no code, 500 | 登录失败，请稍后重试 | new |
| sign-out | any code, no code, 500 | 退出失败，请重试 | existing |
| change password | `INVALID_PASSWORD` | 当前密码不正确 | existing |
| change password | `PASSWORD_TOO_SHORT` | 新密码至少需要 8 个字符 | existing |
| change password | `PASSWORD_TOO_LONG` | 新密码过长，请缩短后重试 | existing |
| change password | `CREDENTIAL_ACCOUNT_NOT_FOUND` | 当前账号不支持修改密码 | existing |
| change password | `FAILED_TO_GET_SESSION`, `SESSION_EXPIRED`, `UNAUTHORIZED` | 登录状态已失效，请重新登录 | existing |
| change password | `SESSION_NOT_FRESH` | 请重新登录后再修改密码 | existing |
| change password | `USER_NOT_FOUND` | 当前账号不存在，请重新登录 | existing |
| change password | `RATE_LIMITED` | 尝试次数过多，请稍后重试 | existing |
| change password | fallback: unknown code, no code, 500 | 修改密码失败，请稍后重试 | existing |
| any operation | `INVALID_ORIGIN` | 请求来源无效，请刷新页面后重试 | existing |
| any operation | `MISSING_OR_NULL_ORIGIN` | 请求来源无效，请刷新页面后重试 | new |

Page copy, none of it an error code:

| Situation | Text | New |
| --- | --- | --- |
| password changed | 密码已更新，其他设备已退出登录 | existing |
| password change submit | 修改密码 / 修改中… | existing |
| current password field label / message | 当前密码 / 请输入当前密码。 | existing |
| new password field label / hint | 新密码 / 至少 8 个字符，且不能与当前密码相同。 | existing |
| confirmation field label / message | 确认新密码 / 请再次输入新密码。 | existing |
| new password equal to the current one | 新密码不能与当前密码相同。 | existing |
| confirmation differs from the new password | 两次输入的新密码不一致。 | existing |
| account section heading / description | 账号 / 修改密码后会退出其他设备，当前设备保持登录。 | existing |
| account menu trigger | 用户菜单 | existing |
| account menu item, settings | 设置 | existing |
| account menu item, sign-out | 退出登录 / 退出中… | existing |
| register page title | 注册 | existing |
| register submit | 注册 / 注册中… | existing |
| nickname field label / message | 昵称 / 请输入昵称。 | existing |
| email field label / message (both pages) | 邮箱 / 请输入有效邮箱。 | existing |
| register password field label / hint | 密码 / 密码至少 8 位。 | existing |
| register confirmation label / message | 确认密码 / 两次输入的密码不一致。 | existing |
| register footer link | 已有账号？ 去登录 | existing |
| login page title | 登录 | existing |
| login submit | 登录 / 登录中… | existing |
| login password field label / message | 密码 / 请输入密码。 | existing |
| login footer link | 还没有账号？ 去注册 | existing |
| auth page product label | 稍后阅读 | existing |

`SESSION_NOT_FRESH` and `RATE_LIMITED` cannot come out of the password change as it is configured today (the endpoint checks the session but not its freshness, and a refused rate limit carries no code of its own); the wordings stay as the mapping for those codes.

## Acceptance

```gherkin
Feature: Accounts and sessions

  Rule: Registration creates an account without signing in

    Scenario: A new account
      Given nobody registered "reader@example.com"
      When I open "/register", fill "昵称" with "读读", "邮箱" with "reader@example.com", "密码" and "确认密码" with "password123" and submit
      Then the request "POST /api/auth/sign-up/email" creates the account
      And I am on "/login" and no session was started
      When I sign in with "reader@example.com" and "password123"
      Then I am on "/" and the library is shown

    Scenario: An email that is already registered
      Given "reader@example.com" already has an account
      When I register "reader@example.com" again with the password "another123"
      Then no second account is created
      And no error is shown and I am on "/login"
      When I sign in with "reader@example.com" and "another123"
      Then the alert "邮箱或密码不正确" is shown and I stay on "/login"

    Scenario: A short password
      When I fill the register form with a 7-character password and submit
      Then nothing is sent and the "密码" field shows "密码至少 8 位。"

    Scenario: A password of 8 characters is accepted
      When I fill the register form with the password "12345678" and submit
      Then the account is created

    Scenario: The confirmation does not match
      When I fill "密码" with "password123" and "确认密码" with "password124" and submit
      Then nothing is sent and the "确认密码" field shows "两次输入的密码不一致。"

    Scenario: The email is not an address
      When I fill "邮箱" with "reader" and submit
      Then nothing is sent and the "邮箱" field shows "请输入有效邮箱。"

    Scenario: A blank nickname
      When I fill "昵称" with "   " and submit
      Then nothing is sent and the "昵称" field shows "请输入昵称。"

    Scenario: The registration request fails
      Given the sign-up endpoint answers 500 "Authentication unavailable"
      When I submit a valid register form
      Then the alert "注册失败，请稍后重试" is shown
      And the typed values stay in the form

  Rule: Signing in opens the library

    Scenario: Right credentials
      Given the account "reader@example.com" with the password "password123"
      When I open "/login" and submit that email and password
      Then a session cookie is set and the page goes to "/"
      And the library shows my saved pages

    Scenario: Wrong credentials
      Given the account "reader@example.com" with the password "password123"
      When I sign in with the password "wrongpass"
      Then the alert "邮箱或密码不正确" is shown
      And I stay on "/login" and no session was started

    Scenario: The sign-in request fails
      Given the sign-in endpoint answers 500 "Authentication unavailable"
      When I submit a valid login form
      Then the alert "登录失败，请稍后重试" is shown

    Scenario: The form is blocked while signing in
      Given a sign-in is in flight
      Then the button reads "登录中…" and the fields and the button are disabled

  Rule: The session guards every page

    Scenario: A page without a session redirects
      Given I have no session
      When I open "/settings"
      Then I am redirected to "/login"
      When I open "/later"
      Then I am redirected to "/login"

    Scenario: The check is pending
      Given the session check has not answered yet
      When I open "/later"
      Then the page shows "正在确认登录状态…"

    Scenario: The check fails
      Given the session check cannot reach the auth server
      When I open "/later"
      Then the page shows "暂时无法确认登录状态，请刷新重试。"
      And it does not redirect

    Scenario: A signed-in user opens the login page
      Given I have a session
      When I open "/login"
      Then I am taken to "/"

    Scenario: A signed-in user opens the register page
      Given I have a session
      When I open "/register"
      Then the registration form is shown

    Scenario: A session that ended elsewhere
      Given I am reading the library
      When the session ends on another device and I focus the window again
      Then the next session check has no session and I am redirected to "/login"

    Scenario: A request finds the session gone before the window is focused again
      Given I am reading the library and my session ends on the server
      When the next library request answers 401
      Then the session is read again and I am redirected to "/login" once

    Scenario: Library operations need the session
      Given I have no session
      When a library request is sent without a session cookie
      Then the answer is 401 with an empty body

  Rule: Signing out ends the session

    Scenario: Signing out
      Given I have a session and the library is open
      When I open the account menu and press "退出登录"
      Then the item reads "退出中…" while the request runs
      And I am on "/login" and the session is gone
      And the page went to "/login" once, without passing through "/" or "/later" again
      When I open "/later"
      Then I am redirected to "/login"

    Scenario: Signing out fails
      Given the sign-out endpoint cannot be reached
      When I press "退出登录"
      Then "退出失败，请重试" is shown inside the menu
      And I stay on the library and still have the session

  Rule: Changing the password

    Scenario: A successful change
      Given I am signed in in two browsers
      When I open "/settings", choose "账号", fill "当前密码" with the old password, "新密码" and "确认新密码" with "newpassword1" and press "修改密码"
      Then the toast "密码已更新，其他设备已退出登录" is shown
      And the three fields are empty
      And the other browser is signed out
      And this browser stays signed in on "/settings"
      When I sign in again after signing out with "newpassword1"
      Then the library opens

    Scenario: The current password is wrong
      When I submit "当前密码" with a wrong password and a valid new password
      Then the toast "当前密码不正确" is shown
      And the stored password is unchanged and the other sessions are still signed in

    Scenario: The new password equals the current one
      When I fill "当前密码", "新密码" and "确认新密码" with the same password and press "修改密码"
      Then nothing is sent and the "新密码" field shows "新密码不能与当前密码相同。"

    Scenario: The confirmation differs
      When "新密码" is "newpassword1" and "确认新密码" is "newpassword2"
      Then nothing is sent and "确认新密码" shows "两次输入的新密码不一致。"

    Scenario: A short new password
      When "新密码" and "确认新密码" are 7 characters long
      Then nothing is sent and both fields show their message

    Scenario: The password change is one action of the page
      Given a password change is in flight
      Then the button reads "修改中…" and the page is blocked until it finishes
```
