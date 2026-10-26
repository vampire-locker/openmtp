package directory

import (
	"fmt"
	"path"

	mtpx "github.com/ganeshrvel/go-mtpx"
)

// DownloadWalker belongs to one transfer and one device session. It never
// retains object handles across transfers/reconnects. Each parent is listed once.
type DownloadWalker struct {
	read     func(string, uint32) ([]*mtpx.FileInfo, error)
	ignore   func(string) bool
	listings map[string][]*mtpx.FileInfo
	objects  map[string]*mtpx.FileInfo
}

func NewDownloadWalker(read func(string, uint32) ([]*mtpx.FileInfo, error), ignore func(string) bool) *DownloadWalker {
	return &DownloadWalker{read: read, ignore: ignore, listings: make(map[string][]*mtpx.FileInfo), objects: make(map[string]*mtpx.FileInfo)}
}

func (w *DownloadWalker) list(parent string) ([]*mtpx.FileInfo, error) {
	if entries, ok := w.listings[parent]; ok {
		return entries, nil
	}
	var handle uint32
	if info := w.objects[parent]; info != nil {
		handle = info.ObjectId
	}
	entries, err := w.read(parent, handle)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry == nil || entry.Name == "" || entry.Name == "." || entry.Name == ".." || path.Base(entry.Name) != entry.Name || entry.FullPath != path.Join(parent, entry.Name) {
			return nil, fmt.Errorf("invalid directory entry under %s", parent)
		}
		if _, duplicate := w.objects[entry.FullPath]; duplicate {
			return nil, fmt.Errorf("duplicate directory entry %s", entry.FullPath)
		}
		w.objects[entry.FullPath] = entry
	}
	w.listings[parent] = entries
	return entries, nil
}

func (w *DownloadWalker) Walk(source string, cb mtpx.WalkCb) (files, dirs int64, err error) {
	if !path.IsAbs(source) || path.Clean(source) != source {
		return 0, 0, fmt.Errorf("invalid download source: %s", source)
	}
	if _, ok := w.objects[source]; !ok {
		if _, err := w.list(path.Dir(source)); err != nil {
			return 0, 0, err
		}
	}
	info := w.objects[source]
	if info == nil {
		return 0, 0, fmt.Errorf("download source no longer exists: %s", source)
	}
	active := make(map[uint32]bool)
	var visit func(*mtpx.FileInfo) error
	visit = func(item *mtpx.FileInfo) error {
		if w.ignore(item.Name) {
			return nil
		}
		if err := cb(item.ObjectId, item, nil); err != nil {
			return err
		}
		if !item.IsDir {
			files++
			return nil
		}
		dirs++
		if active[item.ObjectId] {
			return fmt.Errorf("directory cycle at %s", item.FullPath)
		}
		active[item.ObjectId] = true
		defer delete(active, item.ObjectId)
		children, err := w.list(item.FullPath)
		if err != nil {
			return err
		}
		for _, child := range children {
			if err := visit(child); err != nil {
				return err
			}
		}
		return nil
	}
	err = visit(info)
	return files, dirs, err
}
