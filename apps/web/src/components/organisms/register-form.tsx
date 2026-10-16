import { action, useNavigate, useSubmission } from '@solidjs/router';
import { type RegisterParams, register } from '../../lib/auth';
import { FormError } from '../atoms/form-error';
import { SubmitButton } from '../atoms/submit-button';
import { FormInput } from '../molecules/form-input';
import { PasswordConfirmation } from '../molecules/password-confirmation';

const useRegisterSubmit = () => {
  const navigate = useNavigate();
  const submit = action(async (data: FormData) => {
    const { name, email, password } = Object.fromEntries(data);

    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      throw new Error('Invalid register fields.');
    }

    const params: RegisterParams = {
      name: name.trim(),
      email: email.trim(),
      password,
    };
    await register(params);

    navigate('/login');
  }, 'register');
  const submission = useSubmission(submit);

  return { submit, submission };
};

export const RegisterForm = () => {
  const { submit, submission } = useRegisterSubmit();

  return (
    <form
      action={submit}
      method="post"
      novalidate
      aria-busy={submission.pending}
      onSubmit={(event) => {
        const form = event.currentTarget;
        form.classList.add('submitted');

        if (!form.checkValidity() || submission.pending) {
          event.preventDefault();
        }
      }}
      class="flex flex-col gap-4"
    >
      <FormInput
        id="name"
        name="name"
        label="Name"
        autocomplete="name"
        pattern={'.*\\S.*'}
        required
        hint="Enter your name."
      />
      <FormInput
        id="email"
        name="email"
        label="Email"
        type="email"
        autocomplete="email"
        required
        hint="Enter a valid email address."
      />
      <PasswordConfirmation />
      <FormError
        message={
          submission.error instanceof Error ? submission.error.message : ''
        }
      />
      <SubmitButton
        pending={!!submission.pending}
        label="Create account"
        pendingLabel="Creating account…"
      />
    </form>
  );
};
