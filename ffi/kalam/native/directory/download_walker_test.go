package directory

import (
	"errors"
	"fmt"
	"os"
	"path"
	"testing"
	"time"

	mtpx "github.com/ganeshrvel/go-mtpx"
)

func TestDownloadSelectionIndexesDirectoryOnce(t *testing.T) {
	for _, count := range []int{10000, 50000} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			entries := make([]*mtpx.FileInfo, count)
			for i := range entries {
				name := fmt.Sprintf("photo-%05d.jpg", i)
				entries[i] = &mtpx.FileInfo{Name: name, FullPath: path.Join("/DCIM/Camera", name), ObjectId: uint32(i + 10), Size: int64(i)}
			}
			reads := 0
			walker := NewDownloadWalker(func(parent string, handle uint32) ([]*mtpx.FileInfo, error) {
				reads++
				if parent != "/DCIM/Camera" {
					t.Fatalf("unexpected scan %s", parent)
				}
				return entries, nil
			}, func(string) bool { return false })
			visits := 0
			for _, file := range entries {
				files, dirs, err := walker.Walk(file.FullPath, func(id uint32, info *mtpx.FileInfo, err error) error {
					visits++
					if id != file.ObjectId || info.Size != file.Size {
						t.Fatal("wrong handle/metadata")
					}
					return err
				})
				if err != nil || files != 1 || dirs != 0 {
					t.Fatalf("walk %d %d %v", files, dirs, err)
				}
			}
			if reads != 1 || visits != count {
				t.Fatalf("reads=%d visits=%d", reads, visits)
			}
		})
	}
}

func TestDownloadNestedPathsUseKnownHandles(t *testing.T) {
	folder := &mtpx.FileInfo{Name: "Raw", FullPath: "/DCIM/Camera/Raw", ObjectId: 12, IsDir: true}
	hidden := &mtpx.FileInfo{Name: ".hidden", FullPath: folder.FullPath + "/.hidden", ObjectId: 13}
	ignored := &mtpx.FileInfo{Name: ".DS_Store", FullPath: folder.FullPath + "/.DS_Store", ObjectId: 14}
	reads := 0
	walker := NewDownloadWalker(func(parent string, handle uint32) ([]*mtpx.FileInfo, error) {
		reads++
		if parent == "/DCIM/Camera" {
			return []*mtpx.FileInfo{folder}, nil
		}
		if parent == folder.FullPath && handle == folder.ObjectId {
			return []*mtpx.FileInfo{hidden, ignored}, nil
		}
		t.Fatalf("unexpected path/handle %s %d", parent, handle)
		return nil, nil
	}, mtpx.IsDisallowedFile)
	var seen []uint32
	files, dirs, err := walker.Walk(folder.FullPath, func(id uint32, _ *mtpx.FileInfo, _ error) error { seen = append(seen, id); return nil })
	if err != nil || files != 1 || dirs != 1 || reads != 2 || len(seen) != 2 || seen[1] != 13 {
		t.Fatalf("unexpected recursive walk %v %d %d %d %v", err, files, dirs, reads, seen)
	}
	_, _, err = walker.Walk(hidden.FullPath, func(uint32, *mtpx.FileInfo, error) error { return nil })
	if err != nil || reads != 2 {
		t.Fatal("repeated parent lookup", err, reads)
	}
}

func TestDownloadFailuresAndTaskScope(t *testing.T) {
	failure := errors.New("disconnected")
	calls := 0
	read := func(string, uint32) ([]*mtpx.FileInfo, error) { calls++; return nil, failure }
	walker := NewDownloadWalker(read, func(string) bool { return false })
	if _, _, err := walker.Walk("/Camera/a", func(uint32, *mtpx.FileInfo, error) error { t.Fatal("callback on failed lookup"); return nil }); !errors.Is(err, failure) {
		t.Fatal(err)
	}
	for _, source := range []string{"../x", "/Camera/../x"} {
		if _, _, err := walker.Walk(source, nil); err == nil {
			t.Fatal("accepted unsafe path")
		}
	}
	// A new transfer must build a fresh index; no handles survive a reconnect.
	another := NewDownloadWalker(read, func(string) bool { return false })
	another.Walk("/Camera/a", nil)
	if calls != 2 {
		t.Fatal("cache crossed transfers")
	}
}

func TestInjectedTraversalKeepsUpstreamDirectoryWriter(t *testing.T) {
	for _, preprocess := range []bool{true, false} {
		destination := t.TempDir()
		visited := 0
		walk := func(source string, cb mtpx.WalkCb) (int64, int64, error) {
			visited++
			info := &mtpx.FileInfo{Name: "empty", FullPath: source, ObjectId: 12, IsDir: true, ModTime: time.Now()}
			return 0, 1, cb(info.ObjectId, info, nil)
		}
		// nil USB device proves no legacy per-source path lookup is performed.
		_, _, err := mtpx.DownloadFilesWithWalker(nil, 65537, []string{"/Camera/empty"}, destination, preprocess, func(*mtpx.FileInfo, error) error { return nil }, func(*mtpx.ProgressInfo, error) error { return nil }, walk)
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(path.Join(destination, "empty"))
		if err != nil || !info.IsDir() || visited != 1 {
			t.Fatalf("directory copy failed: %v visited=%d", err, visited)
		}
	}
}
