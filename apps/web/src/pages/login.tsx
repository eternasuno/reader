import { useNavigate } from '@solidjs/router';
import { createEffect } from 'solid-js';
import { authClient } from '../api/auth';
import { LoginForm } from '../components/organisms/auth/login-form';
import { AuthPage } from '../components/templates/auth-page';

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
    <AuthPage title="登录">
      <LoginForm />
      <p class="text-center text-sm text-base-content/70">
        还没有账号？{' '}
        <a href="/register" class="link link-neutral">
          去注册
        </a>
      </p>
    </AuthPage>
  );
};

export default Login;
