import { DateTime, Effect } from 'effect';
import type { ArticleId, FeedId, OwnerId } from '../entity/model';
import {
  type ContentProcessError,
  ContentProcessor,
} from '../port/content-processor';
import { type ArticleBoundary, Articles } from '../port/reader-store';
import type { SubscriptionEntry } from '../port/syndication';
import { articleId } from './identity';

export const SUBSCRIPTION_INITIAL_IMPORT = 30;

type Candidate = {
  readonly id: ArticleId;
  readonly publishedAtIso: string;
  readonly existing: boolean;
  readonly order: number;
  readonly entry?: SubscriptionEntry;
  readonly publishedAt?: DateTime.Utc;
};

type RetainedArticle = Candidate & {
  readonly entry: SubscriptionEntry;
  readonly publishedAt: DateTime.Utc;
};

const newCandidate = (
  ownerId: OwnerId,
  id: FeedId,
  entry: SubscriptionEntry,
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
  entries: readonly SubscriptionEntry[],
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
  entries: readonly SubscriptionEntry[],
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

const processOptional = (
  value: string | undefined,
  process: (value: string) => Effect.Effect<string, ContentProcessError>
) =>
  value === undefined
    ? Effect.succeed(undefined)
    : Effect.map(process(value), (processed) => processed || undefined);

const buildArticle = (
  ownerId: OwnerId,
  id: FeedId,
  candidate: RetainedArticle
) =>
  Effect.gen(function* () {
    const processor = yield* ContentProcessor;
    const { entry } = candidate;
    const description = yield* processOptional(entry.description, (value) =>
      processor.process(value, entry.descriptionText ?? false, entry.url)
    );
    const content = yield* processOptional(entry.content, (value) =>
      processor.process(value, entry.contentText ?? false, entry.url)
    );

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
    const articles = yield* Articles;

    yield* articles.create(ownerId, items);
  });
