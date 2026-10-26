package mtpx

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestSpacePreflightWithAndWithoutOverallProgress(t *testing.T) {
	for _, overall := range []bool{true, false} {
		destination := t.TempDir()
		walk := func(source string, cb WalkCb) (int64, int64, error) {
			return 1, 0, cb(1, &FileInfo{Name: "large.bin", FullPath: source, Size: 401 << 30}, nil)
		}
		options := DownloadOptions{AvailableSpace: func(string) (uint64, error) { return 15 << 30, nil }}
		files, _, err := DownloadFilesWithOptions(nil, 1, []string{"/Camera/large.bin"}, destination, overall, func(*FileInfo, error) error { return nil }, func(*ProgressInfo, error) error { t.Fatal("transfer started before capacity check"); return nil }, walk, options)
		var space *InsufficientSpaceError
		if !errors.As(err, &space) || files != 0 {
			t.Fatalf("expected preflight rejection, got %v files=%d", err, files)
		}
		entries, _ := os.ReadDir(destination)
		if len(entries) != 0 {
			t.Fatal("preflight wrote files")
		}
	}
}

func TestAtomicDownloadsKeepOldBackupOnFailure(t *testing.T) {
	for _, kind := range []string{"cancel", "read-error", "short", "success"} {
		t.Run(kind, func(t *testing.T) {
			folder := t.TempDir()
			destination := filepath.Join(folder, "photo.jpg")
			os.WriteFile(destination, []byte("original backup"), 0600)
			cancelled := false
			options := DownloadOptions{Check: func() error {
				if cancelled {
					return ErrDownloadCancelled
				}
				return nil
			}, AvailableSpace: func(string) (uint64, error) { return 1 << 30, nil }}
			info := &FileInfo{Size: 4, ModTime: time.Now()}
			err := writeDownloadAtomically(info, destination, options, func(w io.Writer) error {
				if kind == "short" {
					_, err := w.Write([]byte("a"))
					return err
				}
				if _, err := w.Write([]byte("data")); err != nil {
					return err
				}
				if kind == "cancel" {
					cancelled = true
				}
				if kind == "read-error" {
					return syscall.ENOSPC
				}
				return nil
			})
			content, _ := os.ReadFile(destination)
			if kind == "success" {
				if err != nil || string(content) != "data" {
					t.Fatalf("success: %v %q", err, content)
				}
			} else {
				if err == nil || string(content) != "original backup" {
					t.Fatalf("backup damaged: %v %q", err, content)
				}
			}
			entries, _ := os.ReadDir(folder)
			if len(entries) != 1 {
				t.Fatal("partial file left behind")
			}
		})
	}
}

func TestFreeSpaceDropsDuringWrite(t *testing.T) {
	folder := t.TempDir()
	destination := filepath.Join(folder, "video.mp4")
	os.WriteFile(destination, []byte("original"), 0600)
	probes := 0
	options := DownloadOptions{AvailableSpace: func(string) (uint64, error) {
		probes++
		if probes > 1 {
			return 1 << 20, nil
		}
		return 1 << 30, nil
	}}
	err := writeDownloadAtomically(&FileInfo{Size: 12 << 20, ModTime: time.Now()}, destination, options, func(w io.Writer) error {
		chunk := bytes.Repeat([]byte{1}, 1<<20)
		for i := 0; i < 12; i++ {
			if _, err := w.Write(chunk); err != nil {
				return err
			}
		}
		return nil
	})
	var space *InsufficientSpaceError
	if !errors.As(err, &space) {
		t.Fatalf("low-space interruption missing: %v", err)
	}
	content, _ := os.ReadFile(destination)
	if string(content) != "original" {
		t.Fatal("old backup overwritten")
	}
	entries, _ := os.ReadDir(folder)
	if len(entries) != 1 {
		t.Fatal("temporary file leaked")
	}
}

func TestSpaceProbeFailureAndReserve(t *testing.T) {
	options := DownloadOptions{AvailableSpace: func(string) (uint64, error) { return downloadReserve, nil }}
	if err := options.checkSpace("/", 0); err != nil {
		t.Fatal(err)
	}
	if err := options.checkSpace("/", 1); err == nil {
		t.Fatal("safety reserve not protected")
	}
	options.AvailableSpace = func(string) (uint64, error) { return 0, syscall.EACCES }
	if err := options.checkSpace("/", 0); !errors.Is(err, syscall.EACCES) {
		t.Fatal("space query failure ignored")
	}
	if _, err := availableDownloadSpace(filepath.Join(t.TempDir(), "not-created", "nested")); err != nil {
		t.Fatal(err)
	}
}
