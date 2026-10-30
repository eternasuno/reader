import type { FeedArticle } from '@reader/api';
import { Cause, Exit } from 'effect';
import { type Accessor, createSignal, onCleanup, type Setter } from 'solid-js';
import { errorText } from '../../lib/errors';
import type { InfiniteState } from '../../lib/infinite';
import type { LinkCommand, ReadingLink } from '../../lib/links';
import type {
  FeedNavCommand,
  FeedNavError,
  FeedNavPending,
} from '../molecules/feed-nav-list';
import {
  feedBulkScope,
  notifyReaderDataChanged,
  publishBulkReadStatus,
  READER_READ_STATUS_CHANGED,
  readStatusFromEvent,
  useReaderDataRefresh,
} from './reader-status';

export const useUnreadRefresh = (
  refreshFeeds: () => void,
  refreshUnread: () => void
) => {
  useReaderDataRefresh(refreshFeeds, refreshUnread);
  let active = true;
  let scheduled = false;
  let feedsPending = false;
  let linksPending = false;
  const flush = () => {
    scheduled = false;
    if (!active) return;

    if (feedsPending) {
      feedsPending = false;
      refreshFeeds();
    }

    if (linksPending) {
      linksPending = false;
      refreshUnread();
    }
  };
  const schedule = (kind: 'feed' | 'link') => {
    if (kind === 'feed') feedsPending = true;
    else linksPending = true;
    if (scheduled) return;

    scheduled = true;
    queueMicrotask(flush);
  };
  const handleReadStatus = (event: Event) => {
    const change = readStatusFromEvent(event);
    if (change) schedule(change.kind);
  };
  window.addEventListener(READER_READ_STATUS_CHANGED, handleReadStatus);
  onCleanup(() => {
    active = false;
    window.removeEventListener(READER_READ_STATUS_CHANGED, handleReadStatus);
  });
};

const commandErrorMessage = (cause: Cause.Cause<unknown>): string =>
  errorText(Cause.squash(cause));

type FeedCommandContext = {
  readonly run: (input: FeedNavCommand) => Promise<Exit.Exit<unknown, unknown>>;
  readonly pending: Accessor<FeedNavPending | undefined>;
  readonly setPending: Setter<FeedNavPending | undefined>;
  readonly setError: Setter<FeedNavError | undefined>;
};

const commandLabel = (input: FeedNavCommand): string => {
  if (input._tag === 'Unsubscribe') return '删除中…';
  if (input._tag === 'MarkAll') return '标记中…';

  return '刷新中…';
};

const executeFeedCommand = async (
  input: FeedNavCommand,
  context: FeedCommandContext
): Promise<Exit.Exit<unknown, unknown> | undefined> => {
  if (context.pending()) return undefined;

  context.setError(undefined);
  context.setPending({ key: input.key, label: commandLabel(input) });

  try {
    const exit = await context.run(input);
    if (Exit.isFailure(exit)) {
      context.setError({
        key: input.key,
        message: commandErrorMessage(exit.cause),
      });
    }

    return exit;
  } catch {
    context.setError({ key: input.key, message: '操作失败，请稍后重试' });

    return undefined;
  } finally {
    context.setPending(undefined);
  }
};

export const useFeedCommand = (
  run: FeedCommandContext['run'],
  articles: Accessor<InfiniteState<FeedArticle>>,
  busy: Accessor<boolean>
) => {
  const [pending, setPending] = createSignal<FeedNavPending>();
  const [error, setError] = createSignal<FeedNavError>();
  const runFeedCommand = async (input: FeedNavCommand) => {
    if (busy()) return;

    const snapshot = input._tag === 'MarkAll' ? articles().items : [];
    const exit = await executeFeedCommand(input, {
      run,
      pending,
      setPending,
      setError,
    });
    if (exit && Exit.isSuccess(exit) && input._tag === 'MarkAll') {
      publishBulkReadStatus(exit, {
        kind: 'feed',
        keys: snapshot
          .filter((item) => input.key === '' || item.feedKey === input.key)
          .map((item) => item.key),
        read: true,
        scope: feedBulkScope(input.key),
      });
    }
  };

  return { feedPending: pending, feedError: error, runFeedCommand };
};

type SourceKey = 'later' | 'rss';

type SourceNavPending = {
  readonly key: SourceKey;
  readonly label: string;
};

type SourceNavError = {
  readonly key: SourceKey;
  readonly message: string;
};

type RssSourceCommand =
  | { readonly _tag: 'RefreshAll'; readonly reload: boolean }
  | { readonly _tag: 'MarkAll'; readonly key: '' };

type SourceCommandRunner<T> = (
  input: T
) => Promise<Exit.Exit<unknown, unknown>>;

type SourceCommandState = {
  readonly busy: Accessor<boolean>;
  readonly pending: Accessor<SourceNavPending | undefined>;
  readonly setPending: Setter<SourceNavPending | undefined>;
  readonly setError: Setter<SourceNavError | undefined>;
};

type SourceCommandInput = {
  readonly runFeed: SourceCommandRunner<RssSourceCommand>;
  readonly runLink: SourceCommandRunner<LinkCommand>;
  readonly feedBusy: Accessor<boolean>;
  readonly linkBusy: Accessor<boolean>;
  readonly feedArticles: Accessor<InfiniteState<FeedArticle>>;
  readonly linkArticles: Accessor<InfiniteState<ReadingLink>>;
  readonly rssActive: Accessor<boolean>;
};

const sourceContext = (
  key: SourceKey,
  state: SourceCommandState
): SourceCommandState & { readonly key: SourceKey } => ({
  key,
  busy: state.busy,
  pending: state.pending,
  setPending: state.setPending,
  setError: state.setError,
});

const executeSourceCommand = async <T>(
  input: T,
  label: string,
  run: SourceCommandRunner<T>,
  context: SourceCommandState & { readonly key: SourceKey }
): Promise<Exit.Exit<unknown, unknown> | undefined> => {
  if (context.busy() || context.pending()) return undefined;

  context.setError(undefined);
  context.setPending({ key: context.key, label });

  try {
    const exit = await run(input);
    if (Exit.isFailure(exit)) {
      context.setError({
        key: context.key,
        message: commandErrorMessage(exit.cause),
      });
    }

    return exit;
  } catch {
    context.setError({ key: context.key, message: '操作失败，请稍后重试' });

    return undefined;
  } finally {
    context.setPending(undefined);
  }
};

const runRssSourceCommand = async (
  command: RssSourceCommand,
  input: SourceCommandInput,
  state: SourceCommandState
) => {
  const snapshot = command._tag === 'MarkAll' ? input.feedArticles().items : [];
  const exit = await executeSourceCommand(
    command,
    command._tag === 'MarkAll' ? '标记中…' : '刷新中…',
    input.runFeed,
    sourceContext('rss', state)
  );
  if (exit && Exit.isSuccess(exit) && command._tag === 'MarkAll') {
    publishBulkReadStatus(exit, {
      kind: 'feed',
      keys: snapshot.map((item) => item.key),
      read: true,
      scope: feedBulkScope(''),
    });
  }
};

const runLaterSourceCommand = async (
  input: SourceCommandInput,
  state: SourceCommandState
) => {
  const snapshot = input.linkArticles().items;
  const command: LinkCommand = { _tag: 'MarkAll' };
  const exit = await executeSourceCommand(
    command,
    '标记中…',
    input.runLink,
    sourceContext('later', state)
  );
  if (exit && Exit.isSuccess(exit)) {
    publishBulkReadStatus(exit, {
      kind: 'link',
      keys: snapshot.map((item) => item.key),
      read: true,
      scope: { kind: 'links' },
    });
  }
};

export const useSourceCommand = (input: SourceCommandInput) => {
  const [pending, setPending] = createSignal<SourceNavPending>();
  const [error, setError] = createSignal<SourceNavError>();
  const busy = () =>
    input.feedBusy() || input.linkBusy() || pending() !== undefined;
  const state: SourceCommandState = { busy, pending, setPending, setError };
  const pendingLabel = (key: SourceKey) => {
    const current = pending();

    return current?.key === key ? current.label : undefined;
  };
  const errorMessage = (key: SourceKey) => {
    const current = error();

    return current?.key === key ? current.message : undefined;
  };
  const refreshLater = () => {
    if (busy()) return;

    notifyReaderDataChanged();
  };

  return {
    sourceBusy: busy,
    sourcePendingLabel: pendingLabel,
    sourceErrorMessage: errorMessage,
    refreshRss: () =>
      void runRssSourceCommand(
        { _tag: 'RefreshAll', reload: input.rssActive() },
        input,
        state
      ),
    markAllRss: () =>
      void runRssSourceCommand({ _tag: 'MarkAll', key: '' }, input, state),
    refreshLater,
    markAllLater: () => void runLaterSourceCommand(input, state),
  };
};
