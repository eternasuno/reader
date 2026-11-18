import { Button } from '../ui/button';
import { FormField } from '../ui/form-field';
import { settingMessages as copy } from './messages';
import { saveRetention } from './save';
import { settingStore } from './store';

/** The retention input: a positive whole number (SET-VAL-1). */
const retentionField = {
  id: 'settings-retention',
  name: 'retention',
  type: 'number',
  min: 1,
  step: 1,
  required: true,
  label: copy.retentionFieldLabel,
  hint: copy.retentionFieldHint,
} as const;

const submitRetention = (form: HTMLFormElement): void => {
  form.classList.add('submitted');

  if (!form.checkValidity()) return;

  void saveRetention(settingStore);
};

/** The props of `RetentionSection`; the beside layout hides it, it stays mounted. */
export type RetentionSectionProps = {
  readonly hidden: boolean;
};

/** The `文章` section: how many articles every feed keeps (SET-FEED). */
export const RetentionSection = (props: RetentionSectionProps) => {
  const disabled = (): boolean => settingStore.saving() !== undefined;

  return (
    <section
      hidden={props.hidden}
      id="settings-articles"
      aria-labelledby="settings-articles-heading"
      class="rounded-box border border-base-300 bg-base-100 p-5"
    >
      <h2 id="settings-articles-heading" class="text-lg font-semibold">
        {copy.retentionHeading}
      </h2>
      <p class="mt-1 text-sm leading-6 text-base-content/60">
        {copy.retentionDescription}
      </p>
      <form
        method="post"
        novalidate
        class="mt-5 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submitRetention(event.currentTarget);
        }}
      >
        <fieldset class="m-0 min-w-0 border-0 p-0" disabled={disabled()}>
          <FormField
            {...retentionField}
            value={settingStore.retentionDraft()}
            onInput={(event) => {
              settingStore.setRetentionDraft(event.currentTarget.value);
            }}
          />
          <div class="mt-4">
            <Button
              type="submit"
              variant="solid"
              class="btn btn-neutral whitespace-nowrap"
              busy={settingStore.saving() === 'retention'}
              pendingLabel={copy.retentionSubmitPending}
            >
              {copy.retentionSubmit}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
};
