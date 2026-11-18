/**
 * The page copy of account.md Messages: the auth pages, the `账号` section of the
 * settings page, the password form and the account menu. Better Auth's failure
 * wordings are keyed by operation in `api/auth.ts`, not here.
 */
export const accountMessages = {
  productLabel: '稍后阅读',

  loginTitle: '登录',
  loginSubmit: '登录',
  loginSubmitPending: '登录中…',
  loginPasswordLabel: '密码',
  loginPasswordMessage: '请输入密码。',
  loginFooterText: '还没有账号？',
  loginFooterLink: '去注册',

  registerTitle: '注册',
  registerSubmit: '注册',
  registerSubmitPending: '注册中…',
  nicknameLabel: '昵称',
  nicknameMessage: '请输入昵称。',
  emailLabel: '邮箱',
  emailMessage: '请输入有效邮箱。',
  registerPasswordLabel: '密码',
  registerPasswordHint: '密码至少 8 位。',
  registerConfirmationLabel: '确认密码',
  registerConfirmationMessage: '两次输入的密码不一致。',
  registerFooterText: '已有账号？',
  registerFooterLink: '去登录',

  accountSectionHeading: '账号',
  accountSectionDescription: '修改密码后会退出其他设备，当前设备保持登录。',
  currentPasswordLabel: '当前密码',
  currentPasswordMessage: '请输入当前密码。',
  newPasswordLabel: '新密码',
  newPasswordHint: '至少 8 个字符，且不能与当前密码相同。',
  newPasswordConfirmationLabel: '确认新密码',
  newPasswordConfirmationMessage: '请再次输入新密码。',
  newPasswordSameMessage: '新密码不能与当前密码相同。',
  newPasswordMismatchMessage: '两次输入的新密码不一致。',
  passwordSubmit: '修改密码',
  passwordSubmitPending: '修改中…',
  passwordChanged: '密码已更新，其他设备已退出登录',

  menuTrigger: '用户菜单',
  menuSettings: '设置',
  signOut: '退出登录',
  signOutPending: '退出中…',
} as const;
