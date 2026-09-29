package htmlmd

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func mustURL(t testing.TB, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func convert(t *testing.T, source string, opts Options) Result {
	t.Helper()
	res, err := Convert([]byte(source), opts)
	if err != nil {
		t.Fatal(err)
	}
	assertWellFormed(t, res.Markdown)
	return res
}

func assertContains(t *testing.T, md string, wants ...string) {
	t.Helper()
	for _, want := range wants {
		if !strings.Contains(md, want) {
			t.Errorf("missing %q in markdown:\n%s", want, md)
		}
	}
}

func assertNotContains(t *testing.T, md string, unwanted ...string) {
	t.Helper()
	for _, bad := range unwanted {
		if strings.Contains(md, bad) {
			t.Errorf("unexpected %q in markdown:\n%s", bad, md)
		}
	}
}

// Ported from yoink TestExtractionMainContentAndDiscovery.
func TestMainContentMetadataAndLinks(t *testing.T) {
	source := `<!doctype html><html lang="EN-us"><head><title>Testing &amp; extraction</title><meta name="description" content="A readable page"><base href="https://example.com/docs/"></head><body><header>Header noise <a href="../nav">Navigation</a></header><main><h1>Useful article</h1><p>This is a readable article with enough words to be useful. It explains how code and tables are preserved in extracted content without navigation pollution.</p><p><a href="next#part">Next</a> and <a href="next">again</a></p><pre><code class="language-go">func main() {
    println("hello")
}</code></pre><table><tr><th>Key</th><th>Value</th></tr><tr><td>A</td><td>One</td></tr></table><img src="image.png" onerror="alert(1)" alt="An image"><script>alert('bad')</script><a href="javascript:alert(1)" onclick="alert(1)">Unsafe</a></main><footer><a href="/footer">Footer noise</a></footer></body></html>`
	res := convert(t, source, Options{BaseURL: mustURL(t, "https://example.com/original"), MainContentOnly: true})
	assertContains(t, res.Markdown,
		"# Useful article",
		"```go\nfunc main() {\n    println(\"hello\")\n}\n```",
		"| Key | Value |\n| --- | --- |\n| A | One |",
		"[Next](<https://example.com/docs/next#part>)",
		"![An image](<https://example.com/docs/image.png>)",
		"Unsafe",
	)
	assertNotContains(t, res.Markdown, "Header noise", "Footer noise", "alert", "onerror", "onclick", "javascript:", "Navigation")
	if res.Title != "Testing & extraction" || res.Description != "A readable page" || res.Language != "en-us" {
		t.Fatalf("metadata: %+v", res)
	}
	if want := []string{"https://example.com/docs/next"}; !reflect.DeepEqual(res.Links, want) {
		t.Fatalf("links: %#v", res.Links)
	}
}

// Ported from yoink TestExtractionIncludeExcludeAndSparse / selection diagnostics.
func TestMainContentOnlyDropsBoilerplate(t *testing.T) {
	source := `<body><header><a href="/home">SITE_BANNER</a></header><nav><a href="/outside">NAV_LINK</a></nav><aside class="sidebar">SIDEBAR</aside><div class="cookie-banner">COOKIES</div><main><h1>Primary</h1><p>Selected paragraph</p><a href="/inside">Inside</a></main><footer>FOOTER_TEXT</footer></body>`
	base := mustURL(t, "https://example.com/")
	main := convert(t, source, Options{BaseURL: base, MainContentOnly: true})
	assertContains(t, main.Markdown, "# Primary", "Selected paragraph", "[Inside](<https://example.com/inside>)")
	assertNotContains(t, main.Markdown, "SITE_BANNER", "NAV_LINK", "SIDEBAR", "COOKIES", "FOOTER_TEXT")
	if !reflect.DeepEqual(main.Links, []string{"https://example.com/inside"}) {
		t.Fatalf("main links: %v", main.Links)
	}
	full := convert(t, source, Options{BaseURL: base})
	assertContains(t, full.Markdown, "SITE_BANNER", "NAV_LINK", "SIDEBAR", "COOKIES", "FOOTER_TEXT", "# Primary")
	if !reflect.DeepEqual(full.Links, []string{"https://example.com/home", "https://example.com/outside", "https://example.com/inside"}) {
		t.Fatalf("full links: %v", full.Links)
	}
	// Block-level chrome renders as separate paragraphs, not run-on text.
	if !strings.Contains(full.Markdown, "SIDEBAR\n\nCOOKIES") {
		t.Fatalf("chrome not separated: %q", full.Markdown)
	}
}

func TestMainContentFallbacks(t *testing.T) {
	// Short page without semantic regions falls back to the pruned body.
	res := convert(t, "<nav>NAV</nav><p>Short fallback</p>", Options{MainContentOnly: true})
	if res.Markdown != "Short fallback\n" {
		t.Fatalf("fallback: %q", res.Markdown)
	}
	// Prose-heavy div wins heuristically over link-heavy chrome.
	prose := strings.Repeat("Heuristic prose evidence. ", 20)
	res = convert(t, `<div class="menu"><a href="/a">Menu one</a> <a href="/b">Menu two</a></div><div><p>`+prose+`</p></div>`, Options{MainContentOnly: true})
	if strings.Contains(res.Markdown, "Menu") || !strings.Contains(res.Markdown, "Heuristic prose evidence.") {
		t.Fatalf("heuristic: %q", res.Markdown)
	}
}

// Ported from yoink TestExtractionUnicodeScoring.
func TestUnicodeScoring(t *testing.T) {
	source := "<section><article><p>" + strings.Repeat("庭", 100) + "</p></article></section><section><article><p>" + strings.Repeat("Latin evidence ", 12) + "</p></article></section>"
	res := convert(t, source, Options{MainContentOnly: true})
	if !strings.Contains(res.Markdown, "Latin evidence") || strings.Contains(res.Markdown, "庭") {
		t.Fatalf("UTF-8 bytes biased selection: %q", res.Markdown)
	}
}

func TestHeadingLevels(t *testing.T) {
	var src strings.Builder
	for i := 1; i <= 6; i++ {
		fmt.Fprintf(&src, "<h%d>  Level\n %d <em>title</em> </h%d><p>Body %d</p>", i, i, i, i)
	}
	res := convert(t, src.String(), Options{})
	want := "# Level 1 title\n\nBody 1\n\n## Level 2 title\n\nBody 2\n\n### Level 3 title\n\nBody 3\n\n" +
		"#### Level 4 title\n\nBody 4\n\n##### Level 5 title\n\nBody 5\n\n###### Level 6 title\n\nBody 6\n"
	if res.Markdown != want {
		t.Fatalf("headings:\n%q\nwant\n%q", res.Markdown, want)
	}
	// Permalink anchors, images and line breaks do not pollute heading text;
	// empty headings are dropped.
	res = convert(t, `<h2 id="x">Install<br>guide <a class="anchor" href="#x">¶</a><img src="https://e.test/i.png"></h2><h3> </h3><h3><a href="/docs">Docs</a></h3>`, Options{})
	if res.Markdown != "## Install guide\n\n### [Docs](</docs>)\n" {
		t.Fatalf("heading cleanup: %q", res.Markdown)
	}
}

func TestNestedLists(t *testing.T) {
	source := `<ul>
<li>Fruit
  <ul><li>Apple</li><li><p>Banana</p><p>Second paragraph</p></li></ul>
</li>
<li>Vegetables<ol start="3"><li>Carrot</li><li>Pea<ul><li>Snap</li></ul></li></ol></li>
<li><p>Paragraph item</p></li>
<li></li>
</ul><ol><li>One</li><li>Two</li></ol>`
	res := convert(t, source, Options{})
	want := "- Fruit\n" +
		"  - Apple\n" +
		"  - Banana\n\n" +
		"    Second paragraph\n" +
		"- Vegetables\n" +
		"  3. Carrot\n" +
		"  4. Pea\n" +
		"     - Snap\n" +
		"- Paragraph item\n\n" +
		"1. One\n" +
		"2. Two\n"
	if res.Markdown != want {
		t.Fatalf("lists:\n%s\nwant:\n%s", res.Markdown, want)
	}
	// Invalid direct nesting (<ul><ul>) attaches to the previous item.
	res = convert(t, `<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>`, Options{})
	if res.Markdown != "- a\n  - b\n- c\n" {
		t.Fatalf("direct nesting: %q", res.Markdown)
	}
	// Code inside a list item keeps its whitespace and is indented under the item.
	res = convert(t, "<ol><li>Run:<pre><code>make  build\n\n  test</code></pre></li></ol>", Options{})
	if res.Markdown != "1. Run:\n\n   ```\n   make  build\n\n     test\n   ```\n" {
		t.Fatalf("code in list: %q", res.Markdown)
	}
}

func TestTables(t *testing.T) {
	source := `<table><caption>Prices</caption><thead><tr><th>Item</th><th>Price</th><th>Notes</th></tr></thead>
<tbody><tr><td>Tea</td><td>$2</td><td>hot | iced</td></tr><tr><td colspan="2">Combined</td><td>multi<br>line</td></tr><tr><td>Short</td></tr></tbody></table>`
	res := convert(t, source, Options{})
	want := "Prices\n\n" +
		"| Item | Price | Notes |\n" +
		"| --- | --- | --- |\n" +
		"| Tea | $2 | hot \\| iced |\n" +
		"| Combined |  | multi<br>line |\n" +
		"| Short |  |  |\n"
	if res.Markdown != want {
		t.Fatalf("table:\n%q\nwant\n%q", res.Markdown, want)
	}
	// Layout tables (containing nested tables) render as blocks.
	res = convert(t, `<table><tr><td><h2>Title</h2><table><tr><th>A</th></tr><tr><td>1</td></tr></table></td></tr></table>`, Options{})
	if res.Markdown != "## Title\n\n| A |\n| --- |\n| 1 |\n" {
		t.Fatalf("layout table: %q", res.Markdown)
	}
}

// Ported from yoink TestExtractionTableEscapes.
func TestTableEscapes(t *testing.T) {
	res := convert(t, `<main><table><tr><th>Value</th></tr><tr><td>A \| B <a href="/linked">label [x]</a> <strong>strong</strong> <code>x|y</code><br>next<br>last &lt;literal&gt;</td></tr></table></main>`, Options{BaseURL: mustURL(t, "https://quality.invalid/source"), MainContentOnly: true})
	assertContains(t, res.Markdown, `A \\\| B`, `[label \[x\]](<https://quality.invalid/linked>)`, `**strong**`, "` x\\|y `<br>next<br>last &lt;literal&gt;")
	if strings.Count(res.Markdown, "\n") != 3 {
		t.Fatalf("cell newlines broke the table: %q", res.Markdown)
	}
}

func TestCodeBlocks(t *testing.T) {
	res := convert(t, "<p>Use <code>go test</code> then:</p><pre class=\"lang-python\">def f():\n    return `x`\n</pre><pre><code data-lang=\"sh&lt;script&gt;\">echo ```</code></pre><pre>   </pre>", Options{})
	want := "Use ` go test ` then:\n\n```python\ndef f():\n    return `x`\n\n```\n\n````shscript\necho ```\n````\n"
	if res.Markdown != want {
		t.Fatalf("code:\n%q\nwant\n%q", res.Markdown, want)
	}
}

// Ported from yoink TestExtractionCodeAtDocumentEdges.
func TestCodeAtDocumentEdges(t *testing.T) {
	for _, code := range []string{"  leading and trailing  ", "\n\n  line\t\n\n", strings.Repeat("`", 10000) + "\n```\n", "\x00literal marker"} {
		// NUL in HTML data is discarded by the parser, not the renderer. A
		// leading newline directly after <pre> is dropped by the HTML parser,
		// but not after <code>.
		parsed := strings.ReplaceAll(code, "\x00", "")
		res := convert(t, "<pre><code>"+code+"</code></pre>", Options{})
		fence := backtickFence(parsed, 3)
		if res.Markdown != fence+"\n"+parsed+"\n"+fence+"\n" {
			t.Errorf("fenced pre changed: %q", res.Markdown)
		}
	}
}

func TestLinkResolution(t *testing.T) {
	source := `<p><a href="guide/intro.html">Intro</a> <a href="/abs?q=1#frag">Abs</a> <a href="//cdn.example.org/x">Proto</a> <a href="HTTPS://Example.COM:443/y">Upper</a> <a href="#local">Local</a> <a href="mailto:a@b.c">Mail</a> <a href="data:text/html,x">Data</a> <a href="https://user:pw@example.com/">Creds</a> <a href="guide/intro.html">Again</a> <a href="  ">Blank</a> <a>NoHref</a></p><map><area href="/area"></map>`
	res := convert(t, source, Options{BaseURL: mustURL(t, "https://example.com/docs/page")})
	assertContains(t, res.Markdown,
		"[Intro](<https://example.com/docs/guide/intro.html>)",
		"[Abs](<https://example.com/abs?q=1#frag>)",
		"[Proto](<https://cdn.example.org/x>)",
		"[Upper](<https://example.com/y>)",
		"[Local](<https://example.com/docs/page#local>)",
		" Mail Data Creds ",
	)
	wantLinks := []string{
		"https://example.com/docs/guide/intro.html",
		"https://example.com/abs?q=1",
		"https://cdn.example.org/x",
		"https://example.com/y",
		"https://example.com/area",
	}
	if !reflect.DeepEqual(res.Links, wantLinks) {
		t.Fatalf("links:\n%#v\nwant\n%#v", res.Links, wantLinks)
	}
	// Without a BaseURL, links are kept as written (and <base> is ignored),
	// but unsafe schemes are still dropped.
	res = convert(t, `<base href="https://evil.test/"><p><a href="guide/a b.html">Rel</a> <a href="https://example.com/x">Abs</a> <a href="javascript:alert(1)">JS</a> <a href="guide/a b.html">Dup</a> <img src="img/p.png" alt="P [1]"></p>`, Options{})
	assertContains(t, res.Markdown, "[Rel](<guide/a%20b.html>)", "[Abs](<https://example.com/x>)", " JS ", `![P \[1\]](<img/p.png>)`)
	assertNotContains(t, res.Markdown, "evil.test", "javascript")
	if !reflect.DeepEqual(res.Links, []string{"guide/a%20b.html", "https://example.com/x"}) {
		t.Fatalf("raw links: %#v", res.Links)
	}
}

func TestInlineFormatting(t *testing.T) {
	res := convert(t, `<p><strong>Note: </strong>text with <em> spaced </em>emphasis, <b></b>empty, <s>old</s> and <a href="https://e.test/"> padded link </a>.</p><blockquote><p>Quoted</p><p>twice</p></blockquote><hr><dl><dt>Term</dt><dd>Definition</dd></dl>`, Options{})
	want := "**Note:** text with *spaced* emphasis, empty, ~~old~~ and [padded link](<https://e.test/>) .\n\n> Quoted\n>\n> twice\n\n---\n\nTerm\n\nDefinition\n"
	if res.Markdown != want {
		t.Fatalf("inline:\n%q\nwant\n%q", res.Markdown, want)
	}
}

func TestPageMarkers(t *testing.T) {
	source := `<!-- grounded:page 1 --><html><head><title>Doc</title></head><body>
<div class="page"><h1>Report</h1><p>First page text.</p></div>
<!-- grounded:page 2 -->
<div class="page"><p>Second <!-- ordinary comment --> page<!-- grounded:page 3 -->continues</p>
<table><tr><th>A</th></tr><tr><td>x<!-- grounded:page 4 --></td></tr></table>
<ul><li>item<!--grounded:page 5--></li></ul>
<pre>code<!-- grounded:page 6 --></pre>
<p>&lt;!-- grounded:page 99 --&gt;</p>
</div></body></html><!-- grounded:page 7 -->`
	res := convert(t, source, Options{})
	want := "<!-- grounded:page 1 -->\n\n# Report\n\nFirst page text.\n\n<!-- grounded:page 2 -->\n\nSecond page\n\n<!-- grounded:page 3 -->\n\ncontinues\n\n" +
		"| A |\n| --- |\n| x |\n\n<!-- grounded:page 4 -->\n\n- item\n\n<!-- grounded:page 5 -->\n\n```\ncode\n```\n\n<!-- grounded:page 6 -->\n\n" +
		"&lt;!-- grounded:page 99 -->\n\n<!-- grounded:page 7 -->\n"
	if res.Markdown != want {
		t.Fatalf("markers:\n%q\nwant\n%q", res.Markdown, want)
	}
	assertNotContains(t, res.Markdown, "ordinary comment")
	// Markers survive in main-content mode when they are inside the selection.
	res = convert(t, `<nav>menu<!-- grounded:page 8 --></nav><main><p>a</p><!-- grounded:page 9 --><p>b</p></main>`, Options{MainContentOnly: true})
	if res.Markdown != "a\n\n<!-- grounded:page 9 -->\n\nb\n" {
		t.Fatalf("main markers: %q", res.Markdown)
	}
	// Tika-style XHTML fragment without html/body.
	res = convert(t, "<!-- grounded:page 1 -->\n<p>one</p>\n<!-- grounded:page 2 -->\n<p>two</p>", Options{})
	if res.Markdown != "<!-- grounded:page 1 -->\n\none\n\n<!-- grounded:page 2 -->\n\ntwo\n" {
		t.Fatalf("fragment markers: %q", res.Markdown)
	}
	// Legacy markers (written before the rename to Grounded) are still read and
	// come out in the current form.
	res = convert(t, "<!-- ragd:page 1 -->\n<p>one</p>\n<!--ragd:page 2-->\n<p>two</p>", Options{})
	if res.Markdown != "<!-- grounded:page 1 -->\n\none\n\n<!-- grounded:page 2 -->\n\ntwo\n" {
		t.Fatalf("legacy markers: %q", res.Markdown)
	}
}

func TestTikaXHTML(t *testing.T) {
	source := `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="de-DE"><head><meta name="dc:title" content="Quarterly Report"/><meta name="dc:description" content="Numbers"/><title></title></head><body><div class="page"><p/><h1>Summary</h1><p>Revenue grew.</p></div></body></html>`
	res := convert(t, source, Options{})
	if res.Title != "Quarterly Report" || res.Description != "Numbers" || res.Language != "de-de" {
		t.Fatalf("tika metadata: %+v", res)
	}
	if res.Markdown != "# Summary\n\nRevenue grew.\n" {
		t.Fatalf("tika markdown: %q", res.Markdown)
	}
}

func TestMetadataFallbacksAndLimits(t *testing.T) {
	res := convert(t, `<html><head><meta property="og:title" content=" OG  title "><meta property="og:description" content="OG desc"></head><body><svg><title>icon</title></svg><p>x</p></body></html>`, Options{})
	if res.Title != "OG title" || res.Description != "OG desc" || res.Language != "" {
		t.Fatalf("fallbacks: %+v", res)
	}
	giant := strings.Repeat("庭", 2000)
	res = convert(t, `<head><title>`+giant+`</title><meta name="description" content="`+giant+`"></head><main><p>Safe body</p></main>`, Options{MainContentOnly: true})
	if len(res.Title) > metadataStringLimit || !utf8.ValidString(res.Title) || len(res.Description) > metadataStringLimit || !utf8.ValidString(res.Description) {
		t.Fatal("unbounded metadata")
	}
	if res.Markdown != "Safe body\n" {
		t.Fatalf("body: %q", res.Markdown)
	}
}

// Ported from yoink TestExtractionComplexityAndCharset.
func TestCharset(t *testing.T) {
	res := convert(t, "<meta charset=\"windows-1252\"><p>caf\xe9</p>", Options{})
	if res.Markdown != "café\n" {
		t.Fatalf("meta charset: %q", res.Markdown)
	}
	res = convert(t, "<p>na\xefve</p>", Options{})
	if res.Markdown != "naïve\n" {
		t.Fatalf("windows-1252 fallback: %q", res.Markdown)
	}
	res = convert(t, "\xef\xbb\xbf<p>日本語</p>", Options{})
	if res.Markdown != "日本語\n" {
		t.Fatalf("utf-8 BOM: %q", res.Markdown)
	}
}

func TestErrTooLarge(t *testing.T) {
	input := []byte("<p>" + strings.Repeat("x", 100) + "</p>")
	if _, err := Convert(input, Options{MaxInputBytes: 50}); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("want ErrTooLarge, got %v", err)
	}
	if _, err := Convert(input, Options{MaxInputBytes: len(input)}); err != nil {
		t.Fatalf("exact limit rejected: %v", err)
	}
	big := make([]byte, DefaultMaxInputBytes+1)
	if _, err := Convert(big, Options{}); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("default limit not enforced: %v", err)
	}
	// A wide ragged table must not expand rows*columns without bound.
	source := "<table><tr>" + strings.Repeat("<th>h</th>", 5000) + "</tr>" + strings.Repeat("<tr><td>x</td></tr>", 500) + "</table>"
	if _, err := Convert([]byte(source), Options{MaxInputBytes: 100_000}); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("table expansion unbounded: %v", err)
	}
}

func TestNonContentNeverRendered(t *testing.T) {
	source := `<html><head><style>.HEAD_STYLE{}</style><script>HEAD_SCRIPT()</script></head><body>
<script>BODY_SCRIPT()</script><script type="application/ld+json">{"LDJSON":1}</script><style>BODY_STYLE{}</style>
<noscript>NOSCRIPT_TEXT</noscript><template><p>TEMPLATE_TEXT</p></template><iframe srcdoc="IFRAME_DOC">IFRAME_TEXT</iframe>
<svg onload="bad"><text>SVG_TEXT</text></svg><math>MATH_TEXT</math><object>OBJECT_TEXT</object><div hidden>HIDDEN_TEXT</div><span aria-hidden="true">ARIA_HIDDEN</span>
<form><label>Name</label><input value="INPUT_VALUE"><select><option>OPTION_TEXT</option></select><textarea>TEXTAREA_TEXT</textarea><button>BUTTON_TEXT</button></form>
<main><p onclick="bad()">Visible <span style="x">content</span></p><!-- comment --></main></body></html>`
	for _, main := range []bool{false, true} {
		res := convert(t, source, Options{MainContentOnly: main})
		assertContains(t, res.Markdown, "Visible content")
		assertNotContains(t, res.Markdown, "SCRIPT", "STYLE", "LDJSON", "NOSCRIPT", "TEMPLATE", "IFRAME", "SVG_TEXT", "MATH_TEXT",
			"OBJECT_TEXT", "HIDDEN", "INPUT_VALUE", "OPTION_TEXT", "TEXTAREA_TEXT", "BUTTON_TEXT", "onclick", "bad", "comment", "<script", "<style", "<noscript")
	}
}

// Ported from yoink TestCleanHTMLDropsActiveAttributes.
func TestActiveURLsDropped(t *testing.T) {
	res := convert(t, `<div style="background:url(javascript:bad)"><a href="data:text/html,bad" target="_blank" ping="https://evil.com">link</a><img src="data:image/png;base64,AAAA" alt="inline"><img src="/x" srcset="https://evil.com 2x"><a href="vbscript:bad">vb</a><a href="java&#x09;script:bad">tab</a><p onclick="bad">okay</p></div>`, Options{BaseURL: mustURL(t, "https://example.com/")})
	assertContains(t, res.Markdown, "link", "okay", "![](<https://example.com/x>)", "vb", "tab")
	assertNotContains(t, res.Markdown, "data:", "evil", "javascript", "vbscript", "bad", "inline")
	if len(res.Links) != 0 {
		t.Fatalf("unsafe links: %v", res.Links)
	}
}

func TestEmptyAndWhitespaceInput(t *testing.T) {
	for _, src := range []string{"", "   ", "<html></html>", "<!-- only comment -->", "<script>x</script>", "<p> \n\t </p>"} {
		res, err := Convert([]byte(src), Options{MainContentOnly: true})
		if err != nil || res.Markdown != "" || len(res.Links) != 0 {
			t.Fatalf("%q: %+v %v", src, res, err)
		}
	}
}

func TestHostileAndMalformedHTML(t *testing.T) {
	cases := map[string]string{
		"unclosed":      "<div><p>one<p>two<ul><li>a<li>b<table><tr><td>c<td>d</div>",
		"stray end":     "</p></div></table></li></ul>text</body></html></html>",
		"misnested":     "<b><i>x</b>y</i><a href=/a><a href=/b>z</a>",
		"deep":          strings.Repeat("<div>", 600) + "deep" + strings.Repeat("</div>", 600),
		"deep inline":   strings.Repeat("<b><i>", 300) + "deep" + strings.Repeat("</i></b>", 300),
		"deep lists":    strings.Repeat("<ul><li>", 250) + "deep" + strings.Repeat("</li></ul>", 250),
		"deep quote":    strings.Repeat("<blockquote>", 400) + "q",
		"many nodes":    strings.Repeat("<i></i>", 100001),
		"table in pre":  "<pre><table><tr><td>x</td></tr></table></pre>",
		"heading soup":  "<h1><h2><ul><li><h3><pre>x</pre></h3></li></ul></h2></h1>",
		"cell soup":     "<table><tr><td><ul><li><pre>a\n\nb</pre></li></ul><blockquote>q</blockquote><h1>h</h1></td></tr></table>",
		"link soup":     "<a href='/x'><div><pre>code</pre></div></a><strong><pre>y</pre></strong>",
		"binary":        "\x00\x01\x02\xff\xfe<\x00p>\x80\x81",
		"attrs":         `<a href="` + strings.Repeat("a", 20000) + `">long</a><img src="` + strings.Repeat("%", 5000) + `">`,
		"bad ol":        `<ol start="-5"><li>a</li></ol><ol start="99999999999999"><li>b</li></ol><td colspan="999999">c</td>`,
		"comments":      "<!-- grounded:page --><!-- grounded:page x --><!-- grounded:page 12345678901 --><!----><!--",
		"cdata":         "<![CDATA[x]]><?php echo 1 ?><!DOCTYPE bogus>",
		"frameset":      "<frameset><frame src='/x'></frameset>",
		"marker attack": "<p>a</p><p>&lt;!-- grounded:page 3 --&gt;</p>",
	}
	for name, src := range cases {
		t.Run(name, func(t *testing.T) {
			for _, main := range []bool{false, true} {
				res, err := Convert([]byte(src), Options{MainContentOnly: main, BaseURL: mustURL(t, "https://example.com/")})
				if err != nil {
					continue // Refusing hostile input is fine; panicking is not.
				}
				assertWellFormed(t, res.Markdown)
				if !utf8.ValidString(res.Markdown) {
					t.Fatal("invalid UTF-8 output")
				}
				if name == "marker attack" && strings.Contains(res.Markdown, "\n<!-- grounded:page 3 -->") {
					t.Fatal("forged page marker")
				}
			}
		})
	}
	// Random byte soup built from HTML-significant fragments.
	parts := []string{"<", ">", "</", "<p>", "<li>", "<ul>", "<ol>", "<table>", "<tr>", "<td>", "<th>", "<pre>", "<code>", "<a href='x'>", "<h2>", "<b>", "<blockquote>", "<!--", "-->", " grounded:page 1 ", "`", "|", "*", "\n", " ", "text", "&amp;", "&", "\xff", "<br>", "<img src=y>", "<main>", "<nav>", "<article>"}
	rng := rand.New(rand.NewPCG(1, 2))
	for i := 0; i < 300; i++ {
		var b strings.Builder
		for j := 0; j < 200; j++ {
			b.WriteString(parts[rng.IntN(len(parts))])
		}
		for _, main := range []bool{false, true} {
			res, err := Convert([]byte(b.String()), Options{MainContentOnly: main})
			if err == nil {
				assertWellFormed(t, res.Markdown)
			}
		}
	}
}

func FuzzConvert(f *testing.F) {
	f.Add([]byte("<h1>t</h1><ul><li>a<ul><li>b</li></ul></li></ul><table><tr><td>x</td></tr></table>"), true)
	f.Add([]byte("<!-- grounded:page 1 --><pre>x</pre><blockquote><p>q</p></blockquote>"), false)
	f.Fuzz(func(t *testing.T, input []byte, main bool) {
		res, err := Convert(input, Options{MainContentOnly: main, MaxInputBytes: 1 << 16})
		if err != nil {
			return
		}
		if res.Markdown != "" && (!strings.HasSuffix(res.Markdown, "\n") || strings.HasSuffix(res.Markdown, "\n\n") || strings.HasPrefix(res.Markdown, "\n")) {
			t.Fatalf("malformed output %q", res.Markdown)
		}
	})
}

// A UTF-8 page with no charset declaration whose first non-ASCII text comes
// after the sniffer's 1,024 bytes stays UTF-8 ("’" was read as "â€™"), and a
// declared charset still wins.
func TestConvertCharsetAfterSniffWindow(t *testing.T) {
	head := "<!DOCTYPE html><html><head><title>Waitlist</title><style>" + strings.Repeat("/* padding */ ", 100) + "</style></head>"
	res, err := Convert([]byte(head+"<body><main><p>The Registrar’s office — room 222.</p></main></body></html>"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Markdown, "Registrar’s office — room 222") || strings.Contains(res.Markdown, "â€") {
		t.Fatalf("markdown = %q", res.Markdown)
	}
	latin := append([]byte(`<html><head><meta charset="iso-8859-1"></head><body><p>caf`), 0xE9, '<', '/', 'p', '>')
	if res, err := Convert(latin, Options{}); err != nil || !strings.Contains(res.Markdown, "café") {
		t.Fatalf("declared charset: %q %v", res.Markdown, err)
	}
}
