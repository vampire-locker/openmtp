package directory

import (
	"fmt"
	"strings"

	mtpx "github.com/ganeshrvel/go-mtpx"
)

func ReadObjects(handles []uint32, parent string, skipHidden bool, read func(uint32, string) (*mtpx.FileInfo, error)) ([]*mtpx.FileInfo, error) {
	files := make([]*mtpx.FileInfo, 0, len(handles))
	for _, handle := range handles {
		info, err := read(handle, parent)
		if err != nil {
			return nil, fmt.Errorf("directory metadata handle=%d: %w", handle, err)
		}
		if skipHidden && strings.HasPrefix(info.Name, ".") {
			continue
		}
		files = append(files, info)
	}
	return files, nil
}
