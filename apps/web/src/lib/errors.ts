import { Cause, Exit } from 'effect';
import { AsyncResult } from 'effect/reactivity';

export const errorText = (error: unknown): string =>
  typeof error === 'object' &&
  error !== null &&
  'error' in error &&
  typeof error.error === 'string'
    ? error.error
    : '操作失败，请稍后重试';

export const resultError = (
  result: AsyncResult.AsyncResult<unknown, unknown>
): string => {
  if (!AsyncResult.isFailure(result)) {
    return '';
  }

  return errorText(Cause.squash(result.cause));
};

export const exitError = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isSuccess(exit) ? '' : errorText(Cause.squash(exit.cause));
