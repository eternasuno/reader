import { DateTime, Effect } from 'effect';
import type { ArticleId, FeedId, OwnerId } from '../entity/object-value';
import {
  type ArticleBoundary,
  ArticleRepository,
} from '../port/article-repository';
import { DocumentSantize } from '../port/document-santize';
import type { ParsedArticle } from '../port/feed-parser';
import { HtmlParser } from '../port/html-parser';
import { articleId } from './identity';

export const SUBSCRIPTION_INITIAL_IMPORT = 30;

const MAX_CONTENT_LENGTH = 100_000;

type Candidate = {
  readonly id: ArticleId;
  readonly publishedAtIso: string;
  readonly existing: boolean;
  readonly order: number;
  readonly entry?: ParsedArticle;
  readonly publishedAt?: DateTime.Utc;
};

type RetainedArticle = Candidate & {
  readonly entry: ParsedArticle;
  readonly publishedAt: DateTime.Utc;
};

const newCandidate = (
  ownerId: OwnerId,
  id: FeedId,
  entry: ParsedArticle,
  now: DateTime.Utc,
  order: number
): Candidate => {
  const publishedAt = entry.publishedAt ?? now;

  return {
    id: articleId(ownerId, id, entry.url, entry.title, entry.description),
    publishedAtIso: DateTime.formatIso(publishedAt),
    existing: false,
    order,
    entry,
    publishedAt,
  };
};

const existingCandidate = (boundary: ArticleBoundary): Candidate => ({
  id: boundary.id,
  publishedAtIso: boundary.publishedAt,
  existing: true,
  order: 0,
});

const compareText = (left: string, right: string) =>
  left === right ? 0 : Number(left > right) - Number(left < right);

const tieBreak = (left: Candidate, right: Candidate) => {
  if (left.existing !== right.existing) {
    return left.existing ? -1 : 1;
  }

  return left.existing
    ? compareText(left.id, right.id)
    : left.order - right.order;
};

const compareCandidates = (left: Candidate, right: Candidate) =>
  compareText(right.publishedAtIso, left.publishedAtIso) ||
  tieBreak(left, right);

export const initialSelection = (
  ownerId: OwnerId,
  id: FeedId,
  entries: readonly ParsedArticle[],
  now: DateTime.Utc
) => {
  const seen = new Set<ArticleId>();

  return entries
    .map((entry, order) => newCandidate(ownerId, id, entry, now, order))
    .toSorted(compareCandidates)
    .filter((candidate) => {
      if (seen.has(candidate.id)) {
        return false;
      }

      seen.add(candidate.id);

      return true;
    })
    .slice(0, SUBSCRIPTION_INITIAL_IMPORT);
};

export const refreshSelection = (
  ownerId: OwnerId,
  id: FeedId,
  inventory: readonly ArticleBoundary[],
  entries: readonly ParsedArticle[],
  now: DateTime.Utc
) => {
  const known = new Set(inventory.map((boundary) => boundary.id));
  const fresh = entries
    .map((entry, order) => newCandidate(ownerId, id, entry, now, order))
    .toSorted(compareCandidates)
    .filter((candidate) => {
      if (known.has(candidate.id)) {
        return false;
      }

      known.add(candidate.id);

      return true;
    });

  return [...inventory.map(existingCandidate), ...fresh].toSorted(
    compareCandidates
  );
};

const isRetained = (candidate: Candidate): candidate is RetainedArticle =>
  !candidate.existing &&
  candidate.entry !== undefined &&
  candidate.publishedAt !== undefined;

const sanitizeDocument = (document: Document) =>
  Effect.gen(function* () {
    const processor = yield* DocumentSantize;
    const processed = yield* processor.sanitize(document);

    return processed === '' ? undefined : processed;
  });

const processHtml = (value: string | undefined, url?: URL) =>
  Effect.gen(function* () {
    if (value === undefined) {
      return undefined;
    }

    const parser = yield* HtmlParser;
    const document = yield* parser.parse(
      value.slice(0, MAX_CONTENT_LENGTH),
      url
    );

    return yield* sanitizeDocument(document);
  }).pipe(Effect.scoped);

const buildArticle = (
  ownerId: OwnerId,
  id: FeedId,
  candidate: RetainedArticle
) =>
  Effect.gen(function* () {
    const { entry } = candidate;
    const description = yield* processHtml(entry.description, entry.url);
    const content = yield* processHtml(entry.content, entry.url);

    return {
      id: candidate.id,
      ownerId,
      feedId: id,
      title: entry.title,
      publishedAt: candidate.publishedAt,
      read: false,
      ...(entry.url === undefined ? {} : { url: entry.url }),
      ...(description === undefined ? {} : { description }),
      ...(content === undefined ? {} : { content }),
    };
  });

export const importArticles = (
  ownerId: OwnerId,
  id: FeedId,
  candidates: readonly Candidate[]
) =>
  Effect.gen(function* () {
    const retained = candidates.filter(isRetained);
    if (retained.length === 0) {
      return;
    }

    const items = yield* Effect.forEach(retained, (candidate) =>
      buildArticle(ownerId, id, candidate)
    );
    const articles = yield* ArticleRepository;

    yield* articles.create(ownerId, items);
  });
