import { useBeforeLeave, useNavigate } from '@solidjs/router';
import type { JSX } from '@solidjs/web';
import {
  createSignal,
  createStore,
  For,
  onCleanup,
  onSettled,
  untrack,
} from 'solid-js';
import { t } from '../i18n';
import type { SettingsDrafts, SettingsSection } from '../state';
import {
  clearSecretDrafts,
  draftsFromSettings,
  errorText,
  HOME_PATH,
  hasAnyUnsavedChanges,
  isSaving,
  isSectionDirty,
  loadSettings,
  refreshKindleSends,
  resetSectionDraft,
  settings,
} from '../state';
import { Button, Icon, type IconName, showToast } from '../ui';
import { KindleSection } from './KindleSections';
import { ServicesSection } from './ServicesSection';
import { ArticlesSection, ExtractionSection } from './SettingsSections';
import type { SettingsDraftProps } from './settingsHelpers';

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
        aria-label={t('settings.backToLibrary')}
        title={t('settings.backToLibrary')}
        onClick={props.onLeave}
      >
        <Icon name="arrow-left" size={18} />
      </Button>
      <h1 class="text-base font-semibold">{t('settings.title')}</h1>
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
      class="grid shrink-0 grid-cols-4 gap-1 md:sticky md:top-6 md:flex md:w-52 md:flex-col md:self-start"
      aria-label={t('settings.title')}
    >
      <For each={SECTIONS}>
        {(section) => (
          <button
            type="button"
            class={[
              'flex flex-col items-center justify-center gap-1 rounded-field px-1 py-2 text-center text-xs leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed md:flex-row md:justify-start md:gap-2.5 md:px-3 md:text-left md:text-sm md:whitespace-nowrap',
              props.active === section
                ? 'bg-neutral font-semibold text-neutral-content'
                : 'font-medium text-base-content/80 hover:bg-base-200',
            ]}
            aria-current={props.active === section ? 'page' : undefined}
            disabled={props.disabled}
            onClick={() => props.onSelect(section)}
          >
            <Icon name={SECTION_ICONS[section]} size={18} class="opacity-70" />
            {t(SECTION_LABEL_KEYS[section])}
          </button>
        )}
      </For>
    </nav>
  );
}

/** All four forms stay mounted so drafts survive section switches (`settings.md:25`). */
function SettingsPanels(
  props: SettingsDraftProps & {
    active: SettingsSection;
    onGoToServices: () => void;
  }
): JSX.Element {
  return (
    <>
      <section
        class={sectionPanelClass(props.active === 'articles')}
        aria-label={t('settings.sectionArticles')}
      >
        <ArticlesSection drafts={props.drafts} setDrafts={props.setDrafts} />
      </section>
      <section
        class={sectionPanelClass(props.active === 'extraction')}
        aria-label={t('settings.sectionExtraction')}
      >
        <ExtractionSection
          drafts={props.drafts}
          setDrafts={props.setDrafts}
          onGoToServices={props.onGoToServices}
        />
      </section>
      <section
        class={sectionPanelClass(props.active === 'kindle')}
        aria-label={t('settings.sectionKindle')}
      >
        <KindleSection
          drafts={props.drafts}
          setDrafts={props.setDrafts}
          onGoToServices={props.onGoToServices}
        />
      </section>
      <section
        class={sectionPanelClass(props.active === 'services')}
        aria-label={t('settings.sectionServices')}
      >
        <ServicesSection drafts={props.drafts} setDrafts={props.setDrafts} />
      </section>
    </>
  );
}

const useLeaveGuards = (isDirty: () => boolean): void => {
  onSettled(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!isDirty()) return;

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
    if (event.defaultPrevented || !isDirty()) return;

    if (!window.confirm(t('settings.unsavedLeaveConfirm'))) {
      event.preventDefault();
    }
  });
};

/**
 * `settings.md:16-25`: one page with four sections in order (articles & subscriptions,
 * extraction, Kindle, external services), sidebar navigation on wide screens, and
 * unsaved-change guards for both section switches and leaving the page.
 */
export function SettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] =
    createSignal<SettingsSection>('articles');
  const [drafts, setDrafts] = createStore<SettingsDrafts>(
    draftsFromSettings(untrack(settings))
  );

  onCleanup(() => clearSecretDrafts(setDrafts));
  useLeaveGuards(() => hasAnyUnsavedChanges(drafts, settings()));

  onSettled(() => {
    let active = true;
    void loadSettings((loaded) => {
      if (active) setDrafts(() => draftsFromSettings(loaded));
    }).catch((error: unknown) => {
      if (active) showToast(errorText(error), 'error');
    });

    return () => {
      active = false;
    };
  });

  const selectSection = (next: SettingsSection): void => {
    const current = activeSection();
    if (next === current || isSaving()) return;

    const loaded = settings();
    if (isSectionDirty(current, drafts, loaded)) {
      if (!window.confirm(t('settings.unsavedSectionConfirm'))) return;
      // `settings.md:20`: the discarded draft is reset from the saved settings.
      resetSectionDraft(current, setDrafts, loaded);
    }

    setActiveSection(next);
    if (next === 'kindle') void refreshKindleSends();
  };

  return (
    <div class="flex min-h-dvh flex-col bg-base-100 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <SettingsHeader onLeave={() => navigate(HOME_PATH)} />
      <div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-3 py-4 md:flex-row md:gap-10 md:p-6">
        <SettingsNav
          active={activeSection()}
          disabled={isSaving()}
          onSelect={selectSection}
        />
        <div class="min-w-0 max-w-2xl flex-1">
          <SettingsPanels
            active={activeSection()}
            drafts={drafts}
            setDrafts={setDrafts}
            onGoToServices={() => selectSection('services')}
          />
        </div>
      </div>
    </div>
  );
}
