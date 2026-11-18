/**
 * The copy of the `Kindle` section and of the send-now row (settings.md and
 * kindle.md Messages).
 */
export const kindleMessages = {
  heading: 'Kindle',
  description:
    '每天定时把未读文章打包成 EPUB，通过你的 SMTP 邮箱发送到 Kindle。',

  kindleEmailLabel: 'Kindle 邮箱',
  senderEmailLabel: '发件人邮箱',
  senderEmailHint: '需在亚马逊账户的"已认可的发件人"列表中。',
  smtpHostLabel: 'SMTP 服务器',
  smtpPortLabel: '端口',
  smtpSecurityLabel: '加密方式',
  securityTls: 'SSL/TLS',
  securityStarttls: 'STARTTLS',
  smtpUserLabel: 'SMTP 用户名',
  smtpUserHint: '留空则不登录。',
  smtpPasswordLabel: 'SMTP 密码',
  smtpPasswordStoredHint: '已保存密码，留空保持不变。',
  smtpPasswordNoneHint: '留空则不登录。',
  sendTimeLabel: '每日发送时间',
  sendTimeHint: '按服务器时间，每天发送一次。',
  sendTimeNone: '不定时发送',

  submit: '保存 Kindle 设置',
  submitPending: '保存中…',
  saved: 'Kindle 设置已保存',
  clearPasswordButton: '删除密码',
  clearPasswordConfirmation: '删除已保存的 SMTP 密码？',
  passwordCleared: 'SMTP 密码已删除',

  sendNow: '立即发送',
  sendNowPending: '发送中…',
  sendNowText: '把当前所有未读文章打包成 EPUB 发送到 Kindle，发送后标为已读。',
  nothingUnread: '没有未读文章',
} as const;

/** The stored-password line: whether a password is stored, never its value (SET-KINDLE-2). */
export const storedPasswordLine = (configured: boolean): string =>
  `SMTP 密码：${configured ? '已保存' : '未保存'}`;

/** The sent toast, with the number of articles the book held (KD-SEND-8). */
export const sentToKindle = (count: number): string =>
  `已发送 ${count} 篇文章到 Kindle`;
