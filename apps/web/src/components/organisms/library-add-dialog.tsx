import { Option } from 'effect';
import { createEffect, createSignal, For, Show } from 'solid-js';
import type { Preview } from '../../lib/library';
import type { PreviewResult } from '../../pages/library-mutations';
import { Button } from '../atoms/button';
import { SubmitButton } from '../atoms/submit-button';
import { Dialog } from '../molecules/dialog';
import { FormInput } from '../molecules/form-input';

type AddBusy = 'add' | 'preview' | 'subscribe';

type AddFlowProps = {
  readonly open: boolean;
  readonly mode: 'article' | 'feed';
  readonly onClose: () => void;
  readonly onAdd: (url: string) => Promise<boolean>;
  readonly onPreview: (url: string) => Promise<PreviewResult>;
  readonly onSubscribe: (url: string, title: string) => Promise<boolean>;
};

const submittedUrl = (form: HTMLFormElement): string =>
  String(new FormData(form).get('url') ?? '').trim();

const requestPreview = async (
  props: AddFlowProps,
  form: HTMLFormElement | undefined
): Promise<Preview | undefined> => {
  if (form === undefined) return undefined;

  const result = await props.onPreview(submittedUrl(form));

  return result.kind === 'preview' ? result.preview : undefined;
};

const useAddPreview = (props: AddFlowProps) => {
  let form: HTMLFormElement | undefined;
  const [preview, setPreview] = createSignal<Preview>();
  const [busy, setBusy] = createSignal(false);
  const reset = () => {
    setPreview(undefined);
  };
  const resetForm = () => {
    reset();
    form?.reset();
  };
  const request = async () => {
    setBusy(true);
    const requested = await requestPreview(props, form);
    setBusy(false);
    if (requested !== undefined) setPreview(requested);
  };

  return {
    preview,
    busy,
    reset,
    resetForm,
    request,
    formRef: (element: HTMLFormElement) => {
      form = element;
    },
  };
};

const useAddSubmit = (
  props: AddFlowProps,
  close: () => void,
  resetPreview: () => void
) => {
  const [busy, setBusy] = createSignal<AddBusy>();
  const run = async (kind: AddBusy, task: () => Promise<boolean>) => {
    setBusy(kind);
    try {
      if (await task()) close();
    } finally {
      setBusy(undefined);
    }
  };
  const add = async (value: string) => {
    await run('add', () => props.onAdd(value));
  };
  const subscribe = async (url: string, title: string) => {
    await run('subscribe', () => props.onSubscribe(url, title));
  };
  const edit = () => {
    resetPreview();
    setBusy(undefined);
  };

  return { busy, add, subscribe, edit };
};

const PreviewPanel = (props: {
  readonly preview: Preview;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) => (
  <section
    aria-label="订阅预览"
    class="mt-2 rounded-box border border-base-content/20 p-3"
  >
    <h3 class="font-semibold tracking-tight">{props.preview.title}</h3>
    <Show when={Option.getOrUndefined(props.preview.description)}>
      {(text) => (
        <p class="mt-1 whitespace-pre-line text-sm text-base-content/70">
          {text()}
        </p>
      )}
    </Show>
    <p class="mt-1 break-all text-xs text-base-content/60">
      {props.preview.url}
    </p>
    <ul class="mt-2 list-disc pl-5 text-sm text-base-content/70">
      <For each={props.preview.titles.slice(0, 3)}>
        {(title) => <li class="truncate">{title}</li>}
      </For>
    </ul>
    <div class="mt-3 flex flex-wrap gap-2">
      <SubmitButton
        type="button"
        pending={props.busy}
        label="确认订阅"
        pendingLabel="订阅中…"
        onClick={props.onConfirm}
      />
      <Button type="button" disabled={props.busy} onClick={props.onCancel}>
        返回修改
      </Button>
    </div>
  </section>
);

const AddForm = (props: {
  readonly preview: ReturnType<typeof useAddPreview>;
  readonly submit: ReturnType<typeof useAddSubmit>;
  readonly mode: 'article' | 'feed';
}) => (
  <form
    ref={props.preview.formRef}
    class="mt-2"
    onSubmit={(event) => {
      event.preventDefault();
      if (props.mode === 'article') {
        void props.submit.add(submittedUrl(event.currentTarget));
      } else {
        void props.preview.request();
      }
    }}
  >
    <FormInput
      id="library-add-url"
      name="url"
      label="网址"
      hint="请输入有效的 http 或 https 链接"
      type="url"
      required
      placeholder={
        props.mode === 'article' ? '粘贴文章链接…' : '粘贴 RSS / Atom 链接…'
      }
      disabled={props.preview.busy() || props.submit.busy() !== undefined}
    />
    <div class="flex flex-wrap gap-2">
      <Show
        when={props.mode === 'article'}
        fallback={
          <SubmitButton
            pending={props.preview.busy()}
            label="预览订阅"
            pendingLabel="获取预览…"
          />
        }
      >
        <SubmitButton
          pending={props.submit.busy() === 'add'}
          label="添加文章"
          pendingLabel="添加中…"
        />
      </Show>
    </div>
  </form>
);

export const LibraryAddDialog = (props: AddFlowProps) => {
  const preview = useAddPreview(props);
  const submit = useAddSubmit(props, props.onClose, preview.reset);
  createEffect(() => {
    if (props.open) preview.resetForm();
  });

  const title = () =>
    props.mode === 'article' ? '新增文章链接' : '新增 RSS 订阅';

  return (
    <Dialog open={props.open} label={title()} onClose={props.onClose}>
      <section class="py-2" aria-labelledby="library-add-heading">
        <h2
          id="library-add-heading"
          class="text-lg font-semibold tracking-tight"
        >
          {title()}
        </h2>
        <p class="mt-2 text-sm text-base-content/60">
          {props.mode === 'article'
            ? '粘贴文章链接，保存到稍后阅读。'
            : '粘贴 RSS / Atom 链接，预览后确认订阅。'}
        </p>
        <Show
          when={preview.preview()}
          keyed
          fallback={
            <AddForm preview={preview} submit={submit} mode={props.mode} />
          }
        >
          {(item) => (
            <PreviewPanel
              preview={item}
              busy={submit.busy() === 'subscribe'}
              onConfirm={() => void submit.subscribe(item.url, item.title)}
              onCancel={submit.edit}
            />
          )}
        </Show>
      </section>
    </Dialog>
  );
};
