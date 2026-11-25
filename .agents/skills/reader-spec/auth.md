# Authentication & Sessions

Single-user password authentication configured by `APP_PASSWORD`. No registration, no user table, no email verification, and no in-app password reset.

## Rules

- `AC-AUTH-1`: `POST /api/auth/login` verifies the submitted password using constant-time comparison against `APP_PASSWORD`. Success sets an `HttpOnly`, `SameSite=Lax` (and `Secure` when `APP_URL` is `https://`) HMAC-signed session cookie.
- `AC-AUTH-1a`: `APP_PASSWORD` must be nonempty valid UTF-8 without CR or LF (browsers strip them from password inputs) and its browser JSON login request must fit the 4096-byte request body limit; invalid configuration is rejected without exposing the password.
- `AC-AUTH-2`: Wrong password returns `401 InvalidCredentials`. Repeated failed login attempts from an IP are rate-limited (`429 TooManyRequests`).
- `AC-AUTH-3`: `POST /api/auth/logout` clears the session cookie (`204`).
- `AC-AUTH-4`: Every route except `/login` checks `GET /api/auth/session` (`200 { authenticated: boolean }`). Unauthenticated requests redirect to `/login` preserving a validated same-origin relative `?next=...` path (starting with `/`, never `//`, keeping encoded query parameters such as `/all?unread` across failed login attempts; `/save` holds its `#url=` or legacy `?url=` draft in tab memory instead of copying it into `?next`); authenticated visits to `/login` redirect to `?next` (if valid) or `/`. `/login` shows the checking-session state until `GET /api/auth/session` resolves, so the form never flashes for an already signed-in visitor.
- `AC-AUTH-5`: If any non-login `/api/*` request receives `401 Unauthorized`, the client clears session state and redirects to `/login` (preserving current relative route+query in `?next`). `POST /api/auth/login` returning `401 InvalidCredentials` never triggers this redirect and shows `密码不正确` inline.

## Interface

- **Login page (`/login`)**: centered card with product label `稍后阅读` (or `Read Later`), title `登录`, one required password field `密码`, submit button `登录` (pending `登录中…`, inputs disabled while in flight), and a compact `中文 / EN` locale toggle (`CM-I18N-1`). Errors show as an inline alert inside the card.
- **Sign-out**: located in the sidebar/mobile header menu (`退出登录` / `退出中…`). Failure shows an inline error inside the menu without leaving the current page.

## API

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/api/auth/session` | — | `200 { authenticated: boolean }` | — |
| POST | `/api/auth/login` | `{ password: string }` | `204` + `Set-Cookie` | `InvalidCredentials` 401, `TooManyRequests` 429 |
| POST | `/api/auth/logout` | — | `204` + cleared cookie | `Forbidden` 403 |

## Messages

| Code / Situation | Text |
| --- | --- |
| `InvalidCredentials` | 密码不正确 |
| login label / placeholder / missing | 密码 / 请输入密码 / 请输入密码。 |
| login button / pending | 登录 / 登录中… |
| sign-out / pending / error | 退出登录 / 退出中… / 退出失败，请重试 |

## Acceptance

```gherkin
Feature: Single-user authentication
  Scenario: Signing in with a redirect target from quick-save
    Given I am not signed in
    When I open "/save#url=https%3A%2F%2Fexample.com%2Fpost%3Fa%3D1%26b%3D2"
    Then I am redirected to "/login?next=%2Fsave" without the target URL in "?next"
    When I submit an incorrect password first, then the correct password
    Then the first attempt stays on "/login" showing "密码不正确" and keeps "?next"
    And the second attempt returns to "/save" with "https://example.com/post?a=1&b=2" pre-filled from memory

  Scenario: Wrong password is rate-limited after repeated failures
    When I submit an incorrect password repeatedly
    Then I receive "密码不正确" and eventually "请求过于频繁，请稍后重试"
```
