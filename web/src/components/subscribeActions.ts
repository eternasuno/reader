import { ApiError, type Feed, type FeedPreview, feedsApi } from '../api';
import { t } from '../i18n';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { SubscribeState } from './subscribeState';

/** Compares feed URLs after canonicalizing them, so form variants match. */
const normalizeHref = (value: string): string => {
  try {
    return new URL(value).href;
  } catch {
    return value.trim();
  }
};

export interface SubscribeOutcomeHandlers {
  onClose: () => void;
  onSubscribed: (feed: Feed) => void;
  onDuplicateFound: (feed: Feed) => void;
}

const sameFeedUrl = (left: string, right: string): boolean =>
  normalizeHref(left) === normalizeHref(right);

const findExistingFeed = async (
  known: ReadonlyArray<Feed>,
  targetUrl: string
): Promise<Feed | undefined> => {
  const local = known.find((feed) => sameFeedUrl(feed.url, targetUrl));
  if (local) return local;

  try {
    const feeds = await feedsApi.list();
    return feeds.find((feed) => sameFeedUrl(feed.url, targetUrl));
  } catch {
    return undefined;
  }
};

/** `FD-PREVIEW-1`: step one validates and previews the submitted URL. */
export const previewFeedUrl = async (state: SubscribeState): Promise<void> => {
  if (state.previewing()) return;

  const trimmedUrl = state.url().trim();
  if (trimmedUrl.length === 0) return;

  state.setPreviewing(true);
  state.setError(undefined);

  try {
    const result = await feedsApi.preview(trimmedUrl);
    state.setPreview(result);
    // `CM-URL-5`: the preview URL is redacted, so the submitted URL stays the source of truth
    // for private feeds (`user:pass@`). The preview step displays the redacted URL instead.
    state.setStep('preview');
  } catch (err) {
    state.setError(errorText(err));
  } finally {
    state.setPreviewing(false);
  }
};

/**
 * `FD-SUB-1`: step two subscribes. `CM-URL-5`: subscribe with the submitted
 * URL so private-feed credentials survive the redacted preview.
 */
export const subscribeToPreviewed = async (
  props: SubscribeOutcomeHandlers,
  existingFeeds: ReadonlyArray<Feed>,
  state: SubscribeState
): Promise<void> => {
  const current = state.preview();
  if (state.submitting() || !current) return;

  state.setSubmitting(true);
  state.setError(undefined);

  try {
    const feed = await feedsApi.create({
      url: subscribeUrlFor(state, current),
      title: current.title,
      folderId: state.folderId() === '' ? null : state.folderId(),
    });
    showToast(String(t('feeds.subscribedToast')), 'success');
    props.onClose();
    props.onSubscribed(feed);
  } catch (err) {
    await handleSubscribeFailure(props, existingFeeds, state, err, current);
  } finally {
    state.setSubmitting(false);
  }
};

const subscribeUrlFor = (
  state: SubscribeState,
  current: FeedPreview
): string => {
  const submittedUrl = state.url().trim();
  return submittedUrl.length > 0 ? submittedUrl : current.url;
};

const handleSubscribeFailure = async (
  props: SubscribeOutcomeHandlers,
  existingFeeds: ReadonlyArray<Feed>,
  state: SubscribeState,
  err: unknown,
  current: FeedPreview
): Promise<void> => {
  if (!(err instanceof ApiError && err.code === 'FeedAlreadyExists')) {
    state.setError(errorText(err));
    return;
  }

  const existing = await findExistingFeed(
    existingFeeds,
    err.url ?? current.url
  );
  showToast(String(t('errors.FeedAlreadyExists')), 'info');
  props.onClose();
  if (existing) props.onDuplicateFound(existing);
};
