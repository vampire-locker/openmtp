package main

import (
	"sync"
	"sync/atomic"

	mtpx "github.com/ganeshrvel/go-mtpx"
)

type downloadControl struct {
	id        string
	cancelled int32
}

func (c *downloadControl) check() error {
	if atomic.LoadInt32(&c.cancelled) != 0 {
		return mtpx.ErrDownloadCancelled
	}
	return nil
}

var downloadControls struct {
	sync.Mutex
	active  *downloadControl
	pending string
}

func beginDownload(id string) *downloadControl {
	downloadControls.Lock()
	defer downloadControls.Unlock()
	c := &downloadControl{id: id}
	if id != "" && downloadControls.pending == id {
		atomic.StoreInt32(&c.cancelled, 1)
	}
	downloadControls.pending = ""
	downloadControls.active = c
	return c
}
func endDownload(c *downloadControl) {
	downloadControls.Lock()
	defer downloadControls.Unlock()
	if downloadControls.active == c {
		downloadControls.active = nil
	}
}
func requestDownloadCancel(id string) {
	if id == "" || len(id) > 128 {
		return
	}
	downloadControls.Lock()
	defer downloadControls.Unlock()
	if c := downloadControls.active; c != nil && c.id == id {
		atomic.StoreInt32(&c.cancelled, 1)
	} else {
		downloadControls.pending = id
	}
}
func downloadCheckpoint() error {
	downloadControls.Lock()
	c := downloadControls.active
	downloadControls.Unlock()
	if c == nil {
		return nil
	}
	return c.check()
}
