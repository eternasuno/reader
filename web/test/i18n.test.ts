import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/types';
import type { Locale } from '../src/i18n';
import {
  formatRelativeTime,
  locale,
  setLocale,
  t,
  toggleLocale,
  translateErrorCode,
} from '../src/i18n';
import { enDict } from '../src/i18n/en';
import { zhDict } from '../src/i18n/zh';
import { errorText } from '../src/state/errorText';

/** Backend and client error codes that must stay translated. */
const ERROR_CODES = `Unauthorized Forbidden InvalidCredentials TooManyRequests
RequestFailed NetworkError RequestTimeout InvalidResponse ArticleEmptyContent WebpageFetcherError
ArticleExtractorError InvalidPageUrl SavedPageAlreadyExists
SavedPageRepositoryError FeedUrlInvalid FetchFeedError FeedParserError
FeedAlreadyExists FeedItemNotFound FeedRepositoryError FeedItemRepositoryError
InvalidOpml InvalidFolderName FolderAlreadyExists FolderNotFound
FolderRepositoryError InvalidRetention InvalidBrowserlessSetting
InvalidSMTPSetting SMTPNotConfigured InvalidKindleSetting SettingRepositoryError KindleNotConfigured
KindleSendInProgress`.split(/\s+/);

const NOW = 1_700_000_000_000;

const rel = (name: Locale, value: number, unit: Intl.RelativeTimeFormatUnit) =>
  new Intl.RelativeTimeFormat(name, { numeric: 'auto' }).format(value, unit);

const absDate = (name: Locale, timestamp: number): string =>
  new Intl.DateTimeFormat(name, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);

const RELATIVE_TIME_CASES: Array<[string, number, Locale, string]> = [
  ['past <1m zh-CN', -30_000, 'zh-CN', '刚刚'],
  ['past <1m en', -30_000, 'en', 'just now'],
  ['past 5m zh-CN', -300_000, 'zh-CN', rel('zh-CN', -5, 'minute')],
  ['past 2h en', -7_200_000, 'en', rel('en', -2, 'hour')],
  ['past 10d en', -864_000_000, 'en', rel('en', -10, 'day')],
  ['past 60d en', -60 * 86_400_000, 'en', absDate('en', NOW - 60 * 86_400_000)],
  ['future <1m zh-CN', 30_000, 'zh-CN', '刚刚'],
  ['future <1m en', 30_000, 'en', 'just now'],
  ['future 5m zh-CN', 300_000, 'zh-CN', rel('zh-CN', 5, 'minute')],
  ['future 5m en', 300_000, 'en', rel('en', 5, 'minute')],
  ['future 2h en', 7_200_000, 'en', rel('en', 2, 'hour')],
  ['future 10d en', 864_000_000, 'en', rel('en', 10, 'day')],
  [
    'future 60d en',
    60 * 86_400_000,
    'en',
    absDate('en', NOW + 60 * 86_400_000),
  ],
];

/** Loads a fresh copy of the i18n module so startup detection re-runs. */
const freshModule = async () => {
  vi.resetModules();
  return import('../src/i18n');
};

beforeEach(() => {
  localStorage.clear();
  setLocale('zh-CN');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('dictionaries', () => {
  it.each(['zh-CN', 'en'] as const)(
    'translates every error code in %s',
    (name) => {
      setLocale(name);
      const dict = name === 'zh-CN' ? zhDict : enDict;

      for (const code of ERROR_CODES) {
        const key = code as keyof typeof zhDict.errors;
        expect(dict.errors[key]).toBeTruthy();
        expect(translateErrorCode(code)).toBe(dict.errors[key]);
        if (code !== 'RequestFailed') {
          expect(dict.errors[key]).not.toBe(dict.errors.RequestFailed);
        }
      }
    }
  );

  it.each([
    ['zh-CN', 'RequestTimeout', '请求超时，请稍后重试'],
    ['zh-CN', 'InvalidResponse', '服务器返回了无法识别的响应'],
    ['en', 'RequestTimeout', 'Request timed out. Please try again later.'],
    ['en', 'InvalidResponse', 'The server returned an unrecognized response.'],
  ] as const)('translates %s %s', (name, code, message) => {
    setLocale(name);
    expect(errorText(new ApiError(code, 0))).toBe(message);
  });

  it('falls back to RequestFailed for unknown error codes', () => {
    expect(translateErrorCode('SomethingElse')).toBe('操作失败，请稍后重试');
  });
});

describe('locale switching', () => {
  it('defaults to Chinese and resolves templates', () => {
    expect(locale()).toBe('zh-CN');
    expect(t('errors.InvalidCredentials')).toBe('密码不正确');
    expect(t('feeds.opmlImportedToast', { imported: 3, skipped: 1 })).toBe(
      '已导入 3 个订阅源，跳过 1 个'
    );
  });

  it('switches reactively, persists it, and updates <html lang>', () => {
    setLocale('en');
    expect(locale()).toBe('en');
    expect(t('errors.InvalidCredentials')).toBe('Incorrect password.');
    expect(localStorage.getItem('reader.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    toggleLocale();
    expect(locale()).toBe('zh-CN');
    expect(localStorage.getItem('reader.locale')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});

describe('locale detection', () => {
  it('restores a persisted locale on a fresh module load', async () => {
    localStorage.setItem('reader.locale', 'en');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
    expect((await freshModule()).locale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('detects Chinese from navigator.language', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
    expect((await freshModule()).locale()).toBe('zh-CN');
  });

  it('falls back to navigator.language when window.localStorage throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
    try {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
      const mod = await freshModule();
      expect(mod.locale()).toBe('en');
      expect(() => mod.setLocale('zh-CN')).not.toThrow();
      expect(mod.locale()).toBe('zh-CN');
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });
});

describe('formatting', () => {
  it.each(RELATIVE_TIME_CASES)(
    'formats %s relative to now',
    (_, offsetMs, targetLocale, expected) => {
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
      const iso = new Date(NOW + offsetMs).toISOString();
      expect(formatRelativeTime(iso, targetLocale)).toBe(expected);
    }
  );

  it('ignores invalid dates', () => {
    expect(formatRelativeTime('not-a-date')).toBe('');
  });
});
