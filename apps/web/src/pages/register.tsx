import { RegisterForm } from '../components/organisms/register-form';
import { AuthPage } from '../components/templates/auth-page';

const Register = () => {
  return (
    <AuthPage title="Create an account">
      <RegisterForm />
      <p class="text-center">
        Already have an account?{' '}
        <a href="/login" class="link">
          Sign in
        </a>
      </p>
    </AuthPage>
  );
};

export default Register;
