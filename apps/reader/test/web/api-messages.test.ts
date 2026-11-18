import { describe, expect, it } from 'vitest';
import * as contractErrors from '../../src/contract/errors';
import { ApiFailure } from '../../src/web/api/failure';
import {
  apiMessages,
  messageOf,
  sessionMessages,
} from '../../src/web/api/messages';

/**
 * The one table from error tag to wording (reader-spec Shared messages and every
 * domain's Messages): iterating the contract's error classes means a new tag
 * without wording fails here.
 */

describe('the tag to wording table', () => {
  it('covers every contract error class', () => {
    expect(Object.keys(contractErrors).length).toBeGreaterThan(0);
    expect(Object.keys(apiMessages).sort()).toEqual(
      expect.arrayContaining(Object.keys(contractErrors))
    );
  });

  it('covers the middleware and transport tags', () => {
    expect(apiMessages.Unauthorized).toBe('登录状态已失效，请重新登录');
    expect(apiMessages.Forbidden).toBe('不允许跨站修改');
    expect(apiMessages.AuthUnavailable).toBe('登录服务暂时不可用，请稍后重试');
    expect(apiMessages.RequestFailed).toBe('请求失败，请稍后重试');
    expect(apiMessages.NetworkError).toBe('网络连接失败，请检查网络后重试');
    expect(apiMessages.InvalidResponse).toBe('响应数据格式不正确，请稍后重试');
  });

  it('writes the domain wordings once, in their domain', () => {
    expect(apiMessages.SavedPageAlreadyExists).toBe('该文章已在稍后阅读中');
    expect(apiMessages.FolderAlreadyExists).toBe('该目录名称已存在');
    expect(apiMessages.SettingRepositoryError).toBe(
      '暂时无法访问设置，请稍后重试'
    );
    expect(apiMessages.ArticleEmptyContent).toBe('未能提取到文章内容');
  });

  it('carries the Kindle wordings of settings.md and kindle.md', () => {
    expect(apiMessages.InvalidKindleSetting).toBe(
      'Kindle 发送设置有误，请检查填写内容'
    );
    expect(apiMessages.KindleNotConfigured).toBe('请先保存 Kindle 发送设置');
    expect(apiMessages.KindleSendInProgress).toBe('正在发送，请稍后再试');
    expect(apiMessages.MailSenderError).toBe('邮件发送失败，请检查 SMTP 设置');
    expect(apiMessages.EpubBuilderError).toBe('电子书生成失败，请稍后重试');
  });
});

describe('the wording of a failure', () => {
  it('reads the row of an ApiFailure tag', () => {
    expect(messageOf(new ApiFailure('InvalidPageUrl'))).toBe(
      '请输入有效的 http 或 https 链接'
    );
    expect(messageOf(new ApiFailure('Unauthorized'))).toBe(
      '登录状态已失效，请重新登录'
    );
  });

  it('falls back for a value without a known tag', () => {
    expect(messageOf(new Error('boom'))).toBe('操作失败，请稍后重试');
    expect(messageOf(undefined)).toBe('操作失败，请稍后重试');
  });

  it('has the session check texts of the guard', () => {
    expect(sessionMessages.checking).toBe('正在确认登录状态…');
    expect(sessionMessages.failed).toBe('暂时无法确认登录状态，请刷新重试。');
  });
});
