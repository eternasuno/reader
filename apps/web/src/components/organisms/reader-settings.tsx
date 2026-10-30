import { useAtomSet, useAtomValue } from '@effect/atom-solid/Hooks';
import { Exit, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { makeSettingsAtoms, readerError } from '../../lib/reader';
import { Button } from '../atoms/button';
import { Input } from '../atoms/input';

const SettingsStatus = (props: {
  configured: boolean | undefined;
  syncing: boolean;
}) => (
  <p class="mt-4 flex items-center gap-2 text-sm">
    <span class="badge badge-outline badge-sm">
      {props.configured ? '已配置 Key' : '尚未配置 Key'}
    </span>
    {props.syncing && (
      <span class="text-xs text-base-content/50">正在同步…</span>
    )}
  </p>
);

const SettingsKeyForm = (props: {
  pending: boolean;
  onSave: (form: HTMLFormElement) => void;
}) => (
  <form
    class="mt-3 flex items-center gap-2"
    onSubmit={(event) => {
      event.preventDefault();
      if (!props.pending) {
        props.onSave(event.currentTarget);
      }
    }}
  >
    <label class="sr-only" for="jina-key">
      Jina API Key
    </label>
    <Input
      id="jina-key"
      type="password"
      name="key"
      required
      maxLength={2048}
      autocomplete="off"
      class="min-w-0 flex-1"
      aria-label="Jina API Key"
      placeholder="输入新的 Jina API Key"
      disabled={props.pending}
    />
    <Button
      class="btn btn-neutral"
      variant="solid"
      type="submit"
      disabled={props.pending}
      aria-busy={props.pending}
    >
      {props.pending ? '保存中…' : '保存'}
    </Button>
  </form>
);

const SettingsDelete = (props: { disabled: boolean; onDelete: () => void }) => (
  <div class="mt-2 flex items-center justify-between gap-3">
    <p class="text-xs text-base-content/50">Key 加密保存，不会回显。</p>
    <Button
      class="link text-sm"
      type="button"
      disabled={props.disabled}
      onClick={props.onDelete}
    >
      删除 Key
    </Button>
  </div>
);

export const ReaderSettings = () => {
  const atoms = makeSettingsAtoms();
  const status = useAtomValue(() => atoms.status);
  const mutation = useAtomValue(() => atoms.update);
  const update = useAtomSet(() => atoms.update, { mode: 'promiseExit' });
  const configured = () =>
    Option.getOrUndefined(AsyncResult.value(status()))?.configured;
  const save = async (form: HTMLFormElement) => {
    const exit = await update(String(new FormData(form).get('key') ?? ''));
    if (Exit.isSuccess(exit)) {
      form.reset();
    }
  };
  const remove = () => {
    if (window.confirm('删除已保存的 Jina Key？缓存正文仍可阅读。')) {
      void update(null);
    }
  };
  return (
    <section class="py-2">
      <h2 class="text-lg font-semibold tracking-tight">正文提取设置</h2>
      <p class="mt-2 text-sm leading-6 text-base-content/60">
        使用自己的 Jina API Key。提取时会将文章地址发送给 Jina
        并消耗你的额度。Key
        加密保存在服务器，不会回显。正文图片默认加载，图片站点仍能看到你的 IP。
      </p>
      <SettingsStatus configured={configured()} syncing={status().waiting} />
      <SettingsKeyForm
        pending={mutation().waiting}
        onSave={(f) => void save(f)}
      />
      <SettingsDelete
        disabled={mutation().waiting || !configured()}
        onDelete={remove}
      />
      <p class="mt-2 min-h-5 text-sm text-error" role="status">
        {readerError(mutation()) || readerError(status())}
      </p>
    </section>
  );
};
