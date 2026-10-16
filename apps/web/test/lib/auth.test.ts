import { beforeEach, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
}));

vi.mock('better-auth/solid', () => ({ createAuthClient: () => client }));

import { login, logout, register } from '../../src/lib/auth';

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
