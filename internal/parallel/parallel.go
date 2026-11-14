// Package parallel runs independent steps of one request together while keeping what a caller sees the same as when
// they ran one after another (#251): the steps' wait becomes the slowest step instead of their sum.
package parallel

import "golang.org/x/sync/errgroup"

// InOrder runs the steps concurrently and returns once every one has returned (none is cancelled by another's
// failure, so none is left running). It returns the error of the first step, in the order given, that failed: the
// error a serial run would have met first, whichever step finished first. A step must not depend on another's
// result, or protect what it shares with the others itself.
func InOrder(steps ...func() error) error {
	errs := make([]error, len(steps))
	var g errgroup.Group
	for i, step := range steps {
		g.Go(func() error {
			errs[i] = step()
			return nil
		})
	}
	_ = g.Wait()
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}
