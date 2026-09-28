package crawl

import (
	"reflect"
	"testing"
)

func TestLinks(t *testing.T) {
	page := `<!doctype html><html><head>
<base href="/docs/">
<base href="https://ignored.example/">
</head><body>
<a href="intro?utm_source=x&b=2&a=1#top">Intro</a>
<a href="../about">About</a>
<a href="#local">skip fragment-only</a>
<a href="intro?b=2&amp;a=1#other">dup via fragment</a>
<a href="https://Other.Example:443/X">abs</a>
<a href="//cdn.example/y">protocol-relative</a>
<a rel="nofollow" href="/nofollow">nf</a>
<a rel="external NoFollow" href="/nofollow2">nf2</a>
<a href="mailto:a@example.edu">mail</a>
<a href="javascript:void(0)">js</a>
<a href="ftp://x.example/">ftp</a>
<a href="  /spaced  ">spaced</a>
<a>no href</a>
<area href="/area">
<a href="http://user:pw@x.example/">creds</a>
<A HREF="/UPPER">upper</A>
</body></html>`
	got := Links([]byte(page), "https://www.example.edu/section/page.html")
	want := []string{
		"https://www.example.edu/docs/intro?a=1&b=2",
		"https://www.example.edu/about",
		"https://other.example/X",
		"https://cdn.example/y",
		"https://www.example.edu/spaced",
		"https://www.example.edu/UPPER",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Links:\n got %q\nwant %q", got, want)
	}

	// Without <base>, relative links resolve against the page URL.
	got = Links([]byte(`<a href="b">b</a><a href="./c/../d">d</a><a href="?q=1">q</a>`), "https://example.com/a/page")
	want = []string{"https://example.com/a/b", "https://example.com/a/d", "https://example.com/a/page?q=1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("relative: got %q want %q", got, want)
	}

	// Meta robots nofollow suppresses all links.
	if got := Links([]byte(`<meta name="Robots" content="noindex, NOFOLLOW"><a href="/x">x</a>`), "https://example.com/"); len(got) != 0 {
		t.Fatalf("meta nofollow ignored: %q", got)
	}
	if got := Links([]byte(`<a href="/x">x</a>`), "mailto:x@y"); got != nil {
		t.Fatalf("non-http page: %q", got)
	}
}
