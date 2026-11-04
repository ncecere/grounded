package pii

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/parse"
)

func TestScanFindsValidNumbersByPage(t *testing.T) {
	md := strings.Join([]string{
		parse.PageMarker(1),
		"Contact the registrar for forms.",
		parse.PageMarker(2),
		"Student SSN: 123-45-6788 and 234 56 7890.",    // two valid SSNs
		"Card on file 4111 1111 1111 1111, thank you.", // Visa test number, Luhn-valid
		parse.PageMarker(4),
		"Amex 3782-822463-10005 and SSN 345-67-8901.",
	}, "\n")
	got := Scan(md, nil)
	if len(got) != 2 {
		t.Fatalf("findings = %+v", got)
	}
	if s := got[0]; s.Kind != KindUSSSN || s.Count != 3 || len(s.Pages) != 2 || s.Pages[0] != 2 || s.Pages[1] != 4 {
		t.Errorf("SSN finding = %+v", s)
	}
	if c := got[1]; c.Kind != KindPaymentCard || c.Count != 2 || len(c.Pages) != 2 || c.Pages[0] != 2 || c.Pages[1] != 4 {
		t.Errorf("card finding = %+v", c)
	}
	raw, _ := json.Marshal(got)
	for _, secret := range []string{"6788", "1111", "10005", "8901"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("a finding holds matched text: %s", raw)
		}
	}
}

// Numbers the SSA never issues, numbers that only look like cards, and ordinary numbers are not findings.
func TestScanRejectsFalsePositives(t *testing.T) {
	for _, line := range []string{
		"000-12-3456", "666-12-3456", "912-34-5678", "123-00-4567", "123-45-0000", // invalid areas, group, serial
		"078-05-1120", "219-09-9999", "123-45-6789", // known example numbers
		"4111 1111 1111 1112",            // fails Luhn
		"1234 5678 9012 3456",            // no known network
		"4444 4444 4444 4444",            // a repeated digit
		"Call 352-555-0142 or 555-0199.", // phone numbers
		"Order 2026-11-04, invoice 100245, ISBN 978-0-306-40615-7.",
		"Room 123-45 is on floor 6789.",
	} {
		if got := Scan(line, nil); len(got) != 0 {
			t.Errorf("%q: %+v", line, got)
		}
	}
}

func TestCustomPatterns(t *testing.T) {
	p, ok := CompilePattern("Student ID", `\bU\d{8}\b`)
	if !ok {
		t.Fatal("valid pattern refused")
	}
	got := Scan("IDs U12345678 and U87654321; not U123.", []Pattern{p})
	if len(got) != 1 || got[0].Kind != "Student ID" || got[0].Count != 2 || len(got[0].Pages) != 0 {
		t.Fatalf("custom finding = %+v", got)
	}
	for _, bad := range []struct{ name, expr string }{
		{"", `\d+`}, {"x", ""}, {"x", `(`}, {"x", `a*`}, {KindUSSSN, `\d`}, {strings.Repeat("n", 61), `\d`}, {"x", strings.Repeat("a", MaxPatternLength+1)},
	} {
		if _, ok := CompilePattern(bad.name, bad.expr); ok {
			t.Errorf("accepted pattern %q %q", bad.name, bad.expr)
		}
	}
}

func TestScanIsBounded(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 150; i++ {
		b.WriteString(parse.PageMarker(i+1) + "\n")
		b.WriteString(strings.Repeat("345-67-8901 ", 100) + "\n")
	}
	got := Scan(b.String(), nil)
	if len(got) != 1 || got[0].Count != maxCount || len(got[0].Pages) != maxPages {
		t.Fatalf("bounds: count %d, pages %d", got[0].Count, len(got[0].Pages))
	}
}
