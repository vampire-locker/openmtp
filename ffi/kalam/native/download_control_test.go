package main

import (
	"errors"
	mtpx "github.com/ganeshrvel/go-mtpx"
	"testing"
	"time"
)

func TestDownloadCancellationControl(t *testing.T) {
	requestDownloadCancel("queued")
	queued := beginDownload("queued")
	if !errors.Is(queued.check(), mtpx.ErrDownloadCancelled) {
		t.Fatal("early stop lost")
	}
	endDownload(queued)
	active := beginDownload("active")
	requestDownloadCancel("stale")
	if err := active.check(); err != nil {
		t.Fatal("stale stop cancelled current task")
	}
	lockMtp()
	done := make(chan struct{})
	go func() { requestDownloadCancel("active"); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancel waited for USB lock")
	}
	unlockMtp()
	if !errors.Is(active.check(), mtpx.ErrDownloadCancelled) {
		t.Fatal("active stop lost")
	}
	endDownload(active)
	fresh := beginDownload("fresh")
	if err := fresh.check(); err != nil {
		t.Fatal("new task inherited cancellation")
	}
	endDownload(fresh)
}
