import { Show } from 'solid-js';
import { Button } from '../../ui/button';
import { browserConfirm } from '../confirm';
import { settingStore } from '../store';
import { KindleForm } from './kindle-form';
import { kindleMessages as copy, storedPasswordLine } from './messages';
import { clearSmtpPassword } from './save';
import { kindleSending, sendNow } from './send';

/** The clear-password row, which exists only while a password is stored (SET-KINDLE-4). */
const ClearPasswordRow = (props: { readonly disabled: boolean }) => (
  <div class="mt-5 flex justify-end border-t border-base-300 pt-4">
    <Button
      type="button"
      class="btn btn-sm shrink-0"
      disabled={props.disabled}
      onClick={() => {
        void clearSmtpPassword(settingStore, browserConfirm);
      }}
    >
      {copy.clearPasswordButton}
    </Button>
  </div>
);

/** The send-now row: a send is not a settings write (kindle.md Interface). */
const SendNowRow = (props: { readonly disabled: boolean }) => (
  <div class="mt-5 flex items-center justify-between gap-3 border-t border-base-300 pt-4">
    <p class="text-xs leading-5 text-base-content/50">{copy.sendNowText}</p>
    <Button
      type="button"
      class="btn btn-sm shrink-0"
      disabled={props.disabled}
      busy={kindleSending()}
      pendingLabel={copy.sendNowPending}
      onClick={() => {
        void sendNow();
      }}
    >
      {copy.sendNow}
    </Button>
  </div>
);

/** The props of `KindleSection`; the beside layout hides it, it stays mounted. */
export type KindleSectionProps = {
  readonly hidden: boolean;
};

/**
 * The `Kindle` section (settings.md SET-KINDLE): the delivery that mails the
 * unread articles, and the send-now row of kindle.md Interface.
 */
export const KindleSection = (props: KindleSectionProps) => {
  const delivery = () => settingStore.setting()?.kindle;
  const passwordStored = (): boolean =>
    delivery()?.smtpPasswordConfigured === true;
  const disabled = (): boolean => settingStore.saving() !== undefined;

  return (
    <section
      hidden={props.hidden}
      id="settings-kindle"
      aria-labelledby="settings-kindle-heading"
      class="rounded-box border border-base-300 bg-base-100 p-5"
    >
      <h2 id="settings-kindle-heading" class="text-lg font-semibold">
        {copy.heading}
      </h2>
      <p class="mt-1 text-sm leading-6 text-base-content/60">
        {copy.description}
      </p>
      <Show when={delivery()}>
        <p class="mt-2 text-xs leading-5 text-base-content/60">
          {storedPasswordLine(passwordStored())}
        </p>
      </Show>
      <KindleForm passwordStored={passwordStored()} disabled={disabled()} />
      <Show when={passwordStored()}>
        <ClearPasswordRow disabled={disabled()} />
      </Show>
      <Show when={delivery()}>
        <SendNowRow disabled={disabled()} />
      </Show>
    </section>
  );
};
