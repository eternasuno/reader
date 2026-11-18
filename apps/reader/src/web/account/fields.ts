import { accountMessages as copy } from './messages';

/**
 * The field definitions of the account forms, so the copy and the native
 * validation attributes of a field stay in one place (account.md Interface).
 * A form spreads the definition and overrides what it computes itself, such as
 * a reactive hint, the confirmation's pattern or a field's `onInput`.
 */

const passwordLength = 8;

export const emailField = {
  id: 'email',
  name: 'email',
  type: 'email',
  autocomplete: 'email',
  required: true,
  label: copy.emailLabel,
  hint: copy.emailMessage,
} as const;

export const loginPasswordField = {
  id: 'password',
  name: 'password',
  type: 'password',
  autocomplete: 'current-password',
  required: true,
  label: copy.loginPasswordLabel,
  hint: copy.loginPasswordMessage,
} as const;

export const nicknameField = {
  id: 'name',
  name: 'name',
  autocomplete: 'name',
  required: true,
  /** A non-blank character is required (AC-ACCOUNT-6). */
  pattern: '.*\\S.*',
  label: copy.nicknameLabel,
  hint: copy.nicknameMessage,
} as const;

export const registerPasswordField = {
  id: 'password',
  name: 'password',
  type: 'password',
  autocomplete: 'new-password',
  required: true,
  minlength: passwordLength,
  label: copy.registerPasswordLabel,
  hint: copy.registerPasswordHint,
} as const;

export const registerConfirmationField = {
  id: 'confirm',
  name: 'confirm',
  type: 'password',
  autocomplete: 'new-password',
  required: true,
  label: copy.registerConfirmationLabel,
  hint: copy.registerConfirmationMessage,
} as const;

/** The new-password field of the `账号` section; its name is read back by submit. */
export const newPasswordFieldName = 'newPassword';

export const currentPasswordField = {
  id: 'currentPassword',
  name: 'currentPassword',
  type: 'password',
  autocomplete: 'current-password',
  required: true,
  label: copy.currentPasswordLabel,
  hint: copy.currentPasswordMessage,
} as const;

export const newPasswordField = {
  id: newPasswordFieldName,
  name: newPasswordFieldName,
  type: 'password',
  autocomplete: 'new-password',
  required: true,
  minlength: passwordLength,
  label: copy.newPasswordLabel,
  hint: copy.newPasswordHint,
} as const;

export const newPasswordConfirmationField = {
  id: 'newPasswordConfirmation',
  name: 'newPasswordConfirmation',
  type: 'password',
  autocomplete: 'new-password',
  required: true,
  label: copy.newPasswordConfirmationLabel,
  hint: copy.newPasswordConfirmationMessage,
} as const;
