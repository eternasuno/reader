import type { FeedPreview } from '@reader/api';
import { Exit } from 'effect';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { exitError } from '../../lib/errors';
import type { FeedCommand } from '../../lib/feeds';

type FeedRun = (input: FeedCommand) => Promise<Exit.Exit<unknown, unknown>>;

type PreviewRun = (url: string) => Promise<Exit.Exit<FeedPreview, unknown>>;

const useFeedPreview = (run: PreviewRun) => {
  const [preview, setPreview] = createSignal<FeedPreview>();
  const [error, setError] = createSignal('');
  const [pending, setPending] = createSignal(false);
  let requestId = 0;
  let form: HTMLFormElement | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    requestId += 1;
  });
  const clear = () => {
    requestId += 1;
    setPreview(undefined);
    setError('');
    setPending(false);
  };
  const reset = () => {
    clear();
    form?.reset();
  };
  const request = async (input: HTMLFormElement) => {
    const url = String(new FormData(input).get('url') ?? '').trim();
    const current = requestId + 1;
    requestId = current;
    form = input;
    setError('');
    setPending(true);
    const exit = await run(url);
    if (disposed || requestId !== current) return;

    setPending(false);
    if (Exit.isSuccess(exit)) {
      setPreview(exit.value);

      return;
    }

    setError(exitError(exit));
  };

  return { preview, error, pending, request, clear, reset };
};

const useFeedConfirm = (
  run: FeedRun,
  preview: Accessor<FeedPreview | undefined>,
  reset: () => void
) => {
  const [error, setError] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [notice, setNotice] = createSignal('');
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const clear = () => {
    setError('');
    setNotice('');
  };
  const confirm = async () => {
    const current = preview();
    if (!current || pending()) return;

    clear();
    setPending(true);
    const exit = await run({ _tag: 'Subscribe', token: current.token });
    if (disposed) return exit;

    setPending(false);
    if (Exit.isSuccess(exit)) {
      reset();
      setNotice(`已订阅「${current.title}」`);

      return exit;
    }

    setError(exitError(exit));

    return exit;
  };

  return { error, pending, notice, clear, confirm };
};

export const useFeedSubscription = (run: FeedRun, previewRun: PreviewRun) => {
  const preview = useFeedPreview(previewRun);
  const confirm = useFeedConfirm(run, preview.preview, preview.reset);
  const edit = () => {
    preview.clear();
    confirm.clear();
  };
  const cancel = () => {
    preview.reset();
    confirm.clear();
  };
  const fetchPreview = (form: HTMLFormElement) => {
    if (!form.checkValidity()) return;

    confirm.clear();

    return preview.request(form);
  };

  return {
    preview: preview.preview,
    previewError: preview.error,
    previewPending: preview.pending,
    confirmError: confirm.error,
    confirmPending: confirm.pending,
    subscribeNotice: confirm.notice,
    fetchPreview,
    confirm: confirm.confirm,
    edit,
    cancel,
  };
};
