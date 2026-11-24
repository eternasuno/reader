import { type Accessor, createSignal, type Setter } from 'solid-js';
import type { FeedPreview } from '../api';
import { createOpenReset } from './createOpenReset';

export interface SubscribeState {
  url: Accessor<string>;
  preview: Accessor<FeedPreview | null>;
  folderId: Accessor<string>;
  previewing: Accessor<boolean>;
  submitting: Accessor<boolean>;
  error: Accessor<string | undefined>;
  busy: Accessor<boolean>;
  setUrl: Setter<string>;
  setPreview: Setter<FeedPreview | null>;
  setFolderId: Setter<string>;
  setPreviewing: Setter<boolean>;
  setSubmitting: Setter<boolean>;
  setError: Setter<string | undefined>;
}

export interface SubscribeStateProps {
  open: boolean;
}

/** Signals for the two-step subscribe dialog, reset on every open. */
export const createSubscribeState = (
  props: SubscribeStateProps
): SubscribeState => {
  const [url, setUrl] = createSignal('');
  const [preview, setPreview] = createSignal<FeedPreview | null>(null);
  const [folderId, setFolderId] = createSignal('');
  const [previewing, setPreviewing] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const busy = () => previewing() || submitting();

  createOpenReset(
    () => props.open,
    () => {
      setUrl('');
      setPreview(null);
      setFolderId('');
      setPreviewing(false);
      setSubmitting(false);
      setError(undefined);
    }
  );

  return {
    url,
    preview,
    folderId,
    previewing,
    submitting,
    error,
    busy,
    setUrl,
    setPreview,
    setFolderId,
    setPreviewing,
    setSubmitting,
    setError,
  };
};
