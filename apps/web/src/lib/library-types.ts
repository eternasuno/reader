import type { Option } from 'effect';

export type Article = {
  readonly id: string;
  readonly feedId: Option.Option<string>;
  readonly url: Option.Option<string>;
  readonly title: string;
  readonly description: Option.Option<string>;
  readonly content: Option.Option<string>;
  readonly extractedContent: Option.Option<string>;
  readonly publishedAt: string;
  readonly read: boolean;
};

/**
 * Identifies an article on the server: saved pages are addressed by id alone,
 * feed items additionally by the feed they belong to.
 */
export type ArticleRef = {
  readonly id: string;
  readonly feedId: string | undefined;
};

export type ArticlePage = {
  readonly items: ReadonlyArray<Article>;
  readonly cursor: string | null;
  readonly boundary: string | null;
};

export type Filter = 'all' | 'unread' | 'read';

export type Scope =
  | { readonly kind: 'later' }
  | { readonly kind: 'feeds'; readonly feedId?: string };

export type Counts = {
  readonly later: number;
  readonly feeds: Readonly<Record<string, number>>;
  readonly feedsTotal: number;
};
