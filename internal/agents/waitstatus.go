// "Working on it…" while an answer waits for capacity (roadmap G22). A request to the model or to SystemOne can queue
// silently: the connection's requests-per-minute pacer reserves a later slot, and SystemOne's concurrency slots line
// requests up. The gateway and SystemOne report such a wait through the request's context (gateway.BeginWait); the run
// turns it into a status step, so the reader sees that the answer is waiting rather than a status that stopped moving.

package agents

import (
	"sync"
	"sync/atomic"
	"time"
)

// stepState is the status a run has told the reader. step is the last status event's step (not "waiting": that overlays
// it); stepMu guards it, as waits end on other goroutines. waits are the waits in progress, and written is set when the
// model has started to write.
type stepState struct {
	step    string
	stepMu  sync.Mutex
	waits   waitState
	written atomic.Bool
}

// waitState counts the waits in progress. The search, the input moderation and the scope check run side by side, so
// several can overlap: the reader gets one "waiting" for all of them. mu is held while the status is sent, so the
// "waiting" and the step that follows it never swap places.
type waitState struct {
	mu sync.Mutex
	n  int
}

// waitNotice is the run's gateway.WaitNotice: the wait is a status overlay (the run's step is left alone), and the
// step the reader was on comes back when the last wait is over. Once the model writes there is nothing to tell: the
// reader has words, and the checks and the follow-up suggestions come after.
func (ru *run) waitNotice(time.Duration) (done func()) {
	if ru.written.Load() {
		return func() {}
	}
	ru.waits.mu.Lock()
	defer ru.waits.mu.Unlock()
	if ru.waits.n++; ru.waits.n == 1 {
		ru.sendStep(StepWaiting)
	}
	var once sync.Once
	return func() { once.Do(ru.endWait) }
}

func (ru *run) endWait() {
	ru.waits.mu.Lock()
	defer ru.waits.mu.Unlock()
	if ru.waits.n--; ru.waits.n > 0 {
		return
	}
	// Back to the step the reader was on, unless the answer is on its way (or there was no step yet: the next one
	// replaces "waiting").
	if step := ru.currentStep(); step != "" && step != StepAnswering && !ru.written.Load() {
		ru.sendStep(step)
	}
}

// writing records that the model has started to write.
func (ru *run) writing() { ru.written.Store(true) }
