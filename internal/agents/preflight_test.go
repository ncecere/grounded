package agents

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// slot is a fake concurrent-chat slot: held counts the slots not released.
type slot struct{ held atomic.Int32 }

func (s *slot) admit(err error) func() (func(), error) {
	return func() (func(), error) {
		if err != nil {
			return nil, err
		}
		s.held.Add(1)
		return func() { s.held.Add(-1) }, nil
	}
}

// A step that fails after admission took a chat slot releases the slot, and its error is the answer's. A slower step
// has finished when admitAlongside returns: nothing is left running.
func TestAdmitAlongsideReleasesTheSlotWhenAStepFails(t *testing.T) {
	var s slot
	kbErr := errors.New("knowledge bases unreadable")
	var slowDone atomic.Bool
	release, err := admitAlongside(s.admit(nil),
		func() error { return kbErr },
		func() error { time.Sleep(30 * time.Millisecond); slowDone.Store(true); return nil },
	)
	if !errors.Is(err, kbErr) || release != nil {
		t.Fatalf("admitAlongside = %v, %v; want the step's error and no release", release != nil, err)
	}
	if n := s.held.Load(); n != 0 {
		t.Fatalf("%d chat slot(s) still held after a sibling failed", n)
	}
	if !slowDone.Load() {
		t.Fatal("admitAlongside returned while a step was still running")
	}
}

// When admission and a step both fail, admission's error wins (it came first when the steps ran one after another),
// even when the step fails sooner.
func TestAdmitAlongsideKeepsTheSerialErrorOrder(t *testing.T) {
	var s slot
	limited, kbErr, callerErr := errors.New("too many chats"), errors.New("knowledge bases"), errors.New("caller")
	for range 10 {
		_, err := admitAlongside(func() (func(), error) { time.Sleep(5 * time.Millisecond); return s.admit(limited)() },
			func() error { return kbErr })
		if !errors.Is(err, limited) {
			t.Fatalf("err = %v, want admission's", err)
		}
		_, err = admitAlongside(s.admit(nil),
			func() error { time.Sleep(5 * time.Millisecond); return kbErr },
			func() error { return callerErr })
		if !errors.Is(err, kbErr) {
			t.Fatalf("err = %v, want the first step's", err)
		}
	}
	if n := s.held.Load(); n != 0 {
		t.Fatalf("%d slot(s) leaked", n)
	}
	release, err := admitAlongside(s.admit(nil), func() error { return nil })
	if err != nil || s.held.Load() != 1 {
		t.Fatalf("a successful preflight: %v, %d held", err, s.held.Load())
	}
	release()
	if s.held.Load() != 0 {
		t.Fatal("release didn't release")
	}
}
