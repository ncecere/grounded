// Command coverreport summarises a Go coverage profile per package, as a
// Markdown table (for CI job summaries) sorted from least to most covered.
package main

import (
	"bufio"
	"fmt"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
)

type counts struct{ total, covered int }

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: coverreport coverage.out")
		os.Exit(2)
	}
	pkgs, err := read(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "coverreport:", err)
		os.Exit(1)
	}
	fmt.Print(render(pkgs))
}

// read sums statements per package. With -coverpkg the same block can appear
// once per test binary, so blocks are deduplicated and counted as covered if
// any binary executed them.
func read(file string) (map[string]*counts, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	type block struct {
		stmts   int
		covered bool
	}
	blocks := map[string]*block{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "mode:") || line == "" {
			continue
		}
		fields := strings.Fields(line) // file:start,end stmts count
		if len(fields) != 3 {
			continue
		}
		stmts, err1 := strconv.Atoi(fields[1])
		hits, err2 := strconv.Atoi(fields[2])
		if err1 != nil || err2 != nil {
			continue
		}
		b := blocks[fields[0]]
		if b == nil {
			b = &block{stmts: stmts}
			blocks[fields[0]] = b
		}
		b.covered = b.covered || hits > 0
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	pkgs := map[string]*counts{}
	for id, b := range blocks {
		file := id[:strings.LastIndex(id, ":")]
		pkg := path.Dir(file)
		c := pkgs[pkg]
		if c == nil {
			c = &counts{}
			pkgs[pkg] = c
		}
		c.total += b.stmts
		if b.covered {
			c.covered += b.stmts
		}
	}
	return pkgs, nil
}

func pct(c *counts) float64 {
	if c.total == 0 {
		return 100
	}
	return 100 * float64(c.covered) / float64(c.total)
}

func render(pkgs map[string]*counts) string {
	names := make([]string, 0, len(pkgs))
	all := &counts{}
	for n, c := range pkgs {
		names = append(names, n)
		all.total += c.total
		all.covered += c.covered
	}
	sort.Slice(names, func(i, j int) bool {
		pi, pj := pct(pkgs[names[i]]), pct(pkgs[names[j]])
		if pi != pj {
			return pi < pj
		}
		return names[i] < names[j]
	})
	var b strings.Builder
	fmt.Fprintf(&b, "### Go coverage: %.1f%% of %d statements (unit and integration tests)\n\n", pct(all), all.total)
	b.WriteString("| Package | Coverage | Statements |\n|---|---:|---:|\n")
	for _, n := range names {
		c := pkgs[n]
		fmt.Fprintf(&b, "| `%s` | %.1f%% | %d |\n", strings.TrimPrefix(n, "github.com/ncecere/grounded/"), pct(c), c.total)
	}
	return b.String()
}
