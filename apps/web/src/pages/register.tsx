import { RegisterForm } from '../components/organisms/register-form';
import { AuthPage } from '../components/templates/auth-page';

const Register = () => {
  return (
    <AuthPage title="注册">
      <RegisterForm />
      <p class="text-center text-sm text-base-content/70">
        已有账号？{' '}
        <a href="/login" class="link link-neutral">
          去登录
        </a>
      </p>
    </AuthPage>
  );
};

export default Register;
