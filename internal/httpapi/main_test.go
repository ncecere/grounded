package httpapi_test

import (
	"context"
	"os"
	"testing"

	"github.com/ncecere/grounded/internal/parse"
)

// TestMain starts compiling the PDF engine at once. Every application the tests build has its own parser, but the
// compiled engine is shared by the process (parse.pdfCompiled), and compiling it takes about half a minute under the
// race detector: begun here, it is ready by the time the parallel tests upload their first PDF, instead of one of
// them waiting for it with the other tests competing for the processors. A run that parses no PDF does not wait.
func TestMain(m *testing.M) {
	go func() {
		p := parse.NewBuiltin(parse.Limits{}, 1)
		defer p.Close()
		_, _ = p.Parse(context.Background(), parse.Input{Name: "warm.pdf", Kind: parse.KindPDF, Data: []byte("%PDF-1.4\n")})
	}()
	os.Exit(m.Run())
}
