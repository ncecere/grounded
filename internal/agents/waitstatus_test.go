package agents

import (
	"sync"
	"testing"
	"time"
)

// statusRun is a run whose events are collected as the steps they carry.
func statusRun() (*run, func() []string) {
	var mu sync.Mutex
	var steps []string
	ru := &run{}
	ru.out = &streamer{emit: func(ev Event) {
		if s, ok := ev.Data.(StatusEvent); ok {
			mu.Lock()
			steps = append(steps, s.Step)
			mu.Unlock()
		}
	}}
	return ru, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), steps...)
	}
}

func same(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func check(t *testing.T, got func() []string, want ...string) {
	t.Helper()
	if g := got(); !same(g, want) {
		t.Errorf("status steps = %v, want %v", g, want)
	}
}

// A wait during a step says "waiting", then goes back to the step the reader was on (G22).
func TestWaitStatusReturnsToTheStepItInterrupted(t *testing.T) {
	ru, got := statusRun()
	ru.status(StepSearching)
	done := ru.waitNotice(2 * time.Second)
	check(t, got, StepSearching, StepWaiting)
	if ru.currentStep() != StepSearching {
		t.Errorf("the wait replaced the step: %q", ru.currentStep())
	}
	done()
	check(t, got, StepSearching, StepWaiting, StepSearching)
}

// The search and the checks run side by side: two waits make one "waiting", and the step comes back when the last ends.
func TestWaitStatusOverlappingWaitsMakeOneStatus(t *testing.T) {
	ru, got := statusRun()
	ru.status(StepThinking)
	first := ru.waitNotice(0)
	second := ru.waitNotice(0)
	check(t, got, StepThinking, StepWaiting)
	first()
	check(t, got, StepThinking, StepWaiting) // one is still waiting
	second()
	check(t, got, StepThinking, StepWaiting, StepThinking)
	second() // ending twice changes nothing
	first()
	check(t, got, StepThinking, StepWaiting, StepThinking)
}

// Before the first step there is nothing to go back to: the status just stays what the next step makes it.
func TestWaitStatusBeforeAnyStepHasNothingToReturnTo(t *testing.T) {
	ru, got := statusRun()
	done := ru.waitNotice(time.Second)
	done()
	check(t, got, StepWaiting)
}

// A step that begins during the wait is the one to return to.
func TestWaitStatusReturnsToTheStepThatCameLast(t *testing.T) {
	ru, got := statusRun()
	ru.status(StepRewriting)
	done := ru.waitNotice(time.Second)
	ru.status(StepSearching)
	done()
	check(t, got, StepRewriting, StepWaiting, StepSearching, StepSearching)
}

// Once the model writes, waits are no longer news: the reader has words, and the checks and the suggestions come after.
func TestWaitStatusIsQuietOnceTheModelWrites(t *testing.T) {
	ru, got := statusRun()
	ru.status(StepThinking)
	ru.writing()
	ru.waitNotice(time.Second)()
	check(t, got, StepThinking)
}

// A wait that began before the first words and ends after them must not put the old step back over the answer.
func TestWaitStatusDoesNotBringBackAStepOverTheAnswer(t *testing.T) {
	ru, got := statusRun()
	ru.status(StepThinking)
	done := ru.waitNotice(time.Second)
	ru.writing()
	ru.status(StepAnswering)
	done()
	check(t, got, StepThinking, StepWaiting, StepAnswering)
}

// Waits from many goroutines (the search, moderation, the scope check) end with a consistent status, race-free.
func TestWaitStatusConcurrent(t *testing.T) {
	ru, got := statusRun()
	ru.status(StepSearching)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			done := ru.waitNotice(0)
			time.Sleep(time.Millisecond)
			done()
		}()
	}
	wg.Wait()
	steps := got()
	if len(steps) < 3 || steps[len(steps)-1] != StepSearching {
		t.Fatalf("status steps = %v: want to end back on searching", steps)
	}
	waiting := 0
	for i, s := range steps {
		if s == StepWaiting {
			waiting++
			if i+1 >= len(steps) || steps[i+1] != StepSearching {
				t.Errorf("a waiting status at %d was not followed by the step: %v", i, steps)
			}
		}
	}
	if waiting == 0 {
		t.Error("no waiting status was sent")
	}
}

// The step in progress need not be thinking when the model writes (a search that waits on in the background): the old
// step still must not come back over the words.
func TestWaitStatusDoesNotBringBackAnyStepOnceTheModelWrote(t *testing.T) {
	ru, got := statusRun()
	ru.status(StepSearching)
	done := ru.waitNotice(time.Second)
	ru.writing()
	done()
	check(t, got, StepSearching, StepWaiting)
}
