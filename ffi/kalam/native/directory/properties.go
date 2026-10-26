// Package directory implements read-only, non-recursive MTP directory listing.
package directory

import (
	"encoding/binary"
	"fmt"
	"io"
	"unicode/utf16"
)

const (
	propertyFormat   uint16 = 0xdc02
	propertySize     uint16 = 0xdc04
	propertyName     uint16 = 0xdc07
	propertyModified uint16 = 0xdc09
	propertyParent   uint16 = 0xdc0b
)

type propertyValue struct {
	number uint64
	text   string
}

type propertyList struct {
	property uint16
	values   map[uint32]propertyValue
	handles  []uint32
}

// Decode is called by mtp.GetData only after a complete, successful transaction.
// A specific-property request has one value per object, not an arbitrary list
// of properties. Reject mismatched/truncated replies instead of showing partial data.
func (p *propertyList) Decode(r io.Reader) (err error) {
	defer func() {
		if err != nil {
			err = fmt.Errorf("%w: %v", ErrUnsupported, err)
		}
	}()
	var count uint32
	if err := binary.Read(r, binary.LittleEndian, &count); err != nil {
		return err
	}
	if count > 2000000 {
		return fmt.Errorf("MTP property count exceeds directory limit: %d", count)
	}
	p.values = make(map[uint32]propertyValue, count)
	p.handles = make([]uint32, 0, count)
	for i := uint32(0); i < count; i++ {
		var header struct {
			Handle   uint32
			Property uint16
			Type     uint16
		}
		if err := binary.Read(r, binary.LittleEndian, &header); err != nil {
			return err
		}
		if header.Property != p.property {
			return fmt.Errorf("unexpected MTP property %x, want %x", header.Property, p.property)
		}
		if _, exists := p.values[header.Handle]; exists {
			return fmt.Errorf("duplicate MTP property for object %d", header.Handle)
		}
		var value propertyValue
		switch p.property {
		case propertyName, propertyModified:
			if header.Type != 0xffff {
				return fmt.Errorf("invalid string property type %x", header.Type)
			}
			text, err := readString(r)
			if err != nil {
				return err
			}
			value.text = text
		case propertyFormat:
			if header.Type != 4 {
				return fmt.Errorf("invalid format property type %x", header.Type)
			}
			var n uint16
			if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
				return err
			}
			value.number = uint64(n)
		case propertyParent:
			if header.Type != 6 {
				return fmt.Errorf("invalid parent property type %x", header.Type)
			}
			var n uint32
			if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
				return err
			}
			value.number = uint64(n)
		case propertySize:
			if header.Type != 8 {
				return fmt.Errorf("invalid size property type %x", header.Type)
			}
			if err := binary.Read(r, binary.LittleEndian, &value.number); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unrequested property %x", p.property)
		}
		p.values[header.Handle] = value
		p.handles = append(p.handles, header.Handle)
	}
	var extra [1]byte
	if n, err := r.Read(extra[:]); n != 0 || err != io.EOF {
		return fmt.Errorf("unexpected trailing property data")
	}
	return nil
}

func readString(r io.Reader) (string, error) {
	var length uint8
	if err := binary.Read(r, binary.LittleEndian, &length); err != nil {
		return "", err
	}
	if length == 0 {
		return "", nil
	}
	units := make([]uint16, int(length))
	if err := binary.Read(r, binary.LittleEndian, units); err != nil {
		return "", err
	}
	if units[len(units)-1] != 0 {
		return "", fmt.Errorf("unterminated MTP string")
	}
	return string(utf16.Decode(units[:len(units)-1])), nil
}
