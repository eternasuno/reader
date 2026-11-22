import { useBeforeLeave, useNavigate } from '@solidjs/router';
import type { JSX } from '@solidjs/web';
import { createSignal, For, onSettled } from 'solid-js';
import { t, translateErrorCode } from '../i18n';
import type { SettingsSection } from '../state';
import {
  hasAnyUnsavedChanges,
  isSaving,
  isSectionDirty,
  loadSettings,
  refreshKindleSends,
  resetSectionDraft,
} from '../state';
import { Button, Icon, type IconName, showToast } from '../ui';
import { KindleSection } from './KindleSections';
import { ServicesSection } from './ServicesSection';
import { ArticlesSection, ExtractionSection } from './SettingsSections';
import { errorCodeOf } from './viewHelpers';

const SECTION_LABEL_KEYS = {
  articles: 'settings.sectionArticles',
  extraction: 'settings.sectionExtraction',
  kindle: 'settings.sectionKindle',
  services: 'settings.sectionServices',
} as const;

const SECTION_ICONS = {
  articles: 'inbox',
  extraction: 'extract',
  kindle: 'mail',
  services: 'globe',
} as const satisfies Record<SettingsSection, IconName>;

const SECTIONS: ReadonlyArray<SettingsSection> = [
  'articles',
  'extraction',
  'kindle',
  'services',
];

const sectionPanelClass = (active: boolean): string =>
  active ? 'block' : 'hidden';

function SettingsHeader(props: { onLeave: () => void }): JSX.Element {
  return (
    <header class="flex min-h-13 items-center gap-1 border-b border-base-300 px-2 py-1.5">
      <Button
        variant="icon"
        size="sm"
        aria-label={String(t('settings.backToLibrary'))}
        title={String(t('settings.backToLibrary'))}
        onClick={props.onLeave}
      >
        <Icon name="arrow-left" size={18} />
      </Button>
      <h1 class="text-base font-semibold">{String(t('settings.title'))}</h1>
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
      class="flex shrink-0 gap-1 overflow-x-auto md:sticky md:top-6 md:w-52 md:flex-col md:self-start md:overflow-visible"
      aria-label={String(t('settings.title'))}
    >
      <For each={SECTIONS}>
        {(section) => (
          <button
            type="button"
            class={[
              'flex items-center gap-2.5 rounded-field px-3 py-2 text-left text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed',
              props.active === section
                ? 'bg-neutral font-semibold text-neutral-content'
                : 'font-medium text-base-content/80 hover:bg-base-200',
            ]}
            aria-current={props.active === section ? 'page' : undefined}
            disabled={props.disabled}
            onClick={() => props.onSelect(section)}
          >
            <Icon name={SECTION_ICONS[section]} size={16} class="opacity-70" />
            {String(t(SECTION_LABEL_KEYS[section]))}
          </button>
        )}
      </For>
    </nav>
  );
}

/** All four forms stay mounted so drafts survive section switches (`settings.md:25`). */
function SettingsPanels(props: {
  active: SettingsSection;
  onGoToServices: () => void;
}): JSX.Element {
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
        <ExtractionSection onGoToServices={props.onGoToServices} />
      </section>
      <section
        class={sectionPanelClass(props.active === 'kindle')}
        aria-label={String(t('settings.sectionKindle'))}
      >
        <KindleSection onGoToServices={props.onGoToServices} />
      </section>
      <section
        class={sectionPanelClass(props.active === 'services')}
        aria-label={String(t('settings.sectionServices'))}
      >
        <ServicesSection />
      </section>
    </>
  );
}

const useLeaveGuards = (): void => {
  onSettled(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!hasAnyUnsavedChanges()) return;

      event.preventDefault();
      const unloadEvent = event;
      unloadEvent.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  });

  useBeforeLeave((event) => {
    if (event.defaultPrevented || !hasAnyUnsavedChanges()) return;

    if (!window.confirm(String(t('settings.unsavedLeaveConfirm')))) {
      event.preventDefault();
    }
  });
};

/**
 * `settings.md:16-25`: one page with four sections in order (articles &
 * subscriptions, extraction, Kindle, external services), sidebar navigation on
 * wide screens, and unsaved-change guards for both section switches and leaving
 * the page.
 */
export function SettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] =
    createSignal<SettingsSection>('articles');

  useLeaveGuards();

  onSettled(() => {
    void loadSettings().catch((error: unknown) => {
      showToast(translateErrorCode(errorCodeOf(error)), 'error');
    });
  });

  const selectSection = (next: SettingsSection): void => {
    const current = activeSection();
    if (next === current || isSaving()) return;

    if (isSectionDirty(current)) {
      if (!window.confirm(String(t('settings.unsavedSectionConfirm')))) return;
      // `settings.md:20`: the discarded draft is reset from the saved settings.
      resetSectionDraft(current);
    }

    setActiveSection(next);
    if (next === 'kindle') void refreshKindleSends();
  };

  return (
    <div class="flex min-h-dvh flex-col bg-base-100">
      <SettingsHeader onLeave={() => navigate('/later')} />
      <div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 md:flex-row md:gap-10 md:p-6">
        <SettingsNav
          active={activeSection()}
          disabled={isSaving()}
          onSelect={selectSection}
        />
        <div class="min-w-0 max-w-2xl flex-1">
          <SettingsPanels
            active={activeSection()}
            onGoToServices={() => selectSection('services')}
          />
        </div>
      </div>
    </div>
  );
}
