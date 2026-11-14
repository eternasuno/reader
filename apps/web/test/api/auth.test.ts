import { beforeEach, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('better-auth/solid', () => ({ createAuthClient: () => client }));

import { changePassword, login, logout, register } from '../../src/api/auth';

beforeEach(() => {
  vi.resetAllMocks();
});

it('preserves login and registration API errors', async () => {
  client.signIn.email.mockResolvedValue({ error: { message: 'Rejected.' } });
  client.signUp.email.mockResolvedValue({ error: { message: 'Rejected.' } });
  const params = {
    name: 'User',
    email: 'user@example.com',
    password: 'password123',
  };
  await expect(login(params)).rejects.toThrow('Rejected.');
  await expect(register(params)).rejects.toThrow('Rejected.');
});

it('converts login and registration network errors', async () => {
  client.signIn.email.mockRejectedValue(new Error('Network unavailable'));
  client.signUp.email.mockRejectedValue(new Error('Network unavailable'));
  const params = {
    name: 'User',
    email: 'user@example.com',
    password: 'password123',
  };
  await expect(login(params)).rejects.toThrow(
    'Sign in failed. Please try again.'
  );
  await expect(register(params)).rejects.toThrow(
    'Registration failed. Please try again.'
  );
});

it('completes successful sign out', async () => {
  client.signOut.mockResolvedValue({ data: { success: true }, error: null });
  await expect(logout()).resolves.toBeUndefined();
  expect(client.signOut).toHaveBeenCalledWith();
});

it('preserves API sign out errors', async () => {
  client.signOut.mockResolvedValue({ error: { message: 'Session expired.' } });
  await expect(logout()).rejects.toThrow('Session expired.');
});

it('converts network sign out failures', async () => {
  client.signOut.mockRejectedValue(new Error('Network unavailable'));
  await expect(logout()).rejects.toThrow('Sign out failed. Please try again.');
});

it('uses fallback messages when API errors have no message', async () => {
  client.signIn.email.mockResolvedValue({ error: {} });
  client.signUp.email.mockResolvedValue({ error: {} });
  client.signOut.mockResolvedValue({ error: {} });
  const params = {
    name: 'User',
    email: 'user@example.com',
    password: 'password123',
  };
  await expect(login(params)).rejects.toThrow('Sign in failed.');
  await expect(register(params)).rejects.toThrow('Registration failed.');
  await expect(logout()).rejects.toThrow('Sign out failed.');
});

it('changes the password and revokes other sessions', async () => {
  client.changePassword.mockResolvedValue({ data: { user: {} }, error: null });
  const params = { currentPassword: 'old-pass', newPassword: 'new-pass1' };

  await expect(changePassword(params)).resolves.toBeUndefined();
  expect(client.changePassword).toHaveBeenCalledWith({
    ...params,
    revokeOtherSessions: true,
  });
});

it('maps password error codes without backend messages', async () => {
  client.changePassword.mockResolvedValue({
    error: { code: 'INVALID_PASSWORD', message: 'backend text' },
  });

  await expect(
    changePassword({ currentPassword: 'old-pass', newPassword: 'new-pass1' })
  ).rejects.toThrow('当前密码不正确');
});

it('falls back for unknown password codes and network failures', async () => {
  client.changePassword.mockResolvedValue({
    error: { code: 'MYSTERY', message: 'backend text' },
  });
  const params = { currentPassword: 'old-pass', newPassword: 'new-pass1' };
  await expect(changePassword(params)).rejects.toThrow(
    '修改密码失败，请稍后重试'
  );

  client.changePassword.mockRejectedValue(new Error('Network unavailable'));
  await expect(changePassword(params)).rejects.toThrow(
    '网络连接失败，请稍后重试'
  );
});
