/**
 * A confirmation the user answers with yes or no. The components pass the
 * browser's own `confirm`, so the settings store and its rules stay testable
 * without a DOM.
 */
export type Confirm = (message: string) => boolean;

/** The browser's confirmation; never called outside a browser. */
export const browserConfirm: Confirm = (message) => globalThis.confirm(message);
