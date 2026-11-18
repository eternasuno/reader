import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { FolderSelect, folders } from '../folder';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { FormField } from '../ui/form-field';
import {
  closeSubscribe,
  confirmSubscription,
  type FeedPreview,
  previewAddress,
  returnToEdit,
  setSubscribeFolder,
  subscribeFolder,
  subscribeOpen,
  subscribePending,
  subscribePreview,
} from './subscribe';

/** The address form: one required native URL field, whose submit previews it. */
const AddressForm = (props: {
  readonly address: string;
  readonly onAddress: (value: string) => void;
}) => (
  <form
    class="mt-2"
    onSubmit={(event) => {
      event.preventDefault();
      void previewAddress(props.address);
    }}
  >
    <FormField
      id="subscribe-url"
      name="url"
      label="网址"
      hint="请输入有效的 http 或 https 链接"
      type="url"
      required
      placeholder="粘贴 RSS / Atom 链接…"
      disabled={subscribePending() !== undefined}
      value={props.address}
      onInput={(event) => props.onAddress(event.currentTarget.value)}
    />
    <Button
      type="submit"
      variant="solid"
      busy={subscribePending() === 'preview'}
      pendingLabel="获取预览…"
    >
      预览订阅
    </Button>
  </form>
);

/** The previewed source, then the folder choice and the confirmation (FD-PREVIEW). */
const SubscribePreview = (props: { readonly preview: FeedPreview }) => (
  <section
    aria-label="订阅预览"
    class="mt-2 rounded-box border border-base-content/20 p-3"
  >
    <p class="text-xs tracking-[0.06em] text-base-content/60">订阅预览</p>
    <h3 class="mt-1 font-semibold tracking-tight">{props.preview.title}</h3>
    <Show when={props.preview.description}>
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
    <Show when={folders().length > 0}>
      <FolderSelect
        id="subscribe-folder"
        value={subscribeFolder()}
        disabled={subscribePending() !== undefined}
        onChange={setSubscribeFolder}
      />
    </Show>
    <div class="mt-3 flex flex-wrap gap-2">
      <Button
        type="button"
        variant="solid"
        busy={subscribePending() === 'subscribe'}
        pendingLabel="订阅中…"
        onClick={() => void confirmSubscription()}
      >
        确认订阅
      </Button>
      <Button
        type="button"
        disabled={subscribePending() !== undefined}
        onClick={returnToEdit}
      >
        返回修改
      </Button>
    </div>
  </section>
);

/** `新增 RSS 订阅`; mounted once by the sidebar section (feeds.md). */
export const SubscribeDialog = () => {
  const [address, setAddress] = createSignal('');

  createEffect(
    on(subscribeOpen, (open) => {
      if (open) setAddress('');
    })
  );

  return (
    <Dialog
      open={subscribeOpen()}
      label="新增 RSS 订阅"
      onClose={closeSubscribe}
    >
      <section class="py-2">
        <h2 class="text-lg font-semibold tracking-tight">新增 RSS 订阅</h2>
        <p class="mt-2 text-sm text-base-content/60">
          粘贴 RSS / Atom 链接，预览后确认订阅。
        </p>
        <Show
          when={subscribePreview()}
          keyed
          fallback={<AddressForm address={address()} onAddress={setAddress} />}
        >
          {(preview) => <SubscribePreview preview={preview} />}
        </Show>
      </section>
    </Dialog>
  );
};
