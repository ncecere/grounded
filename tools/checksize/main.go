// Command checksize fails when Go source files or functions grow past the
// size limits in CONTRIBUTING.md ("Code size and complexity"): it keeps
// oversized, tangled files and functions out of the tree. Generated files
// (with a "Code generated ... DO NOT EDIT." header) are skipped.
//
//	go run ./tools/checksize [-file 600] [-testfile 1200] [-func 100] dir...
package main

import (
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type limits struct {
	file, testFile, fn int
}

type violation struct {
	pos   string
	what  string
	lines int
	limit int
}

func main() {
	var l limits
	flag.IntVar(&l.file, "file", 600, "maximum lines in a non-test .go file")
	flag.IntVar(&l.testFile, "testfile", 1200, "maximum lines in a _test.go file")
	flag.IntVar(&l.fn, "func", 100, "maximum lines in a non-test function or method")
	flag.Parse()
	roots := flag.Args()
	if len(roots) == 0 {
		roots = []string{"."}
	}
	var found []violation
	for _, root := range roots {
		vs, err := checkTree(root, l)
		if err != nil {
			fmt.Fprintln(os.Stderr, "checksize:", err)
			os.Exit(2)
		}
		found = append(found, vs...)
	}
	sort.Slice(found, func(i, j int) bool { return found[i].lines > found[j].lines })
	for _, v := range found {
		fmt.Printf("%s: %s has %d lines (limit %d)\n", v.pos, v.what, v.lines, v.limit)
	}
	if len(found) > 0 {
		fmt.Println("split by responsibility: see CONTRIBUTING.md, \"Code size and complexity\"")
		os.Exit(1)
	}
}

func checkTree(root string, l limits) ([]violation, error) {
	var found []violation
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if name := d.Name(); path != root && (name == "testdata" || name == "node_modules" || strings.HasPrefix(name, ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		vs, err := checkFile(path, l)
		found = append(found, vs...)
		return err
	})
	return found, err
}

func checkFile(path string, l limits) ([]violation, error) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
	if err != nil {
		return nil, err
	}
	if ast.IsGenerated(f) {
		return nil, nil
	}
	test := strings.HasSuffix(path, "_test.go")
	var found []violation
	lines := fset.File(f.Pos()).LineCount()
	if limit := pick(test, l.testFile, l.file); lines > limit {
		found = append(found, violation{path, "file", lines, limit})
	}
	if test {
		return found, nil
	}
	for _, decl := range f.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		start, end := fset.Position(fn.Pos()), fset.Position(fn.End())
		if n := end.Line - start.Line + 1; n > l.fn {
			found = append(found, violation{fmt.Sprintf("%s:%d", path, start.Line), "func " + funcName(fn), n, l.fn})
		}
	}
	return found, nil
}

func funcName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return fn.Name.Name
	}
	t := fn.Recv.List[0].Type
	if star, ok := t.(*ast.StarExpr); ok {
		t = star.X
	}
	if idx, ok := t.(*ast.IndexExpr); ok { // generic receiver
		t = idx.X
	}
	if id, ok := t.(*ast.Ident); ok {
		return id.Name + "." + fn.Name.Name
	}
	return fn.Name.Name
}

func pick(test bool, testLimit, limit int) int {
	if test {
		return testLimit
	}
	return limit
}
