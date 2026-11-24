import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** Backend error codes that must stay translated (reader-spec API errors). */
const ERROR_CODES = `Unauthorized Forbidden InvalidCredentials TooManyRequests
RequestFailed NetworkError ArticleEmptyContent WebpageFetcherError
ArticleExtractorError InvalidPageUrl SavedPageAlreadyExists
SavedPageRepositoryError FeedUrlInvalid FetchFeedError FeedParserError
FeedAlreadyExists FeedItemNotFound FeedRepositoryError FeedItemRepositoryError
InvalidOpml InvalidFolderName FolderAlreadyExists FolderNotFound
FolderRepositoryError InvalidRetention InvalidEndpoint BrowserEndpointRequired
InvalidKindleSetting SettingRepositoryError KindleNotConfigured
KindleSendInProgress`.split(/\s+/);

const rel = (name: Locale, value: number, unit: Intl.RelativeTimeFormatUnit) =>
  new Intl.RelativeTimeFormat(name, { numeric: 'auto' }).format(value, unit);

const agoTime = (ms: number, name: Locale): string =>
  formatRelativeTime(new Date(Date.now() - ms).toISOString(), name);

const flattenKeys = (value: object, prefix = ''): Array<string> =>
  Object.entries(value).flatMap(([key, child]) => {
    const path = prefix.length > 0 ? `${prefix}.${key}` : key;
    const nested = child !== null && typeof child === 'object';
    return nested ? flattenKeys(child, path) : [path];
  });

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
  it('translates every backend error code in both locales', () => {
    for (const code of ERROR_CODES) {
      const key = code as keyof typeof zhDict.errors;
      expect(zhDict.errors[key]).toBeTruthy();
      expect(enDict.errors[key]).toBeTruthy();
      expect(translateErrorCode(code)).toBe(zhDict.errors[key]);
    }
  });

  it('mirrors Chinese keys in English and keeps the copy', () => {
    expect(flattenKeys(enDict).sort()).toEqual(flattenKeys(zhDict).sort());
    expect(zhDict.common.brand).toBe('Lantern');
    expect(zhDict.common.justNow).toBe('刚刚');
    expect(zhDict.library.laterScope).toBe('稍后阅读');
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
  it('formats relative times in both locales', () => {
    expect(agoTime(30_000, 'zh-CN')).toBe('刚刚');
    expect(agoTime(30_000, 'en')).toBe('just now');
    expect(agoTime(300_000, 'zh-CN')).toBe(rel('zh-CN', -5, 'minute'));
    expect(agoTime(7_200_000, 'en')).toBe(rel('en', -2, 'hour'));
    expect(agoTime(864_000_000, 'en')).toBe(rel('en', -10, 'day'));
  });

  it('formats old dates and ignores invalid input', () => {
    const old = Date.now() - 60 * 86_400_000;
    const iso = new Date(old).toISOString();
    const format = new Intl.DateTimeFormat('en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    expect(formatRelativeTime(iso, 'en')).toBe(format.format(old));
    expect(translateErrorCode('NetworkError')).toBe(
      '网络连接失败，请检查网络后重试'
    );
    expect(formatRelativeTime('not-a-date')).toBe('');
  });
});
