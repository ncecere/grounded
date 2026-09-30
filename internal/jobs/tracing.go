package jobs

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/tracing"
)

// traceMiddleware carries trace context from where a job is enqueued to
// where it is worked (docs/operations/tracing.md): at insert it writes the
// caller's traceparent (and tracestate) into the job's metadata; when the
// job is worked, it runs in a consumer span ("job ingest.document") that
// continues that trace, with the job's kind, queue and attempt. Periodic
// jobs (River marks them "periodic") are not traced: housekeeping every few
// seconds would make a trace each time. The jobs they enqueue are traced,
// each as a new trace.
type traceMiddleware struct{ river.MiddlewareDefaults }

func (*traceMiddleware) InsertMany(ctx context.Context, many []*rivertype.JobInsertParams,
	doInner func(context.Context) ([]*rivertype.JobInsertResult, error)) ([]*rivertype.JobInsertResult, error) {
	if trace.SpanContextFromContext(ctx).IsValid() {
		for _, p := range many {
			p.Metadata = tracing.InjectJSON(ctx, p.Metadata)
		}
	}
	return doInner(ctx)
}

func (*traceMiddleware) Work(ctx context.Context, job *rivertype.JobRow, doInner func(context.Context) error) (err error) {
	if periodic(job.Metadata) {
		return doInner(ctx)
	}
	ctx, span := tracing.StartKind(tracing.ExtractJSON(ctx, job.Metadata), "job "+job.Kind, trace.SpanKindConsumer,
		attribute.String("messaging.system", "river"), attribute.String("grounded.job.kind", job.Kind),
		attribute.String("grounded.job.queue", job.Queue), attribute.Int("grounded.job.attempt", job.Attempt),
		attribute.String("grounded.job.id", strconv.FormatInt(job.ID, 10)))
	outcome := OutcomePanic // unless doInner returns
	defer func() {
		span.SetAttributes(attribute.String("grounded.job.outcome", outcome))
		if outcome == OutcomeError || outcome == OutcomePanic {
			tracing.Fail(span, outcome)
		}
		span.End()
	}()
	err = doInner(ctx)
	outcome = JobOutcome(err)
	return err
}

// periodic reports whether River inserted the job for a periodic schedule.
func periodic(metadata []byte) bool {
	var m struct {
		Periodic bool `json:"periodic"`
	}
	return len(metadata) > 0 && json.Unmarshal(metadata, &m) == nil && m.Periodic
}
