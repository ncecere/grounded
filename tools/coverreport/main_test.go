package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadDeduplicatesBlocksAcrossBinaries(t *testing.T) {
	p := filepath.Join(t.TempDir(), "c.out")
	profile := "mode: atomic\n" +
		"example.com/m/a/x.go:1.1,2.2 3 0\n" +
		"example.com/m/a/x.go:1.1,2.2 3 5\n" + // same block, covered by another binary
		"example.com/m/a/x.go:3.1,4.2 2 0\n" +
		"example.com/m/b/y.go:1.1,2.2 4 1\n"
	if err := os.WriteFile(p, []byte(profile), 0o600); err != nil {
		t.Fatal(err)
	}
	pkgs, err := read(p)
	if err != nil {
		t.Fatal(err)
	}
	if a := pkgs["example.com/m/a"]; a.total != 5 || a.covered != 3 {
		t.Fatalf("a = %+v", *a)
	}
	out := render(pkgs)
	if !strings.Contains(out, "77.8% of 9 statements") || strings.Index(out, "`example.com/m/a`") > strings.Index(out, "`example.com/m/b`") {
		t.Fatalf("render:\n%s", out)
	}
}
