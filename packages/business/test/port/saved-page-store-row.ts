import type { OwnerId } from '../../src/entity/common/owner-id';
import type { SavedPage } from '../../src/entity/saved-page/saved-page';
import { alice, makeUniqueSavedPage } from '../support';

export const pageRow = (owner: OwnerId = alice): SavedPage =>
  makeUniqueSavedPage({ ownerId: owner });
