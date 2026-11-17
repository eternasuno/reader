import { useNavigate } from '@solidjs/router';
import { createSignal } from 'solid-js';
import { signIn } from '../api/auth';
import { messageOf } from '../api/messages';
import { FormField } from '../ui/form-field';
import { AuthForm } from './auth-form';
import { emailField, loginPasswordField } from './fields';
import { fieldValue } from './form-data';
import { accountMessages as copy } from './messages';

/** The sign-in form of `/login`: `/` on success, an alert on failure. */
export const LoginForm = () => {
  const navigate = useNavigate();
  const [failure, setFailure] = createSignal('');
  const [pending, setPending] = createSignal(false);

  const signInWith = async (form: HTMLFormElement) => {
    const data = new FormData(form);

    setFailure('');
    setPending(true);

    try {
      await signIn({
        email: fieldValue(data, 'email').trim(),
        password: fieldValue(data, 'password'),
      });
      navigate('/', { replace: true });
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthForm
      busy={pending()}
      failure={failure()}
      submitLabel={copy.loginSubmit}
      submitPendingLabel={copy.loginSubmitPending}
      onSubmit={(form) => void signInWith(form)}
    >
      <FormField {...emailField} />
      <FormField {...loginPasswordField} />
    </AuthForm>
  );
};
