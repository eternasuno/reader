import type {
  ExtractorProvider,
  Feed,
  FeedItem,
  FeedPreview,
  FeedUnreadCount,
  Folder,
  KindleLanguage,
  KindleSchedule,
  KindleSendRecord,
  KindleSends,
  KindleSettingsView,
  OPMLImportResult,
  Page,
  ReaderMode,
  SavedPage,
  SavedPageUnreadCount,
  Session,
  Settings,
  SMTPSecurity,
  SmtpSettingsView,
  SortOrder,
  UnreadCounts,
} from './types';
import { ApiError } from './types';
import { isServerHttpUrl } from './url';

type UnknownRecord = Record<string, unknown>;

export type TypeGuard<T> = (value: unknown) => value is T;

export type Decoder<T> = (payload: unknown, status: number) => T;

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isNonEmptyString = (value: unknown): value is string =>
  isString(value) && value.trim().length > 0;

const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Mirrors `domain.IsValidUUIDv7`: canonical lowercase RFC 4122 UUID, version 7, variant 8/9/a/b.
 * Pagination and count boundaries are server-minted UUIDv7 values.
 */
export const isUuidV7 = (value: unknown): value is string =>
  isString(value) && UUID_V7.test(value);

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const isNullableString = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || typeof value === 'string';

const isOptionalBoolean = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === 'boolean';

const isOptionalObject = <T>(
  value: unknown,
  guard: TypeGuard<T>
): value is T | undefined => value === undefined || guard(value);

const invalidResponse = (status: number): ApiError =>
  new ApiError('InvalidResponse', status);

export const decodeWith =
  <T>(guard: TypeGuard<T>): Decoder<T> =>
  (payload, status) => {
    if (!guard(payload)) {
      throw invalidResponse(status);
    }

    return payload;
  };

export const isArrayOf =
  <T>(guard: TypeGuard<T>): TypeGuard<Array<T>> =>
  (value): value is Array<T> =>
    Array.isArray(value) && value.every(guard);

export const decodeField =
  <T>(key: string, guard: TypeGuard<T>): Decoder<T> =>
  (payload, status) => {
    if (!isRecord(payload)) {
      throw invalidResponse(status);
    }

    const value = payload[key];
    if (!guard(value)) {
      throw invalidResponse(status);
    }

    return value;
  };

export const decodePage =
  <T>(guard: TypeGuard<T>): Decoder<Page<T>> =>
  (payload, status) => {
    if (!isRecord(payload) || !isArrayOf(guard)(payload.items)) {
      throw invalidResponse(status);
    }

    const cursor = payload.cursor;
    if (cursor !== null && !isString(cursor)) {
      throw invalidResponse(status);
    }

    const boundary = payload.boundary;
    if (!isUuidV7(boundary)) {
      throw invalidResponse(status);
    }

    return { items: payload.items, cursor, boundary };
  };

export const isNullable =
  <T>(guard: TypeGuard<T>): TypeGuard<T | null> =>
  (value): value is T | null =>
    value === null || guard(value);

export const isSession: TypeGuard<Session> = (value): value is Session =>
  isRecord(value) && isBoolean(value.authenticated);

export const isFolder: TypeGuard<Folder> = (value): value is Folder =>
  isRecord(value) && isString(value.id) && isString(value.name);

const isReaderMode = (value: unknown): value is ReaderMode =>
  value === 'default' || value === 'extracted';

const isSortOrder = (value: unknown): value is SortOrder =>
  value === 'newest' || value === 'oldest';

export const isFeed: TypeGuard<Feed> = (value): value is Feed =>
  isRecord(value) &&
  isString(value.id) &&
  isServerHttpUrl(value.url) &&
  isString(value.title) &&
  isNullableString(value.folderId) &&
  isOptionalString(value.updatedAt) &&
  isFiniteNumber(value.failureCount) &&
  isOptionalString(value.lastError) &&
  (value.siteUrl === undefined || isServerHttpUrl(value.siteUrl)) &&
  (value.iconUrl === undefined || isServerHttpUrl(value.iconUrl)) &&
  isReaderMode(value.readerMode) &&
  isSortOrder(value.order);

export const isFeedUnreadCount: TypeGuard<FeedUnreadCount> = (
  value
): value is FeedUnreadCount =>
  isRecord(value) && isString(value.feedId) && isFiniteNumber(value.count);

export const isUnreadCounts: TypeGuard<UnreadCounts> = (
  value
): value is UnreadCounts =>
  isRecord(value) &&
  isArrayOf(isFeedUnreadCount)(value.items) &&
  isUuidV7(value.boundary);

export const isSavedPageUnreadCount: TypeGuard<SavedPageUnreadCount> = (
  value
): value is SavedPageUnreadCount =>
  isRecord(value) && isFiniteNumber(value.count) && isUuidV7(value.boundary);

export const decodeUnreadCounts: Decoder<UnreadCounts> =
  decodeWith(isUnreadCounts);

export const decodeSavedPageUnreadCount: Decoder<SavedPageUnreadCount> =
  decodeWith(isSavedPageUnreadCount);

export const isFeedPreview: TypeGuard<FeedPreview> = (
  value
): value is FeedPreview =>
  isRecord(value) &&
  isServerHttpUrl(value.url) &&
  isString(value.title) &&
  isOptionalString(value.description) &&
  isArrayOf(isString)(value.titles);

export const isFeedItem: TypeGuard<FeedItem> = (value): value is FeedItem =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.feedId) &&
  isServerHttpUrl(value.url) &&
  isString(value.title) &&
  isOptionalString(value.description) &&
  isOptionalString(value.content) &&
  isOptionalString(value.extractedContent) &&
  isOptionalString(value.publishedAt) &&
  isBoolean(value.read);

export const isExtractedFeedItem: TypeGuard<FeedItem> = (
  value
): value is FeedItem =>
  isFeedItem(value) && isNonEmptyString(value.extractedContent);

export const isSavedPage: TypeGuard<SavedPage> = (value): value is SavedPage =>
  isRecord(value) &&
  isString(value.id) &&
  isServerHttpUrl(value.url) &&
  isString(value.title) &&
  isOptionalString(value.description) &&
  isString(value.content) &&
  isOptionalString(value.publishedAt) &&
  isBoolean(value.read);

export const isOPMLImportResult: TypeGuard<OPMLImportResult> = (
  value
): value is OPMLImportResult =>
  isRecord(value) &&
  isFiniteNumber(value.importedFeeds) &&
  isFiniteNumber(value.skippedFeeds) &&
  isFiniteNumber(value.createdFolders);

const isProvider = (value: unknown): value is ExtractorProvider =>
  value === 'direct' || value === 'jina' || value === 'browser';

const isSMTPSecurity = (value: unknown): value is SMTPSecurity =>
  value === 'tls' || value === 'starttls';

const isKindleLanguage = (value: unknown): value is KindleLanguage =>
  value === 'zh' || value === 'en' || value === 'ja';

const isSmtpSettingsView: TypeGuard<SmtpSettingsView> = (
  value
): value is SmtpSettingsView =>
  isRecord(value) &&
  isString(value.senderEmail) &&
  isString(value.host) &&
  isFiniteNumber(value.port) &&
  isSMTPSecurity(value.security) &&
  isOptionalString(value.user) &&
  isOptionalBoolean(value.passwordConfigured);

const isKindleSchedule: TypeGuard<KindleSchedule> = (
  value
): value is KindleSchedule =>
  isRecord(value) &&
  Number.isInteger(value.hour) &&
  Number.isInteger(value.minute) &&
  isString(value.timezone);

const isKindleSettingsView: TypeGuard<KindleSettingsView> = (
  value
): value is KindleSettingsView =>
  isRecord(value) &&
  isString(value.kindleEmail) &&
  isKindleLanguage(value.language) &&
  isOptionalObject(value.schedule, isKindleSchedule) &&
  isOptionalString(value.nextSendAt);

export const isSettings: TypeGuard<Settings> = (value): value is Settings =>
  isRecord(value) &&
  isFiniteNumber(value.retention) &&
  isProvider(value.provider) &&
  isBoolean(value.jinaKeyConfigured) &&
  isBoolean(value.browserEndpointConfigured) &&
  isOptionalObject(value.smtp, isSmtpSettingsView) &&
  isOptionalObject(value.kindle, isKindleSettingsView);

const isKindleTrigger = (
  value: unknown
): value is KindleSendRecord['trigger'] =>
  value === 'manual' || value === 'scheduled';

const isKindleStatus = (value: unknown): value is KindleSendRecord['status'] =>
  value === 'running' || value === 'succeeded' || value === 'failed';

const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const isRfc3339 = (value: unknown): value is string =>
  isString(value) && RFC3339.test(value) && Number.isFinite(Date.parse(value));

export const isKindleSendRecord: TypeGuard<KindleSendRecord> = (
  value
): value is KindleSendRecord =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isKindleTrigger(value.trigger) &&
  isKindleStatus(value.status) &&
  isFiniteNumber(value.articleCount) &&
  isFiniteNumber(value.bookCount) &&
  isOptionalString(value.error) &&
  isRfc3339(value.startedAt) &&
  (value.finishedAt === undefined || isRfc3339(value.finishedAt));

export const isKindleSends: TypeGuard<KindleSends> = (
  value
): value is KindleSends =>
  isRecord(value) &&
  isBoolean(value.running) &&
  isArrayOf(isKindleSendRecord)(value.items);
