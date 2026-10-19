import { createSignal } from 'solid-js';
import { FormInput } from './form-input';

export const PasswordConfirmation = () => {
  const [password, setPassword] = createSignal('');

  return (
    <div class="flex flex-col gap-4">
      <FormInput
        id="password"
        name="password"
        label="密码"
        type="password"
        autocomplete="new-password"
        minlength={8}
        required
        onInput={(event) => setPassword(event.currentTarget.value)}
        onChange={(event) => setPassword(event.currentTarget.value)}
        hint="密码至少 8 位。"
      />
      <FormInput
        id="confirm"
        name="confirm"
        label="确认密码"
        type="password"
        autocomplete="new-password"
        pattern={RegExp.escape(password())}
        title="两次输入的密码不一致。"
        required
        hint="两次输入的密码不一致。"
      />
    </div>
  );
};
