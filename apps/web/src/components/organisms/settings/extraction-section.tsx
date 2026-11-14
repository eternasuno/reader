import { Show } from 'solid-js';
import type { FetcherProvider } from '../../../api/setting';
import { Button } from '../../atoms/button';
import { SubmitButton } from '../../atoms/submit-button';
import { FormInput } from '../../molecules/form-input';

type ExtractionSectionProps = {
  readonly class?: string;
  readonly busy: boolean;
  readonly pending: boolean;
  readonly provider: FetcherProvider;
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
  readonly jinaKey: string;
  readonly browserEndpoint: string;
  readonly onProviderChange: (provider: FetcherProvider) => void;
  readonly onJinaKeyChange: (value: string) => void;
  readonly onBrowserEndpointChange: (value: string) => void;
  readonly onSubmit: (form: HTMLFormElement) => void;
  readonly onClearKey: () => void;
};

const ExtractionProvider = (props: {
  readonly provider: FetcherProvider;
  readonly busy: boolean;
  readonly onChange: (provider: FetcherProvider) => void;
}) => (
  <div class="flex items-center gap-2">
    <label class="text-sm whitespace-nowrap" for="settings-provider">
      提取方式
    </label>
    <select
      id="settings-provider"
      name="provider"
      class="select min-w-0 flex-1 border border-base-content/40 bg-base-200 text-base-content focus:border-primary focus:outline-primary disabled:border-base-content/20 disabled:text-base-content/40"
      value={props.provider}
      disabled={props.busy}
      onChange={(event) =>
        props.onChange(
          event.currentTarget.value === 'browser' ? 'browser' : 'jina'
        )
      }
    >
      <option value="jina">Jina（可匿名使用）</option>
      <option value="browser">服务器提取服务</option>
    </select>
  </div>
);

const ExtractionFlags = (props: {
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
}) => (
  <p class="text-xs leading-5 text-base-content/60">
    Jina Key：{props.jinaKeyConfigured ? '已保存' : '未保存'}
    <span aria-hidden="true"> · </span>
    浏览器服务地址：{props.browserEndpointConfigured ? '已保存' : '未保存'}
  </p>
);

const JinaKeyField = (props: {
  readonly configured: boolean;
  readonly busy: boolean;
  readonly value: string;
  readonly onInput: (value: string) => void;
}) => (
  <FormInput
    id="settings-jina-key"
    name="jinaKey"
    type="password"
    autocomplete="off"
    label="Jina API Key"
    hint={
      props.configured
        ? '已保存 Key，留空保持不变。'
        : '留空则使用 Jina 匿名访问。'
    }
    value={props.value}
    disabled={props.busy}
    onInput={(event) => props.onInput(event.currentTarget.value)}
  />
);

const BrowserEndpointField = (props: {
  readonly configured: boolean;
  readonly busy: boolean;
  readonly value: string;
  readonly onInput: (value: string) => void;
}) => (
  <FormInput
    id="settings-browser-endpoint"
    name="browserEndpoint"
    type="url"
    autocomplete="off"
    spellcheck={false}
    label="浏览器服务地址"
    hint={
      props.configured
        ? '已保存地址，留空保持不变。'
        : '支持 http、https、ws 或 wss。'
    }
    value={props.value}
    disabled={props.busy}
    onInput={(event) => props.onInput(event.currentTarget.value)}
  />
);

const ExtractionFields = (props: {
  readonly provider: FetcherProvider;
  readonly busy: boolean;
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
  readonly jinaKey: string;
  readonly browserEndpoint: string;
  readonly onJinaKeyChange: (value: string) => void;
  readonly onBrowserEndpointChange: (value: string) => void;
}) => (
  <Show
    when={props.provider === 'browser'}
    fallback={
      <JinaKeyField
        configured={props.jinaKeyConfigured}
        busy={props.busy}
        value={props.jinaKey}
        onInput={props.onJinaKeyChange}
      />
    }
  >
    <BrowserEndpointField
      configured={props.browserEndpointConfigured}
      busy={props.busy}
      value={props.browserEndpoint}
      onInput={props.onBrowserEndpointChange}
    />
  </Show>
);

const JinaKeyClearAction = (props: {
  readonly busy: boolean;
  readonly onClearKey: () => void;
}) => (
  <div class="mt-5 flex items-center justify-between gap-3 border-t border-base-300 pt-4">
    <p class="text-xs leading-5 text-base-content/50">
      删除已保存的 Jina Key 后，Jina 提取使用匿名访问。
    </p>
    <Button
      class="btn btn-sm shrink-0"
      type="button"
      disabled={props.busy}
      onClick={props.onClearKey}
    >
      删除 Key
    </Button>
  </div>
);

const ExtractionHeader = (props: {
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
}) => (
  <div class="mt-1 flex flex-col gap-1">
    <p class="text-sm leading-6 text-base-content/60">
      Jina 会把文章地址发送给 Jina 并消耗额度，未保存 Key
      时使用匿名访问；服务器提取服务使用你填写的浏览器服务地址。
    </p>
    <ExtractionFlags
      jinaKeyConfigured={props.jinaKeyConfigured}
      browserEndpointConfigured={props.browserEndpointConfigured}
    />
  </div>
);

const ExtractionForm = (props: ExtractionSectionProps) => (
  <form
    class="mt-5 flex flex-col gap-4"
    novalidate
    onSubmit={(event) => {
      event.preventDefault();
      props.onSubmit(event.currentTarget);
    }}
  >
    <ExtractionProvider
      provider={props.provider}
      busy={props.busy}
      onChange={props.onProviderChange}
    />
    <ExtractionFields
      provider={props.provider}
      busy={props.busy}
      jinaKeyConfigured={props.jinaKeyConfigured}
      browserEndpointConfigured={props.browserEndpointConfigured}
      jinaKey={props.jinaKey}
      browserEndpoint={props.browserEndpoint}
      onJinaKeyChange={props.onJinaKeyChange}
      onBrowserEndpointChange={props.onBrowserEndpointChange}
    />
    <div>
      <SubmitButton
        pending={props.pending}
        label="保存提取设置"
        pendingLabel="保存中…"
      />
    </div>
  </form>
);

export const ExtractionSection = (props: ExtractionSectionProps) => (
  <section
    id="settings-extraction"
    class={`rounded-box border border-base-300 bg-base-100 p-5 ${props.class ?? ''}`}
    aria-labelledby="settings-extraction-title"
  >
    <h2 id="settings-extraction-title" class="text-lg font-semibold">
      提取
    </h2>
    <ExtractionHeader
      jinaKeyConfigured={props.jinaKeyConfigured}
      browserEndpointConfigured={props.browserEndpointConfigured}
    />
    <ExtractionForm {...props} />
    <Show when={props.jinaKeyConfigured}>
      <JinaKeyClearAction busy={props.busy} onClearKey={props.onClearKey} />
    </Show>
  </section>
);
