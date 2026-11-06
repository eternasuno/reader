import { Array as Arr, DateTime, Effect, Option, Order, pipe } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
  type ArticleId,
} from '../entity/article';
import type { FeedId, OwnerId } from '../entity/object-value';
import {
  type ArticleBoundary,
  ArticleRepository,
} from '../port/article-repository';
import { DocumentSantize } from '../port/document-santize';
import type { ParsedArticle } from '../port/feed-parser';
import { HtmlParser } from '../port/html-parser';
import { articleId } from './identity';

const FEED_INITIAL_IMPORT = 30;

const MAX_CONTENT_LENGTH = 100_000;

type Candidate = {
  readonly id: ArticleId;
  readonly publishedAt: DateTime.Utc;
  readonly existing: boolean;
  readonly order: number;
  readonly entry?: ParsedArticle;
};

type RetainedArticle = Candidate & {
  readonly entry: ParsedArticle;
};

const newCandidate = (
  ownerId: OwnerId,
  id: FeedId,
  entry: ParsedArticle,
  order: number
): Candidate => ({
  id: articleId({
    ownerId,
    feedId: Option.some(id),
    url: entry.url,
    title: entry.title,
    description: entry.description,
  }),
  publishedAt: entry.publishedAt,
  existing: false,
  order,
  entry,
});

const existingCandidate = (boundary: ArticleBoundary): Candidate => ({
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
  const seen = new Set<ArticleId>();

  return Arr.filter(candidates, (candidate) => {
    if (seen.has(candidate.id)) {
      return false;
    }
    seen.add(candidate.id);

    return true;
  });
};

export const initialSelection = (
  ownerId: OwnerId,
  id: FeedId,
  entries: ReadonlyArray<ParsedArticle>
) =>
  pipe(
    entries,
    Arr.map((entry, order) => newCandidate(ownerId, id, entry, order)),
    Arr.sort(candidateOrder),
    dedupeCandidates,
    Arr.take(FEED_INITIAL_IMPORT)
  );

export const refreshSelection = (
  ownerId: OwnerId,
  id: FeedId,
  inventory: ReadonlyArray<ArticleBoundary>,
  entries: ReadonlyArray<ParsedArticle>
) => {
  const known = new Set(inventory.map((boundary) => boundary.id));
  const fresh = pipe(
    entries,
    Arr.map((entry, order) => newCandidate(ownerId, id, entry, order)),
    Arr.sort(candidateOrder),
    dedupeCandidates,
    Arr.filter((candidate) => !known.has(candidate.id))
  );

  return pipe(
    [...inventory.map(existingCandidate), ...fresh],
    Arr.sort(candidateOrder)
  );
};

const isRetained = (candidate: Candidate): candidate is RetainedArticle =>
  !candidate.existing && candidate.entry !== undefined;

const sanitizeDocument = (document: Document) =>
  Effect.gen(function* () {
    const processor = yield* DocumentSantize;

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

const buildArticle = (
  ownerId: OwnerId,
  id: FeedId,
  candidate: RetainedArticle
) =>
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
      ownerId,
      feedId: Option.some(id),
      title: entry.title,
      publishedAt: candidate.publishedAt,
      read: false,
      url: entry.url,
      description,
      content,
      extractedContent: Option.none(),
    };
  });

export const importArticles = (
  ownerId: OwnerId,
  id: FeedId,
  candidates: ReadonlyArray<Candidate>
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
