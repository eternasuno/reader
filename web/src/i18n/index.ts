import * as i18n from '@solid-primitives/i18n';
import { createMemo, createRoot, createSignal, flush } from 'solid-js';
import type { Dict } from './en';
import { enDict } from './en';
import { zhDict } from './zh';

export type { Dict } from './en';
export type Locale = 'zh-CN' | 'en';
export type FlatDict = i18n.Flatten<Dict>;

const STORAGE_KEY = 'reader.locale';

const dicts: Record<Locale, Dict> = {
  'zh-CN': zhDict,
  en: enDict,
};

const isLocale = (value: string | null): value is Locale =>
  value === 'zh-CN' || value === 'en';

const detectLocale = (): Locale => {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  }

  const language =
    typeof navigator === 'undefined' ? '' : (navigator.language ?? '');
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
};

const [locale, setLocaleSignal] = createSignal<Locale>(detectLocale());

const applyDocumentLang = (next: Locale) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
  }
};

applyDocumentLang(locale());

export { locale };

export const setLocale = (next: Locale) => {
  if (!isLocale(next)) return;

  setLocaleSignal(next);
  applyDocumentLang(next);
  flush();

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, next);
  }
};

export const toggleLocale = () => {
  setLocale(locale() === 'zh-CN' ? 'en' : 'zh-CN');
};

const flatDict = createRoot(() =>
  createMemo(() => i18n.flatten(dicts[locale()]))
);

export const t = i18n.translator(flatDict, i18n.resolveTemplate);

const translate = t as (
  path: string,
  args?: Record<string, unknown>
) => unknown;

export const translateErrorCode = (code: string): string => {
  const message = translate(`errors.${code}`);
  if (typeof message === 'string' && message.length > 0) return message;

  return String(t('errors.RequestFailed'));
};

/** `RD-CONTENT-1`: localized absolute date and time, e.g. `2026年11月22日 14:01`. */
export const formatDateTime = (
  isoString: string,
  currentLocale: Locale = locale()
): string => {
  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) return '';

  return new Intl.DateTimeFormat(currentLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
};

export const formatRelativeTime = (
  isoString: string,
  currentLocale: Locale = locale()
): string => {
  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) return '';

  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return dicts[currentLocale].common.justNow;

  const relative = new Intl.RelativeTimeFormat(currentLocale, {
    numeric: 'auto',
  });
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return relative.format(-minutes, 'minute');

  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return relative.format(-hours, 'hour');

  const days = Math.floor(elapsed / 86_400_000);
  if (days <= 30) return relative.format(-days, 'day');

  return new Intl.DateTimeFormat(currentLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
};
