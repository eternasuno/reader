/** A feed's stored starting view; the embedded webpage view is only ever temporary. */
export type ReaderMode = 'default' | 'extracted';
export type SortOrder = 'newest' | 'oldest';
export type SMTPSecurity = 'tls' | 'starttls';
type KindleTrigger = 'manual' | 'scheduled';
type KindleStatus = 'running' | 'succeeded' | 'failed';

export type RequestCallOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export interface ErrorResponse {
  error: string;
  url?: string;
  id?: string;
}

export interface Session {
  authenticated: boolean;
}

export interface Folder {
  id: string;
  name: string;
}

export interface Feed {
  id: string;
  url: string;
  title: string;
  folderId?: string | null;
  updatedAt?: string;
  failureCount: number;
  lastError?: string;
  siteUrl?: string;
  iconUrl?: string;
  readerMode: ReaderMode;
  order: SortOrder;
}

export interface FeedUnreadCount {
  feedId: string;
  count: number;
}

export interface UnreadCounts {
  items: Array<FeedUnreadCount>;
  boundary: string;
}

export interface SavedPageUnreadCount {
  count: number;
  boundary: string;
}

export interface FeedItem {
  id: string;
  feedId: string;
  url: string;
  title: string;
  description?: string;
  content?: string;
  extractedContent?: string;
  publishedAt?: string;
  read: boolean;
}

export interface SavedPage {
  id: string;
  url: string;
  title: string;
  description?: string;
  content: string;
  publishedAt?: string;
  read: boolean;
}

export interface FeedPreview {
  url: string;
  title: string;
  description?: string;
  titles: ReadonlyArray<string>;
}

export interface FeedItemGroup {
  feedId: string;
  ids: Array<string>;
}

export interface FeedItemOrder {
  boundary: string;
  groups: Array<FeedItemGroup>;
}

export interface SavedPageOrder {
  boundary: string;
  ids: Array<string>;
}

export type OrderParams = { unread?: boolean };

export interface FeedCreateInput {
  url: string;
  title?: string;
  folderId?: string | null;
}

export interface OPMLImportResult {
  importedFeeds: number;
  skippedFeeds: number;
  createdFolders: number;
}

export interface SmtpSettings {
  senderEmail: string;
  host: string;
  port: number;
  security: SMTPSecurity;
  user?: string;
}

export interface SmtpSettingsView extends SmtpSettings {
  passwordConfigured: boolean;
}

export interface SmtpSettingsInput extends SmtpSettings {
  password?: string;
}

export interface BrowserlessSettingsView {
  url: string;
  tokenConfigured: boolean;
  residentialProxy: boolean;
}

export interface BrowserlessSettingsInput {
  url: string;
  token?: string;
  residentialProxy: boolean;
}

export interface KindleSchedule {
  hour: number;
  minute: number;
  timezone: string;
}

/** `KD-BOOK-1`: the EPUB's primary language. */
export type KindleLanguage = 'zh' | 'en' | 'ja';

export interface KindleSettings {
  kindleEmail: string;
  language: KindleLanguage;
  schedule?: KindleSchedule;
}

export interface KindleSettingsView extends KindleSettings {
  nextSendAt?: string;
}

export interface Settings {
  retention: number;
  browserless?: BrowserlessSettingsView;
  smtp?: SmtpSettingsView;
  kindle?: KindleSettingsView;
}

export interface KindleSendRecord {
  id: string;
  trigger: KindleTrigger;
  status: KindleStatus;
  articleCount: number;
  bookCount: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface KindleSends {
  running: boolean;
  items: Array<KindleSendRecord>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly url?: string;
  readonly id?: string;

  constructor(code: string, status: number, url?: string, id?: string) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.url = url;
    this.id = id;
  }
}

export class RequestAbortedError extends Error {
  constructor(cause?: unknown) {
    super('The operation was aborted.');
    this.name = 'AbortError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: cause,
        configurable: true,
      });
    }
  }
}

export class RequestTimeoutError extends ApiError {
  constructor() {
    super('RequestTimeout', 0);
    this.name = 'RequestTimeoutError';
  }
}

export const errorCodeOf = (error: unknown): string =>
  error instanceof ApiError ? error.code : 'RequestFailed';
