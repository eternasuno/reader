import { createAuthClient } from 'better-auth/solid';

/**
 * The one Better Auth Solid client (AC-SESSION-1): it owns `/api/auth/*` — sign-in,
 * registration, sign-out, the session read and the password change — and the
 * session atom that `useSession()` reads inside a component's owned scope.
 */
export const authClient = createAuthClient({
  fetchOptions: { credentials: 'include' },
});

/** The Better Auth operations whose failures carry their own wording. */
export type AuthOperation =
  | 'sign-up'
  | 'sign-in'
  | 'sign-out'
  | 'change-password';

/** The shared transport wording: no answer at all (SKILL.md Shared messages). */
export const authNetworkMessage = '网络连接失败，请检查网络后重试';

const originMessages: Readonly<Record<string, string>> = {
  INVALID_ORIGIN: '请求来源无效，请刷新页面后重试',
  MISSING_OR_NULL_ORIGIN: '请求来源无效，请刷新页面后重试',
};

type OperationMessages = {
  readonly fallback: string;
  readonly codes: Readonly<Record<string, string>>;
};

/**
 * Better Auth answers in English and one code can mean different things per
 * operation, so the wording is keyed by operation and code (account.md Messages).
 */
const operationMessages: Record<AuthOperation, OperationMessages> = {
  'sign-up': {
    fallback: '注册失败，请稍后重试',
    codes: {
      INVALID_EMAIL: '请输入有效的邮箱',
      PASSWORD_TOO_SHORT: '密码至少需要 8 个字符',
      PASSWORD_TOO_LONG: '密码过长，请缩短后重试',
      FAILED_TO_CREATE_USER: '注册失败，请稍后重试',
    },
  },
  'sign-in': {
    fallback: '登录失败，请稍后重试',
    codes: {
      INVALID_EMAIL: '请输入有效的邮箱',
      PASSWORD_TOO_LONG: '密码过长，请缩短后重试',
      INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不正确',
      FAILED_TO_CREATE_SESSION: '登录失败，请稍后重试',
    },
  },
  'sign-out': { fallback: '退出失败，请重试', codes: {} },
  'change-password': {
    fallback: '修改密码失败，请稍后重试',
    codes: {
      INVALID_PASSWORD: '当前密码不正确',
      PASSWORD_TOO_SHORT: '新密码至少需要 8 个字符',
      PASSWORD_TOO_LONG: '新密码过长，请缩短后重试',
      CREDENTIAL_ACCOUNT_NOT_FOUND: '当前账号不支持修改密码',
      FAILED_TO_GET_SESSION: '登录状态已失效，请重新登录',
      SESSION_EXPIRED: '登录状态已失效，请重新登录',
      SESSION_NOT_FRESH: '请重新登录后再修改密码',
      UNAUTHORIZED: '登录状态已失效，请重新登录',
      USER_NOT_FOUND: '当前账号不存在，请重新登录',
      RATE_LIMITED: '尝试次数过多，请稍后重试',
    },
  },
};

/**
 * The wording of a Better Auth failure: the code's row for the operation, the
 * operation's fallback for an unknown code, no code (a 500 or a rate limit) or a
 * 500 `{ "error": "Authentication unavailable" }` body, and the shared
 * origin-failure wording for a rejected `Origin` (account.md Messages).
 */
export const authMessage = (
  operation: AuthOperation,
  code?: string
): string => {
  if (code !== undefined && Object.hasOwn(originMessages, code)) {
    return originMessages[code] ?? '';
  }

  const messages = operationMessages[operation];

  return code === undefined
    ? messages.fallback
    : (messages.codes[code] ?? messages.fallback);
};

/**
 * What a sign-in, registration, sign-out or password change rejects with: the
 * Chinese wording as `message`, the operation, and Better Auth's `code` when it
 * sent one. `messageOf` in `messages.ts` returns `message` unchanged.
 */
export class AuthFailure extends Error {
  readonly operation: AuthOperation;
  readonly code: string | undefined;

  constructor(
    operation: AuthOperation,
    code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = 'AuthFailure';
    this.operation = operation;
    this.code = code;
  }
}

export const isAuthFailure = (value: unknown): value is AuthFailure =>
  value instanceof AuthFailure;

/** Only the failure of a Better Auth call is read; the payload is not used. */
type AuthOutcome = { readonly error: unknown };

const codeOf = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;

  const code: unknown = Reflect.get(error, 'code');

  return typeof code === 'string' ? code : undefined;
};

/**
 * Runs one Better Auth call: a failure code becomes the operation's wording, an
 * answer without a code its fallback, and a call that gets no answer the shared
 * transport wording.
 */
const run = async (
  operation: AuthOperation,
  call: () => Promise<AuthOutcome>
): Promise<void> => {
  let outcome: AuthOutcome;

  try {
    outcome = await call();
  } catch {
    throw new AuthFailure(operation, undefined, authNetworkMessage);
  }

  if (outcome.error === null || outcome.error === undefined) return;

  const code = codeOf(outcome.error);

  throw new AuthFailure(operation, code, authMessage(operation, code));
};

export type SignInParams = {
  readonly email: string;
  readonly password: string;
};

export type RegisterParams = SignInParams & { readonly name: string };

/** `POST /api/auth/sign-in/email`: starts a session (AC-ACCOUNT-4). */
export const signIn = (params: SignInParams): Promise<void> =>
  run('sign-in', () => authClient.signIn.email({ ...params }));

/**
 * `POST /api/auth/sign-up/email`: creates the account and starts no session
 * (AC-ACCOUNT-2); a taken email answers the same success (AC-ACCOUNT-3).
 */
export const register = (params: RegisterParams): Promise<void> =>
  run('sign-up', () => authClient.signUp.email({ ...params }));

/** `POST /api/auth/sign-out`: ends the session and expires the cookie. */
export const signOutRequest = (): Promise<void> =>
  run('sign-out', () => authClient.signOut());

export type PasswordChangeParams = {
  readonly currentPassword: string;
  readonly newPassword: string;
};

/** `POST /api/auth/change-password`, revoking the other sessions (AC-PASSWORD-2). */
export const changePassword = (params: PasswordChangeParams): Promise<void> =>
  run('change-password', () =>
    authClient.changePassword({ ...params, revokeOtherSessions: true })
  );
