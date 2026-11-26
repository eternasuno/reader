package sqlite

import (
	"context"
	"slices"
	"testing"

	"reader/internal/domain"
)

func TestFolderRepoLifecycle(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Folders()

	created, err := repo.Create(ctx, domain.NewID(), "News")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}

	if created.Name != "News" {
		t.Fatalf("created folder name = %q, want %q", created.Name, "News")
	}

	if _, err := repo.Create(ctx, domain.NewID(), "News"); err == nil {
		t.Fatal("expected a duplicate folder name error")
	} else {
		requireCode(t, err, domain.ErrFolderAlreadyExists)
	}

	for _, name := range []string{"beta", "Alpha", "alpha"} {
		if _, err := repo.Create(ctx, domain.NewID(), name); err != nil {
			t.Fatalf("create folder %q: %v", name, err)
		}
	}

	folders, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("list folders: %v", err)
	}

	names := make([]string, len(folders))
	for i, folder := range folders {
		names[i] = folder.Name
	}

	if want := []string{"Alpha", "News", "alpha", "beta"}; !slices.Equal(names, want) {
		t.Fatalf("folder names = %v, want %v", names, want)
	}

	if !slices.Contains(folders, created) {
		t.Fatalf("folders = %+v, want %+v", folders, created)
	}
}

func TestFolderRepoRename(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Folders()

	first, err := repo.Create(ctx, domain.NewID(), "News")
	if err != nil {
		t.Fatalf("create first folder: %v", err)
	}

	second, err := repo.Create(ctx, domain.NewID(), "Tech")
	if err != nil {
		t.Fatalf("create second folder: %v", err)
	}

	if err := repo.Rename(ctx, first.ID, "News"); err != nil {
		t.Fatalf("rename to the current name: %v", err)
	}

	if err := repo.Rename(ctx, "missing", "Anything"); err == nil {
		t.Fatal("expected a missing folder error")
	} else {
		requireCode(t, err, domain.ErrFolderNotFound)
	}

	if err := repo.Rename(ctx, second.ID, "News"); err == nil {
		t.Fatal("expected a duplicate folder name error")
	} else {
		requireCode(t, err, domain.ErrFolderAlreadyExists)
	}

	if err := repo.Rename(ctx, second.ID, "Technology"); err != nil {
		t.Fatalf("rename folder: %v", err)
	}

	folders, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("list folders after rename: %v", err)
	}

	if !slices.Contains(folders, domain.Folder{ID: second.ID, Name: "Technology"}) {
		t.Fatalf("folders after rename = %+v, want Technology", folders)
	}
}

func TestFolderRepoDeleteKeepsFeedsAtTopLevel(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	folder := createFolder(t, store, "News")
	feed := createFeed(t, store, "Example", &folder.ID)
	items := addItems(t, store, feed, 2)

	if err := store.Folders().Delete(ctx, folder.ID); err != nil {
		t.Fatalf("delete folder: %v", err)
	}

	if err := store.Folders().Delete(ctx, folder.ID); err != nil {
		t.Fatalf("delete missing folder: %v", err)
	}

	folders, err := store.Folders().List(ctx)
	if err != nil {
		t.Fatalf("list folders after delete: %v", err)
	}

	if len(folders) != 0 {
		t.Fatalf("folders after delete = %+v, want empty", folders)
	}

	moved, err := store.Feeds().GetByID(ctx, feed.ID)
	if err != nil {
		t.Fatalf("get feed after folder delete: %v", err)
	}

	if moved == nil {
		t.Fatal("feed was deleted with its folder")
	}

	if moved.FolderID != nil {
		t.Fatalf("feed folder = %v, want nil", *moved.FolderID)
	}

	stored, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list feed items after folder delete: %v", err)
	}

	if len(stored.Items) != len(items) {
		t.Fatalf("feed items after folder delete = %d, want %d", len(stored.Items), len(items))
	}
}
