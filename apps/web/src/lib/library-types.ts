import type { Option } from 'effect';

export type Article = {
  readonly id: string;
  readonly feedId: Option.Option<string>;
  readonly url: Option.Option<string>;
  readonly title: string;
  readonly description: Option.Option<string>;
  readonly content: Option.Option<string>;
  readonly extractedContent: Option.Option<string>;
  readonly publishedAt: string | undefined;
  readonly read: boolean;
};

/**
 * Identifies an article on the server: saved pages are addressed by id alone,
 * feed items by the same id; `feedId` only picks which endpoint to call.
 */
export type ArticleRef = {
  readonly id: string;
  readonly feedId: string | undefined;
};

export type ArticlePage = {
  readonly items: ReadonlyArray<Article>;
  readonly cursor: string | null;
};

export type Scope =
  | { readonly kind: 'later' }
  | { readonly kind: 'feeds'; readonly feedId?: string }
  | { readonly kind: 'folder'; readonly folderId: string };

export type Counts = {
  readonly later: number;
  readonly feeds: Readonly<Record<string, number>>;
  readonly feedsTotal: number;
};
