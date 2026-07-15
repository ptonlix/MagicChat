package media

import (
	"encoding/binary"
	"errors"
)

// WebPDimensions reads the dimensions from a VP8X, VP8L, or VP8 WebP image.
func WebPDimensions(content []byte) (int, int, error) {
	if len(content) < 12 || string(content[0:4]) != "RIFF" || string(content[8:12]) != "WEBP" {
		return 0, 0, errors.New("invalid webp")
	}

	for offset := 12; offset+8 <= len(content); {
		chunkType := string(content[offset : offset+4])
		chunkSize := int(binary.LittleEndian.Uint32(content[offset+4 : offset+8]))
		payloadStart := offset + 8
		payloadEnd := payloadStart + chunkSize
		if chunkSize < 0 || payloadEnd > len(content) {
			return 0, 0, errors.New("invalid webp")
		}

		payload := content[payloadStart:payloadEnd]
		switch chunkType {
		case "VP8X":
			return parseVP8XDimensions(payload)
		case "VP8L":
			return parseVP8LDimensions(payload)
		case "VP8 ":
			return parseVP8Dimensions(payload)
		}

		offset = payloadEnd
		if chunkSize%2 == 1 {
			offset++
		}
	}

	return 0, 0, errors.New("missing webp dimensions")
}

func parseVP8XDimensions(payload []byte) (int, int, error) {
	if len(payload) < 10 {
		return 0, 0, errors.New("invalid vp8x")
	}

	width := 1 + int(payload[4]) + (int(payload[5]) << 8) + (int(payload[6]) << 16)
	height := 1 + int(payload[7]) + (int(payload[8]) << 8) + (int(payload[9]) << 16)

	return width, height, nil
}

func parseVP8LDimensions(payload []byte) (int, int, error) {
	if len(payload) < 5 || payload[0] != 0x2f {
		return 0, 0, errors.New("invalid vp8l")
	}

	width := 1 + int(payload[1]) + (int(payload[2]&0x3f) << 8)
	height := 1 + (int(payload[2]&0xc0) >> 6) + (int(payload[3]) << 2) + (int(payload[4]&0x0f) << 10)

	return width, height, nil
}

func parseVP8Dimensions(payload []byte) (int, int, error) {
	if len(payload) < 10 || payload[3] != 0x9d || payload[4] != 0x01 || payload[5] != 0x2a {
		return 0, 0, errors.New("invalid vp8")
	}

	width := int(binary.LittleEndian.Uint16(payload[6:8]) & 0x3fff)
	height := int(binary.LittleEndian.Uint16(payload[8:10]) & 0x3fff)

	return width, height, nil
}
