package domain

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"
)

type ErrorCode string

const (
	ErrUnauthorized             ErrorCode = "Unauthorized"
	ErrForbidden                ErrorCode = "Forbidden"
	ErrInvalidCredentials       ErrorCode = "InvalidCredentials"
	ErrTooManyRequests          ErrorCode = "TooManyRequests"
	ErrRequestFailed            ErrorCode = "RequestFailed"
	ErrArticleEmptyContent      ErrorCode = "ArticleEmptyContent"
	ErrWebpageFetcherError      ErrorCode = "WebpageFetcherError"
	ErrArticleExtractorError    ErrorCode = "ArticleExtractorError"
	ErrInvalidPageUrl           ErrorCode = "InvalidPageUrl"
	ErrSavedPageAlreadyExists   ErrorCode = "SavedPageAlreadyExists"
	ErrSavedPageRepositoryError ErrorCode = "SavedPageRepositoryError"
	ErrFeedUrlInvalid           ErrorCode = "FeedUrlInvalid"
	ErrFetchFeedError           ErrorCode = "FetchFeedError"
	ErrFeedParserError          ErrorCode = "FeedParserError"
	ErrFeedAlreadyExists        ErrorCode = "FeedAlreadyExists"
	ErrFeedItemNotFound         ErrorCode = "FeedItemNotFound"
	ErrFeedRepositoryError      ErrorCode = "FeedRepositoryError"
	ErrFeedItemRepositoryError  ErrorCode = "FeedItemRepositoryError"
	ErrInvalidOpml              ErrorCode = "InvalidOpml"
	ErrInvalidFolderName        ErrorCode = "InvalidFolderName"
	ErrFolderAlreadyExists      ErrorCode = "FolderAlreadyExists"
	ErrFolderNotFound           ErrorCode = "FolderNotFound"
	ErrFolderRepositoryError    ErrorCode = "FolderRepositoryError"
	ErrInvalidRetention         ErrorCode = "InvalidRetention"
	ErrInvalidProvider          ErrorCode = "InvalidProvider"
	ErrInvalidJinaKey           ErrorCode = "InvalidJinaKey"
	ErrInvalidEndpoint          ErrorCode = "InvalidEndpoint"
	ErrBrowserEndpointRequired  ErrorCode = "BrowserEndpointRequired"
	ErrInvalidSMTPSetting       ErrorCode = "InvalidSMTPSetting"
	ErrSMTPNotConfigured        ErrorCode = "SMTPNotConfigured"
	ErrInvalidKindleSetting     ErrorCode = "InvalidKindleSetting"
	ErrSettingRepositoryError   ErrorCode = "SettingRepositoryError"
	ErrKindleNotConfigured      ErrorCode = "KindleNotConfigured"
	ErrKindleSendInProgress     ErrorCode = "KindleSendInProgress"
)

type DomainError struct {
	Code  ErrorCode
	ID    string
	URL   string
	Cause error
}

func (e *DomainError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %s", e.Code, SanitizeErrorText(e.Cause.Error()))
	}

	return string(e.Code)
}

func (e *DomainError) Unwrap() error {
	return e.Cause
}

func NewError(code ErrorCode, cause error) *DomainError {
	return &DomainError{Code: code, Cause: cause}
}

func NewConflictURL(code ErrorCode, redactedURL string) *DomainError {
	return &DomainError{Code: code, URL: redactedURL}
}

func NewSavedPageConflict(id string, redactedURL string) *DomainError {
	return &DomainError{Code: ErrSavedPageAlreadyExists, ID: id, URL: redactedURL}
}

type NormalizedURL struct {
	raw      string
	redacted string
	host     string
	hasCreds bool
	username string
	password string
	hasPass  bool
}

func (u NormalizedURL) Raw() string {
	return u.raw
}

func (u NormalizedURL) RedactedString() string {
	return u.redacted
}

func (u NormalizedURL) Host() string {
	return u.host
}

func (u NormalizedURL) HasCredentials() bool {
	return u.hasCreds
}

func (u NormalizedURL) BasicAuth() (username string, password string, ok bool) {
	if !u.hasCreds {
		return "", "", false
	}

	return u.username, u.password, true
}

func (u NormalizedURL) Parsed() (*url.URL, error) {
	parsed, err := url.Parse(u.raw)
	if err != nil {
		return nil, errors.New(SanitizeErrorText(err.Error()))
	}

	return parsed, nil
}

type ReaderMode string

const (
	ReaderModeDefault   ReaderMode = "default"
	ReaderModeExtracted ReaderMode = "extracted"
	ReaderModeEmbedded  ReaderMode = "embedded"
)

type SortOrder string

const (
	SortOrderNewest SortOrder = "newest"
	SortOrderOldest SortOrder = "oldest"
)

type ExtractorProvider string

const (
	ProviderDirect  ExtractorProvider = "direct"
	ProviderJina    ExtractorProvider = "jina"
	ProviderBrowser ExtractorProvider = "browser"
)

type SMTPSecurity string

const (
	SMTPSecurityTLS      SMTPSecurity = "tls"
	SMTPSecuritySTARTTLS SMTPSecurity = "starttls"
)

type KindleTrigger string

const (
	KindleTriggerManual    KindleTrigger = "manual"
	KindleTriggerScheduled KindleTrigger = "scheduled"
)

type KindleStatus string

const (
	KindleStatusRunning   KindleStatus = "running"
	KindleStatusSucceeded KindleStatus = "succeeded"
	KindleStatusFailed    KindleStatus = "failed"
)

type PageParams struct {
	Limit  int
	Unread bool
	Order  SortOrder
	Cursor *string
}

type PageResult[T any] struct {
	Items  []T
	Cursor *string
}

type Folder struct {
	ID   string
	Name string
}

type Feed struct {
	ID           string
	URL          NormalizedURL
	Title        string
	FolderID     *string
	UpdatedAt    *time.Time
	FailureCount int
	LastError    *string
	ReaderMode   ReaderMode
	Order        SortOrder
}

type FeedUnreadCount struct {
	FeedID string
	Count  int
}

type FeedItem struct {
	ID               string
	FeedID           string
	URL              NormalizedURL
	Title            string
	Description      *string
	Content          *string
	ExtractedContent *string
	PublishedAt      *time.Time
	Read             bool
}

type StoredRef struct {
	ID  string
	URL NormalizedURL
}

type SavedPage struct {
	ID          string
	URL         NormalizedURL
	Title       string
	Description *string
	Content     string
	PublishedAt *time.Time
	Read        bool
}

type ExtractedArticle struct {
	Title       string
	Description *string
	Content     string
	PublishedAt *time.Time
}

type ParsedFeedEntry struct {
	URL         NormalizedURL
	Title       string
	Description *string
	Content     *string
	PublishedAt *time.Time
}

type ParsedFeed struct {
	Title       string
	Description *string
	Entries     []ParsedFeedEntry
}

type FeedPreview struct {
	URL         string
	Title       string
	Description *string
	Titles      []string
}

type OPMLFeedInput struct {
	URL        NormalizedURL
	Title      string
	FolderName *string
}

type OPMLExportFolder struct {
	Name  string
	Feeds []Feed
}

type OPMLDocument struct {
	Folders        []string
	Feeds          []OPMLFeedInput
	SkippedInvalid int
}

type OPMLImportResult struct {
	ImportedFeeds  int
	SkippedFeeds   int
	CreatedFolders int
}

type SMTPSettings struct {
	SenderEmail string
	Host        string
	Port        int
	Security    SMTPSecurity
	User        *string
	Password    *string // nil/blank on update = keep stored password
}

type KindleSettings struct {
	KindleEmail string
	SendTime    *string
	NextSendAt  *time.Time
}

type Settings struct {
	Retention       int
	Provider        ExtractorProvider
	JinaKey         *string
	BrowserEndpoint *string
	SMTP            *SMTPSettings   // nil unless sender_email, smtp_host, smtp_port, smtp_security all non-NULL
	Kindle          *KindleSettings // nil unless kindle_email non-NULL (independent of SMTP)
}

// KindleDelivery is the snapshot used by the Kindle worker and mail sender.
type KindleDelivery struct {
	SMTP        SMTPSettings
	KindleEmail string
}

// ClaimedKindleSend is the atomic result of claiming a manual or scheduled send.
type ClaimedKindleSend struct {
	Claimed  bool
	Record   KindleSendRecord
	Delivery KindleDelivery
}

type KindleSendRecord struct {
	ID           string
	Trigger      KindleTrigger
	Status       KindleStatus
	ArticleCount int
	BookCount    int
	Error        *string
	StartedAt    time.Time
	FinishedAt   *time.Time
}

type KindleArticle struct {
	ID          string
	IsSavedPage bool
	SourceTitle string
	URL         string
	Title       string
	HTMLBody    string
	PublishedAt *time.Time
}

type EPUBBook struct {
	Title        string
	Filename     string
	Data         []byte
	SavedPageIDs []string
	FeedItemIDs  []string
	ArticleCount int
}

type FolderRepository interface {
	List(ctx context.Context) ([]Folder, error)
	GetByID(ctx context.Context, id string) (*Folder, error)
	Create(ctx context.Context, id string, name string) (Folder, error)
	Rename(ctx context.Context, id string, name string) error
	Delete(ctx context.Context, id string) error
}

type FeedRepository interface {
	List(ctx context.Context) ([]Feed, error)
	GetByID(ctx context.Context, id string) (*Feed, error)
	GetByURL(ctx context.Context, url NormalizedURL) (*Feed, error)
	Create(ctx context.Context, feed Feed) (Feed, error)
	Delete(ctx context.Context, id string) error
	UpdateReaderMode(ctx context.Context, id string, mode ReaderMode) error
	UpdateOrder(ctx context.Context, id string, order SortOrder) error
	MoveToFolder(ctx context.Context, id string, folderID *string) error
	RecordRefreshFailure(ctx context.Context, id string, errSummary string) error
	ApplySync(ctx context.Context, feedID string, newTitle string, updatedAt time.Time, newItems []FeedItem, deleteIDs []string) error
	ImportOPML(ctx context.Context, doc OPMLDocument) (OPMLImportResult, []string, error)
	ExportOPML(ctx context.Context) ([]OPMLExportFolder, []Feed, error)
}

type FeedItemRepository interface {
	ListAll(ctx context.Context, params PageParams) (PageResult[FeedItem], error)
	ListByFeed(ctx context.Context, feedID string, params PageParams) (PageResult[FeedItem], error)
	ListByFolder(ctx context.Context, folderID string, params PageParams) (PageResult[FeedItem], error)
	ListStoredRefsByFeed(ctx context.Context, feedID string) ([]StoredRef, error)
	GetByID(ctx context.Context, id string) (*FeedItem, error)
	UnreadCounts(ctx context.Context) ([]FeedUnreadCount, error)
	SetRead(ctx context.Context, id string, read bool) error
	MarkIDsRead(ctx context.Context, ids []string) error
	MarkAllRead(ctx context.Context) error
	MarkFeedRead(ctx context.Context, feedID string) error
	MarkFolderRead(ctx context.Context, folderID string) error
	SaveExtractedContentIfEmpty(ctx context.Context, id string, content string) (*FeedItem, bool, error)
}

type SavedPageRepository interface {
	List(ctx context.Context, params PageParams) (PageResult[SavedPage], error)
	UnreadCount(ctx context.Context) (int, error)
	GetByID(ctx context.Context, id string) (*SavedPage, error)
	GetByURL(ctx context.Context, url NormalizedURL) (*SavedPage, error)
	Create(ctx context.Context, page SavedPage) (SavedPage, error)
	SetRead(ctx context.Context, id string, read bool) error
	MarkIDsRead(ctx context.Context, ids []string) error
	MarkAllRead(ctx context.Context) error
	Delete(ctx context.Context, id string) error
}

type SettingRepository interface {
	Get(ctx context.Context) (Settings, error)
	UpdateRetention(ctx context.Context, retention int) error
	UpdateProvider(ctx context.Context, provider ExtractorProvider) error
	UpdateJinaKey(ctx context.Context, key string) error
	DeleteJinaKey(ctx context.Context) error
	UpdateBrowserEndpoint(ctx context.Context, endpoint string) error
	DeleteBrowserEndpoint(ctx context.Context) error
	UpdateSMTP(ctx context.Context, smtp SMTPSettings) error
	DeleteSMTPPassword(ctx context.Context) error
	DeleteSMTP(ctx context.Context) error
	UpdateKindle(ctx context.Context, kindle KindleSettings) error
}

type KindleSendRepository interface {
	RecoverRunningOnStartup(ctx context.Context, now time.Time) error
	ListRecent(ctx context.Context) ([]KindleSendRecord, error)
	ClaimManualSend(ctx context.Context, sendID string, now time.Time) (ClaimedKindleSend, error)
	ClaimDueSend(ctx context.Context, sendID string, now time.Time, loc *time.Location, slotBusy bool) (ClaimedKindleSend, error)
	ListUnreadForKindle(ctx context.Context) ([]SavedPage, []Feed, map[string][]FeedItem, error)
	RecordBookAccepted(ctx context.Context, sendID string, savedPageIDs []string, feedItemIDs []string, articleDelta int) error
	CompleteSend(ctx context.Context, sendID string, status KindleStatus, errSummary *string, finishedAt time.Time) error
}

type FeedFetcher interface {
	FetchFeed(ctx context.Context, url NormalizedURL) (body []byte, finalURL string, err error)
}

type WebpageFetcher interface {
	FetchWebpage(ctx context.Context, url NormalizedURL) (htmlBody string, finalURL string, err error)
}

type ImageFetcher interface {
	FetchImage(ctx context.Context, rawURL string) (data []byte, mediaType string, ext string, err error)
}

type FeedParser interface {
	ParseFeed(body []byte, baseURL string) (ParsedFeed, error)
}

type ArticleExtractor interface {
	ExtractArticle(htmlBody string, pageURL string) (ExtractedArticle, error)
}

type HTMLSanitizer interface {
	SanitizeHTML(rawHTML string, baseURL string) (string, error)
}

type EPUBBuilder interface {
	BuildBooks(ctx context.Context, dateStr string, articles []KindleArticle) ([]EPUBBook, error)
}

type MailSender interface {
	SendEPUB(ctx context.Context, delivery KindleDelivery, book EPUBBook) error
}
