import { Data } from 'effect';
import type { SavedPageId } from '../entity/saved-page/saved-page';

export class DuplicateSavedPage extends Data.TaggedError('DuplicateSavedPage')<{
  readonly id: SavedPageId;
  readonly message: string;
}> {}
