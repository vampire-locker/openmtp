package main

import (
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/ganeshrvel/go-mtpfs/mtp"
	mtpx "github.com/ganeshrvel/go-mtpx"
	"kalam/directory"
)

// A measured 42k-file folder needed 53 seconds for a cold ObjectSize reply.
// This bounded timeout is scoped to directory enumeration, not transfers.
const directoryTimeout = 120000

func readDirectory(storageID uint32, fullPath string, skipHidden bool) ([]*mtpx.FileInfo, error) {
	return readDirectoryByHandle(storageID, fullPath, skipHidden, 0)
}

func readDirectoryByHandle(storageID uint32, fullPath string, skipHidden bool, handle uint32) ([]*mtpx.FileInfo, error) {
	started := time.Now()
	log.Printf("directory read path=%q storage=%d", fullPath, storageID)
	if err := verifyMtpSession(verifyMtpSessionMode{}); err != nil {
		return nil, err
	}
	dev := container.dev
	originalTimeout := dev.Timeout
	defer func() { dev.Timeout = originalTimeout }()
	dev.Timeout = directoryTimeout
	folder := &mtpx.FileInfo{ObjectId: handle, IsDir: true, FullPath: fullPath}
	if handle == 0 {
		var err error
		folder, err = mtpx.GetObjectFromPath(dev, storageID, fullPath)
		if err != nil {
			return nil, err
		}
	}
	if !folder.IsDir {
		return []*mtpx.FileInfo{folder}, nil
	}
	if folder.ObjectId != mtpx.ParentObjectId && directory.Supported(container.deviceInfo) {
		files, err := directory.List(dev, storageID, folder.ObjectId, fullPath, skipHidden)
		if err == nil {
			return files, nil
		}
		if !errors.Is(err, directory.ErrUnsupported) {
			return nil, err
		}
		log.Printf("directory bulk unavailable; using compatibility listing: %v", err)
	}
	// Older devices/root directories keep standard GetObjectHandles/GetObjectInfo.
	// A transport failure must abort: the upstream walker silently skips errors,
	// which can otherwise report an empty/partial directory after a disconnect.
	handles := mtp.Uint32Array{}
	phase := time.Now()
	if err := dev.GetObjectHandles(storageID, 0, folder.ObjectId, &handles); err != nil {
		return nil, fmt.Errorf("directory handles: %w", err)
	}
	log.Printf("directory handles duration=%s count=%d", time.Since(phase), len(handles.Values))
	dev.Timeout = originalTimeout
	files, err := directory.ReadObjects(handles.Values, fullPath, skipHidden, func(handle uint32, parent string) (*mtpx.FileInfo, error) {
		return mtpx.GetObjectFromObjectId(dev, handle, parent)
	})
	log.Printf("directory compatibility completed duration=%s entries=%d error=%v", time.Since(started), len(files), err)
	return files, err
}
