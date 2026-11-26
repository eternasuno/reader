package httpserver

import (
	"errors"
	"io"
	"mime"
	"mime/multipart"
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

	result, err := s.cfg.Feeds.ImportOPML(r.Context(), document, s.cfg.Now().UTC())
	if err != nil {
		writeError(w, err)

		return
	}

	s.cfg.Refresher.Wake()

	writeJSON(w, http.StatusOK, opmlImportResponse{
		ImportedFeeds:  result.ImportedFeeds,
		SkippedFeeds:   result.SkippedFeeds,
		CreatedFolders: result.CreatedFolders,
	})
}

func readOPMLUpload(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxOPMLUploadBytes)

	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
		return readBoundedOPML(r.Body)
	}

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
	header, err := selectOPMLFileHeader(r.MultipartForm.File)
	if err != nil {
		return nil, err
	}

	file, err := header.Open()
	if err != nil {
		return nil, domain.NewError(domain.ErrInvalidOpml, err)
	}

	return file, nil
}

func selectOPMLFileHeader(files map[string][]*multipart.FileHeader) (*multipart.FileHeader, error) {
	var selected *multipart.FileHeader
	for _, headers := range files {
		for _, header := range headers {
			if selected != nil {
				return nil, domain.NewError(domain.ErrInvalidOpml, errors.New("opml upload must contain a single file"))
			}

			selected = header
		}
	}

	if selected == nil {
		return nil, domain.NewError(domain.ErrInvalidOpml, errors.New("opml upload has no file part"))
	}

	return selected, nil
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
