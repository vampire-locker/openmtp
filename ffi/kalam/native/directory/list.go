package directory

import (
	"errors"
	"fmt"
	"log"
	"math"
	"path"
	"strings"
	"time"

	"github.com/ganeshrvel/go-mtpfs/mtp"
	mtpx "github.com/ganeshrvel/go-mtpx"
)

// ErrUnsupported permits a compatibility fallback only after a synchronized
// protocol rejection or a fully received, unusable property dataset.
var ErrUnsupported = errors.New("bulk directory properties unavailable")

type Device interface {
	GetData(*mtp.Container, interface{}) error
}

func Supported(info *mtp.DeviceInfo) bool {
	if info == nil {
		return false
	}
	for _, op := range info.OperationsSupported {
		if op == mtp.OC_MTP_GetObjPropList {
			return true
		}
	}
	return false
}

func List(dev Device, storageID, parent uint32, fullPath string, skipHidden bool) ([]*mtpx.FileInfo, error) {
	started := time.Now()
	datasets := make(map[uint16]*propertyList)
	// Avoid ALL properties: some Android devices advertise the operation but
	// reject ALL with Invalid_ObjectPropCode. These five suffice for the UI.
	for _, property := range []uint16{propertyParent, propertyName, propertyFormat, propertySize, propertyModified} {
		values := &propertyList{property: property}
		request := mtp.Container{Code: mtp.OC_MTP_GetObjPropList, Param: []uint32{parent, 0, uint32(property), 0, 1}}
		phase := time.Now()
		err := dev.GetData(&request, values)
		log.Printf("directory bulk property=%04x duration=%s objects=%d error=%v", property, time.Since(phase), len(values.values), err)
		if err != nil {
			// Only these capability errors are safe to retry using legacy reads.
			// USB timeouts close the transport; never continue on that dead session.
			var code mtp.RCError
			if errors.As(err, &code) {
				switch uint16(code) {
				case 0x2005, 0x2006, 0x201d, 0xa801, 0xa802, 0xa807, 0xa808, 0xa80a:
					return nil, fmt.Errorf("%w: %v", ErrUnsupported, err)
				}
			}
			return nil, fmt.Errorf("directory property %04x: %w", property, err)
		}
		datasets[property] = values
	}
	files, err := joinProperties(datasets, storageID, parent, fullPath, skipHidden)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnsupported, err)
	}
	log.Printf("directory bulk completed duration=%s entries=%d", time.Since(started), len(files))
	return files, nil
}

func joinProperties(data map[uint16]*propertyList, storageID, parent uint32, fullPath string, skipHidden bool) ([]*mtpx.FileInfo, error) {
	files := make([]*mtpx.FileInfo, 0, len(data[propertyParent].values))
	for _, handle := range data[propertyParent].handles {
		// Depth=1 may include the directory itself. Only return direct children.
		if handle == parent || data[propertyParent].values[handle].number != uint64(parent) {
			continue
		}
		for _, property := range []uint16{propertyName, propertyFormat, propertySize, propertyModified} {
			if _, ok := data[property].values[handle]; !ok {
				return nil, fmt.Errorf("missing property %04x for object %d", property, handle)
			}
		}
		name := data[propertyName].values[handle].text
		if name == "" || name == "." || name == ".." || strings.Contains(name, "/") {
			return nil, fmt.Errorf("invalid object filename for handle %d", handle)
		}
		if skipHidden && strings.HasPrefix(name, ".") {
			continue
		}
		format := uint16(data[propertyFormat].values[handle].number)
		isDir := format == mtp.OFC_Association
		size := data[propertySize].values[handle].number
		if isDir {
			size = 0
		}
		if size > math.MaxInt64 {
			return nil, fmt.Errorf("file size overflows int64 for handle %d", handle)
		}
		modified, err := parseDate(data[propertyModified].values[handle].text)
		if err != nil {
			return nil, fmt.Errorf("invalid modified date for handle %d: %w", handle, err)
		}
		info := &mtp.ObjectInfo{StorageID: storageID, ParentObject: parent, ObjectFormat: format, Filename: name, ModificationDate: modified}
		if size > math.MaxUint32 {
			info.CompressedSize = math.MaxUint32
		} else {
			info.CompressedSize = uint32(size)
		}
		files = append(files, &mtpx.FileInfo{ObjectId: handle, ParentId: parent, Name: name, IsDir: isDir, Size: int64(size), ModTime: modified, FullPath: path.Join(fullPath, name), ParentPath: fullPath, Extension: extension(name, isDir), Info: info})
	}
	return files, nil
}

func parseDate(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, nil
	}
	value = strings.TrimRight(strings.TrimRight(value, "."), "Z")
	for _, layout := range []string{"20060102T150405", "20060102T150405-0700"} {
		if result, err := time.Parse(layout, value); err == nil {
			return result, nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported MTP date")
}

func extension(name string, isDir bool) string {
	if isDir {
		return ""
	}
	parts := strings.Split(name, ".")
	if len(parts) > 2 && parts[len(parts)-2] == "tar" {
		return strings.Join(parts[len(parts)-2:], ".")
	}
	if len(parts) > 1 {
		return parts[len(parts)-1]
	}
	return ""
}
