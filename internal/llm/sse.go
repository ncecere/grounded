package llm

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

// maxSSELine bounds one SSE line (a single chunk is a few hundred bytes; a
// non-streamed completion body can be larger).
const maxSSELine = 16 << 20

var errLineTooLong = errors.New("stream line too long")

// sseReader parses server-sent events leniently: "data:" with or without a
// space, comments (":" lines), CRLF, multi-line data joined with "\n", and
// servers that omit the blank line between events (a new data line after a
// complete JSON payload starts a new event).
type sseReader struct {
	r      *bufio.Reader
	onLine func() // called after every line read (idle-timeout reset)
	event  string
	data   [][]byte
}

type sseEvent struct {
	Event string
	Data  []byte
}

func newSSEReader(r io.Reader, onLine func()) *sseReader {
	if onLine == nil {
		onLine = func() {}
	}
	return &sseReader{r: bufio.NewReaderSize(r, 64<<10), onLine: onLine}
}

func (s *sseReader) readLine() ([]byte, error) {
	var line []byte
	for {
		frag, err := s.r.ReadSlice('\n')
		line = append(line, frag...)
		if len(line) > maxSSELine {
			return nil, errLineTooLong
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		if err != nil {
			if err == io.EOF && len(line) > 0 {
				return trimEOL(line), nil
			}
			return nil, err
		}
		return trimEOL(line), nil
	}
}

func trimEOL(b []byte) []byte {
	b = bytes.TrimSuffix(b, []byte("\n"))
	return bytes.TrimSuffix(b, []byte("\r"))
}

func (s *sseReader) flush() *sseEvent {
	if len(s.data) == 0 {
		s.event = ""
		return nil
	}
	ev := &sseEvent{Event: s.event, Data: bytes.Join(s.data, []byte("\n"))}
	s.event, s.data = "", nil
	return ev
}

// Next returns the next event with data. It returns io.EOF after the last
// event.
func (s *sseReader) Next() (sseEvent, error) {
	for {
		line, err := s.readLine()
		if err != nil {
			if err == io.EOF {
				if ev := s.flush(); ev != nil {
					return *ev, nil
				}
			}
			return sseEvent{}, err
		}
		s.onLine()
		if len(line) == 0 {
			if ev := s.flush(); ev != nil {
				return *ev, nil
			}
			continue
		}
		if line[0] == ':' {
			continue // comment / keep-alive
		}
		field, value, found := bytes.Cut(line, []byte(":"))
		if found {
			value = bytes.TrimPrefix(value, []byte(" "))
		}
		switch string(field) {
		case "data":
			if len(s.data) == 1 && json.Valid(s.data[0]) {
				// Missing blank line: the previous payload is complete.
				prev := s.flush()
				s.data = [][]byte{append([]byte(nil), value...)}
				return *prev, nil
			}
			s.data = append(s.data, append([]byte(nil), value...))
		case "event":
			if len(s.data) > 0 && json.Valid(bytes.Join(s.data, []byte("\n"))) {
				prev := s.flush()
				s.event = string(value)
				return *prev, nil
			}
			s.event = string(value)
		}
		// id, retry and unknown fields are ignored.
	}
}
