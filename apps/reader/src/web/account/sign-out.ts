import { signOutRequest } from '../api/auth';

/**
 * The sign-out action of the account menu (account.md Sign-out): ends the session
 * on the server and expires its cookie, and Better Auth re-reads the session
 * afterwards (AC-SESSION-8). The menu that calls it shows the pending label while
 * it runs, the sign-out wording when it rejects, and navigates to `/login` with
 * `{ replace: true }` when it resolves (AC-SESSION-4).
 */
export const signOut = (): Promise<void> => signOutRequest();
