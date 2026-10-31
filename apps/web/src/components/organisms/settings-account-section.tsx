import { SubmitButton } from '../atoms/submit-button';
import { FormInput } from '../molecules/form-input';

type PasswordField = 'current' | 'next' | 'confirm';

type AccountSectionProps = {
  readonly class?: string;
  readonly busy: boolean;
  readonly pending: boolean;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmPassword: string;
  readonly onChange: (field: PasswordField, value: string) => void;
  readonly onSubmit: (form: HTMLFormElement) => void;
};

const CurrentPasswordField = (props: {
  readonly value: string;
  readonly busy: boolean;
  readonly onInput: (value: string) => void;
}) => (
  <FormInput
    id="settings-current-password"
    name="currentPassword"
    type="password"
    autocomplete="current-password"
    required
    label="当前密码"
    hint="请输入当前密码。"
    value={props.value}
    disabled={props.busy}
    onInput={(event) => props.onInput(event.currentTarget.value)}
  />
);

const NewPasswordFields = (props: {
  readonly newPassword: string;
  readonly confirmPassword: string;
  readonly busy: boolean;
  readonly onNewInput: (value: string) => void;
  readonly onConfirmInput: (value: string) => void;
}) => (
  <>
    <FormInput
      id="settings-new-password"
      name="newPassword"
      type="password"
      autocomplete="new-password"
      required
      minlength={8}
      label="新密码"
      hint="至少 8 个字符，且不能与当前密码相同。"
      value={props.newPassword}
      disabled={props.busy}
      onInput={(event) => props.onNewInput(event.currentTarget.value)}
    />
    <FormInput
      id="settings-confirm-password"
      name="confirmPassword"
      type="password"
      autocomplete="new-password"
      required
      minlength={8}
      label="确认新密码"
      hint="请再次输入新密码。"
      value={props.confirmPassword}
      disabled={props.busy}
      onInput={(event) => props.onConfirmInput(event.currentTarget.value)}
    />
  </>
);

const syncPasswordValidity = (
  form: HTMLFormElement,
  current: string,
  next: string,
  confirm: string
) => {
  const newInput = form.elements.namedItem('newPassword');
  const confirmInput = form.elements.namedItem('confirmPassword');
  if (newInput instanceof HTMLInputElement) {
    newInput.setCustomValidity(
      next !== '' && next === current ? '新密码不能与当前密码相同。' : ''
    );
  }

  if (confirmInput instanceof HTMLInputElement) {
    confirmInput.setCustomValidity(
      confirm !== '' && confirm !== next ? '两次输入的新密码不一致。' : ''
    );
  }
};

export const AccountSection = (props: AccountSectionProps) => {
  const submit = (form: HTMLFormElement) => {
    syncPasswordValidity(
      form,
      props.currentPassword,
      props.newPassword,
      props.confirmPassword
    );
    props.onSubmit(form);
  };

  return (
    <section
      id="settings-account"
      class={`rounded-box border border-base-300 bg-base-100 p-5 ${props.class ?? ''}`}
      aria-labelledby="settings-account-title"
    >
      <h2 id="settings-account-title" class="text-lg font-semibold">
        账号
      </h2>
      <p class="mt-1 text-sm leading-6 text-base-content/60">
        修改密码后会退出其他设备，当前设备保持登录。
      </p>
      <form
        class="mt-5 flex flex-col gap-4"
        novalidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(event.currentTarget);
        }}
      >
        <CurrentPasswordField
          value={props.currentPassword}
          busy={props.busy}
          onInput={(value) => props.onChange('current', value)}
        />
        <NewPasswordFields
          newPassword={props.newPassword}
          confirmPassword={props.confirmPassword}
          busy={props.busy}
          onNewInput={(value) => props.onChange('next', value)}
          onConfirmInput={(value) => props.onChange('confirm', value)}
        />
        <div>
          <SubmitButton
            pending={props.pending}
            label="修改密码"
            pendingLabel="修改中…"
          />
        </div>
      </form>
    </section>
  );
};
