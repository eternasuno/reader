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
  existingFeeds: ReadonlyArray<Feed>;
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
    // `CM-URL-5`: the preview URL is redacted, so `state.url()` stays the source of truth
    // for private feeds (`user:pass@`). The preview step displays the redacted URL instead.
    const result = await feedsApi.preview(trimmedUrl);
    state.setPreview(result);
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
  state: SubscribeState
): Promise<void> => {
  const current = state.preview();
  if (state.submitting() || !current) return;

  state.setSubmitting(true);
  state.setError(undefined);

  try {
    const feed = await feedsApi.create({
      url: state.url().trim(),
      title: current.title,
      folderId: state.folderId() === '' ? null : state.folderId(),
    });
    showToast(String(t('feeds.subscribedToast')), 'success');
    props.onClose();
    props.onSubscribed(feed);
  } catch (err) {
    await handleSubscribeFailure(props, state, err, current);
  } finally {
    state.setSubmitting(false);
  }
};

const handleSubscribeFailure = async (
  props: SubscribeOutcomeHandlers,
  state: SubscribeState,
  err: unknown,
  current: FeedPreview
): Promise<void> => {
  if (!(err instanceof ApiError && err.code === 'FeedAlreadyExists')) {
    state.setError(errorText(err));

    return;
  }

  const existing = await findExistingFeed(
    props.existingFeeds,
    err.url ?? current.url
  );
  showToast(String(t('errors.FeedAlreadyExists')), 'info');
  props.onClose();
  if (existing) props.onDuplicateFound(existing);
};
