import { MemorySavedPageRepositoryLive } from './memory-saved-page-repository';
import { savedPageRepositoryContract } from './saved-page-repository-contract';

savedPageRepositoryContract(
  'MemorySavedPageRepository',
  MemorySavedPageRepositoryLive
);
