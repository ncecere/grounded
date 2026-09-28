// Sending email over SMTP (SMTP_* settings), and building the MIME message.

package notify

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"
)

// Sender delivers one message to one address.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// Message is an addressed email.
type Message struct {
	From string // header value, e.g. "Grounded <rag@example.edu>"
	To   string // one address
	Rendered
}

// SMTPConfig configures SMTPSender (config.SMTP).
type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	TLS      string // "starttls", "tls" or "none"
	Timeout  time.Duration
	// TLSConfig overrides certificate checks (tests only).
	TLSConfig *tls.Config
}

// SMTPSender sends through an SMTP relay, one connection per message.
type SMTPSender struct{ Config SMTPConfig }

// Send implements Sender.
func (s *SMTPSender) Send(ctx context.Context, msg Message) error {
	from, err := mail.ParseAddress(msg.From)
	if err != nil {
		return fmt.Errorf("SMTP_FROM: %w", err)
	}
	to, err := mail.ParseAddress(msg.To)
	if err != nil {
		return fmt.Errorf("recipient: %w", err)
	}
	c, conn, err := s.dial(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	defer c.Close()
	if err := s.secure(c); err != nil {
		return err
	}
	if err := c.Mail(from.Address); err != nil {
		return fmt.Errorf("smtp MAIL: %w", err)
	}
	if err := c.Rcpt(to.Address); err != nil {
		return fmt.Errorf("smtp RCPT: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(msg.Bytes(time.Now())); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	return c.Quit()
}

func (s *SMTPSender) tlsConfig() *tls.Config {
	if s.Config.TLSConfig != nil {
		return s.Config.TLSConfig
	}
	return &tls.Config{ServerName: s.Config.Host, MinVersion: tls.VersionTLS12}
}

// dial connects (with implicit TLS in "tls" mode) and bounds the whole
// exchange by the context and the timeout.
func (s *SMTPSender) dial(ctx context.Context) (*smtp.Client, net.Conn, error) {
	timeout := s.Config.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	addr := net.JoinHostPort(s.Config.Host, strconv.Itoa(s.Config.Port))
	d := &net.Dialer{}
	var (
		conn net.Conn
		err  error
	)
	if s.Config.TLS == "tls" {
		conn, err = (&tls.Dialer{NetDialer: d, Config: s.tlsConfig()}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = d.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("smtp connect: %w", err)
	}
	// The dial context ends when dial returns; the deadline bounds the rest.
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)
	c, err := smtp.NewClient(conn, s.Config.Host)
	if err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("smtp greeting: %w", err)
	}
	return c, conn, nil
}

// secure upgrades with STARTTLS (required in "starttls" mode) and
// authenticates when a username is set.
func (s *SMTPSender) secure(c *smtp.Client) error {
	if s.Config.TLS == "starttls" {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errors.New("smtp: the relay does not offer STARTTLS (set SMTP_TLS to tls or none)")
		}
		if err := c.StartTLS(s.tlsConfig()); err != nil {
			return fmt.Errorf("smtp STARTTLS: %w", err)
		}
	}
	if s.Config.Username == "" {
		return nil
	}
	if err := c.Auth(smtp.PlainAuth("", s.Config.Username, s.Config.Password, s.Config.Host)); err != nil {
		return fmt.Errorf("smtp AUTH: %w", err)
	}
	return nil
}

// Bytes is the message in RFC 5322 form: multipart/alternative with a
// plain-text and an HTML part, both quoted-printable UTF-8.
func (m Message) Bytes(now time.Time) []byte {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, part := range []struct{ ctype, content string }{
		{"text/plain; charset=utf-8", m.Text},
		{"text/html; charset=utf-8", m.HTML},
	} {
		w, _ := mw.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {part.ctype},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		qp := quotedprintable.NewWriter(w)
		_, _ = qp.Write([]byte(strings.ReplaceAll(part.content, "\n", "\r\n")))
		_ = qp.Close()
	}
	_ = mw.Close()

	var out bytes.Buffer
	header := func(k, v string) { fmt.Fprintf(&out, "%s: %s\r\n", k, v) }
	header("From", headerSafe(m.From))
	header("To", headerSafe(m.To))
	header("Subject", mime.QEncoding.Encode("utf-8", headerSafe(m.Subject)))
	header("Date", now.Format(time.RFC1123Z))
	header("Message-ID", messageID(m.From))
	header("MIME-Version", "1.0")
	header("Auto-Submitted", "auto-generated")
	header("Content-Type", `multipart/alternative; boundary="`+mw.Boundary()+`"`)
	out.WriteString("\r\n")
	out.Write(body.Bytes())
	return out.Bytes()
}

// headerSafe removes line breaks so values can't add headers.
func headerSafe(s string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(s)
}

func messageID(from string) string {
	domain := "localhost"
	if a, err := mail.ParseAddress(from); err == nil {
		if i := strings.LastIndexByte(a.Address, '@'); i >= 0 {
			domain = a.Address[i+1:]
		}
	}
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "<" + hex.EncodeToString(b) + "@" + domain + ">"
}
