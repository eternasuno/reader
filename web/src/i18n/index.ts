import * as i18n from '@solid-primitives/i18n';
import { createMemo, createRoot, createSignal, flush } from 'solid-js';
// biome-ignore lint/style/noRestrictedImports: storage.ts is a dependency-free leaf helper
import { getItem, setItem } from '../state/storage';
import type { Dict } from './en';
import { enDict } from './en';
import { zhDict } from './zh';

export type { Dict } from './en';
export type Locale = 'zh-CN' | 'en';

const STORAGE_KEY = 'reader.locale';

const dicts: Record<Locale, Dict> = {
  'zh-CN': zhDict,
  en: enDict,
};

const isLocale = (value: string | null): value is Locale =>
  value === 'zh-CN' || value === 'en';

const detectLocale = (): Locale => {
  const stored = getItem(STORAGE_KEY);
  if (isLocale(stored)) return stored;

  const language = navigator.language ?? '';
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
};

const [locale, setLocaleSignal] = createSignal<Locale>(detectLocale());

const applyDocumentLang = (next: Locale) => {
  document.documentElement.lang = next;
};

applyDocumentLang(locale());

export { locale };

export const setLocale = (next: Locale) => {
  setLocaleSignal(next);
  applyDocumentLang(next);
  flush();

  setItem(STORAGE_KEY, next);
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

  return t('errors.RequestFailed');
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
  currentLocale: Locale,
  currentTime: number
): string => {
  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) return '';

  const elapsed = currentTime - timestamp;
  const absElapsed = Math.abs(elapsed);
  if (absElapsed < 60_000) return dicts[currentLocale].common.justNow;

  const sign = elapsed > 0 ? -1 : 1;
  const relative = new Intl.RelativeTimeFormat(currentLocale, {
    numeric: 'auto',
  });
  const minutes = Math.floor(absElapsed / 60_000);
  if (minutes < 60) return relative.format(sign * minutes, 'minute');

  const hours = Math.floor(absElapsed / 3_600_000);
  if (hours < 24) return relative.format(sign * hours, 'hour');

  const days = Math.floor(absElapsed / 86_400_000);
  if (days <= 30) return relative.format(sign * days, 'day');

  return new Intl.DateTimeFormat(currentLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
};
