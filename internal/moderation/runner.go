package moderation

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Calling providers (docs/ui-review F-01): each model has its own timeout,
// a timed-out or transiently failing call is retried once, and a recent
// successful call counts as a readiness probe.

// ClassifierTimeout is the default timeout of chat_classifier providers: a
// chat model answering our JSON prompt (and possibly reasoning first) often
// needs longer than a dedicated moderation endpoint. A model's own
// moderation timeout overrides it.
const ClassifierTimeout = 30 * time.Second

// readyTTL is how long a successful call to a provider is trusted by Ready.
const readyTTL = 10 * time.Minute

// retryPause separates the two attempts of a check.
var retryPause = 250 * time.Millisecond

// bound is a provider with the settings of its model.
type bound struct {
	Provider
	timeout  time.Duration
	model    uuid.UUID
	revision int64
}

// timeoutFor is a model's check timeout: its own setting, else the
// platform default (MODERATION_TIMEOUT), raised to ClassifierTimeout for
// chat classifiers.
func (s *Service) timeoutFor(m dbgen.Model) time.Duration {
	if m.ModerationTimeoutSeconds != nil && *m.ModerationTimeoutSeconds > 0 {
		return time.Duration(*m.ModerationTimeoutSeconds) * time.Second
	}
	if catalog.ModerationProviderOf(m) == catalog.ModerationClassifier {
		return max(s.Timeout, ClassifierTimeout)
	}
	return s.Timeout
}

// bind builds the adapter of a moderation target with its timeout.
func (s *Service) bind(t catalog.ModerationTarget) (bound, error) {
	p, err := s.NewProvider(t)
	if err != nil {
		return bound{}, err
	}
	return bound{Provider: p, timeout: s.timeoutFor(t.Model), model: t.Model.ID, revision: t.Model.Revision}, nil
}

// provider builds the adapter of an enabled moderation model.
func (s *Service) provider(ctx context.Context, modelID uuid.UUID) (bound, error) {
	t, err := s.Catalog.ModerationTarget(ctx, modelID)
	if err != nil {
		return bound{}, err
	}
	return s.bind(t)
}

// run calls a provider within its timeout and times it. A timeout or a
// transient failure (network, 5xx) is retried once while ctx allows;
// backpressure (429) is not. Latency covers both attempts. A success
// marks the provider healthy for Ready.
func (s *Service) run(ctx context.Context, b bound, in Input) (Result, error) {
	start := time.Now()
	res, err := s.attempt(ctx, b, in)
	if err != nil && retryable(err) && ctx.Err() == nil {
		s.Log.Info("moderation check retried", "stage", in.Stage, "err", err)
		select {
		case <-ctx.Done():
		case <-time.After(retryPause):
			res, err = s.attempt(ctx, b, in)
		}
	}
	res.Latency = time.Since(start)
	if err == nil {
		s.markHealthy(b)
	}
	return res, err
}

func (s *Service) attempt(ctx context.Context, b bound, in Input) (Result, error) {
	timeout := b.timeout
	if timeout <= 0 {
		timeout = s.Timeout
	}
	actx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return b.Check(actx, in)
}

// retryable reports a failure worth one more attempt: a timeout or an
// unavailable provider, but not backpressure or a bad request.
func retryable(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var ge *gateway.Error
	return errors.As(err, &ge) && ge.Kind == gateway.KindUnavailable && !ge.Backpressure()
}

// markHealthy records a successful call to a provider.
func (s *Service) markHealthy(b bound) {
	if b.model == uuid.Nil {
		return
	}
	s.mu.Lock()
	s.healthy[b.model] = healthMark{revision: b.revision, at: time.Now()}
	s.mu.Unlock()
}

// recentlyHealthy reports a successful call to the provider (at this model
// revision) within readyTTL.
func (s *Service) recentlyHealthy(b bound) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.healthy[b.model]
	return ok && m.revision == b.revision && time.Since(m.at) < readyTTL
}

type healthMark struct {
	revision int64
	at       time.Time
}
