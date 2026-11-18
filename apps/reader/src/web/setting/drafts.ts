import { createSignal } from 'solid-js';
import type { Setting } from '../api/setting';
import type { DraftSection } from './section';

/** The two providers of settings.md SET-FETCH. */
export type FetcherProvider = Setting['provider'];

/**
 * The sections whose drafts this module keeps: `Kindle` keeps its own in
 * `kindle/` (settings.md SET-KINDLE).
 */
export type OwnDraftSection = Exclude<DraftSection, 'kindle'>;

/** What a draft is compared with: the retention and the provider that were read. */
export type StoredValues = {
  readonly retention: number;
  readonly provider: FetcherProvider;
};

/** A field that is omitted, empty or blank counts as not given (SET-VAL-6). */
export const given = (value: string): string | undefined => {
  const text = value.trim();

  return text === '' ? undefined : text;
};

/**
 * The drafts of the `文章` and `提取` sections: the retention as typed, the
 * provider as selected, and the two secret fields, which start empty and are
 * never filled from a read (SET-VAL-4).
 */
export const createDrafts = () => {
  const [retentionDraft, setRetentionDraft] = createSignal('');
  const [providerDraft, setProviderDraft] =
    createSignal<FetcherProvider>('jina');
  const [jinaKeyDraft, setJinaKeyDraft] = createSignal('');
  const [endpointDraft, setEndpointDraft] = createSignal('');

  return {
    retentionDraft,
    setRetentionDraft,
    providerDraft,
    setProviderDraft,
    jinaKeyDraft,
    setJinaKeyDraft,
    endpointDraft,
    setEndpointDraft,
  };
};

export type Drafts = ReturnType<typeof createDrafts>;

/** Takes a read setting over: the drafts start from it and the secrets stay empty. */
export const applyRead = (drafts: Drafts, stored: StoredValues): void => {
  drafts.setRetentionDraft(String(stored.retention));
  drafts.setProviderDraft(stored.provider);
  drafts.setJinaKeyDraft('');
  drafts.setEndpointDraft('');
};

/** A section counts as changed when its draft differs from what was read. */
export const changedDraft = (
  drafts: Drafts,
  stored: StoredValues,
  section: OwnDraftSection
): boolean => {
  if (section === 'articles') {
    return drafts.retentionDraft() !== String(stored.retention);
  }

  return (
    drafts.providerDraft() !== stored.provider ||
    given(drafts.jinaKeyDraft()) !== undefined ||
    given(drafts.endpointDraft()) !== undefined
  );
};

/** Drops a section's drafts: the retention is refilled and the secrets emptied. */
export const discardDraft = (
  drafts: Drafts,
  stored: StoredValues,
  section: OwnDraftSection
): void => {
  if (section === 'articles') {
    drafts.setRetentionDraft(String(stored.retention));
  }

  if (section === 'extraction') {
    drafts.setProviderDraft(stored.provider);
    drafts.setJinaKeyDraft('');
    drafts.setEndpointDraft('');
  }
};
