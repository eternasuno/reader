import type { JSX } from '@solidjs/web';
import { createSignal, For, Show } from 'solid-js';
import { t } from '../i18n';
import {
  isDefaultAppearance,
  type ReaderFontFamily,
  type ReaderTheme,
  readerAppearance,
  readerTheme,
  resetReaderAppearance,
  setReaderTheme,
  stepFontSize,
  stepLineHeight,
  stepLineWidth,
  updateReaderAppearance,
} from '../state';
import { Icon, Menu, MenuDivider, MenuItem, MenuRadio } from '../ui';

const THEME_OPTIONS: ReadonlyArray<{
  value: ReaderTheme;
  labelKey: 'reader.themeAuto' | 'reader.themeLight' | 'reader.themeDark';
}> = [
  { value: 'auto', labelKey: 'reader.themeAuto' },
  { value: 'light', labelKey: 'reader.themeLight' },
  { value: 'dark', labelKey: 'reader.themeDark' },
];

const THEME_LABEL_KEYS: Record<
  ReaderTheme,
  'reader.themeAuto' | 'reader.themeLight' | 'reader.themeDark'
> = {
  auto: 'reader.themeAuto',
  light: 'reader.themeLight',
  dark: 'reader.themeDark',
};

const FONT_OPTIONS: ReadonlyArray<{
  value: ReaderFontFamily;
  labelKey: 'reader.fontSans' | 'reader.fontSerif';
}> = [
  { value: 'sans', labelKey: 'reader.fontSans' },
  { value: 'serif', labelKey: 'reader.fontSerif' },
];

const BackHeader = (props: {
  label: string;
  onBack: () => void;
}): JSX.Element => (
  <button
    type="button"
    role="menuitem"
    data-keep-open="true"
    class="mx-2 flex min-h-10 w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm leading-5 text-base-content transition-colors hover:bg-base-300/70 focus-visible:bg-base-300/70 focus-visible:outline-none"
    onClick={() => props.onBack()}
  >
    <span class="flex size-5 shrink-0 items-center justify-center">
      <Icon name="arrow-left" size={18} />
    </span>
    <span>{props.label}</span>
  </button>
);

const ThemeSubpage = (props: { onBack: () => void }): JSX.Element => (
  <>
    <BackHeader label={t('reader.theme')} onBack={props.onBack} />
    <div data-keep-open="true">
      <For each={THEME_OPTIONS}>
        {(opt) => (
          <MenuRadio
            checked={readerTheme() === opt.value}
            onSelect={() => setReaderTheme(opt.value)}
          >
            {t(opt.labelKey)}
          </MenuRadio>
        )}
      </For>
    </div>
  </>
);

const FontSubpage = (props: { onBack: () => void }): JSX.Element => (
  <>
    <BackHeader label={t('reader.fontFamily')} onBack={props.onBack} />
    <div data-keep-open="true">
      <For each={FONT_OPTIONS}>
        {(opt) => (
          <MenuRadio
            checked={readerAppearance().fontFamily === opt.value}
            onSelect={() => updateReaderAppearance({ fontFamily: opt.value })}
          >
            {t(opt.labelKey)}
          </MenuRadio>
        )}
      </For>
    </div>
  </>
);

interface StepperRowProps {
  label: string;
  value: string;
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}

const StepperRow = (props: StepperRowProps): JSX.Element => (
  <div
    data-keep-open="true"
    class="mx-2 flex min-h-10 items-center justify-between gap-3 px-2.5 py-1.5 text-sm leading-5 text-base-content"
  >
    <span class="truncate pl-7.5">{props.label}</span>
    <div class="flex items-center gap-1">
      <button
        type="button"
        role="menuitem"
        data-keep-open="true"
        disabled={!props.canDecrease}
        aria-label={`${props.label} ${t('reader.decrease')}`}
        class="btn btn-ghost btn-xs btn-square disabled:opacity-30 pointer-coarse:size-9"
        onClick={props.onDecrease}
      >
        <Icon name="minus-circle" size={16} />
      </button>
      <span class="inline-flex h-6.5 min-w-8 items-center justify-center rounded-[4px] border border-base-content/35 bg-base-300/60 px-1.5 text-sm tabular-nums">
        {props.value}
      </span>
      <button
        type="button"
        role="menuitem"
        data-keep-open="true"
        disabled={!props.canIncrease}
        aria-label={`${props.label} ${t('reader.increase')}`}
        class="btn btn-ghost btn-xs btn-square disabled:opacity-30 pointer-coarse:size-9"
        onClick={props.onIncrease}
      >
        <Icon name="plus-circle" size={16} />
      </button>
    </div>
  </div>
);

const SubpageRow = (props: {
  label: string;
  value: string;
  onOpen: () => void;
}): JSX.Element => (
  <button
    type="button"
    role="menuitem"
    data-keep-open="true"
    class="mx-2 flex min-h-10 w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm leading-5 text-base-content transition-colors hover:bg-base-300/70 focus-visible:bg-base-300/70 focus-visible:outline-none"
    onClick={props.onOpen}
  >
    <span class="flex size-5 shrink-0 items-center justify-center opacity-70">
      <Icon name="chevron-right" size={16} />
    </span>
    <span class="flex-1 truncate">{props.label}</span>
    <span class="text-sm text-base-content/60">{props.value}</span>
  </button>
);

const AppearanceSteppers = (): JSX.Element => (
  <>
    <StepperRow
      label={t('reader.fontSize')}
      value={String(readerAppearance().fontSize)}
      canDecrease={readerAppearance().fontSize > 14}
      canIncrease={readerAppearance().fontSize < 22}
      onDecrease={() => stepFontSize(-1)}
      onIncrease={() => stepFontSize(1)}
    />
    <StepperRow
      label={t('reader.lineHeight')}
      value={readerAppearance().lineHeight.toFixed(1)}
      canDecrease={readerAppearance().lineHeight > 1.4}
      canIncrease={readerAppearance().lineHeight < 2.0}
      onDecrease={() => stepLineHeight(-1)}
      onIncrease={() => stepLineHeight(1)}
    />
    <StepperRow
      label={t('reader.lineWidth')}
      value={String(readerAppearance().lineWidth)}
      canDecrease={readerAppearance().lineWidth > 1}
      canIncrease={readerAppearance().lineWidth < 6}
      onDecrease={() => stepLineWidth(-1)}
      onIncrease={() => stepLineWidth(1)}
    />
  </>
);

const RootViewOptions = (props: {
  onBack?: () => void;
  onOpenTheme: () => void;
  onOpenFont: () => void;
  onOpenSettings?: () => void;
}): JSX.Element => (
  <>
    <Show when={props.onBack}>
      {(onBack) => (
        <BackHeader label={t('reader.appearance')} onBack={() => onBack()()} />
      )}
    </Show>
    <SubpageRow
      label={t('reader.theme')}
      value={t(THEME_LABEL_KEYS[readerTheme()])}
      onOpen={props.onOpenTheme}
    />
    <MenuDivider />
    <SubpageRow
      label={t('reader.fontFamily')}
      value={t(
        readerAppearance().fontFamily === 'serif'
          ? 'reader.fontSerif'
          : 'reader.fontSans'
      )}
      onOpen={props.onOpenFont}
    />
    <AppearanceSteppers />
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
    <Show when={props.onOpenSettings}>
      {(openSettings) => (
        <>
          <MenuDivider />
          <MenuItem icon="settings" onSelect={() => openSettings()()}>
            {t('reader.moreOptions')}
          </MenuItem>
        </>
      )}
    </Show>
  </>
);

/** In-menu view options sub-panel with theme/font pickers and numeric steppers. */
export function ReaderViewOptionsPanel(props: {
  onBack?: () => void;
  onOpenSettings?: () => void;
}): JSX.Element {
  const [subpage, setSubpage] = createSignal<'root' | 'theme' | 'font'>('root');

  return (
    <div class="min-w-60">
      <Show when={subpage() === 'root'}>
        <RootViewOptions
          onBack={props.onBack}
          onOpenTheme={() => setSubpage('theme')}
          onOpenFont={() => setSubpage('font')}
          onOpenSettings={props.onOpenSettings}
        />
      </Show>
      <Show when={subpage() === 'theme'}>
        <ThemeSubpage onBack={() => setSubpage('root')} />
      </Show>
      <Show when={subpage() === 'font'}>
        <FontSubpage onBack={() => setSubpage('root')} />
      </Show>
    </div>
  );
}

export function ReaderAppearanceMenu(): JSX.Element {
  return (
    <Menu
      icon="typography"
      label={t('reader.appearance')}
      triggerClass="btn-sm max-md:size-10 pointer-coarse:size-10"
    >
      <ReaderViewOptionsPanel />
    </Menu>
  );
}
