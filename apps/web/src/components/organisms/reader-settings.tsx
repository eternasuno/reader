import { useAtomSet, useAtomValue } from '@effect/atom-solid/Hooks';
import { Exit, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import {
  makeSettingsAtoms,
  type ReaderProvider,
  readerError,
  toReaderProvider,
} from '../../lib/reader';
import { Button } from '../atoms/button';
import { Input } from '../atoms/input';
import { SubmitButton } from '../atoms/submit-button';

const providerLabels: Record<ReaderProvider, string> = {
  jina: 'Jina',
  browser: '服务器提取服务',
};

const SettingsStatus = (props: {
  configured: boolean | undefined;
  jinaConfigured: boolean | undefined;
  provider: ReaderProvider | undefined;
  syncing: boolean;
}) => (
  <p class="mt-4 flex flex-wrap items-center gap-2 text-sm">
    <span class="badge badge-outline badge-sm">
      {props.configured ? '提取已就绪' : '提取未就绪'}
    </span>
    <span class="badge badge-outline badge-sm">
      {props.jinaConfigured ? '已保存 Jina Key' : '未保存 Jina Key'}
    </span>
    <span class="badge badge-outline badge-sm">
      当前：{props.provider ? providerLabels[props.provider] : '读取中…'}
    </span>
    {props.syncing && (
      <span class="text-xs text-base-content/50">正在同步…</span>
    )}
  </p>
);

const SettingsProviderForm = (props: {
  provider: ReaderProvider | undefined;
  disabled: boolean;
  onChange: (provider: ReaderProvider) => Promise<boolean>;
}) => {
  let select!: HTMLSelectElement;
  const reset = () => {
    select.value = props.provider ?? '';
  };
  const change = async () => {
    const next = toReaderProvider(select.value);
    if (!next) {
      reset();

      return;
    }

    if (!(await props.onChange(next))) {
      reset();
    }
  };

  return (
    <div class="mt-4 flex items-center gap-2">
      <label class="text-sm whitespace-nowrap" for="reader-provider">
        提取方式
      </label>
      <select
        ref={select}
        id="reader-provider"
        name="provider"
        class="select min-w-0 flex-1 border border-base-content/40 bg-base-200 text-base-content focus:border-primary focus:outline-primary disabled:border-base-content/20 disabled:text-base-content/40"
        value={props.provider ?? ''}
        disabled={props.disabled}
        onChange={() => void change()}
      >
        <option value="browser">服务器提取服务</option>
        <option value="jina">Jina</option>
      </select>
    </div>
  );
};

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
    <SubmitButton pending={props.pending} label="保存" pendingLabel="保存中…" />
  </form>
);

const SettingsBrowserForm = (props: {
  endpoint: string;
  pending: boolean;
  onSave: (form: HTMLFormElement) => void;
}) => (
  <form
    class="mt-3 flex items-center gap-2"
    onSubmit={(event) => {
      event.preventDefault();
      if (!props.pending && event.currentTarget.checkValidity()) {
        props.onSave(event.currentTarget);
      }
    }}
  >
    <label class="sr-only" for="browser-endpoint">
      浏览器服务地址
    </label>
    <Input
      id="browser-endpoint"
      type="url"
      name="endpoint"
      value={props.endpoint}
      maxLength={2048}
      pattern="(?:https?|wss?)://.+"
      autocomplete="off"
      spellcheck={false}
      class="min-w-0 flex-1"
      placeholder="http://127.0.0.1:9222"
      aria-describedby="browser-endpoint-help"
      disabled={props.pending}
    />
    <SubmitButton pending={props.pending} label="保存" pendingLabel="保存中…" />
  </form>
);

const SettingsDelete = (props: { disabled: boolean; onDelete: () => void }) => (
  <div class="mt-2 flex items-center justify-between gap-3">
    <p class="text-xs text-base-content/50">
      Key 加密保存，不会回显；切换提取方式后会保留。
    </p>
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

const useReaderSettings = () => {
  const atoms = makeSettingsAtoms();
  const status = useAtomValue(() => atoms.status);
  const mutation = useAtomValue(() => atoms.update);
  const update = useAtomSet(() => atoms.update, { mode: 'promiseExit' });
  const settings = () => Option.getOrUndefined(AsyncResult.value(status()));
  const busy = () => mutation().waiting;
  const changeProvider = async (next: ReaderProvider) => {
    const exit = await update({ _tag: 'Provider', provider: next });

    return Exit.isSuccess(exit);
  };
  const save = async (form: HTMLFormElement) => {
    const key = String(new FormData(form).get('key') ?? '');
    const exit = await update({ _tag: 'Key', key });
    if (Exit.isSuccess(exit)) {
      form.reset();
    }
  };
  const saveBrowserEndpoint = async (form: HTMLFormElement) => {
    const endpoint = String(new FormData(form).get('endpoint') ?? '');
    await update({ _tag: 'BrowserEndpoint', endpoint });
  };
  const remove = () => {
    if (
      window.confirm('删除已保存的 Jina Key？切换回 Jina 提取时需要重新填写。')
    ) {
      void update({ _tag: 'DeleteKey' });
    }
  };

  return {
    status,
    mutation,
    settings,
    busy,
    changeProvider,
    save,
    saveBrowserEndpoint,
    remove,
  };
};

export const ReaderSettings = () => {
  const model = useReaderSettings();

  return (
    <section class="py-2">
      <h2 class="text-lg font-semibold tracking-tight">正文提取设置</h2>
      <p class="mt-2 text-sm leading-6 text-base-content/60">
        服务器提取服务使用你填写的浏览器服务地址，无需 Jina Key；Jina
        提取会把文章地址发送给 Jina
        并消耗你的额度。切换提取方式会保留浏览器服务地址和 Jina Key。
      </p>
      <p class="mt-1 text-sm leading-6 text-base-content/60">
        正文图片默认加载，图片站点仍能看到你的 IP。
      </p>
      <SettingsStatus
        configured={model.settings()?.configured}
        jinaConfigured={model.settings()?.jinaConfigured}
        provider={model.settings()?.provider}
        syncing={model.status().waiting}
      />
      <SettingsProviderForm
        provider={model.settings()?.provider}
        disabled={
          model.busy() || model.status().waiting || !model.settings()?.provider
        }
        onChange={model.changeProvider}
      />
      <h3 class="mt-5 text-sm font-semibold">浏览器服务地址</h3>
      <SettingsBrowserForm
        endpoint={model.settings()?.browserEndpoint ?? ''}
        pending={model.busy() || model.status().waiting}
        onSave={(form) => void model.saveBrowserEndpoint(form)}
      />
      <p
        id="browser-endpoint-help"
        class="mt-2 text-xs leading-5 text-base-content/50"
      >
        支持 HTTP、HTTPS、WS 或 WSS 地址，由 API 服务器连接；localhost 指 API
        所在机器。留空保存可清除地址，地址仅对当前账户生效。
      </p>
      <h3 class="mt-5 text-sm font-semibold">Jina API Key</h3>
      <SettingsKeyForm
        pending={model.busy()}
        onSave={(f) => void model.save(f)}
      />
      <SettingsDelete
        disabled={model.busy() || !model.settings()?.jinaConfigured}
        onDelete={model.remove}
      />
      <p class="mt-2 min-h-5 text-sm text-error" role="status">
        {readerError(model.mutation()) || readerError(model.status())}
      </p>
    </section>
  );
};
