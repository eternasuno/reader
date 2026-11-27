package httpserver

import (
	"net/http"

	"reader/internal/domain"
)

type folderJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func toFolderJSON(folder domain.Folder) folderJSON {
	return folderJSON{ID: folder.ID, Name: folder.Name}
}

type folderRequest struct {
	Name string `json:"name"`
}

func (s *server) handleFolderList(w http.ResponseWriter, r *http.Request) {
	folders, err := s.cfg.Folders.List(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, listResponse[folderJSON]{Items: mapSlice(folders, toFolderJSON)})
}

func (s *server) handleFolderCreate(w http.ResponseWriter, r *http.Request) {
	var req folderRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	name, err := domain.ValidateFolderName(req.Name)
	if err != nil {
		writeError(w, err)

		return
	}

	created, err := s.cfg.Folders.Create(r.Context(), domain.NewID(), name)
	if err != nil {
		writeError(w, err)

		return
	}

	converted := toFolderJSON(created)

	writeJSON(w, http.StatusCreated, itemResponse[folderJSON]{Item: &converted})
}

func (s *server) handleFolderRename(w http.ResponseWriter, r *http.Request) {
	var req folderRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	name, err := domain.ValidateFolderName(req.Name)
	if err != nil {
		writeError(w, err)

		return
	}

	if err := s.cfg.Folders.Rename(r.Context(), r.PathValue("id"), name); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFolderDelete(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.Folders.Delete(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFolderMarkRead(w http.ResponseWriter, r *http.Request) {
	before, err := decodeReadAllBefore(w, r)
	if err != nil {
		writeError(w, err)

		return
	}

	if err := s.cfg.FeedItems.MarkFolderRead(r.Context(), r.PathValue("id"), before); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFolderItemSnapshot(w http.ResponseWriter, r *http.Request) {
	params, err := parseSnapshotParams(r)
	if err != nil {
		writeError(w, err)

		return
	}

	groups, err := s.cfg.FeedItems.SnapshotByFolder(r.Context(), r.PathValue("id"), params)
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, toFeedItemSnapshot(groups, params.Boundary))
}
