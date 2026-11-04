import type { Article } from './library-schema';

export type ArticlePage = {
  readonly items: readonly Article[];
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
