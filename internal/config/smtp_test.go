package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSMTPSettings(t *testing.T) {
	dir := t.TempDir()
	pw := filepath.Join(dir, "smtp-password")
	if err := os.WriteFile(pw, []byte("hunter2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := LoadFrom("", env(map[string]string{
		"SMTP_HOST": "smtp.example.edu", "SMTP_PORT": "465", "SMTP_TLS": "TLS", "SMTP_USERNAME": "rag",
		"SMTP_PASSWORD_FILE": pw, "SMTP_FROM": "Campus RAG <rag@example.edu>",
	}))
	if err != nil {
		t.Fatal(err)
	}
	want := SMTP{Host: "smtp.example.edu", Port: 465, Username: "rag", Password: "hunter2", From: "Campus RAG <rag@example.edu>", TLS: SMTPTLS}
	if c.SMTP != want || !c.SMTP.Enabled() {
		t.Fatalf("smtp = %+v", c.SMTP)
	}
	if errs := c.SMTP.validate("https://rag.example.edu"); len(errs) != 0 {
		t.Fatalf("valid config rejected: %v", errs)
	}
	// Defaults: off, port 587, STARTTLS.
	d := Defaults().SMTP
	if d.Enabled() || d.Port != 587 || d.TLS != SMTPStartTLS || len(d.validate("")) != 0 {
		t.Errorf("defaults = %+v", d)
	}
	if _, err := LoadFrom("", env(map[string]string{"SMTP_PORT": "0"})); err == nil {
		t.Error("port 0 accepted")
	}
}

func TestSMTPValidation(t *testing.T) {
	ok := SMTP{Host: "127.0.0.1", Port: 1025, From: "rag@example.edu", TLS: SMTPNoTLS}
	cases := []struct {
		name   string
		change func(*SMTP)
		appURL string
		want   string
	}{
		{"loopback relay without TLS", func(*SMTP) {}, "http://127.0.0.1:8080", ""},
		{"bad TLS mode", func(s *SMTP) { s.TLS = "ssl" }, "http://127.0.0.1:8080", "SMTP_TLS"},
		{"no from", func(s *SMTP) { s.From = "" }, "http://127.0.0.1:8080", "SMTP_FROM"},
		{"bad from", func(s *SMTP) { s.From = "not an address" }, "http://127.0.0.1:8080", "SMTP_FROM"},
		{"host with port", func(s *SMTP) { s.Host = "smtp.example.edu:25" }, "http://127.0.0.1:8080", "SMTP_HOST"},
		{"username without password", func(s *SMTP) { s.Username = "rag" }, "http://127.0.0.1:8080", "SMTP_USERNAME"},
		{"password in clear to a remote relay", func(s *SMTP) { s.Host, s.Username, s.Password = "smtp.example.edu", "rag", "pw" }, "http://127.0.0.1:8080", "SMTP_TLS=none"},
		{"links need APP_URL", func(*SMTP) {}, "", "APP_URL"},
	}
	for _, c := range cases {
		s := ok
		c.change(&s)
		errs := s.validate(c.appURL)
		var joined []string
		for _, e := range errs {
			joined = append(joined, e.Error())
		}
		got := strings.Join(joined, "; ")
		if (c.want == "") != (got == "") || !strings.Contains(got, c.want) {
			t.Errorf("%s: got %q, want an error mentioning %q", c.name, got, c.want)
		}
	}
}
