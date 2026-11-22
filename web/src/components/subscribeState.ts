import { type Accessor, createSignal, type Setter } from 'solid-js';
import type { FeedPreview } from '../api';
import { createOpenReset } from './createOpenReset';

export type Step = 'url' | 'preview';

export interface SubscribeState {
  step: Accessor<Step>;
  url: Accessor<string>;
  preview: Accessor<FeedPreview | null>;
  folderId: Accessor<string>;
  previewing: Accessor<boolean>;
  submitting: Accessor<boolean>;
  error: Accessor<string | undefined>;
  busy: Accessor<boolean>;
  setStep: Setter<Step>;
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
  const [step, setStep] = createSignal<Step>('url');
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
      setStep('url');
      setUrl('');
      setPreview(null);
      setFolderId('');
      setPreviewing(false);
      setSubmitting(false);
      setError(undefined);
    }
  );

  return {
    step,
    url,
    preview,
    folderId,
    previewing,
    submitting,
    error,
    busy,
    setStep,
    setUrl,
    setPreview,
    setFolderId,
    setPreviewing,
    setSubmitting,
    setError,
  };
};
