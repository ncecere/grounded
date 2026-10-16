package testutil

import (
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestParseTimeScale(t *testing.T) {
	for in, want := range map[string]float64{
		"": 1, "  ": 1, "1": 1, "3": 3, " 3 ": 3, "10": 10, "2.5": 2.5,
		// Never shortens, never beyond 10, never a word.
		"0.5": 1, "0": 1, "-3": 1, "11": 1, "100": 1, "abc": 1, "NaN": 1, "Inf": 1, "-Inf": 1, "3x": 1,
	} {
		if got := ParseTimeScale(in); got != want || math.IsNaN(got) {
			t.Errorf("ParseTimeScale(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestScale(t *testing.T) {
	t.Setenv("TEST_TIME_SCALE", "")
	if got := Scale(45 * time.Second); got != 45*time.Second {
		t.Errorf("default = %v: CI must be unchanged", got)
	}
	t.Setenv("TEST_TIME_SCALE", "3")
	if got := Scale(45 * time.Second); got != 135*time.Second {
		t.Errorf("scale 3 = %v, want 135s", got)
	}
	t.Setenv("TEST_TIME_SCALE", "0.1")
	if got := Scale(45 * time.Second); got != 45*time.Second {
		t.Errorf("a scale below 1 shortened the limit: %v", got)
	}
}

// A poll's deadline in an integration test must go through Scale, or the cluster's TEST_TIME_SCALE does not reach it and the wait gets no
// headroom on a slower machine (which is how TestDocumentProblemsForAdmins failed on the cluster and never on GitHub). Durations the test
// is about (a TTL, a timeout it expects) are not deadlines of a poll and are not named "deadline".
func TestWaitDeadlinesAreScaled(t *testing.T) {
	root := filepath.Join("..", "..")
	re := regexp.MustCompile(`\bdeadline\s*:?=\s*time\.Now\(\)\.Add\(`)
	checked := 0
	for _, dir := range []string{"internal", "cmd"} {
		err := filepath.WalkDir(filepath.Join(root, dir), func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, "_integration_test.go") {
				return err
			}
			src, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			for i, line := range strings.Split(string(src), "\n") {
				if !re.MatchString(line) {
					continue
				}
				checked++
				if !strings.Contains(line, "testutil.Scale(") {
					t.Errorf("%s:%d: a poll's deadline is not scaled (use testutil.Scale): %s", path, i+1, strings.TrimSpace(line))
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if checked < 10 {
		t.Fatalf("found only %d poll deadlines: the search no longer finds them", checked)
	}
}
