import { action, useSubmission } from '@solidjs/router';
import { type LoginParams, login } from '../../lib/auth';
import { FormError } from '../atoms/form-error';
import { SubmitButton } from '../atoms/submit-button';
import { FormInput } from '../molecules/form-input';

const useLoginSubmit = () => {
  const submit = action(async (data: FormData) => {
    const { email, password } = Object.fromEntries(data);

    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new Error('Invalid login fields.');
    }

    const params: LoginParams = {
      email: email.trim(),
      password,
    };
    await login(params);
  }, 'login');
  const submission = useSubmission(submit);

  return { submit, submission };
};

export const LoginForm = () => {
  const { submit, submission } = useLoginSubmit();

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
        required
        id="email"
        name="email"
        label="Email"
        type="email"
        autocomplete="email"
        hint="Enter a valid email address."
      />
      <FormInput
        required
        id="password"
        name="password"
        label="Password"
        type="password"
        autocomplete="current-password"
        hint="Enter your password."
      />
      <FormError
        message={
          submission.error instanceof Error ? submission.error.message : ''
        }
      />
      <SubmitButton
        pending={!!submission.pending}
        label="Sign in"
        pendingLabel="Signing in…"
      />
    </form>
  );
};
