// Command depinventory writes the dependency inventory of
// docs/security/dependencies.md: the direct Go and npm dependencies with
// their versions and licenses, and every license found among the Go
// modules compiled into `grounded` and the npm packages of the built UI,
// with the ones that aren't permissive called out. It replaces the text
// between the "inventory:start" and "inventory:end" markers.
//
//	go run ./tools/depinventory [-doc docs/security/dependencies.md] [-web web]
//
// Go licenses are read from each module's LICENSE file in the module cache
// (run `go mod download` first); npm licenses from web/package-lock.json and
// web/node_modules. Detection is by well-known license text: anything it
// can't name is listed as "unknown" for a person to check.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const (
	startMarker = "<!-- inventory:start -->"
	endMarker   = "<!-- inventory:end -->"
)

// permissive licenses need no action beyond keeping their notices.
var permissive = map[string]bool{
	"MIT": true, "Apache-2.0": true, "BSD-2-Clause": true, "BSD-3-Clause": true, "ISC": true, "0BSD": true,
	"Unlicense": true, "CC0-1.0": true, "BlueOak-1.0.0": true, "Python-2.0": true, "CC-BY-4.0": true, "Zlib": true,
}

type dep struct {
	name, version, license string
	dev                    bool
}

func main() {
	doc := flag.String("doc", "docs/security/dependencies.md", "the document to update")
	web := flag.String("web", "web", "the web UI directory")
	flag.Parse()
	goDirect, goAll, err := goModules()
	if err != nil {
		fail(err)
	}
	npmDirect, npmAll, err := npmPackages(*web)
	if err != nil {
		fail(err)
	}
	var b strings.Builder
	writeTable(&b, "Go modules required directly (go.mod)", goDirect)
	writeTable(&b, "npm packages required directly (web/package.json)", npmDirect)
	writeLicenses(&b, goAll, npmAll)
	if err := replaceSection(*doc, b.String()); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "depinventory:", err)
	os.Exit(1)
}

// ---- Go ---------------------------------------------------------------------------

type goModule struct {
	Path, Version, Dir string
	Main, Indirect     bool
}

// goModules returns the direct requirements, and the modules compiled into
// `grounded` (the SBOM's Go content).
func goModules() (direct, linked []dep, err error) {
	out, err := exec.Command("go", "list", "-m", "-json", "all").Output()
	if err != nil {
		return nil, nil, fmt.Errorf("go list -m: %w", err)
	}
	dirs := map[string]goModule{}
	dec := json.NewDecoder(bytes.NewReader(out))
	for dec.More() {
		var m goModule
		if err := dec.Decode(&m); err != nil {
			return nil, nil, err
		}
		if m.Main {
			continue
		}
		dirs[m.Path] = m
		if !m.Indirect {
			direct = append(direct, dep{name: m.Path, version: m.Version, license: goLicense(m.Dir)})
		}
	}
	out, err = exec.Command("go", "list", "-deps", "-f", "{{with .Module}}{{if not .Main}}{{.Path}}{{end}}{{end}}", "./cmd/grounded").Output()
	if err != nil {
		return nil, nil, fmt.Errorf("go list -deps: %w", err)
	}
	seen := map[string]bool{}
	for _, p := range strings.Fields(string(out)) {
		if m, ok := dirs[p]; ok && !seen[p] {
			seen[p] = true
			linked = append(linked, dep{name: p, version: m.Version, license: goLicense(m.Dir)})
		}
	}
	return direct, linked, nil
}

// goLicense names the license in a module directory.
func goLicense(dir string) string {
	if dir == "" {
		return "unknown (not downloaded)"
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		n := strings.ToUpper(e.Name())
		if strings.HasPrefix(n, "LICENSE") || strings.HasPrefix(n, "LICENCE") || strings.HasPrefix(n, "COPYING") {
			if text, err := os.ReadFile(filepath.Join(dir, e.Name())); err == nil {
				return classify(string(text))
			}
		}
	}
	return "unknown"
}

// classify names a license from its text.
func classify(text string) string {
	t := strings.Join(strings.Fields(text), " ")
	has := func(s ...string) bool {
		for _, x := range s {
			if !strings.Contains(t, x) {
				return false
			}
		}
		return true
	}
	switch {
	case has("Apache License", "Version 2.0"):
		return "Apache-2.0"
	case has("Mozilla Public License", "2.0"):
		return "MPL-2.0"
	case has("GNU AFFERO GENERAL PUBLIC LICENSE"):
		return "AGPL"
	case has("GNU LESSER GENERAL PUBLIC LICENSE"):
		return "LGPL"
	case has("GNU GENERAL PUBLIC LICENSE"):
		return "GPL"
	case has("Permission is hereby granted, free of charge"):
		return "MIT"
	case has("Redistribution and use in source and binary forms") && (has("Neither the name") || has("names of its contributors")):
		return "BSD-3-Clause"
	case has("Redistribution and use in source and binary forms"):
		return "BSD-2-Clause"
	case has("Permission to use, copy, modify, and/or distribute this software"), has("Permission to use, copy, modify, and distribute this software"):
		return "ISC"
	case has("This is free and unencumbered software"):
		return "Unlicense"
	}
	return "unknown"
}

// ---- npm --------------------------------------------------------------------------

type lockfile struct {
	Packages map[string]struct {
		Version string          `json:"version"`
		License json.RawMessage `json:"license"`
		Dev     bool            `json:"dev"`
	} `json:"packages"`
}

// npmPackages returns the direct dependencies (runtime and development) and
// every runtime package (what the built UI can contain).
func npmPackages(web string) (direct, runtime []dep, err error) {
	var pkg struct{ Dependencies, DevDependencies map[string]string }
	var lock lockfile
	if err := readJSON(filepath.Join(web, "package.json"), &pkg); err != nil {
		return nil, nil, err
	}
	if err := readJSON(filepath.Join(web, "package-lock.json"), &lock); err != nil {
		return nil, nil, err
	}
	entry := func(name string) dep {
		p := lock.Packages["node_modules/"+name]
		return dep{name: name, version: p.Version, license: npmLicense(p.License), dev: p.Dev}
	}
	for _, group := range []map[string]string{pkg.Dependencies, pkg.DevDependencies} {
		for name := range group {
			direct = append(direct, entry(name))
		}
	}
	for path, p := range lock.Packages {
		if path != "" && !p.Dev && strings.Contains(path, "node_modules/") {
			name := path[strings.LastIndex(path, "node_modules/")+len("node_modules/"):]
			runtime = append(runtime, dep{name: name, version: p.Version, license: npmLicense(p.License)})
		}
	}
	return direct, runtime, nil
}

func npmLicense(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil && s != "" {
		return s
	}
	var o struct{ Type string }
	if json.Unmarshal(raw, &o) == nil && o.Type != "" {
		return o.Type
	}
	return "unknown"
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// ---- output -----------------------------------------------------------------------

func writeTable(b *strings.Builder, title string, deps []dep) {
	sort.Slice(deps, func(i, j int) bool { return deps[i].name < deps[j].name })
	fmt.Fprintf(b, "\n### %s\n\n| Dependency | Version | License | |\n|---|---|---|---|\n", title)
	for _, d := range deps {
		note := ""
		if d.dev {
			note = "development only"
		}
		if !isPermissive(d.license) {
			note = strings.TrimPrefix(note+"; **review**", "; ")
		}
		fmt.Fprintf(b, "| `%s` | %s | %s | %s |\n", d.name, d.version, d.license, note)
	}
}

// writeLicenses counts licenses over everything shipped, and lists what isn't
// permissive.
func writeLicenses(b *strings.Builder, goAll, npmAll []dep) {
	fmt.Fprintf(b, "\n### Licenses of everything shipped\n\n%d Go modules are compiled into `grounded`; %d npm packages can end up in the built UI (runtime dependencies, direct and transitive; development tools are not shipped).\n\n",
		len(goAll), len(npmAll))
	fmt.Fprintf(b, "| License | Go modules | npm packages |\n|---|---|---|\n")
	counts := map[string][2]int{}
	for i, list := range [][]dep{goAll, npmAll} {
		for _, d := range list {
			c := counts[d.license]
			c[i]++
			counts[d.license] = c
		}
	}
	var names []string
	for n := range counts {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		fmt.Fprintf(b, "| %s | %d | %d |\n", n, counts[n][0], counts[n][1])
	}
	var review []string
	for _, list := range [][]dep{goAll, npmAll} {
		for _, d := range list {
			if !isPermissive(d.license) {
				review = append(review, fmt.Sprintf("- `%s` %s: %s", d.name, d.version, d.license))
			}
		}
	}
	sort.Strings(review)
	if len(review) == 0 {
		b.WriteString("\nEvery shipped dependency has a permissive license.\n")
		return
	}
	b.WriteString("\nNot (or not recognisably) permissive, to review:\n\n" + strings.Join(review, "\n") + "\n")
}

// isPermissive accepts SPDX expressions whose every alternative in an OR,
// or every part of an AND, is permissive.
func isPermissive(license string) bool {
	l := strings.Trim(license, "()")
	if strings.Contains(l, " OR ") {
		for _, p := range strings.Split(l, " OR ") {
			if isPermissive(p) {
				return true
			}
		}
		return false
	}
	for _, p := range strings.Split(l, " AND ") {
		if !permissive[strings.TrimSpace(strings.Trim(p, "()"))] {
			return false
		}
	}
	return true
}

func replaceSection(path, body string) error {
	doc, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	s := string(doc)
	i, j := strings.Index(s, startMarker), strings.Index(s, endMarker)
	if i < 0 || j < i {
		return fmt.Errorf("%s has no %s ... %s section", path, startMarker, endMarker)
	}
	return os.WriteFile(path, []byte(s[:i+len(startMarker)]+"\n"+body+"\n"+s[j:]), 0o644)
}
