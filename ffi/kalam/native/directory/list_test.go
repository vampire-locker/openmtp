package directory

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"

	"github.com/ganeshrvel/go-mtpfs/mtp"
	mtpx "github.com/ganeshrvel/go-mtpx"
)

type fakeDevice struct {
	count    int
	calls    int
	failure  error
	omitSize bool
}

func encodeProperty(buf *bytes.Buffer, property uint16, handle uint32, value propertyValue) {
	binary.Write(buf, binary.LittleEndian, handle)
	binary.Write(buf, binary.LittleEndian, property)
	switch property {
	case propertyName, propertyModified:
		binary.Write(buf, binary.LittleEndian, uint16(0xffff))
		units := append(utf16.Encode([]rune(value.text)), 0)
		binary.Write(buf, binary.LittleEndian, uint8(len(units)))
		binary.Write(buf, binary.LittleEndian, units)
	case propertyFormat:
		binary.Write(buf, binary.LittleEndian, uint16(4))
		binary.Write(buf, binary.LittleEndian, uint16(value.number))
	case propertyParent:
		binary.Write(buf, binary.LittleEndian, uint16(6))
		binary.Write(buf, binary.LittleEndian, uint32(value.number))
	case propertySize:
		binary.Write(buf, binary.LittleEndian, uint16(8))
		binary.Write(buf, binary.LittleEndian, value.number)
	}
}

func (d *fakeDevice) GetData(request *mtp.Container, target interface{}) error {
	d.calls++
	if d.failure != nil {
		return d.failure
	}
	if request.Code != mtp.OC_MTP_GetObjPropList || len(request.Param) != 5 || request.Param[4] != 1 || request.Param[2] == 0xffffffff {
		return fmt.Errorf("invalid request")
	}
	property := uint16(request.Param[2])
	count := d.count + 1
	if d.omitSize && property == propertySize {
		count--
	}
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(count))
	// Deliberately reverse property order to test joining by handle, not index.
	for i := count; i > 0; i-- {
		value := propertyValue{}
		switch property {
		case propertyParent:
			value.number = 1
			if i == 1 {
				value.number = 0
			}
		case propertyName:
			value.text = fmt.Sprintf("图片😀%d.jpg", i)
			if i == 2 {
				value.text = ".hidden"
			}
		case propertyFormat:
			value.number = 0x3801
		case propertySize:
			value.number = uint64(i) * 5 * 1024 * 1024 * 1024
		case propertyModified:
			value.text = "20261022T093000Z"
		}
		encodeProperty(&buf, property, uint32(i), value)
	}
	return target.(mtp.Decoder).Decode(&buf)
}

func TestBulkDirectories(t *testing.T) {
	for _, count := range []int{0, 7, 10000, 50000} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			dev := &fakeDevice{count: count}
			files, err := List(dev, 65537, 1, "/DCIM/Camera", false)
			if err != nil {
				t.Fatal(err)
			}
			if len(files) != count || dev.calls != 5 {
				t.Fatalf("files=%d requests=%d", len(files), dev.calls)
			}
			for _, file := range files {
				if file.ParentId != 1 || file.Size != int64(file.ObjectId)*5*1024*1024*1024 || file.ModTime.Year() != 2026 {
					t.Fatalf("metadata mismatch for %d", file.ObjectId)
				}
				if file.Info.CompressedSize != 0xffffffff || file.FullPath != "/DCIM/Camera/"+file.Name {
					t.Fatal("large size/path mismatch")
				}
			}
		})
	}
	files, err := List(&fakeDevice{count: 7}, 65537, 1, "/DCIM/Camera", true)
	if err != nil || len(files) != 6 {
		t.Fatalf("hidden filter files=%d error=%v", len(files), err)
	}
}

func TestCompatibilityErrors(t *testing.T) {
	for _, code := range []mtp.RCError{0x2005, 0xa801, 0xa808, 0xa80a} {
		dev := &fakeDevice{failure: code}
		if _, err := List(dev, 1, 1, "/x", false); !errors.Is(err, ErrUnsupported) || dev.calls != 1 {
			t.Fatalf("unsupported %v: %v", code, err)
		}
	}
	transport := errors.New("LIBUSB_ERROR_TIMEOUT")
	if _, err := List(&fakeDevice{failure: transport}, 1, 1, "/x", false); !errors.Is(err, transport) || errors.Is(err, ErrUnsupported) {
		t.Fatalf("transport error must not fall back: %v", err)
	}
	if _, err := List(&fakeDevice{count: 7, omitSize: true}, 1, 1, "/x", false); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("partial dataset accepted: %v", err)
	}
}

func TestRejectMalformedProperties(t *testing.T) {
	var valid bytes.Buffer
	binary.Write(&valid, binary.LittleEndian, uint32(1))
	encodeProperty(&valid, propertyName, 42, propertyValue{text: "中文😀.jpg"})
	data := valid.Bytes()
	for length := 0; length < len(data); length++ {
		list := &propertyList{property: propertyName}
		if err := list.Decode(bytes.NewReader(data[:length])); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("truncated length=%d accepted: %v", length, err)
		}
	}
	for _, mutate := range []func([]byte) []byte{
		func(b []byte) []byte { return append(b, 1) },
		func(b []byte) []byte { b[8] = 0x04; return b },
		func(b []byte) []byte { b[10] = 0x08; return b },
		func(b []byte) []byte { b[len(b)-1] = 1; return b },
		func(b []byte) []byte { b[0] = 2; return append(b, b[4:]...) },
	} {
		list := &propertyList{property: propertyName}
		if err := list.Decode(bytes.NewReader(mutate(append([]byte(nil), data...)))); err == nil {
			t.Fatal("malformed dataset accepted")
		}
	}
	list := &propertyList{property: propertyName}
	if err := list.Decode(bytes.NewReader(data)); err != nil || list.values[42].text != "中文😀.jpg" {
		t.Fatalf("UTF16 decode failed: %v", err)
	}
}

func TestFallbackDoesNotPublishPartialDirectory(t *testing.T) {
	calls := 0
	failure := errors.New("device is not open")
	files, err := ReadObjects([]uint32{1, 2, 3}, "/x", false, func(id uint32, _ string) (*mtpx.FileInfo, error) {
		calls++
		if id == 2 {
			return nil, failure
		}
		return &mtpx.FileInfo{Name: "a"}, nil
	})
	if !errors.Is(err, failure) || files != nil || calls != 2 {
		t.Fatalf("partial result or continued on dead device: %+v %v %d", files, err, calls)
	}
}

func TestDatesAndFolders(t *testing.T) {
	for _, date := range []string{"", "20261022T093000.", "20261022T093000Z", "20261022T093000+0800", "20261022T093000.123"} {
		if _, err := parseDate(date); err != nil {
			t.Fatal(date, err)
		}
	}
	if _, err := parseDate("bad date"); err == nil {
		t.Fatal("invalid date accepted")
	}
	if extension("a.tar.gz", false) != "tar.gz" || extension("Camera", true) != "" {
		t.Fatal("extension semantics changed")
	}
	if Supported(nil) || !Supported(&mtp.DeviceInfo{OperationsSupported: []uint16{mtp.OC_MTP_GetObjPropList}}) {
		t.Fatal("capability detection")
	}
}

// Optional local capture validation. Captures contain private filenames and
// must never be committed. This uses already collected responses, no USB I/O.
func TestCapturedProperties(t *testing.T) {
	root := os.Getenv("KALAM_CAPTURE_DIR")
	if root == "" {
		t.Skip("no local capture")
	}
	data := make(map[uint16]*propertyList)
	for _, property := range []uint16{propertyParent, propertyName, propertyFormat, propertySize, propertyModified} {
		name := fmt.Sprintf("openmtp-bulk-%x.bin", property)
		if property == propertyName {
			name = "openmtp-bulk-result.bin"
		}
		f, err := os.Open(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		values := &propertyList{property: property}
		err = values.Decode(f)
		f.Close()
		if err != nil {
			t.Fatal(err)
		}
		data[property] = values
	}
	files, err := joinProperties(data, 65537, 102, "/DCIM/Camera", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 42546 {
		t.Fatalf("unexpected captured count: %d", len(files))
	}
	t.Logf("decoded %d captured entries without re-querying phone", len(files))
}
