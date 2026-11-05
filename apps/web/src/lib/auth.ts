import { createAuthClient } from 'better-auth/solid';

export const authClient = createAuthClient({
  fetchOptions: {
    credentials: 'include',
  },
});

export type LoginParams = {
  email: string;
  password: string;
};

export type RegisterParams = LoginParams & {
  name: string;
};

export const login = async (params: LoginParams) => {
  let result: Awaited<ReturnType<typeof authClient.signIn.email>>;

  try {
    result = await authClient.signIn.email(params);
  } catch {
    throw new Error('Sign in failed. Please try again.');
  }

  if (result.error) {
    throw new Error(result.error.message ?? 'Sign in failed.');
  }
};

export const register = async (params: RegisterParams) => {
  let result: Awaited<ReturnType<typeof authClient.signUp.email>>;

  try {
    result = await authClient.signUp.email(params);
  } catch {
    throw new Error('Registration failed. Please try again.');
  }

  if (result.error) {
    throw new Error(result.error.message ?? 'Registration failed.');
  }
};

export const logout = async () => {
  let result: Awaited<ReturnType<typeof authClient.signOut>>;

  try {
    result = await authClient.signOut();
  } catch {
    throw new Error('Sign out failed. Please try again.');
  }

  if (result.error) {
    throw new Error(result.error.message ?? 'Sign out failed.');
  }
};

type ChangePasswordParams = {
  currentPassword: string;
  newPassword: string;
};

const passwordMessages: Record<string, string> = {
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
  INVALID_ORIGIN: '请求来源无效，请刷新页面后重试',
};

const passwordErrorText = (code: string | undefined): string =>
  code === undefined
    ? '修改密码失败，请稍后重试'
    : (passwordMessages[code] ?? '修改密码失败，请稍后重试');

export const changePassword = async (params: ChangePasswordParams) => {
  let result: Awaited<ReturnType<typeof authClient.changePassword>>;

  try {
    result = await authClient.changePassword({
      ...params,
      revokeOtherSessions: true,
    });
  } catch {
    throw new Error('网络连接失败，请稍后重试');
  }

  if (result.error) {
    const code: unknown = result.error.code;

    throw new Error(
      passwordErrorText(typeof code === 'string' ? code : undefined)
    );
  }
};
