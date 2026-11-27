import type { JSX } from '@solidjs/web';
import { createSignal, For, Show } from 'solid-js';
import { type Dict, t } from '../i18n';
import {
  isDefaultAppearance,
  type ReaderAppearance,
  type ReaderTheme,
  readerAppearance,
  readerTheme,
  resetReaderAppearance,
  setReaderTheme,
  updateReaderAppearance,
} from '../state';
import { Icon, Menu, MenuDivider, MenuItem, MenuRadio } from '../ui';

type LabelKey = `reader.${keyof Dict['reader'] & string}`;

interface ChoiceOption<T extends string> {
  value: T;
  labelKey: LabelKey;
}

/** One tiered picker: a root row showing the current label and a radio sub-page. */
interface Choice {
  labelKey: LabelKey;
  options: ReadonlyArray<ChoiceOption<string>>;
  current: () => string;
  select: (value: string) => void;
}

const appearanceChoice = <K extends keyof ReaderAppearance>(
  key: K,
  labelKey: LabelKey,
  options: ReadonlyArray<ChoiceOption<ReaderAppearance[K]>>
): Choice => ({
  labelKey,
  options,
  current: () => readerAppearance()[key],
  // `select` only receives values from `options`, which are typed above.
  select: (value) =>
    updateReaderAppearance({ [key]: value } as Partial<ReaderAppearance>),
});

const THEME_OPTIONS: ReadonlyArray<ChoiceOption<ReaderTheme>> = [
  { value: 'auto', labelKey: 'reader.themeAuto' },
  { value: 'light', labelKey: 'reader.themeLight' },
  { value: 'dark', labelKey: 'reader.themeDark' },
];

const THEME_CHOICE: Choice = {
  labelKey: 'reader.theme',
  options: THEME_OPTIONS,
  current: readerTheme,
  select: (value) => setReaderTheme(value as ReaderTheme),
};

const TYPOGRAPHY_CHOICES: ReadonlyArray<Choice> = [
  appearanceChoice('fontFamily', 'reader.fontFamily', [
    { value: 'sans', labelKey: 'reader.fontSans' },
    { value: 'serif', labelKey: 'reader.fontSerif' },
  ]),
  appearanceChoice('fontSize', 'reader.fontSize', [
    { value: 'sm', labelKey: 'reader.fontSizeSm' },
    { value: 'md', labelKey: 'reader.fontSizeMd' },
    { value: 'lg', labelKey: 'reader.fontSizeLg' },
    { value: 'xl', labelKey: 'reader.fontSizeXl' },
  ]),
  appearanceChoice('lineHeight', 'reader.lineHeight', [
    { value: 'compact', labelKey: 'reader.lineHeightCompact' },
    { value: 'medium', labelKey: 'reader.lineHeightMedium' },
    { value: 'relaxed', labelKey: 'reader.lineHeightRelaxed' },
  ]),
  appearanceChoice('lineWidth', 'reader.lineWidth', [
    { value: 'narrow', labelKey: 'reader.lineWidthNarrow' },
    { value: 'medium', labelKey: 'reader.lineWidthMedium' },
    { value: 'wide', labelKey: 'reader.lineWidthWide' },
  ]),
];

const currentLabelKey = (choice: Choice): LabelKey =>
  choice.options.find((opt) => opt.value === choice.current())?.labelKey ??
  choice.labelKey;

const ROW_CLASSES =
  'mx-2 flex min-h-10 w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm leading-5 text-base-content transition-colors hover:bg-base-300/70 focus-visible:bg-base-300/70 focus-visible:outline-none';

const BackHeader = (props: {
  label: string;
  onBack: () => void;
}): JSX.Element => (
  <button
    type="button"
    role="menuitem"
    data-keep-open="true"
    class={ROW_CLASSES}
    onClick={() => props.onBack()}
  >
    <span class="flex size-5 shrink-0 items-center justify-center">
      <Icon name="arrow-left" size={18} />
    </span>
    <span>{props.label}</span>
  </button>
);

const ChoiceSubpage = (props: {
  choice: Choice;
  onBack: () => void;
}): JSX.Element => (
  <>
    <BackHeader label={t(props.choice.labelKey)} onBack={props.onBack} />
    <div data-keep-open="true">
      <For each={props.choice.options}>
        {(opt) => (
          <MenuRadio
            checked={props.choice.current() === opt.value}
            onSelect={() => props.choice.select(opt.value)}
          >
            {t(opt.labelKey)}
          </MenuRadio>
        )}
      </For>
    </div>
  </>
);

const ChoiceRow = (props: {
  choice: Choice;
  onOpen: () => void;
}): JSX.Element => (
  <button
    type="button"
    role="menuitem"
    data-keep-open="true"
    class={ROW_CLASSES}
    onClick={props.onOpen}
  >
    <span class="flex size-5 shrink-0 items-center justify-center opacity-70">
      <Icon name="chevron-right" size={16} />
    </span>
    <span class="flex-1 truncate">{t(props.choice.labelKey)}</span>
    <span class="text-sm text-base-content/60">
      {t(currentLabelKey(props.choice))}
    </span>
  </button>
);

const RootViewOptions = (props: {
  onBack?: () => void;
  onOpen: (choice: Choice) => void;
}): JSX.Element => (
  <>
    <Show when={props.onBack}>
      {(onBack) => (
        <BackHeader label={t('reader.appearance')} onBack={() => onBack()()} />
      )}
    </Show>
    <ChoiceRow
      choice={THEME_CHOICE}
      onOpen={() => props.onOpen(THEME_CHOICE)}
    />
    <MenuDivider />
    <For each={TYPOGRAPHY_CHOICES}>
      {(choice) => (
        <ChoiceRow choice={choice} onOpen={() => props.onOpen(choice)} />
      )}
    </For>
    <Show when={!isDefaultAppearance() || readerTheme() !== 'auto'}>
      <MenuDivider />
      <MenuItem
        keepOpen
        icon="refresh"
        onSelect={() => resetReaderAppearance()}
      >
        {t('reader.resetAppearance')}
      </MenuItem>
    </Show>
  </>
);

/**
 * `RD-APPEAR-1`: in-menu view options panel (theme, font, and tiered font size,
 * line height, and content width pickers), shared by the reader and sidebar menus.
 */
export function ReaderViewOptionsPanel(props: {
  onBack?: () => void;
}): JSX.Element {
  const [subpage, setSubpage] = createSignal<Choice | null>(null);

  return (
    <div class="min-w-60">
      <Show
        when={subpage()}
        fallback={<RootViewOptions onBack={props.onBack} onOpen={setSubpage} />}
      >
        {(choice) => (
          <ChoiceSubpage choice={choice()} onBack={() => setSubpage(null)} />
        )}
      </Show>
    </div>
  );
}

export function ReaderAppearanceMenu(): JSX.Element {
  return (
    <Menu
      icon="typography"
      label={t('reader.appearance')}
      triggerClass="btn-sm max-md:size-10"
    >
      <ReaderViewOptionsPanel />
    </Menu>
  );
}
