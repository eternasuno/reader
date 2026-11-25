package epub

import (
	"compress/flate"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"reader/internal/domain"
)

const measureUpperBoundIndex = 987654

// PrepareSpoolDir ensures the instance spool directory exists with 0700
// permissions and removes any leftover files from an unclean shutdown.
func PrepareSpoolDir(dir string) error {
	cleanDir, err := ensurePrivateSpoolDir(dir)
	if err != nil {
		return err
	}

	root, err := os.OpenRoot(cleanDir)
	if err != nil {
		return fmt.Errorf("open epub spool dir: %s", domain.SanitizeErrorText(err.Error()))
	}

	defer func() { _ = root.Close() }()

	entries, err := readRootDir(root)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if err := root.RemoveAll(entry.Name()); err != nil {
			return fmt.Errorf("clean epub spool dir: %s", domain.SanitizeErrorText(err.Error()))
		}
	}

	return nil
}

func ensurePrivateSpoolDir(dir string) (string, error) {
	if dir == "" {
		return "", fmt.Errorf("create epub spool dir: empty path")
	}

	cleanDir := filepath.Clean(dir)
	if info, err := os.Lstat(cleanDir); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("open epub spool dir: symlink not allowed")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("stat epub spool dir: %s", domain.SanitizeErrorText(err.Error()))
	}

	if err := os.MkdirAll(cleanDir, 0o700); err != nil {
		return "", fmt.Errorf("create epub spool dir: %s", domain.SanitizeErrorText(err.Error()))
	}

	if err := os.Chmod(cleanDir, 0o700); err != nil { //nolint:gosec // G302: spool directory requires owner execute bit (0700)
		return "", fmt.Errorf("chmod epub spool dir: %s", domain.SanitizeErrorText(err.Error()))
	}

	return cleanDir, nil
}

func readRootDir(root *os.Root) ([]os.DirEntry, error) {
	dirFile, err := root.Open(".")
	if err != nil {
		return nil, fmt.Errorf("open epub spool dir: %s", domain.SanitizeErrorText(err.Error()))
	}

	defer func() { _ = dirFile.Close() }()

	entries, err := dirFile.ReadDir(-1)
	if err != nil {
		return nil, fmt.Errorf("read epub spool dir: %s", domain.SanitizeErrorText(err.Error()))
	}

	return entries, nil
}

type packer struct {
	builder           *Builder
	dateStr           string
	measureTitle      string
	imageDeadline     time.Time
	totalSpooledBytes int64
	failedImages      map[string]struct{}
	current           *draftBook
	finished          []finishedBook
	finishedCalled    bool
	closed            bool
	measureCount      int
	flateWriter       *flate.Writer
	removeFile        func(string) error
}

type draftBook struct {
	identity           bookIdentity
	anchoredSize       int64
	spooledSinceAnchor int64
	navMetaSinceAnchor int64
	anchoredZip64      bool
	spoolPath          string
	spoolFile          *os.File
	spoolSize          int64
	entries            []spooledEntry
	chapters           []chapterMeta
	images             []imageManifestItem
	imgRewrites        map[string]string
	imageBytesUsed     int64
	savedPageIDs       []string
	feedItemIDs        []string
	articleCount       int
}

type finishedBook struct {
	identity     bookIdentity
	spoolPath    string
	consumed     bool
	entries      []spooledEntry
	chapters     []chapterMeta
	images       []imageManifestItem
	savedPageIDs []string
	feedItemIDs  []string
	articleCount int
}

type preparedCandidate struct {
	chapter chapterInput
	assets  map[string]preparedImage
}

type candidatePlan struct {
	chapter         chapterMeta
	newImages       []imageManifestItem
	newRewrites     map[string]string
	addedImgBytes   int64
	entries         []compressedEntry
	spooledZipBytes int64
	navMetaBytes    int64
}

func newPacker(builder *Builder, dateStr string) *packer {
	measureTitle, _ := domain.FormatKindleBookMeta(dateStr, measureUpperBoundIndex, measureUpperBoundIndex)

	return &packer{
		builder:       builder,
		dateStr:       dateStr,
		measureTitle:  measureTitle,
		failedImages:  make(map[string]struct{}),
		removeFile:    os.Remove,
		imageDeadline: time.Now().Add(builder.imagePrepTimeout),
	}
}

func (p *packer) AddArticle(ctx context.Context, article domain.KindleArticle) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	if p.closed || p.finishedCalled {
		return errors.New("epub packer is closed")
	}

	ch, err := newChapterInput(article)
	if err != nil {
		return err
	}

	cand := &preparedCandidate{
		chapter: ch,
		assets:  make(map[string]preparedImage),
	}

	return p.addCandidate(ctx, cand)
}

func (p *packer) addCandidate(ctx context.Context, cand *preparedCandidate) error {
	cur := p.ensureCurrentBook()

	fitted, measured, hadImages, err := p.tryAddToBook(ctx, cur, cand, false)
	if err != nil || fitted {
		return err
	}

	if len(cur.chapters) > 0 {
		cur, fitted, measured, hadImages, err = p.rolloverAndRetry(ctx, cand)
		if err != nil || fitted {
			return err
		}
	}

	return p.retrySingleArticleTextOnly(ctx, cur, cand, measured, hadImages)
}

func (p *packer) rolloverAndRetry(ctx context.Context, cand *preparedCandidate) (*draftBook, bool, int64, bool, error) {
	if err := p.finalizeCurrentBook(); err != nil {
		return nil, false, 0, false, err
	}

	cur := p.ensureCurrentBook()
	fitted, measured, hadImages, err := p.tryAddToBook(ctx, cur, cand, false)

	return cur, fitted, measured, hadImages, err
}

func (p *packer) retrySingleArticleTextOnly(
	ctx context.Context,
	cur *draftBook,
	cand *preparedCandidate,
	measured int64,
	hadImages bool,
) error {
	articleID := cand.chapter.article.ID
	if !hadImages {
		return domain.OversizeKindleArticleError(articleID, int(measured), p.builder.maxEPUBBytes)
	}

	fitted, textBytes, _, err := p.tryAddToBook(ctx, cur, cand, true)
	if err != nil {
		return err
	}

	if fitted {
		return nil
	}

	return domain.OversizeKindleArticleError(articleID, int(textBytes), p.builder.maxEPUBBytes)
}

func (p *packer) tryAddToBook(
	ctx context.Context,
	book *draftBook,
	cand *preparedCandidate,
	textOnly bool,
) (bool, int64, bool, error) {
	if !textOnly {
		if err := p.prepareCandidateImages(ctx, book, cand); err != nil {
			return false, 0, false, err
		}
	}

	plan, hadImages, err := p.buildCandidatePlan(book, cand, textOnly)
	if errors.Is(err, errArchiveTooLarge) {
		return false, int64(p.builder.maxEPUBBytes) + 1, hadImages, nil
	}

	if err != nil {
		return false, 0, hadImages, err
	}

	fitted, measured, err := p.fitAndCommitPlan(ctx, book, cand.chapter.article, plan)

	return fitted, measured, hadImages, err
}

func (p *packer) fitAndCommitPlan(
	ctx context.Context,
	book *draftBook,
	article domain.KindleArticle,
	plan *candidatePlan,
) (bool, int64, error) {
	maxBytes := int64(p.builder.maxEPUBBytes)
	if err := p.ensureBookBaseSize(ctx, book, maxBytes); err != nil {
		return false, 0, err
	}

	estimate := p.estimateBookSize(book, plan)
	if estimate <= maxBytes-measurementMargin(maxBytes) {
		if err := p.commitCandidate(book, article, plan, 0); err != nil {
			return false, 0, err
		}

		return true, estimate, nil
	}

	measured, err := p.measureCandidate(ctx, book, plan, maxBytes)
	if errors.Is(err, errArchiveTooLarge) {
		return false, measured, nil
	}

	if err != nil {
		return false, 0, err
	}

	if err := p.commitCandidate(book, article, plan, measured); err != nil {
		return false, 0, err
	}

	return true, measured, nil
}

func (p *packer) estimateBookSize(book *draftBook, plan *candidatePlan) int64 {
	totalEntries := zipStaticEntryCount + len(book.entries) + len(plan.entries)

	return estimateArchiveUpperBound(
		book.anchoredSize,
		book.spooledSinceAnchor+plan.spooledZipBytes,
		book.navMetaSinceAnchor+plan.navMetaBytes,
		totalEntries,
		book.anchoredZip64,
	)
}

func (p *packer) measureCandidate(
	ctx context.Context,
	book *draftBook,
	plan *candidatePlan,
	maxBytes int64,
) (int64, error) {
	p.measureCount++

	added := make([]spooledEntry, len(plan.entries))
	for i, e := range plan.entries {
		added[i] = e.spooled
	}

	meta := archiveMeta{
		title:    p.measureTitle,
		identity: book.identity,
		chapters: append(append([]chapterMeta(nil), book.chapters...), plan.chapter),
		images:   append(append([]imageManifestItem(nil), book.images...), plan.newImages...),
	}

	return measureArchiveSize(ctx, meta, book.entries, added, maxBytes)
}

func (p *packer) prepareCandidateImages(ctx context.Context, book *draftBook, cand *preparedCandidate) error {
	remaining := p.builder.maxBookImageBytes - book.imageBytesUsed
	if remaining <= 0 {
		return ctx.Err()
	}

	needed := make([]string, 0, len(cand.chapter.imgURLs))
	for _, rawURL := range cand.chapter.imgURLs {
		if _, ok := book.imgRewrites[rawURL]; ok {
			continue
		}

		needed = append(needed, rawURL)
	}

	return p.builder.prepareChapterImages(ctx, p.imageDeadline, needed, remaining, p.failedImages, cand.assets)
}

func (p *packer) buildCandidatePlan(book *draftBook, cand *preparedCandidate, textOnly bool) (*candidatePlan, bool, error) {
	rewrites, newImgs, addedImgBytes := planChapterRewrites(book, cand, p.builder.maxBookImageBytes, textOnly)
	hadImages := len(newImgs) > 0
	maxBytes := int64(p.builder.maxEPUBBytes)

	chapterName := oebpsPrefix + chapterHref(len(book.chapters))
	chapterDoc, hasRemoteResources := renderChapter(cand.chapter, rewrites)
	chapterMetaItem := chapterMeta{
		title:              chapterTitle(cand.chapter.article),
		hasRemoteResources: hasRemoteResources,
	}

	chapterEntry, err := p.compressEntry(chapterName, chapterDoc, maxBytes)
	if err != nil {
		return nil, hadImages, err
	}

	entries := make([]compressedEntry, 0, 1+len(newImgs))
	entries = append(entries, chapterEntry)

	manifest := make([]imageManifestItem, 0, len(newImgs))
	for _, img := range newImgs {
		imgEntry, err := p.compressEntry(imagesPrefix+img.fileName, img.asset.data, maxBytes)
		if err != nil {
			return nil, hadImages, err
		}

		entries = append(entries, imgEntry)
		manifest = append(manifest, imageManifestItem{
			number:    img.number,
			fileName:  img.fileName,
			mediaType: img.asset.format.mediaType,
		})
	}

	return assembleCandidatePlan(len(book.chapters), chapterMetaItem, rewrites, manifest, addedImgBytes, entries), hadImages, nil
}

func assembleCandidatePlan(
	chapterIndex int,
	chapter chapterMeta,
	rewrites map[string]string,
	manifest []imageManifestItem,
	addedImgBytes int64,
	entries []compressedEntry,
) *candidatePlan {
	var spooledZipBytes int64
	for _, e := range entries {
		spooledZipBytes += spooledEntryZipBytes(e.spooled)
	}

	return &candidatePlan{
		chapter:         chapter,
		newImages:       manifest,
		newRewrites:     rewrites,
		addedImgBytes:   addedImgBytes,
		entries:         entries,
		spooledZipBytes: spooledZipBytes,
		navMetaBytes:    chapterNavOpfUncompressedBytes(chapterIndex, chapter, manifest),
	}
}

type plannedImage struct {
	number   int
	fileName string
	asset    preparedImage
}

func planChapterRewrites(
	book *draftBook,
	cand *preparedCandidate,
	maxBookImageBytes int64,
	textOnly bool,
) (map[string]string, []plannedImage, int64) {
	if textOnly {
		return nil, nil, 0
	}

	rewrites := make(map[string]string, len(cand.chapter.imgURLs))
	newImgs := make([]plannedImage, 0)
	nextNum := len(book.images) + 1
	var addedBytes int64

	for _, rawURL := range cand.chapter.imgURLs {
		if existing, ok := book.imgRewrites[rawURL]; ok {
			rewrites[rawURL] = existing
			continue
		}

		asset, ok := cand.assets[rawURL]
		if !ok {
			continue
		}

		imgSize := int64(len(asset.data))
		if book.imageBytesUsed+addedBytes+imgSize > maxBookImageBytes {
			continue
		}

		fileName := fmt.Sprintf("img-%04d%s", nextNum, asset.format.ext)
		rewrites[rawURL] = "../images/" + fileName
		newImgs = append(newImgs, plannedImage{number: nextNum, fileName: fileName, asset: asset})
		nextNum++
		addedBytes += imgSize
	}

	return rewrites, newImgs, addedBytes
}

func (p *packer) commitCandidate(
	book *draftBook,
	article domain.KindleArticle,
	plan *candidatePlan,
	measuredAnchor int64,
) error {
	if err := p.appendSpooledEntries(book, plan.entries); err != nil {
		return err
	}

	book.chapters = append(book.chapters, plan.chapter)
	book.images = append(book.images, plan.newImages...)
	for rawURL, rewritten := range plan.newRewrites {
		book.imgRewrites[rawURL] = rewritten
	}

	book.imageBytesUsed += plan.addedImgBytes
	book.articleCount++

	if article.IsSavedPage {
		book.savedPageIDs = append(book.savedPageIDs, article.ID)
	} else {
		book.feedItemIDs = append(book.feedItemIDs, article.ID)
	}

	if measuredAnchor > 0 {
		book.anchoredSize = measuredAnchor
		book.spooledSinceAnchor = 0
		book.navMetaSinceAnchor = 0
		book.anchoredZip64 = zipStaticEntryCount+len(book.entries) >= zipMaxNonZip64Entries
	} else {
		book.spooledSinceAnchor += plan.spooledZipBytes
		book.navMetaSinceAnchor += plan.navMetaBytes
	}

	return nil
}

func (p *packer) appendSpooledEntries(book *draftBook, entries []compressedEntry) error {
	var addedBytes int64
	for _, entry := range entries {
		addedBytes += int64(len(entry.data))
	}

	if p.totalSpooledBytes+addedBytes > p.builder.maxJobSpoolBytes {
		return fmt.Errorf("kindle epub spool quota exceeded: %d byte limit", p.builder.maxJobSpoolBytes)
	}

	if err := p.ensureSpoolFile(book); err != nil {
		return err
	}

	for _, entry := range entries {
		if _, err := book.spoolFile.Write(entry.data); err != nil {
			return fmt.Errorf("write epub spool: %s", domain.SanitizeErrorText(err.Error()))
		}

		meta := entry.spooled
		meta.offset = book.spoolSize
		book.spoolSize += int64(len(entry.data))
		p.totalSpooledBytes += int64(len(entry.data))
		book.entries = append(book.entries, meta)
	}

	return nil
}

func (p *packer) compressEntry(name string, raw []byte, maxBytes int64) (compressedEntry, error) {
	if p.flateWriter == nil {
		fw, err := flate.NewWriter(io.Discard, flate.DefaultCompression)
		if err != nil {
			return compressedEntry{}, err
		}

		p.flateWriter = fw
	}

	return compressDeflateBoundedWith(p.flateWriter, name, raw, maxBytes)
}

func (p *packer) ensureCurrentBook() *draftBook {
	if p.current == nil {
		p.current = &draftBook{
			identity:    newBookIdentity(),
			imgRewrites: make(map[string]string),
		}
	}

	return p.current
}

func (p *packer) ensureBookBaseSize(ctx context.Context, book *draftBook, maxBytes int64) error {
	if book.anchoredSize > 0 {
		return nil
	}

	baseSize, err := measureArchiveSize(
		ctx,
		archiveMeta{title: p.measureTitle, identity: book.identity},
		nil,
		nil,
		maxBytes,
	)
	if err != nil && !errors.Is(err, errArchiveTooLarge) {
		return err
	}

	book.anchoredSize = baseSize
	book.anchoredZip64 = zipStaticEntryCount >= zipMaxNonZip64Entries

	return nil
}

func (p *packer) ensureSpoolFile(book *draftBook) error {
	if book.spoolFile != nil {
		return nil
	}

	file, err := os.CreateTemp(p.builder.spoolDir, "lantern-epub-*.spool")
	if err != nil {
		return fmt.Errorf("create epub spool: %s", domain.SanitizeErrorText(err.Error()))
	}

	book.spoolFile = file
	book.spoolPath = file.Name()

	return nil
}

func (p *packer) finalizeCurrentBook() error {
	if p.current == nil {
		return nil
	}

	cur := p.current
	if err := p.closeDraftSpool(cur); err != nil {
		return err
	}

	if cur.articleCount == 0 {
		if err := p.removeSpoolPath(cur.spoolPath); err != nil {
			return err
		}

		cur.spoolPath = ""
		p.current = nil

		return nil
	}

	p.current = nil
	p.finished = append(p.finished, finishedBook{
		identity:     cur.identity,
		spoolPath:    cur.spoolPath,
		entries:      cur.entries,
		chapters:     cur.chapters,
		images:       cur.images,
		savedPageIDs: cur.savedPageIDs,
		feedItemIDs:  cur.feedItemIDs,
		articleCount: cur.articleCount,
	})

	return nil
}

func (p *packer) closeDraftSpool(cur *draftBook) error {
	if cur.spoolFile == nil {
		return nil
	}

	if err := cur.spoolFile.Close(); err != nil {
		if p.removeSpoolPath(cur.spoolPath) == nil {
			cur.spoolPath = ""
		}

		return fmt.Errorf("close epub spool: %s", domain.SanitizeErrorText(err.Error()))
	}

	cur.spoolFile = nil

	return nil
}

func (p *packer) Finish(ctx context.Context) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}

	if p.closed {
		return 0, errors.New("epub packer is closed")
	}

	if !p.finishedCalled {
		if err := p.finalizeCurrentBook(); err != nil {
			return 0, err
		}

		p.finishedCalled = true
	}

	return len(p.finished), nil
}

func (p *packer) ReadBook(ctx context.Context, index int) (domain.EPUBBook, error) {
	if err := ctx.Err(); err != nil {
		return domain.EPUBBook{}, err
	}

	item, err := p.readyFinishedBook(index)
	if err != nil {
		return domain.EPUBBook{}, err
	}

	title, filename := domain.FormatKindleBookMeta(p.dateStr, index+1, len(p.finished))
	meta := archiveMeta{title: title, identity: item.identity, chapters: item.chapters, images: item.images}
	data, err := writeFinalArchive(ctx, meta, item.spoolPath, item.entries, int64(p.builder.maxEPUBBytes))
	removeErr := p.consumeFinishedBook(item)
	if err != nil {
		return domain.EPUBBook{}, err
	}

	if removeErr != nil {
		return domain.EPUBBook{}, removeErr
	}

	return domain.EPUBBook{
		Title:        title,
		Filename:     filename,
		Data:         data,
		SavedPageIDs: item.savedPageIDs,
		FeedItemIDs:  item.feedItemIDs,
		ArticleCount: item.articleCount,
	}, nil
}

func (p *packer) consumeFinishedBook(item *finishedBook) error {
	item.consumed = true
	item.entries = nil

	err := p.removeSpoolPath(item.spoolPath)
	if err == nil {
		item.spoolPath = ""
	}

	return err
}

func (p *packer) readyFinishedBook(index int) (*finishedBook, error) {
	if p.closed || !p.finishedCalled || index < 0 || index >= len(p.finished) {
		return nil, fmt.Errorf("invalid epub book index %d", index)
	}

	item := &p.finished[index]
	if item.consumed {
		return nil, fmt.Errorf("epub book %d already consumed", index)
	}

	return item, nil
}

func (p *packer) Close() error {
	p.closed = true

	var errs []error
	if err := p.closeCurrentSpool(); err != nil {
		errs = append(errs, err)
	}

	for i := range p.finished {
		if err := p.removeSpoolPath(p.finished[i].spoolPath); err != nil {
			errs = append(errs, err)
			continue
		}

		p.finished[i].spoolPath = ""
	}

	return errors.Join(errs...)
}

func (p *packer) closeCurrentSpool() error {
	if p.current == nil {
		return nil
	}

	var errs []error
	if p.current.spoolFile != nil {
		if err := p.current.spoolFile.Close(); err != nil {
			errs = append(errs, err)
		} else {
			p.current.spoolFile = nil
		}
	}

	if err := p.removeSpoolPath(p.current.spoolPath); err != nil {
		errs = append(errs, err)
	} else {
		p.current.spoolPath = ""
		if p.current.spoolFile == nil {
			p.current = nil
		}
	}

	return errors.Join(errs...)
}

func (p *packer) removeSpoolPath(path string) error {
	if path == "" {
		return nil
	}

	removeFn := p.removeFile
	if removeFn == nil {
		removeFn = os.Remove
	}

	if err := removeFn(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	return nil
}
