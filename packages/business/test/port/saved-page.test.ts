import { savedPageRepositoryContract } from '../support/contract/saved-page';
import { memorySavedPageLayer } from '../support/memory/saved-page';

savedPageRepositoryContract(memorySavedPageLayer);
