/**
 * The page copy of settings.md Messages. The `账号` section's heading, its
 * description and the password form's wordings belong to account.md and come
 * from `account/messages.ts`.
 */
export const settingMessages = {
  heading: '设置',
  subtitle: '管理账号、文章保留、正文提取与 Kindle 发送。',
  backToLibrary: '返回阅读',
  navigationLabel: '设置分区',

  savingStatus: '正在保存设置，完成前无法切换分区或离开本页。',
  reading: '正在读取设置…',
  retry: '重试',

  retentionHeading: '文章',
  retentionDescription:
    '每个订阅源最多保留最近的文章，超出数量的旧文章会自动清理。默认保留 100 篇。',
  retentionFieldLabel: '每个订阅源保留文章数',
  retentionFieldHint: '请输入正整数。',
  retentionSubmit: '保存文章设置',
  retentionSubmitPending: '保存中…',
  retentionSaved: '文章保留数量已保存',

  fetcherHeading: '提取',
  fetcherDescription:
    'Jina 会把文章地址发送给 Jina 并消耗额度，未保存 Key 时使用匿名访问；服务器提取服务使用你填写的浏览器服务地址。',
  fetcherSubmit: '保存提取设置',
  fetcherSubmitPending: '保存中…',
  fetcherSaved: '提取设置已保存',
  providerLabel: '提取方式',
  providerJina: 'Jina（可匿名使用）',
  providerBrowser: '服务器提取服务',
  jinaKeyLabel: 'Jina API Key',
  jinaKeyStoredHint: '已保存 Key，留空保持不变。',
  jinaKeyAnonymousHint: '留空则使用 Jina 匿名访问。',
  endpointLabel: '浏览器服务地址',
  endpointStoredHint: '已保存地址，留空保持不变。',
  endpointProtocolsHint: '支持 http、https、ws 或 wss。',
  clearKeyText: '删除已保存的 Jina Key 后，Jina 提取使用匿名访问。',
  clearKeyButton: '删除 Key',
  clearKeyConfirmation:
    '删除已保存的 Jina Key？删除后 Jina 提取将使用匿名访问。',
  keyCleared: 'Jina Key 已删除',

  sectionSwitchConfirmation:
    '当前分区有未保存的修改，切换后将被丢弃。确定继续吗？',
  leaveConfirmation: '有未保存的修改，确定离开设置页吗？',

  configured: '已保存',
  notConfigured: '未保存',
} as const;

const storedWord = (stored: boolean): string =>
  stored ? settingMessages.configured : settingMessages.notConfigured;

/**
 * The configuration line of the `提取` section: each half says whether that value
 * is stored and never shows it (SET-VAL-4).
 */
export const configurationLine = (stored: {
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
}): string =>
  `Jina Key：${storedWord(stored.jinaKeyConfigured)} · 浏览器服务地址：${storedWord(stored.browserEndpointConfigured)}`;
