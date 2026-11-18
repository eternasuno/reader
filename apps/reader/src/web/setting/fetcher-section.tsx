import { Show } from 'solid-js';
import { Button } from '../ui/button';
import { FormField } from '../ui/form-field';
import { browserConfirm } from './confirm';
import type { FetcherProvider } from './drafts';
import { configurationLine, settingMessages as copy } from './messages';
import { clearJinaKey, saveFetcher } from './save';
import { settingStore } from './store';

const providerOf = (value: string): FetcherProvider =>
  value === 'browser' ? 'browser' : 'jina';

const submitFetcher = (form: HTMLFormElement): void => {
  form.classList.add('submitted');

  if (!form.checkValidity()) return;

  void saveFetcher(settingStore);
};

const selectClass =
  'select w-full border border-base-content/40 bg-base-200 text-base-content focus:border-primary focus:outline-primary disabled:border-base-content/20 disabled:text-base-content/40';

/** Which of the two providers fetches the page (SET-FETCH). */
const ProviderSelect = () => (
  <fieldset class="fieldset">
    <label class="label" for="settings-provider">
      {copy.providerLabel}
    </label>
    <select
      id="settings-provider"
      name="provider"
      class={selectClass}
      value={settingStore.providerDraft()}
      onChange={(event) => {
        settingStore.setProviderDraft(providerOf(event.currentTarget.value));
      }}
    >
      <option value="jina">{copy.providerJina}</option>
      <option value="browser">{copy.providerBrowser}</option>
    </select>
  </fieldset>
);

/** The Jina key: empty when read, blank keeps the stored one (SET-VAL-6). */
const JinaKeyField = (props: { readonly stored: boolean }) => (
  <FormField
    id="settings-jina-key"
    name="jinaKey"
    type="password"
    autocomplete="off"
    label={copy.jinaKeyLabel}
    hint={props.stored ? copy.jinaKeyStoredHint : copy.jinaKeyAnonymousHint}
    value={settingStore.jinaKeyDraft()}
    onInput={(event) => {
      settingStore.setJinaKeyDraft(event.currentTarget.value);
    }}
  />
);

/** The browser service address; only a new one can replace it (SET-ENDPOINT-1). */
const BrowserEndpointField = (props: { readonly stored: boolean }) => (
  <FormField
    id="settings-browser-endpoint"
    name="browserEndpoint"
    type="url"
    autocomplete="off"
    spellcheck={false}
    label={copy.endpointLabel}
    hint={props.stored ? copy.endpointStoredHint : copy.endpointProtocolsHint}
    value={settingStore.endpointDraft()}
    onInput={(event) => {
      settingStore.setEndpointDraft(event.currentTarget.value);
    }}
  />
);

/** The clear-key row, which exists only while a key is stored (SET-KEY-3). */
const ClearKeyRow = (props: { readonly disabled: boolean }) => (
  <div class="mt-5 flex items-center justify-between gap-3 border-t border-base-300 pt-4">
    <p class="text-xs leading-5 text-base-content/50">{copy.clearKeyText}</p>
    <Button
      type="button"
      class="btn btn-sm shrink-0"
      disabled={props.disabled}
      onClick={() => {
        void clearJinaKey(settingStore, browserConfirm);
      }}
    >
      {copy.clearKeyButton}
    </Button>
  </div>
);

/** The props of `FetcherSection`; the beside layout hides it, it stays mounted. */
export type FetcherSectionProps = {
  readonly hidden: boolean;
};

/** The `提取` section: Jina or the browser service, and the stored key (SET-FETCH). */
export const FetcherSection = (props: FetcherSectionProps) => {
  const jinaStored = (): boolean =>
    settingStore.setting()?.jinaKeyConfigured === true;
  const endpointStored = (): boolean =>
    settingStore.setting()?.browserEndpointConfigured === true;
  const browser = (): boolean => settingStore.providerDraft() === 'browser';
  const disabled = (): boolean => settingStore.saving() !== undefined;

  return (
    <section
      hidden={props.hidden}
      id="settings-extraction"
      aria-labelledby="settings-extraction-heading"
      class="rounded-box border border-base-300 bg-base-100 p-5"
    >
      <h2 id="settings-extraction-heading" class="text-lg font-semibold">
        {copy.fetcherHeading}
      </h2>
      <p class="mt-1 text-sm leading-6 text-base-content/60">
        {copy.fetcherDescription}
      </p>
      <p class="mt-2 text-xs leading-5 text-base-content/60">
        {configurationLine({
          jinaKeyConfigured: jinaStored(),
          browserEndpointConfigured: endpointStored(),
        })}
      </p>
      <form
        method="post"
        novalidate
        class="mt-5 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submitFetcher(event.currentTarget);
        }}
      >
        <fieldset
          class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
          disabled={disabled()}
        >
          <ProviderSelect />
          <Show
            when={browser()}
            fallback={<JinaKeyField stored={jinaStored()} />}
          >
            <BrowserEndpointField stored={endpointStored()} />
          </Show>
          <div>
            <Button
              type="submit"
              variant="solid"
              class="btn btn-neutral whitespace-nowrap"
              busy={settingStore.saving() === 'fetcher'}
              pendingLabel={copy.fetcherSubmitPending}
            >
              {copy.fetcherSubmit}
            </Button>
          </div>
        </fieldset>
      </form>
      <Show when={jinaStored()}>
        <ClearKeyRow disabled={disabled()} />
      </Show>
    </section>
  );
};
