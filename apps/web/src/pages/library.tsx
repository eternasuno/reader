import { useNavigate } from '@solidjs/router';
import { createEffect, Show } from 'solid-js';
import { LibraryWorkspace } from '../components/organisms/library-workspace';
import { authClient } from '../lib/auth';

export const LibraryPage = () => {
  const navigate = useNavigate();
  const session = authClient.useSession();
  createEffect(() => {
    const current = session();
    if (!current.isPending && !current.data && !current.error)
      navigate('/login', { replace: true });
  });

  return (
    <main class="min-h-dvh">
      <Show
        when={!session().isPending}
        fallback={
          <p class="p-6 text-sm text-base-content/70">正在确认登录状态…</p>
        }
      >
        <Show
          when={!session().error}
          fallback={
            <p role="alert" class="p-6 text-sm text-error">
              暂时无法确认登录状态，请刷新重试。
            </p>
          }
        >
          <Show when={session().data?.user.id}>
            <LibraryWorkspace />
          </Show>
        </Show>
      </Show>
    </main>
  );
};

export default LibraryPage;
