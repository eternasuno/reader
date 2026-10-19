import { useAtomRefresh, useAtomValue } from '@effect/atom-solid/Hooks';
import { useNavigate } from '@solidjs/router';
import { Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  Show,
  splitProps,
} from 'solid-js';
import { logout } from '../../lib/auth';
import { makeFeedAtoms } from '../../lib/feeds';
import { Button } from '../atoms/button';
import { ReaderIcon } from '../atoms/reader-icon';

const NavIcon = (props: Parameters<typeof ReaderIcon>[0]) => (
  <ReaderIcon {...props} class="w-5 shrink-0 text-[#aaa3b2]" />
);

type NavButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly active?: boolean;
};

const NavButton = (props: NavButtonProps) => {
  const [local, rest] = splitProps(props, ['class', 'active']);
  return (
    <Button
      {...rest}
      type="button"
      aria-current={local.active ? 'page' : undefined}
      class={`flex min-h-9 cursor-pointer items-center rounded px-2.5 py-2 text-left aria-[current=page]:bg-neutral aria-[current=page]:text-neutral-content max-sm:min-h-11 ${local.class ?? ''}`}
    />
  );
};

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
      <NavButton
        class="gap-1.5"
        disabled={leaving()}
        onClick={() => void signOut()}
      >
        <ReaderIcon name="logout" />
        {leaving() ? '退出中…' : '退出登录'}
      </NavButton>
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="px-2.5 py-1">
            {message()}
          </p>
        )}
      </Show>
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
    <ul aria-label="订阅源" class="mt-1 min-h-20 flex-1">
      <For
        each={items()}
        fallback={<li class="p-3 text-xs text-[#929295]">尚未订阅</li>}
      >
        {(feed) => (
          <li>
            <NavButton
              class="w-full gap-3"
              active={feed.key === props.activeKey}
              onClick={() => props.onPick(feed.key)}
            >
              <NavIcon name="feed" />
              <span class="min-w-0 truncate">{feed.title}</span>
            </NavButton>
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
  readonly class?: string;
  readonly onPickLater: () => void;
  readonly onPickRss: () => void;
  readonly onManage: () => void;
  readonly onPickFeed: (key: string) => void;
  readonly onSettings: () => void;
}) => (
  <nav
    aria-label="阅读导航"
    class={`flex min-w-0 flex-col gap-1 overflow-y-auto border-r border-base-300 bg-base-100 px-3 pb-3 ${props.class ?? ''}`}
  >
    <h1 class="mb-2 flex min-h-16 items-center gap-2.5 px-2 text-xl font-semibold tracking-[0.08em]">
      <ReaderIcon name="feed" class="size-7 text-[#d5a15c]" />
      留白
      <span class="ml-auto text-xs tracking-[0.15em] text-[#929295]">
        READER
      </span>
    </h1>
    <NavButton
      class="w-full gap-3"
      active={props.scope === 'later'}
      onClick={props.onPickLater}
    >
      <NavIcon name="bookmark" />
      稍后阅读
    </NavButton>
    <NavButton
      class="w-full gap-3"
      active={props.scope === 'rss' && !props.feedKey}
      onClick={props.onPickRss}
    >
      <NavIcon name="all" />
      全部文章
    </NavButton>
    <div class="mt-5 flex items-center justify-between pl-3 text-xs tracking-[0.06em] text-[#a2a2a7]">
      <span>订阅源</span>
      <NavButton
        class="w-9 justify-center"
        aria-label="管理订阅"
        title="管理订阅"
        onClick={props.onManage}
      >
        <ReaderIcon name="plus" />
      </NavButton>
    </div>
    <FeedNavList
      activeKey={props.feedKey}
      revision={props.feedRevision}
      onPick={props.onPickFeed}
    />
    <div class="mt-auto flex flex-wrap border-t border-base-300 pt-3 text-xs text-[#a6a6ab]">
      <NavButton class="gap-1.5" onClick={props.onSettings}>
        <ReaderIcon name="settings" />
        设置
      </NavButton>
      <SignOutButton />
    </div>
  </nav>
);
