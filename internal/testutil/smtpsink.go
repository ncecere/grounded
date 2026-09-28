package testutil

import (
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"net/textproto"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// SMTPSink is a tiny in-process SMTP server that stores what it receives,
// for tests of notification email. It speaks enough of RFC 5321 for
// net/smtp without TLS or AUTH (SMTP_TLS=none).
type SMTPSink struct {
	ln       net.Listener
	mu       sync.Mutex
	messages []SinkMessage
	failNext int // reject this many DATA commands with a 451
	notify   chan struct{}
}

// SinkMessage is one received email.
type SinkMessage struct {
	From string
	To   []string
	Raw  string
}

// NewSMTPSink starts a sink on 127.0.0.1 and stops it when the test ends.
func NewSMTPSink(t testing.TB) *SMTPSink {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("smtp sink: %v", err)
	}
	s := &SMTPSink{ln: ln, notify: make(chan struct{}, 1)}
	go s.serve()
	t.Cleanup(func() { _ = ln.Close() })
	return s
}

// Host and Port are where the sink listens.
func (s *SMTPSink) Host() string { return "127.0.0.1" }

func (s *SMTPSink) Port() int { return s.ln.Addr().(*net.TCPAddr).Port }

// FailNext makes the next n messages fail with a temporary error (451).
func (s *SMTPSink) FailNext(n int) {
	s.mu.Lock()
	s.failNext = n
	s.mu.Unlock()
}

// Messages returns what has been received so far.
func (s *SMTPSink) Messages() []SinkMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]SinkMessage(nil), s.messages...)
}

// Wait returns once at least n messages arrived, or fails the test.
func (s *SMTPSink) Wait(t testing.TB, n int, timeout time.Duration) []SinkMessage {
	t.Helper()
	deadline := time.After(timeout)
	for {
		if m := s.Messages(); len(m) >= n {
			return m
		}
		select {
		case <-s.notify:
		case <-deadline:
			t.Fatalf("smtp sink: got %d messages, want %d", len(s.Messages()), n)
		}
	}
}

func (s *SMTPSink) serve() {
	for {
		c, err := s.ln.Accept()
		if err != nil {
			return
		}
		go s.session(c)
	}
}

func (s *SMTPSink) session(c net.Conn) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(time.Minute))
	tp := textproto.NewConn(c)
	reply := func(code int, msg string) { _ = tp.PrintfLine("%d %s", code, msg) }
	reply(220, "sink ESMTP ready")
	var cur SinkMessage
	for {
		line, err := tp.ReadLine()
		if err != nil {
			return
		}
		verb, arg, _ := strings.Cut(line, " ")
		switch strings.ToUpper(verb) {
		case "EHLO", "HELO":
			_ = tp.PrintfLine("250-sink")
			reply(250, "8BITMIME")
		case "MAIL":
			cur = SinkMessage{From: addrArg(arg)}
			reply(250, "OK")
		case "RCPT":
			cur.To = append(cur.To, addrArg(arg))
			reply(250, "OK")
		case "DATA":
			reply(354, "go ahead")
			raw, err := tp.ReadDotBytes()
			if err != nil {
				return
			}
			cur.Raw = string(raw)
			s.accept(cur, reply)
		case "RSET", "NOOP":
			reply(250, "OK")
		case "QUIT":
			reply(221, "bye")
			return
		default:
			reply(502, "not implemented")
		}
	}
}

func (s *SMTPSink) accept(m SinkMessage, reply func(int, string)) {
	s.mu.Lock()
	if s.failNext > 0 {
		s.failNext--
		s.mu.Unlock()
		reply(451, "try again later")
		return
	}
	s.messages = append(s.messages, m)
	s.mu.Unlock()
	select {
	case s.notify <- struct{}{}:
	default:
	}
	reply(250, "queued")
}

// addrArg extracts the address from "FROM:<a@b>" or "TO:<a@b> ...".
func addrArg(arg string) string {
	i, j := strings.IndexByte(arg, '<'), strings.IndexByte(arg, '>')
	if i < 0 || j < i {
		return ""
	}
	return arg[i+1 : j]
}

// Parsed is a received email's headers and decoded bodies.
type Parsed struct {
	Header mail.Header
	Text   string
	HTML   string
}

// Parse decodes a multipart/alternative message (as Grounded sends them).
func (m SinkMessage) Parse(t testing.TB) Parsed {
	t.Helper()
	msg, err := mail.ReadMessage(strings.NewReader(m.Raw))
	if err != nil {
		t.Fatalf("parse email: %v", err)
	}
	out := Parsed{Header: msg.Header}
	if subj, err := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject")); err == nil {
		out.Header["Subject"] = []string{subj}
	}
	_, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("content type: %v", err)
	}
	mr := multipart.NewReader(msg.Body, params["boundary"])
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		} else if err != nil {
			t.Fatalf("part: %v", err)
		}
		b, _ := io.ReadAll(p) // multipart decodes quoted-printable parts

		body := strings.ReplaceAll(string(b), "\r\n", "\n")
		if strings.HasPrefix(p.Header.Get("Content-Type"), "text/html") {
			out.HTML = body
		} else {
			out.Text = body
		}
	}
	return out
}

// Addr is "host:port", for logs.
func (s *SMTPSink) Addr() string { return net.JoinHostPort(s.Host(), strconv.Itoa(s.Port())) }
