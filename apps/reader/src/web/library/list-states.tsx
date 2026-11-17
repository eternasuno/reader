import { Show } from 'solid-js';
import { Button } from '../ui/button';
import {
  copy,
  type EmptyAction,
  type EmptyCopy,
  emptyActionLabel,
} from './messages';

const Status = (props: {
  readonly title: string;
  readonly hint: string;
  readonly action?: string | undefined;
  readonly onAction?: (() => void) | undefined;
}) => (
  <div class="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-12 text-center">
    <div class="max-w-xs">
      <h3 class="text-lg font-medium text-balance">{props.title}</h3>
      <p class="mt-3 text-sm leading-relaxed text-pretty text-base-content/65">
        {props.hint}
      </p>
      <Show when={props.action}>
        {(action) => (
          <Button
            variant="solid"
            class="btn btn-sm btn-primary mt-6 pointer-coarse:min-h-11"
            onClick={() => props.onAction?.()}
          >
            {action()}
          </Button>
        )}
      </Show>
    </div>
  </div>
);

/** The pane while the first page of the scope loads (LIB-STATE-1). */
export const ListLoading = () => (
  <div
    role="status"
    class="flex min-h-0 flex-1 items-center justify-center gap-3 text-sm text-base-content/60"
  >
    <span class="loading loading-spinner loading-sm" aria-hidden="true" />
    {copy.loading}
  </div>
);

/** The first page failed and no row is loaded (LIB-LIST-4). */
export const ListFailed = () => (
  <Status title={copy.failedTitle} hint={copy.failedHint} />
);

/** The scope has no rows: the recovery is the one its copy names (LIB-STATE-2). */
export const ListEmpty = (props: {
  readonly empty: EmptyCopy;
  readonly onAction: (action: EmptyAction) => void;
}) => (
  <Status
    title={props.empty.title}
    hint={props.empty.hint}
    action={
      props.empty.action === undefined
        ? undefined
        : emptyActionLabel(props.empty.action)
    }
    onAction={() => {
      if (props.empty.action !== undefined) props.onAction(props.empty.action);
    }}
  />
);

/** The banner of a list whose page failed, above whatever is loaded (LIB-LIST-4). */
export const ListError = (props: {
  readonly message: string;
  readonly onRetry: () => void;
}) => (
  <div
    role="alert"
    class="flex shrink-0 items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-2 text-xs text-error"
  >
    <span class="min-w-0 flex-1">{props.message}</span>
    <Button
      type="button"
      class="btn btn-sm pointer-coarse:min-h-11"
      onClick={() => props.onRetry()}
    >
      {copy.retry}
    </Button>
  </div>
);
