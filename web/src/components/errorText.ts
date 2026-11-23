import { errorCodeOf } from '../api';
import { translateErrorCode } from '../i18n';

/** Maps an API failure to the translated message the UI shows inline. */
export const errorText = (error: unknown): string =>
  translateErrorCode(errorCodeOf(error));
