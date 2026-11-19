import { useNavigate } from '@solidjs/router';
import type { JSX } from '@solidjs/web';
import { createSignal, For, onSettled } from 'solid-js';
import { t, translateErrorCode } from '../i18n';
import type { SettingsSection } from '../state';
import {
  hasAnyUnsavedChanges,
  isSaving,
  isSectionDirty,
  loadSettings,
  resetSectionDraft,
} from '../state';
import { Button, Icon, showToast } from '../ui';
import { KindleSection } from './KindleSections';
import { ArticlesSection, ExtractionSection } from './SettingsSections';
import { errorCodeOf } from './viewHelpers';

const SECTION_LABEL_KEYS = {
  articles: 'settings.sectionArticles',
  extraction: 'settings.sectionExtraction',
  kindle: 'settings.sectionKindle',
} as const;

const SECTIONS: ReadonlyArray<SettingsSection> = [
  'articles',
  'extraction',
  'kindle',
];

const sectionPanelClass = (active: boolean): string =>
  active ? 'block' : 'hidden';

function SettingsHeader(props: { onLeave: () => void }): JSX.Element {
  return (
    <header class="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
      <h1 class="text-xl font-semibold">{String(t('settings.title'))}</h1>
      <Button variant="ghost" size="sm" onClick={props.onLeave}>
        <Icon name="arrow-left" size={16} />
        {String(t('settings.backToLibrary'))}
      </Button>
    </header>
  );
}

interface SettingsNavProps {
  active: SettingsSection;
  disabled: boolean;
  onSelect: (section: SettingsSection) => void;
}

function SettingsNav(props: SettingsNavProps): JSX.Element {
  return (
    <nav
      class="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col md:overflow-visible"
      aria-label={String(t('settings.title'))}
    >
      <For each={SECTIONS}>
        {(section) => (
          <button
            type="button"
            class={[
              'rounded-field px-3 py-2 text-left text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              props.active === section
                ? 'bg-primary/15 font-medium text-primary'
                : 'text-base-content/70 hover:bg-base-200',
            ]}
            aria-current={props.active === section ? 'page' : undefined}
            disabled={props.disabled}
            onClick={() => props.onSelect(section)}
          >
            {String(t(SECTION_LABEL_KEYS[section]))}
          </button>
        )}
      </For>
    </nav>
  );
}

/** All three forms stay mounted so drafts survive section switches (`settings.md:20`). */
function SettingsPanels(props: { active: SettingsSection }): JSX.Element {
  return (
    <>
      <section
        class={sectionPanelClass(props.active === 'articles')}
        aria-label={String(t('settings.sectionArticles'))}
      >
        <ArticlesSection />
      </section>
      <section
        class={sectionPanelClass(props.active === 'extraction')}
        aria-label={String(t('settings.sectionExtraction'))}
      >
        <ExtractionSection />
      </section>
      <section
        class={sectionPanelClass(props.active === 'kindle')}
        aria-label={String(t('settings.sectionKindle'))}
      >
        <KindleSection />
      </section>
    </>
  );
}

/**
 * `settings.md:15-20`: one page with three sections in order (articles &
 * subscriptions, extraction, Kindle), sidebar navigation on wide screens, and
 * unsaved-change guards for both section switches and leaving the page.
 */
export function SettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] =
    createSignal<SettingsSection>('articles');

  onSettled(() => {
    void loadSettings().catch((error: unknown) => {
      showToast(translateErrorCode(errorCodeOf(error)), 'error');
    });
  });

  const leave = (): void => {
    const unsaved = hasAnyUnsavedChanges();
    if (unsaved && !window.confirm(String(t('settings.unsavedLeaveConfirm'))))
      return;

    navigate('/later');
  };

  const selectSection = (next: SettingsSection): void => {
    const current = activeSection();
    if (next === current || isSaving()) return;

    if (isSectionDirty(current)) {
      if (!window.confirm(String(t('settings.unsavedSectionConfirm')))) return;
      // `settings.md:20`: the discarded draft is reset from the saved settings.
      resetSectionDraft(current);
    }

    setActiveSection(next);
  };

  return (
    <div class="flex min-h-dvh flex-col bg-base-100">
      <SettingsHeader onLeave={leave} />
      <div class="flex flex-1 flex-col gap-6 p-4 md:flex-row md:p-6">
        <SettingsNav
          active={activeSection()}
          disabled={isSaving()}
          onSelect={selectSection}
        />
        <div class="min-w-0 flex-1">
          <SettingsPanels active={activeSection()} />
        </div>
      </div>
    </div>
  );
}
