package parse

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

// node is a minimal XML element tree for OOXML parts. Names are local names;
// namespaces are ignored because OOXML prefixes are stable in practice.
type node struct {
	name     string
	attrs    map[string]string
	children []*node
	text     string // character data directly inside this element
}

func (n *node) attr(name string) string { return n.attrs[name] }

// child returns the first direct child with the given name.
func (n *node) child(name string) *node {
	for _, c := range n.children {
		if c.name == name {
			return c
		}
	}
	return nil
}

// find returns the first descendant (depth-first) with the given name.
func (n *node) find(name string) *node {
	for _, c := range n.children {
		if c.name == name {
			return c
		}
		if f := c.find(name); f != nil {
			return f
		}
	}
	return nil
}

// path follows direct children by name.
func (n *node) path(names ...string) *node {
	cur := n
	for _, name := range names {
		if cur == nil {
			return nil
		}
		cur = cur.child(name)
	}
	return cur
}

const maxXMLDepth = 256

func parseXML(r io.Reader) (*node, error) {
	dec := xml.NewDecoder(r)
	dec.Strict = false
	root := &node{name: "#root"}
	stack := []*node{root}
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return root, nil
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if len(stack) > maxXMLDepth {
				return nil, fmt.Errorf("xml nested too deeply")
			}
			n := &node{name: t.Name.Local}
			if len(t.Attr) > 0 {
				n.attrs = make(map[string]string, len(t.Attr))
				for _, a := range t.Attr {
					n.attrs[a.Name.Local] = a.Value
				}
			}
			parent := stack[len(stack)-1]
			parent.children = append(parent.children, n)
			stack = append(stack, n)
		case xml.EndElement:
			if len(stack) > 1 {
				stack = stack[:len(stack)-1]
			}
		case xml.CharData:
			stack[len(stack)-1].text += string(t)
		}
	}
}

// zipDoc reads parts from an OOXML package with decompression limits, so a
// zip bomb cannot exhaust memory.
type zipDoc struct {
	files     map[string]*zip.File
	remaining int64
}

func openZip(data []byte, lim Limits) (*zipDoc, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("%w: unreadable archive", ErrCorrupt)
	}
	if len(zr.File) > lim.MaxZipEntries {
		return nil, fmt.Errorf("%w: archive has too many entries", ErrTooLarge)
	}
	z := &zipDoc{files: make(map[string]*zip.File, len(zr.File)), remaining: lim.MaxUnzippedBytes}
	for _, f := range zr.File {
		z.files[f.Name] = f
		if f.Name == "EncryptionInfo" || f.Name == "EncryptedPackage" {
			return nil, ErrEncrypted
		}
	}
	return z, nil
}

// xml parses one part; a missing part returns (nil, nil).
func (z *zipDoc) xml(name string) (*node, error) {
	f, ok := z.files[name]
	if !ok {
		return nil, nil
	}
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", ErrCorrupt, name, err)
	}
	defer rc.Close()
	budget := z.remaining + 1
	lr := &io.LimitedReader{R: rc, N: budget}
	n, err := parseXML(lr)
	z.remaining -= budget - lr.N // bytes actually decompressed
	if lr.N <= 0 || z.remaining < 0 {
		return nil, fmt.Errorf("%w: decompressed content exceeds the limit", ErrTooLarge)
	}
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", ErrCorrupt, name, err)
	}
	return n, nil
}

// relationships maps relationship IDs to targets for a part's .rels file.
func (z *zipDoc) relationships(relsPath string) (map[string]string, error) {
	n, err := z.xml(relsPath)
	if err != nil || n == nil {
		return map[string]string{}, err
	}
	out := map[string]string{}
	if root := n.child("Relationships"); root != nil {
		for _, r := range root.children {
			if r.name == "Relationship" {
				out[r.attr("Id")] = r.attr("Target")
			}
		}
	}
	return out, nil
}

// coreTitle reads dc:title from docProps/core.xml.
func (z *zipDoc) coreTitle() string {
	n, err := z.xml("docProps/core.xml")
	if err != nil || n == nil {
		return ""
	}
	if t := n.find("title"); t != nil {
		return strings.TrimSpace(t.text)
	}
	return ""
}

// markdownTable renders rows as a pipe table; the first row is the header.
func markdownTable(rows [][]string) string {
	if len(rows) == 0 {
		return ""
	}
	cols := 0
	for _, r := range rows {
		cols = max(cols, len(r))
	}
	if cols == 0 {
		return ""
	}
	cell := func(s string) string {
		s = strings.Join(strings.Fields(s), " ")
		return strings.ReplaceAll(s, "|", `\|`)
	}
	var b strings.Builder
	for i, r := range rows {
		b.WriteString("|")
		for c := 0; c < cols; c++ {
			v := ""
			if c < len(r) {
				v = cell(r[c])
			}
			b.WriteString(" " + v + " |")
		}
		b.WriteString("\n")
		if i == 0 {
			b.WriteString("|" + strings.Repeat(" --- |", cols) + "\n")
		}
	}
	return b.String()
}
