package auditexport

import "context"

var spoolSlots = make(chan struct{}, 2)

func takeSpool(ctx context.Context) error {
	select {
	case spoolSlots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func releaseSpool() { <-spoolSlots }
