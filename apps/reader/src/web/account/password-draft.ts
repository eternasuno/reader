import { createSignal } from 'solid-js';
import { accountMessages as copy } from './messages';

export type PasswordDraft = ReturnType<typeof createPasswordDraft>;

/**
 * The three password fields of the `账号` section as one draft: their values and
 * the messages that depend on more than one field (account.md Interface). The
 * confirmation carries the new password as its `pattern`, so a differing
 * confirmation fails native validation before anything is sent.
 */
export const createPasswordDraft = () => {
  const [current, setCurrent] = createSignal('');
  const [next, setNext] = createSignal('');
  const [confirmation, setConfirmation] = createSignal('');

  return {
    current,
    setCurrent,
    next,
    setNext,
    confirmation,
    setConfirmation,
    /** A new password equal to the current one is refused (AC-PASSWORD-4). */
    newPasswordHint: () =>
      next() !== '' && next() === current()
        ? copy.newPasswordSameMessage
        : copy.newPasswordHint,
    confirmationHint: () =>
      confirmation() === ''
        ? copy.newPasswordConfirmationMessage
        : copy.newPasswordMismatchMessage,
    confirmationPattern: () => RegExp.escape(next()),
    clear: () => {
      setCurrent('');
      setNext('');
      setConfirmation('');
    },
  };
};
