package httpserver

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"reader/internal/domain"
)

const (
	opmlContentType    = "text/x-opml+xml; charset=utf-8"
	opmlFilename       = "subscriptions.opml"
	maxOPMLUploadBytes = 10 << 20
)

type opmlImportResponse struct {
	ImportedFeeds  int `json:"importedFeeds"`
	SkippedFeeds   int `json:"skippedFeeds"`
	CreatedFolders int `json:"createdFolders"`
}

func (s *server) handleOPMLExport(w http.ResponseWriter, r *http.Request) {
	exportFolders, topFeeds, err := s.cfg.Feeds.ExportOPML(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	payload, err := domain.ExportOPML(exportFolders, topFeeds)
	if err != nil {
		writeError(w, err)

		return
	}

	w.Header().Set("Content-Type", opmlContentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+opmlFilename+`"`)
	w.WriteHeader(http.StatusOK)

	_, _ = w.Write(payload)
}

func (s *server) handleOPMLImport(w http.ResponseWriter, r *http.Request) {
	payload, err := readOPMLUpload(w, r)
	if err != nil {
		writeError(w, err)

		return
	}

	document, err := domain.ParseOPML(payload)
	if err != nil {
		writeError(w, err)

		return
	}

	result, newFeedIDs, err := s.cfg.Feeds.ImportOPML(r.Context(), document)
	if err != nil {
		writeError(w, err)

		return
	}

	if s.cfg.Refresher != nil && len(newFeedIDs) > 0 {
		s.cfg.Refresher.Enqueue(newFeedIDs...)
	}

	writeJSON(w, http.StatusOK, opmlImportResponse{
		ImportedFeeds:  result.ImportedFeeds,
		SkippedFeeds:   result.SkippedFeeds,
		CreatedFolders: result.CreatedFolders,
	})
}

func readOPMLUpload(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
		return readBoundedOPML(r.Body)
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxOPMLUploadBytes)
	if err := r.ParseMultipartForm(maxOPMLUploadBytes); err != nil {
		return nil, domain.NewError(domain.ErrInvalidOpml, err)
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	file, err := openOPMLMultipartFile(r)
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()

	return readBoundedOPML(file)
}

func openOPMLMultipartFile(r *http.Request) (io.ReadCloser, error) {
	if file, _, err := r.FormFile("file"); err == nil {
		return file, nil
	}

	for _, headers := range r.MultipartForm.File {
		if len(headers) == 0 {
			continue
		}

		file, err := headers[0].Open()
		if err != nil {
			return nil, domain.NewError(domain.ErrInvalidOpml, err)
		}

		return file, nil
	}

	return nil, domain.NewError(domain.ErrInvalidOpml, errors.New("opml upload has no file part"))
}

func readBoundedOPML(r io.Reader) ([]byte, error) {
	payload, err := io.ReadAll(io.LimitReader(r, maxOPMLUploadBytes+1))
	if err != nil {
		return nil, domain.NewError(domain.ErrInvalidOpml, err)
	}

	if len(payload) > maxOPMLUploadBytes {
		return nil, domain.NewError(domain.ErrInvalidOpml, nil)
	}

	return payload, nil
}
