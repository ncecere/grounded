package crawl

import (
	"fmt"
	"testing"
)

// A page's links are each checked against the source's scope: up to 20,000
// links against up to 50 exclude patterns.
func BenchmarkScopeAllows(b *testing.B) {
	s := Scope{Seeds: []string{"https://www.example.edu/"}, MaxDepth: 5}
	for i := range 50 {
		s.Exclude = append(s.Exclude, fmt.Sprintf("/archive/%d/**/print-*", 1990+i))
	}
	links := make([]string, 200)
	for i := range links {
		links[i] = fmt.Sprintf("https://www.example.edu/admissions/programs/%d/overview", i)
	}
	b.ReportAllocs()
	for b.Loop() {
		for _, l := range links {
			if ok, _ := s.Allows(l, 2); !ok {
				b.Fatal("link refused")
			}
		}
	}
}
