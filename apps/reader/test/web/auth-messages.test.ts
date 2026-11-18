import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('better-auth/solid', () => ({ createAuthClient: () => client }));

import {
  authMessage,
  authNetworkMessage,
  changePassword,
  signIn,
} from '../../src/web/api/auth';

/**
 * Better Auth's wordings keyed by operation and code (account.md Messages): one
 * code can be worded differently per operation, and an unknown code, a missing
 * code (the 500 `{ "error": "Authentication unavailable" }` body) or a refused
 * rate limit uses the operation's fallback.
 */

beforeEach(() => {
  vi.resetAllMocks();
});

describe('the operation and code lookup', () => {
  it('words the password length per operation', () => {
    expect(authMessage('sign-up', 'PASSWORD_TOO_SHORT')).toBe(
      '密码至少需要 8 个字符'
    );
    expect(authMessage('change-password', 'PASSWORD_TOO_SHORT')).toBe(
      '新密码至少需要 8 个字符'
    );
    expect(authMessage('sign-up', 'PASSWORD_TOO_LONG')).toBe(
      '密码过长，请缩短后重试'
    );
    expect(authMessage('change-password', 'PASSWORD_TOO_LONG')).toBe(
      '新密码过长，请缩短后重试'
    );
  });

  it('uses the origin wording for any operation', () => {
    expect(authMessage('sign-in', 'INVALID_ORIGIN')).toBe(
      '请求来源无效，请刷新页面后重试'
    );
    expect(authMessage('change-password', 'MISSING_OR_NULL_ORIGIN')).toBe(
      '请求来源无效，请刷新页面后重试'
    );
  });

  it('falls back per operation for an unknown or missing code', () => {
    expect(authMessage('sign-in', 'MYSTERY')).toBe('登录失败，请稍后重试');
    expect(authMessage('sign-in')).toBe('登录失败，请稍后重试');
    expect(authMessage('sign-up')).toBe('注册失败，请稍后重试');
    expect(authMessage('sign-out', 'ANY')).toBe('退出失败，请重试');
    expect(authMessage('change-password', 'MYSTERY')).toBe(
      '修改密码失败，请稍后重试'
    );
  });
});

describe('a failed Better Auth call', () => {
  it('rejects with the operation wording of the code', async () => {
    client.signIn.email.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid' },
    });

    await expect(
      signIn({ email: 'reader@example.com', password: 'wrongpass' })
    ).rejects.toMatchObject({
      name: 'AuthFailure',
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: '邮箱或密码不正确',
    });
  });

  it('falls back for an English 500 body without a code', async () => {
    client.signIn.email.mockResolvedValue({
      data: null,
      error: { message: 'Authentication unavailable' },
    });

    await expect(
      signIn({ email: 'reader@example.com', password: 'password123' })
    ).rejects.toMatchObject({ message: '登录失败，请稍后重试' });
  });

  it('reports a call without an answer as the shared transport wording', async () => {
    client.changePassword.mockRejectedValue(new TypeError('no network'));

    await expect(
      changePassword({ currentPassword: 'old-one', newPassword: 'new-one-1' })
    ).rejects.toMatchObject({ message: authNetworkMessage });
  });

  it('revokes the other sessions when the password changes', async () => {
    client.changePassword.mockResolvedValue({ data: {}, error: null });

    await expect(
      changePassword({ currentPassword: 'old-one', newPassword: 'new-one-1' })
    ).resolves.toBeUndefined();
    expect(client.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-one',
      newPassword: 'new-one-1',
      revokeOtherSessions: true,
    });
  });
});
