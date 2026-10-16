import { createSignal } from 'solid-js';
import { FormInput } from './form-input';

export const PasswordConfirmation = () => {
  const [password, setPassword] = createSignal('');

  return (
    <div class="flex flex-col gap-4">
      <FormInput
        id="password"
        name="password"
        label="Password"
        type="password"
        autocomplete="new-password"
        minlength={8}
        required
        onInput={(event) => setPassword(event.currentTarget.value)}
        onChange={(event) => setPassword(event.currentTarget.value)}
        hint="Password must be at least 8 characters."
      />
      <FormInput
        id="confirm"
        name="confirm"
        label="Confirm password"
        type="password"
        autocomplete="new-password"
        pattern={RegExp.escape(password())}
        title="Passwords must match."
        required
        hint="Passwords must match."
      />
    </div>
  );
};
