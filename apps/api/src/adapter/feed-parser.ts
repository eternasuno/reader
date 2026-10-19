import { FeedParseError, FeedParser } from '@reader/business';
import { Effect, Layer } from 'effect';
import { parseFeed } from '../infrastructure/feed-parser';

export const FeedParserLive = Layer.succeed(FeedParser, {
  parse: (content, baseUrl) =>
    Effect.try({
      try: () => parseFeed(content, baseUrl),
      catch: () =>
        new FeedParseError({ error: '无法解析订阅源，格式无效或不受支持' }),
    }),
});
