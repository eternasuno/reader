import { describe, expect, it, vi } from 'vitest';

vi.mock('better-auth/solid', () => ({ createAuthClient: () => ({}) }));

import { type AuthSession, isConfirmedSignedIn } from '../../src/web/api/auth';

const signedIn: NonNullable<AuthSession['data']> = {
  user: {
    id: 'u1',
    name: '读读',
    email: 'reader@example.com',
    emailVerified: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  session: {
    id: 's1',
    userId: 'u1',
    token: 't1',
    expiresAt: new Date(0),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
};

const answered: AuthSession = {
  data: signedIn,
  error: null,
  isPending: false,
  isRefetching: false,
  refetch: async () => undefined,
};

describe('AC-SESSION-5 /login leaves only for a confirmed session', () => {
  it('confirms a session whose read has finished with a user', () => {
    expect(isConfirmedSignedIn(answered)).toBe(true);
  });

  it('Scenario: Signing out — a session being read again is not confirmed', () => {
    expect(isConfirmedSignedIn({ ...answered, isRefetching: true })).toBe(
      false
    );
  });

  it('does not confirm a pending or empty read', () => {
    expect(
      isConfirmedSignedIn({ ...answered, data: null, isPending: true })
    ).toBe(false);
    expect(isConfirmedSignedIn({ ...answered, data: null })).toBe(false);
  });
});
