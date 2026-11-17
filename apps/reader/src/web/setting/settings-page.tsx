import { createSignal, onCleanup, onMount } from 'solid-js';
import { browserConfirm } from './confirm';
import { SettingsFrame } from './frame';
import { observeLayout, type SettingsLayout } from './layout';
import { useLeaveGuard } from './leave-guard';
import { SectionPanels } from './panels';
import {
  createSectionSwitch,
  type SettingsSection,
  sectionElementId,
} from './section';
import { SectionNav } from './section-nav';
import { discard, draftChanged, loadSetting, settingStore } from './store';

const scrollToSection = (section: SettingsSection): void => {
  document
    .getElementById(sectionElementId(section))
    ?.scrollIntoView({ block: 'start' });
};

/**
 * `/settings`: the `账号`, `文章` and `提取` sections in one page, beside their
 * navigation on a wide screen and stacked when it does not fit, with drafts that
 * are neither saved nor lost silently (settings.md).
 */
export const SettingsPage = () => {
  const [layout, setLayout] = createSignal<SettingsLayout>('beside');
  let navigationElement: HTMLElement | undefined;
  let sectionsElement: HTMLElement | undefined;

  const saving = (): boolean => settingStore.saving() !== undefined;

  const sectionSwitch = createSectionSwitch({
    beside: () => layout() === 'beside',
    accountChanged: () => settingStore.accountChanged(),
    draftChanged: (section) => draftChanged(settingStore, section),
    saving,
    confirm: browserConfirm,
    discard: (section) => {
      discard(settingStore, section);
    },
    scroll: scrollToSection,
  });

  onMount(() => {
    void loadSetting(settingStore);

    if (navigationElement === undefined || sectionsElement === undefined)
      return;

    onCleanup(observeLayout(navigationElement, sectionsElement, setLayout));
  });

  useLeaveGuard({ saving, anyChanged: sectionSwitch.anyChanged });

  return (
    <SettingsFrame
      sectionsRef={(element) => {
        sectionsElement = element;
      }}
      navigation={
        <SectionNav
          section={sectionSwitch.open()}
          saving={saving()}
          stacked={layout() === 'stacked'}
          onPick={sectionSwitch.pick}
          elementRef={(element) => {
            navigationElement = element;
          }}
        />
      }
    >
      <SectionPanels layout={layout()} section={sectionSwitch.open()} />
    </SettingsFrame>
  );
};
