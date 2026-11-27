import type { zhErrors } from './zh-errors';

export const enErrors: typeof zhErrors = {
  Unauthorized: 'Your session has expired. Please sign in again.',
  Forbidden: 'Cross-site changes are not allowed.',
  InvalidCredentials: 'Incorrect password.',
  TooManyRequests: 'Too many requests. Please try again later.',
  RequestFailed: 'Something went wrong. Please try again later.',
  RequestTimeout: 'Request timed out. Please try again later.',
  InvalidResponse: 'The server returned an unrecognized response.',
  NetworkError:
    'Network connection failed. Check your connection and try again.',
  ArticleEmptyContent: 'Could not extract any article content.',
  WebpageFetcherError: 'Failed to fetch the webpage. Please try again later.',
  ArticleExtractorError:
    'Failed to extract the article. Please try again later.',
  InvalidPageUrl: 'Enter a valid http or https link.',
  SavedPageAlreadyExists: 'This article is already in Read Later.',
  SavedPageRepositoryError:
    'Read Later is temporarily unavailable. Please try again later.',
  FeedUrlInvalid: 'Enter a valid feed URL.',
  FetchFeedError: 'Could not fetch the feed. Please try again later.',
  FeedParserError:
    'Could not parse the feed. Check that the address is correct.',
  FeedAlreadyExists: 'This feed is already subscribed.',
  FeedItemNotFound: 'This article no longer exists or was deleted.',
  FeedRepositoryError:
    'Feeds are temporarily unavailable. Please try again later.',
  FeedItemRepositoryError:
    'Feed articles are temporarily unavailable. Please try again later.',
  InvalidOpml:
    'Could not parse the OPML file. Check that the format is correct.',
  InvalidFolderName: 'Enter a folder name.',
  FolderAlreadyExists: 'This folder name already exists.',
  FolderNotFound: 'This folder no longer exists or was deleted.',
  FolderRepositoryError:
    'Folders are temporarily unavailable. Please try again later.',
  InvalidRetention: 'Retention must be a positive integer.',
  InvalidBrowserlessSetting: 'Enter a valid Browserless URL.',
  InvalidSMTPSetting: 'Check the SMTP settings and try again.',
  SMTPNotConfigured: 'Configure SMTP under External services first.',
  InvalidKindleSetting: 'Check the Kindle settings and try again.',
  SettingRepositoryError:
    'Settings are temporarily unavailable. Please try again later.',
  KindleNotConfigured: 'Configure SMTP and your Kindle email address first.',
  KindleSendInProgress:
    'A send is already in progress. Please try again later.',
};
