import { DateTime } from 'effect';
import type { Feed } from '../../src/entity/feed/feed';
import { FeedTitle } from '../../src/entity/feed/feed';
import { alice, makeUniqueFeed } from '../support';

export const feedRow = (title = 'Feed', owner = alice): Feed =>
  makeUniqueFeed({ ownerId: owner, title: FeedTitle.make(title) });

export const updatedTime = (): DateTime.Utc =>
  DateTime.fromDateUnsafe(new Date('2026-01-01T00:00:00.000Z'));
