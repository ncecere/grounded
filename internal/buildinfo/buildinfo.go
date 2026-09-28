// Package buildinfo exposes version metadata injected at link time.
package buildinfo

import "fmt"

// Set with -ldflags "-X github.com/ncecere/grounded/internal/buildinfo.Version=..."
var (
	Version = "dev"
	Commit  = "unknown"
)

func String() string { return fmt.Sprintf("grounded %s (%s)", Version, Commit) }
