import { useLocation, useNavigate } from '@solidjs/router';
import type { JSX } from '@solidjs/web';
import { createSignal, onSettled, Show } from 'solid-js';
import { ApiError, savedPagesApi } from '../api';
import { t, translateErrorCode } from '../i18n';
import { Button, Input, showToast } from '../ui';
import { errorCodeOf } from './viewHelpers';

const savedPageUrl = (pageId: string): string =>
  `/later/${encodeURIComponent(pageId)}`;

interface SaveResult {
  kind: 'saved' | 'existing' | 'error';
  pageId?: string;
  message?: string;
}

const failed = (message: string): SaveResult => ({ kind: 'error', message });

/** `SP-ADD-1`: a duplicate opens the existing page instead of creating another one. */
const resolveDuplicate = async (
  caught: unknown,
  url: string
): Promise<SaveResult> => {
  if (!(caught instanceof ApiError) || caught.code !== 'SavedPageAlreadyExists')
    return failed(translateErrorCode(errorCodeOf(caught)));

  try {
    const existing = await savedPagesApi.lookup(caught.url ?? url);
    if (existing !== null)
      return { kind: 'existing', pageId: savedPageUrl(existing.id) };
  } catch (lookupError) {
    return failed(translateErrorCode(errorCodeOf(lookupError)));
  }

  return failed(translateErrorCode('SavedPageAlreadyExists'));
};

const savePage = async (url: string): Promise<SaveResult> => {
  try {
    const page = await savedPagesApi.create(url);
    return { kind: 'saved', pageId: savedPageUrl(page.id) };
  } catch (caught) {
    return resolveDuplicate(caught, url);
  }
};

/** `later.md:16,54-58`: `GET /save?url=…` never mutates; the form performs the single POST. */
const useQuickSave = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [urlDraft, setUrlDraft] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const url = (): string =>
    urlDraft() ?? new URLSearchParams(location.search).get('url') ?? '';

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (submitting()) return;

    const trimmed = url().trim();
    if (trimmed.length === 0) {
      setError(translateErrorCode('InvalidPageUrl'));
      return;
    }

    setSubmitting(true);
    setError(null);
    void savePage(trimmed).then((result) => {
      setSubmitting(false);
      if (result.kind === 'error') {
        setError(result.message ?? translateErrorCode('RequestFailed'));
        return;
      }

      if (result.kind === 'saved')
        showToast(String(t('later.addedToast')), 'success');
      if (result.pageId !== undefined) navigate(result.pageId);
    });
  };

  return { url, error, submitting, setUrl: setUrlDraft, submit };
};

interface QuickSaveFormProps {
  url: string;
  submitting: boolean;
  onUrl: (value: string) => void;
  onSubmit: (event: SubmitEvent) => void;
}

function QuickSaveForm(props: QuickSaveFormProps): JSX.Element {
  let form: HTMLFormElement | undefined;

  onSettled(() => {
    form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
  });

  return (
    <form ref={form} class="flex flex-col gap-4" onSubmit={props.onSubmit}>
      <Input
        type="url"
        required
        label={String(t('later.urlLabel'))}
        placeholder={String(t('later.urlPlaceholder'))}
        value={props.url}
        disabled={props.submitting}
        onInput={(event) => props.onUrl(event.currentTarget.value)}
      />
      <div class="flex items-center justify-between gap-2">
        <a class="link link-hover text-sm text-base-content/70" href="/later">
          {String(t('common.cancel'))}
        </a>
        <Button
          type="submit"
          variant="primary"
          loading={props.submitting}
          disabled={props.submitting}
        >
          {String(t(props.submitting ? 'later.saving' : 'later.confirmSave'))}
        </Button>
      </div>
    </form>
  );
}

/**
 * `later.md:16,54-58`: `GET /save?url=...` renders an editable, pre-filled confirmation form
 * whose focused submit button performs the single `POST /api/saved-pages`.
 */
export function QuickSavePage(): JSX.Element {
  const save = useQuickSave();

  return (
    <div class="flex min-h-dvh items-center justify-center bg-base-100 p-4">
      <div class="card w-full max-w-md border border-base-300 bg-base-200 shadow-xl">
        <div class="card-body gap-4">
          <div class="flex flex-col gap-1">
            <p class="text-xs tracking-wide text-base-content/60 uppercase">
              {String(t('common.brand'))}
            </p>
            <h1 class="text-lg font-medium">
              {String(t('later.quickSaveTitle'))}
            </h1>
          </div>

          <Show when={save.error()}>
            <div role="alert" class="alert alert-error alert-soft text-sm">
              {save.error()}
            </div>
          </Show>

          <QuickSaveForm
            url={save.url()}
            submitting={save.submitting()}
            onUrl={save.setUrl}
            onSubmit={save.submit}
          />
        </div>
      </div>
    </div>
  );
}
