import { createAuthClient } from 'better-auth/solid';

export const authClient = createAuthClient({
  fetchOptions: {
    credentials: 'include',
  },
});

export type SessionState = ReturnType<ReturnType<typeof authClient.useSession>>;

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
