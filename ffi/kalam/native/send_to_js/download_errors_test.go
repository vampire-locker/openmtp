package send_to_js

import (
	"fmt"
	mtpx "github.com/ganeshrvel/go-mtpx"
	"syscall"
	"testing"
)

func TestDownloadSafetyErrorTypes(t *testing.T) {
	cases := []struct {
		err  error
		want ErrorType
	}{
		{&mtpx.InsufficientSpaceError{Required: 401 << 30, Available: 15 << 30}, ErrorInsufficientLocalSpace},
		{fmt.Errorf("stopped: %w", mtpx.ErrDownloadCancelled), ErrorTransferCancelled},
		{&mtpx.IncompleteDownloadError{Err: mtpx.ErrDownloadCancelled}, ErrorTransferCancelled},
		{&mtpx.IncompleteDownloadError{Err: syscall.ENOSPC}, ErrorDownloadInterrupted},
	}
	for _, test := range cases {
		kind, message := processError(test.err)
		if kind != test.want || message == "" {
			t.Fatalf("%v => %s %q", test.err, kind, message)
		}
	}
}
