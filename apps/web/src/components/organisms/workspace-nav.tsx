import { useAtomRefresh, useAtomValue } from '@effect/atom-solid/Hooks';
import { useNavigate } from '@solidjs/router';
import { Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { logout } from '../../lib/auth';
import { makeFeedAtoms } from '../../lib/feeds';
import { ReaderIcon } from '../atoms/reader-icon';

const SignOutButton = () => {
  const navigate = useNavigate();
  const [leaving, setLeaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const signOut = async (): Promise<void> => {
    setLeaving(true);
    setError('');
    try {
      await logout();
      navigate('/login');
    } catch {
      setError('退出失败，请重试');
    } finally {
      setLeaving(false);
    }
  };

  return (
    <>
      <button type="button" disabled={leaving()} onClick={() => void signOut()}>
        <ReaderIcon name="logout" />
        {leaving() ? '退出中…' : '退出登录'}
      </button>
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
    </>
  );
};

const FeedNavList = (props: {
  readonly activeKey: string;
  readonly revision: number;
  readonly onPick: (key: string) => void;
}) => {
  const atoms = makeFeedAtoms();
  const feeds = useAtomValue(() => atoms.feeds);
  const refresh = useAtomRefresh(() => atoms.feeds);
  createEffect(() => {
    if (props.revision >= 0) refresh();
  });
  const items = () =>
    Option.getOrUndefined(AsyncResult.value(feeds()))?.items ?? [];
  createEffect(
    on([feeds, () => props.activeKey], ([result, activeKey]) => {
      if (
        activeKey &&
        AsyncResult.isSuccess(result) &&
        !result.waiting &&
        !result.value.items.some((feed) => feed.key === activeKey)
      ) {
        props.onPick('');
      }
    })
  );

  return (
    <ul aria-label="订阅源">
      <For each={items()} fallback={<li>尚未订阅</li>}>
        {(feed) => (
          <li>
            <button
              type="button"
              aria-current={feed.key === props.activeKey || undefined}
              onClick={() => props.onPick(feed.key)}
            >
              <ReaderIcon name="feed" class="nav-icon" />
              <span class="nav-label">{feed.title}</span>
            </button>
          </li>
        )}
      </For>
    </ul>
  );
};

export const WorkspaceNav = (props: {
  readonly scope: 'later' | 'rss';
  readonly feedKey: string;
  readonly feedRevision: number;
  readonly onPickLater: () => void;
  readonly onPickRss: () => void;
  readonly onManage: () => void;
  readonly onPickFeed: (key: string) => void;
  readonly onSettings: () => void;
}) => (
  <nav class="workspace-nav" aria-label="阅读导航">
    <h1 class="workspace-brand">
      <ReaderIcon name="feed" class="brand-mark" />
      留白<span class="brand-caption">READER</span>
    </h1>
    <button
      type="button"
      aria-current={props.scope === 'later' ? 'page' : undefined}
      onClick={props.onPickLater}
    >
      <ReaderIcon name="bookmark" class="nav-icon" />
      稍后阅读
    </button>
    <button
      type="button"
      aria-current={
        props.scope === 'rss' && !props.feedKey ? 'page' : undefined
      }
      onClick={props.onPickRss}
    >
      <ReaderIcon name="all" class="nav-icon" />
      全部文章
    </button>
    <div class="workspace-feed-heading">
      <span>订阅源</span>
      <button
        type="button"
        aria-label="管理订阅"
        title="管理订阅"
        onClick={props.onManage}
      >
        <ReaderIcon name="plus" />
      </button>
    </div>
    <FeedNavList
      activeKey={props.feedKey}
      revision={props.feedRevision}
      onPick={props.onPickFeed}
    />
    <div class="workspace-nav-footer">
      <button type="button" onClick={props.onSettings}>
        <ReaderIcon name="settings" />
        设置
      </button>
      <SignOutButton />
    </div>
  </nav>
);
