import { useNavigate } from '@solidjs/router';
import { createEffect, Show } from 'solid-js';
import {
  SessionCard,
  SessionErrorCard,
  SessionLoading,
} from '../components/organisms/session-card';
import { CenteredLayout } from '../components/templates/centered-layout';
import { authClient, logout } from '../lib/auth';

const Home = () => {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const signOut = async () => {
    await logout();
    navigate('/login');
  };

  createEffect(() => {
    const current = session();

    if (!current.isPending && !current.data && !current.error) {
      navigate('/login', { replace: true });
    }
  });

  return (
    <CenteredLayout>
      <Show when={!session().isPending} fallback={<SessionLoading />}>
        <Show
          when={!session().error}
          fallback={<SessionErrorCard session={session()} />}
        >
          <SessionCard session={session()} onLogout={signOut} />
        </Show>
      </Show>
    </CenteredLayout>
  );
};

export default Home;
