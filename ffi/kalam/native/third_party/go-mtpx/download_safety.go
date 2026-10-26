package mtpx

import (
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

const downloadReserve uint64 = 64 * 1024 * 1024

var ErrDownloadCancelled = errors.New("Download stopped by user")

type InsufficientSpaceError struct{ Required, Available uint64 }

func (e *InsufficientSpaceError) Error() string {
	return fmt.Sprintf("Not enough free space on the destination disk. Need %.2f GiB including a 64 MiB safety reserve; available %.2f GiB. Existing files are not deducted from this conservative estimate.", float64(e.Required)/(1<<30), float64(e.Available)/(1<<30))
}

type IncompleteDownloadError struct{ Err error }

func (e *IncompleteDownloadError) Error() string {
	return fmt.Sprintf("Download interrupted; the incomplete temporary file was removed: %v", e.Err)
}
func (e *IncompleteDownloadError) Unwrap() error { return e.Err }

type DownloadOptions struct {
	Check          func() error
	AvailableSpace func(string) (uint64, error)
}

func (o DownloadOptions) checkpoint() error {
	if o.Check != nil {
		return o.Check()
	}
	return nil
}
func (o DownloadOptions) checkSpace(target string, size int64) error {
	if size < 0 {
		return fmt.Errorf("invalid negative download size")
	}
	available := o.AvailableSpace
	if available == nil {
		available = availableDownloadSpace
	}
	free, err := available(target)
	if err != nil {
		return fmt.Errorf("cannot check destination free space: %w", err)
	}
	needed := uint64(size) + downloadReserve
	if needed > free {
		return &InsufficientSpaceError{Required: needed, Available: free}
	}
	return nil
}

// Statfs follows the actual destination volume, including mounted/symlinked
// directories. Walk to an existing ancestor if the target does not exist yet.
func availableDownloadSpace(target string) (uint64, error) {
	target = filepath.Clean(target)
	for {
		var info syscall.Statfs_t
		err := syscall.Statfs(target, &info)
		if err == nil {
			if info.Bsize <= 0 || uint64(info.Bavail) > math.MaxUint64/uint64(info.Bsize) {
				return 0, fmt.Errorf("invalid filesystem capacity")
			}
			return uint64(info.Bavail) * uint64(info.Bsize), nil
		}
		if !os.IsNotExist(err) {
			return 0, err
		}
		parent := filepath.Dir(target)
		if parent == target {
			return 0, err
		}
		target = parent
	}
}

type guardedDownloadWriter struct {
	file                           *os.File
	expected, written, lastChecked int64
	lastCheck                      time.Time
	options                        DownloadOptions
	err                            error
}

func (w *guardedDownloadWriter) Write(data []byte) (int, error) {
	if w.err != nil {
		return 0, w.err
	}
	if err := w.options.checkpoint(); err != nil {
		w.err = err
		return 0, err
	}
	if int64(len(data)) > w.expected-w.written {
		w.err = fmt.Errorf("source file grew during download")
		return 0, w.err
	}
	if w.written-w.lastChecked >= 8*1024*1024 || time.Since(w.lastCheck) >= time.Second {
		if err := w.options.checkSpace(w.file.Name(), w.expected-w.written); err != nil {
			w.err = err
			return 0, err
		}
		w.lastCheck = time.Now()
		w.lastChecked = w.written
	}
	n, err := w.file.Write(data)
	w.written += int64(n)
	if err != nil {
		w.err = err
	}
	return n, err
}

// Do not expose partial downloads or truncate an existing backup on failure.
// A completed file replaces its destination only after flush, close and size validation.
func writeDownloadAtomically(fi *FileInfo, destination string, options DownloadOptions, read func(io.Writer) error) error {
	if err := options.checkpoint(); err != nil {
		return err
	}
	if err := options.checkSpace(filepath.Dir(destination), fi.Size); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(destination), ".openmtp-*.part")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	defer f.Close()
	writer := &guardedDownloadWriter{file: f, expected: fi.Size, options: options, lastCheck: time.Now()}
	err = read(writer)
	if writer.err != nil {
		err = writer.err
	}
	if err == nil {
		err = options.checkpoint()
	}
	if err == nil && writer.written != fi.Size {
		err = fmt.Errorf("file size changed: expected %d bytes, received %d", fi.Size, writer.written)
	}
	if err != nil {
		return &IncompleteDownloadError{Err: err}
	}
	if err = f.Sync(); err != nil {
		return &IncompleteDownloadError{Err: err}
	}
	if err = f.Close(); err != nil {
		return &IncompleteDownloadError{Err: err}
	}
	if err = restoreLocalFileTimestamp(temp, fi.ModTime); err != nil {
		return err
	}
	if err = options.checkpoint(); err != nil {
		return err
	}
	return os.Rename(temp, destination)
}
