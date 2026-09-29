package agents

import "testing"

func TestNormalizePunctuation(t *testing.T) {
	cases := []struct{ in, want string }{
		// The e-mail address is one link again, not "benefits@example.edu".
		{"Write to military\u2011benefits@example.edu.", "Write to military-benefits@example.edu."},
		{"Call 555\u2011392\u20114357 (392\u2011HELP).", "Call 555-392-4357 (392-HELP)."},
		{"Since Jan\u202f1\u202f1975, fees\u00a0apply.", "Since Jan 1 1975, fees apply."},
		{"two\u2011factor\u2009authentication", "two-factor authentication"},
		{"zero\u200bwidth\u2060joined\ufeff soft\u00adhyphen", "zerowidthjoined softhyphen"},
		// Real punctuation stays: en and em dashes, the ideographic space, quotes.
		{"2\u20133 months \u2014 “quoted” 学生\u3000証", "2\u20133 months \u2014 “quoted” 学生\u3000証"},
		{"plain text [1]", "plain text [1]"},
	}
	for _, c := range cases {
		if got := NormalizePunctuation(c.in); got != c.want {
			t.Errorf("NormalizePunctuation(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSettledTextIsNormalised(t *testing.T) {
	// The finished answer goes through settle: markers and punctuation.
	text, cites := applyCitations(NormalizePunctuation("Fees apply since Jan\u202f1\u202f1975\u202f【1】."), []numberedHit{{N: 1}}, CitationSnippetLink)
	if text != "Fees apply since Jan 1 1975 [1]." || len(cites) != 1 {
		t.Errorf("text %q, %d citations", text, len(cites))
	}
}
