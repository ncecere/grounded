//go:build !race

package analytics_test

// raceEnabled reports whether the race detector is on. It slows database-heavy
// code several times over, so timing budgets are relaxed under it.
const raceEnabled = false
