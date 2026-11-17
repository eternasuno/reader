import { useNavigate } from '@solidjs/router';
import { createSignal } from 'solid-js';
import { register } from '../api/auth';
import { messageOf } from '../api/messages';
import { FormField } from '../ui/form-field';
import { AuthForm } from './auth-form';
import {
  emailField,
  nicknameField,
  registerConfirmationField,
  registerPasswordField,
} from './fields';
import { fieldValue } from './form-data';
import { accountMessages as copy } from './messages';

/**
 * The registration form: `/login` on success — registration starts no session
 * (AC-ACCOUNT-2), and a taken email answers the same success (AC-ACCOUNT-3). The
 * confirmation must equal the password typed above it.
 */
export const RegisterForm = () => {
  const navigate = useNavigate();
  const [password, setPassword] = createSignal('');
  const [failure, setFailure] = createSignal('');
  const [pending, setPending] = createSignal(false);

  const registerWith = async (form: HTMLFormElement) => {
    const data = new FormData(form);

    setFailure('');
    setPending(true);

    try {
      await register({
        name: fieldValue(data, 'name').trim(),
        email: fieldValue(data, 'email').trim(),
        password: fieldValue(data, 'password'),
      });
      navigate('/login');
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
      submitLabel={copy.registerSubmit}
      submitPendingLabel={copy.registerSubmitPending}
      onSubmit={(form) => void registerWith(form)}
    >
      <FormField {...nicknameField} />
      <FormField {...emailField} />
      <FormField
        {...registerPasswordField}
        onInput={(event) => setPassword(event.currentTarget.value)}
      />
      <FormField
        {...registerConfirmationField}
        pattern={RegExp.escape(password())}
      />
    </AuthForm>
  );
};
