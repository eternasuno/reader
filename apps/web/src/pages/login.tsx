import { useNavigate } from '@solidjs/router';
import { createEffect } from 'solid-js';
import { LoginForm } from '../components/organisms/login-form';
import { AuthPage } from '../components/templates/auth-page';
import { authClient } from '../lib/auth';

const Login = () => {
  const navigate = useNavigate();
  const session = authClient.useSession();

  createEffect(() => {
    const current = session();

    if (!current.isPending && current.data && !current.error) {
      navigate('/', { replace: true });
    }
  });

  return (
    <AuthPage title="Sign in">
      <LoginForm />
      <p class="text-center">
        Don&apos;t have an account?{' '}
        <a href="/register" class="link">
          Create one
        </a>
      </p>
    </AuthPage>
  );
};

export default Login;
