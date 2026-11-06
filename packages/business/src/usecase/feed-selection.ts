import { Array as Arr, DateTime, Effect, Option, Order, pipe } from 'effect';
import type { FeedId } from '../entity/feed/feed';
import type { FeedItemId } from '../entity/feed/feed-item';
import {
  ArticleContent,
  ArticleDescription,
} from '../entity/object-value/article';
import { DocumentSanitizer } from '../port/document-sanitizer';
import {
  type FeedItemBoundary,
  FeedItemRepository,
} from '../port/feed-item-repository';
import type { ParsedFeedItem } from '../port/feed-parser';
import { HtmlParser } from '../port/html-parser';
import { feedItemId } from './identity';

const FEED_INITIAL_IMPORT = 30;

const MAX_CONTENT_LENGTH = 100_000;

type Candidate = {
  readonly id: FeedItemId;
  readonly publishedAt: DateTime.Utc;
  readonly existing: boolean;
  readonly order: number;
  readonly entry?: ParsedFeedItem;
};

type RetainedCandidate = Candidate & {
  readonly entry: ParsedFeedItem;
};

const newCandidate = (
  feedId: FeedId,
  entry: ParsedFeedItem,
  order: number
): Candidate => ({
  id: feedItemId({
    feedId,
    url: entry.url,
    title: entry.title,
    description: entry.description,
  }),
  publishedAt: entry.publishedAt,
  existing: false,
  order,
  entry,
});

const existingCandidate = (boundary: FeedItemBoundary): Candidate => ({
  id: boundary.id,
  publishedAt: boundary.publishedAt,
  existing: true,
  order: 0,
});

const descendingPublishedAt = Order.flip(
  Order.mapInput(Order.Number, (candidate: Candidate) =>
    DateTime.toEpochMillis(candidate.publishedAt)
  )
);

const tieBreak = (left: Candidate, right: Candidate): -1 | 0 | 1 => {
  if (left.existing !== right.existing) {
    return left.existing ? -1 : 1;
  }

  return left.existing
    ? Order.String(left.id, right.id)
    : Order.Number(left.order, right.order);
};

const compareCandidates = (left: Candidate, right: Candidate): -1 | 0 | 1 =>
  descendingPublishedAt(left, right) || tieBreak(left, right);

const candidateOrder = Order.make(compareCandidates);

const dedupeCandidates = (
  candidates: ReadonlyArray<Candidate>
): ReadonlyArray<Candidate> => {
  const seen = new Set<FeedItemId>();

  return Arr.filter(candidates, (candidate) => {
    if (seen.has(candidate.id)) {
      return false;
    }
    seen.add(candidate.id);

    return true;
  });
};

export const initialSelection = (
  feedId: FeedId,
  entries: ReadonlyArray<ParsedFeedItem>
) =>
  pipe(
    entries,
    Arr.map((entry, order) => newCandidate(feedId, entry, order)),
    Arr.sort(candidateOrder),
    dedupeCandidates,
    Arr.take(FEED_INITIAL_IMPORT)
  );

export const refreshSelection = (
  feedId: FeedId,
  inventory: ReadonlyArray<FeedItemBoundary>,
  entries: ReadonlyArray<ParsedFeedItem>
) => {
  const known = new Set(inventory.map((boundary) => boundary.id));
  const fresh = pipe(
    entries,
    Arr.map((entry, order) => newCandidate(feedId, entry, order)),
    Arr.sort(candidateOrder),
    dedupeCandidates,
    Arr.filter((candidate) => !known.has(candidate.id))
  );

  return pipe(
    [...inventory.map(existingCandidate), ...fresh],
    Arr.sort(candidateOrder)
  );
};

const isRetained = (candidate: Candidate): candidate is RetainedCandidate =>
  !candidate.existing && candidate.entry !== undefined;

const sanitizeDocument = (document: Document) =>
  Effect.gen(function* () {
    const processor = yield* DocumentSanitizer;

    return yield* processor.sanitize(document);
  });

const processHtml = (value: Option.Option<string>, url: Option.Option<URL>) =>
  Option.match(value, {
    onNone: () => Effect.succeed(Option.none()),
    onSome: (html) =>
      Effect.gen(function* () {
        const parser = yield* HtmlParser;
        const document = yield* parser.parse(
          html.slice(0, MAX_CONTENT_LENGTH),
          Option.getOrUndefined(url)
        );

        return yield* sanitizeDocument(document);
      }).pipe(Effect.scoped),
  });

const buildFeedItem = (feedId: FeedId, candidate: RetainedCandidate) =>
  Effect.gen(function* () {
    const { entry } = candidate;
    const description = Option.map(
      yield* processHtml(entry.description, entry.url),
      (html) => ArticleDescription.make(html)
    );
    const content = Option.map(
      yield* processHtml(entry.content, entry.url),
      (html) => ArticleContent.make(html)
    );

    return {
      id: candidate.id,
      feedId,
      title: entry.title,
      publishedAt: candidate.publishedAt,
      read: false,
      url: entry.url,
      description,
      content,
      extractedContent: Option.none(),
    };
  });

export const importFeedItems = (
  feedId: FeedId,
  candidates: ReadonlyArray<Candidate>
) =>
  Effect.gen(function* () {
    const retained = candidates.filter(isRetained);
    if (retained.length === 0) {
      return;
    }

    const items = yield* Effect.forEach(retained, (candidate) =>
      buildFeedItem(feedId, candidate)
    );
    const feedItems = yield* FeedItemRepository;

    yield* feedItems.create(items);
  });
