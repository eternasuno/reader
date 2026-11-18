import { For } from 'solid-js';
import { Button } from '../../ui/button';
import { FormField } from '../../ui/form-field';
import { settingStore } from '../store';
import { securityOf } from './drafts';
import { kindleMessages as copy } from './messages';
import { saveKindle } from './save';

/**
 * The field form of the `Kindle` section (settings.md SET-KINDLE): every field
 * the delivery has, the security select and the save button. The Kindle address,
 * the SMTP host and the port have no message of their own (settings.md
 * Messages), so they are marked invalid without showing a text.
 */

const submitKindle = (form: HTMLFormElement): void => {
  form.classList.add('submitted');

  if (!form.checkValidity()) return;

  void saveKindle(settingStore);
};

const selectClass =
  'select w-full border border-base-content/40 bg-base-200 text-base-content focus:border-primary focus:outline-primary disabled:border-base-content/20 disabled:text-base-content/40';

/** The two mail addresses the delivery needs (SET-KINDLE-1). */
const AddressFields = () => (
  <>
    <FormField
      id="settings-kindle-email"
      name="kindleEmail"
      type="email"
      required
      autocomplete="off"
      spellcheck={false}
      label={copy.kindleEmailLabel}
      hint=""
      value={settingStore.kindleEmailDraft()}
      onInput={(event) => {
        settingStore.setKindleEmailDraft(event.currentTarget.value);
      }}
    />
    <FormField
      id="settings-kindle-sender"
      name="senderEmail"
      type="email"
      required
      autocomplete="off"
      spellcheck={false}
      label={copy.senderEmailLabel}
      hint={copy.senderEmailHint}
      value={settingStore.senderEmailDraft()}
      onInput={(event) => {
        settingStore.setSenderEmailDraft(event.currentTarget.value);
      }}
    />
  </>
);

/** The security: TLS from the start, or STARTTLS on a plain connection. */
const SecuritySelect = () => (
  <fieldset class="fieldset">
    <label class="label" for="settings-kindle-security">
      {copy.smtpSecurityLabel}
    </label>
    <select
      id="settings-kindle-security"
      name="smtpSecurity"
      class={selectClass}
      value={settingStore.smtpSecurityDraft()}
      onChange={(event) => {
        settingStore.setSmtpSecurityDraft(
          securityOf(event.currentTarget.value)
        );
      }}
    >
      <option value="tls">{copy.securityTls}</option>
      <option value="starttls">{copy.securityStarttls}</option>
    </select>
  </fieldset>
);

/** The SMTP server, its port and its security (SET-KINDLE-1). */
const ServerFields = () => (
  <>
    <FormField
      id="settings-kindle-host"
      name="smtpHost"
      type="text"
      required
      autocomplete="off"
      spellcheck={false}
      label={copy.smtpHostLabel}
      hint=""
      value={settingStore.smtpHostDraft()}
      onInput={(event) => {
        settingStore.setSmtpHostDraft(event.currentTarget.value);
      }}
    />
    <div class="grid gap-4 sm:grid-cols-2">
      <FormField
        id="settings-kindle-port"
        name="smtpPort"
        type="number"
        min={1}
        max={65535}
        step={1}
        required
        label={copy.smtpPortLabel}
        hint=""
        value={settingStore.smtpPortDraft()}
        onInput={(event) => {
          settingStore.setSmtpPortDraft(event.currentTarget.value);
        }}
      />
      <SecuritySelect />
    </div>
  </>
);

/** The optional login; the password never comes back from a read (SET-KINDLE-2). */
const LoginFields = (props: { readonly passwordStored: boolean }) => (
  <>
    <FormField
      id="settings-kindle-user"
      name="smtpUser"
      type="text"
      autocomplete="off"
      spellcheck={false}
      label={copy.smtpUserLabel}
      hint={copy.smtpUserHint}
      value={settingStore.smtpUserDraft()}
      onInput={(event) => {
        settingStore.setSmtpUserDraft(event.currentTarget.value);
      }}
    />
    <FormField
      id="settings-kindle-password"
      name="smtpPassword"
      type="password"
      autocomplete="off"
      label={copy.smtpPasswordLabel}
      hint={
        props.passwordStored
          ? copy.smtpPasswordStoredHint
          : copy.smtpPasswordNoneHint
      }
      value={settingStore.smtpPasswordDraft()}
      onInput={(event) => {
        settingStore.setSmtpPasswordDraft(event.currentTarget.value);
      }}
    />
  </>
);

/** Every whole and half hour of a day, the only send times there are (SET-KINDLE-1). */
const sendTimes: ReadonlyArray<string> = Array.from(
  { length: 48 },
  (_, slot) => {
    const hour = String(Math.floor(slot / 2)).padStart(2, '0');

    return `${hour}:${slot % 2 === 0 ? '00' : '30'}`;
  }
);

/** The optional daily send time, a whole or half hour (KD-SCHED-1). */
const SendTimeField = () => (
  <fieldset class="fieldset">
    <label class="label" for="settings-kindle-send-time">
      {copy.sendTimeLabel}
    </label>
    <select
      id="settings-kindle-send-time"
      name="sendTime"
      class={selectClass}
      value={settingStore.sendTimeDraft()}
      onChange={(event) => {
        settingStore.setSendTimeDraft(event.currentTarget.value);
      }}
    >
      <option value="">{copy.sendTimeNone}</option>
      <For each={sendTimes}>
        {(time) => <option value={time}>{time}</option>}
      </For>
    </select>
    <p class="label text-base-content/65">{copy.sendTimeHint}</p>
  </fieldset>
);

const SubmitButton = () => (
  <div>
    <Button
      type="submit"
      variant="solid"
      class="btn btn-neutral whitespace-nowrap"
      busy={settingStore.saving() === 'kindle'}
      pendingLabel={copy.submitPending}
    >
      {copy.submit}
    </Button>
  </div>
);

export type KindleFormProps = {
  readonly passwordStored: boolean;
  readonly disabled: boolean;
};

/** The form saving the whole delivery in one write (SET-KINDLE-3). */
export const KindleForm = (props: KindleFormProps) => (
  <form
    method="post"
    novalidate
    class="mt-5 flex flex-col gap-4"
    onSubmit={(event) => {
      event.preventDefault();
      submitKindle(event.currentTarget);
    }}
  >
    <fieldset
      class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
      disabled={props.disabled}
    >
      <AddressFields />
      <ServerFields />
      <LoginFields passwordStored={props.passwordStored} />
      <SendTimeField />
      <SubmitButton />
    </fieldset>
  </form>
);
