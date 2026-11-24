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

	created, err := repo.Create(ctx, domain.NewID(), "  News  ")
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

	if _, err := repo.Create(ctx, domain.NewID(), "   "); err == nil {
		t.Fatal("expected an invalid folder name error")
	} else {
		requireCode(t, err, domain.ErrInvalidFolderName)
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

	missing, err := repo.GetByID(ctx, "missing")
	if err != nil {
		t.Fatalf("get missing folder: %v", err)
	}

	if missing != nil {
		t.Fatalf("missing folder = %+v, want nil", missing)
	}

	fetched, err := repo.GetByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("get folder: %v", err)
	}

	if fetched == nil || fetched.Name != "News" {
		t.Fatalf("fetched folder = %+v, want News", fetched)
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

	if err := repo.Rename(ctx, first.ID, " News "); err != nil {
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

	if err := repo.Rename(ctx, second.ID, "  Technology  "); err != nil {
		t.Fatalf("rename folder: %v", err)
	}

	renamed, err := repo.GetByID(ctx, second.ID)
	if err != nil {
		t.Fatalf("get renamed folder: %v", err)
	}

	if renamed == nil || renamed.Name != "Technology" {
		t.Fatalf("renamed folder = %+v, want Technology", renamed)
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

	deleted, err := store.Folders().GetByID(ctx, folder.ID)
	if err != nil {
		t.Fatalf("get deleted folder: %v", err)
	}

	if deleted != nil {
		t.Fatalf("deleted folder = %+v, want nil", deleted)
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

	stored, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10})
	if err != nil {
		t.Fatalf("list feed items after folder delete: %v", err)
	}

	if len(stored.Items) != len(items) {
		t.Fatalf("feed items after folder delete = %d, want %d", len(stored.Items), len(items))
	}
}
