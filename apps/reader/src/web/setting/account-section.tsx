import { accountMessages } from '../account/messages';
import { PasswordForm } from '../account/password-form';
import { setAccountSaving } from './save';
import { settingStore } from './store';

export type AccountSectionProps = {
  /** A write of any section is in flight, so the form is locked. */
  readonly saving: boolean;
  /** The beside layout hides it while another section is open; it stays mounted. */
  readonly hidden: boolean;
};

/**
 * The `账号` section: the password form of account.md Interface. The form's
 * pending write and its typed fields are reported to the page's store, so one
 * write at a time holds for the page and a layout change, which only hides the
 * section, loses neither (settings.md Saving and unsaved changes).
 */
export const AccountSection = (props: AccountSectionProps) => (
  <section
    hidden={props.hidden}
    id="settings-account"
    aria-labelledby="settings-account-heading"
    class="rounded-box border border-base-300 bg-base-100 p-5"
  >
    <h2 id="settings-account-heading" class="text-lg font-semibold">
      {accountMessages.accountSectionHeading}
    </h2>
    <p class="mt-1 text-sm leading-6 text-base-content/60">
      {accountMessages.accountSectionDescription}
    </p>
    <div class="mt-5">
      <fieldset class="m-0 min-w-0 border-0 p-0" disabled={props.saving}>
        <PasswordForm
          onBusyChange={(busy) => setAccountSaving(settingStore, busy)}
          onDirtyChange={(dirty) => {
            settingStore.setAccountChanged(dirty);
          }}
        />
      </fieldset>
    </div>
  </section>
);
