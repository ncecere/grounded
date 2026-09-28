package parse

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
	"testing"

	"golang.org/x/text/encoding/charmap"
)

// Fixture builders produce small, real documents so tests show exactly what
// each input contains.

func zipFiles(t testing.TB, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

const wNS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`

func docxFile(t testing.TB, body string, title string) []byte {
	styles := `<?xml version="1.0"?><w:styles ` + wNS + `>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="PolicyHeading"><w:name w:val="Policy Heading"/><w:basedOn w:val="Heading2"/></w:style>
<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`
	files := map[string]string{
		"[Content_Types].xml": `<Types/>`,
		"word/document.xml":   `<?xml version="1.0"?><w:document ` + wNS + `><w:body>` + body + `</w:body></w:document>`,
		"word/styles.xml":     styles,
	}
	if title != "" {
		files["docProps/core.xml"] = `<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>` + title + `</dc:title></cp:coreProperties>`
	}
	return zipFiles(t, files)
}

func wPara(style, text string) string {
	ppr := ""
	if style != "" {
		ppr = `<w:pPr><w:pStyle w:val="` + style + `"/></w:pPr>`
	}
	return `<w:p>` + ppr + `<w:r><w:t xml:space="preserve">` + text + `</w:t></w:r></w:p>`
}

func wListItem(level int, text string) string {
	return fmt.Sprintf(`<w:p><w:pPr><w:numPr><w:ilvl w:val="%d"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>%s</w:t></w:r></w:p>`, level, text)
}

type slide struct {
	title   string
	bullets []string // prefix with ">" per indent level
	notes   string
	table   [][]string
}

const pNS = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`

// pptxFile writes slides in the given order. Slide part names are assigned in
// reverse so the test proves ordering follows presentation.xml, not names.
func pptxFile(t testing.TB, slides []slide) []byte {
	files := map[string]string{"[Content_Types].xml": `<Types/>`}
	var ids, rels strings.Builder
	for i, s := range slides {
		part := fmt.Sprintf("slide%d.xml", len(slides)-i)
		rid := fmt.Sprintf("rId%d", i+10)
		ids.WriteString(fmt.Sprintf(`<p:sldId id="%d" r:id="%s"/>`, 256+i, rid))
		rels.WriteString(fmt.Sprintf(`<Relationship Id="%s" Target="slides/%s"/>`, rid, part))

		var body strings.Builder
		body.WriteString(`<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>` + s.title + `</a:t></a:r></a:p></p:txBody></p:sp>`)
		body.WriteString(`<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>`)
		for _, bl := range s.bullets {
			lvl := len(bl) - len(strings.TrimLeft(bl, ">"))
			body.WriteString(fmt.Sprintf(`<a:p><a:pPr lvl="%d"/><a:r><a:t>%s</a:t></a:r></a:p>`, lvl, strings.TrimLeft(bl, ">")))
		}
		body.WriteString(`</p:txBody></p:sp>`)
		body.WriteString(`<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>99</a:t></a:r></a:p></p:txBody></p:sp>`)
		if s.table != nil {
			body.WriteString(`<p:graphicFrame><a:graphic><a:graphicData><a:tbl>`)
			for _, row := range s.table {
				body.WriteString(`<a:tr>`)
				for _, c := range row {
					body.WriteString(`<a:tc><a:txBody><a:p><a:r><a:t>` + c + `</a:t></a:r></a:p></a:txBody></a:tc>`)
				}
				body.WriteString(`</a:tr>`)
			}
			body.WriteString(`</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`)
		}
		files["ppt/slides/"+part] = `<p:sld ` + pNS + `><p:cSld><p:spTree>` + body.String() + `</p:spTree></p:cSld></p:sld>`
		if s.notes != "" {
			notesPart := fmt.Sprintf("notesSlide%d.xml", i+1)
			files["ppt/slides/_rels/"+part+".rels"] = `<Relationships><Relationship Id="rId2" Target="../notesSlides/` + notesPart + `"/></Relationships>`
			files["ppt/notesSlides/"+notesPart] = `<p:notes ` + pNS + `><p:cSld><p:spTree>` +
				`<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>` +
				`<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>` + s.notes + `</a:t></a:r></a:p></p:txBody></p:sp>` +
				`</p:spTree></p:cSld></p:notes>`
		}
	}
	files["ppt/presentation.xml"] = `<p:presentation ` + pNS + `><p:sldIdLst>` + ids.String() + `</p:sldIdLst></p:presentation>`
	files["ppt/_rels/presentation.xml.rels"] = `<Relationships>` + rels.String() + `</Relationships>`
	return zipFiles(t, files)
}

// pdfText is one line of text drawn on a page.
type pdfText struct {
	size float64
	y    float64
	text string
}

// pdfTextAt is a line drawn at an explicit x position.
type pdfTextAt struct {
	size, x, y float64
	text       string
}

// pdfFileAt is pdfFile with explicit x positions (for indentation tests).
func pdfFileAt(t testing.TB, pages [][]pdfTextAt) []byte { return buildPDF(t, "", pages) }

// pdfFile builds a PDF with every line at the default left margin (x=72).
func pdfFile(t testing.TB, title string, pages [][]pdfText) []byte {
	conv := make([][]pdfTextAt, len(pages))
	for i, p := range pages {
		conv[i] = []pdfTextAt{}
		for _, l := range p {
			conv[i] = append(conv[i], pdfTextAt{size: l.size, x: 72, y: l.y, text: l.text})
		}
	}
	return buildPDF(t, title, conv)
}

// buildPDF builds a minimal valid PDF (Helvetica text, correct xref offsets).
// A page with no texts gets a filled rectangle instead, like a scanned image.
func buildPDF(t testing.TB, title string, pages [][]pdfTextAt) []byte {
	t.Helper()
	esc := strings.NewReplacer(`\`, `\\`, `(`, `\(`, `)`, `\)`)
	var objs []string
	add := func(s string) int { objs = append(objs, s); return len(objs) }
	add("") // 1 catalog, filled below
	add("") // 2 pages
	font := add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
	var kids []string
	for _, lines := range pages {
		var content strings.Builder
		if len(lines) == 0 {
			content.WriteString("0.5 g 72 72 468 648 re f\n")
		}
		for _, l := range lines {
			// Helvetica with WinAnsiEncoding: text must be Windows-1252 bytes.
			ansi, err := charmap.Windows1252.NewEncoder().String(l.text)
			if err != nil {
				t.Fatal(err)
			}
			content.WriteString(fmt.Sprintf("BT /F1 %.1f Tf %.1f %.1f Td (%s) Tj ET\n", l.size, l.x, l.y, esc.Replace(ansi)))
		}
		stream := content.String()
		c := add(fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(stream), stream))
		p := add(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>", font, c))
		kids = append(kids, fmt.Sprintf("%d 0 R", p))
	}
	objs[0] = "<< /Type /Catalog /Pages 2 0 R >>"
	objs[1] = fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(kids))
	info := 0
	if title != "" {
		info = add("<< /Title (" + esc.Replace(title) + ") >>")
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, o := range objs {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	trailer := fmt.Sprintf("<< /Size %d /Root 1 0 R", len(objs)+1)
	if info > 0 {
		trailer += fmt.Sprintf(" /Info %d 0 R", info)
	}
	fmt.Fprintf(&b, "trailer\n%s >>\nstartxref\n%d\n%%%%EOF\n", trailer, xref)
	return b.Bytes()
}
