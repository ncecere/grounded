package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

// maxErrorBodyBytes bounds how much of an error response we read.
const maxErrorBodyBytes = 1 << 20

var errResponseTimeout = errors.New("timed out waiting for the response")

// StreamResponse is an open streaming response. The caller must Close Body,
// which also releases the request.
type StreamResponse struct {
	Body        io.ReadCloser
	ContentType string
	Status      int
}

// PostStream POSTs a JSON body and returns the response for incremental
// reading (server-sent events).
//
// The client's timeout (the connection's request timeout) bounds only the wait
// for the response headers, not the body, so a long generation is never cut
// off mid-stream. Callers bound the body themselves, typically with an idle
// timeout between chunks and the request context. Non-2xx responses are
// returned as *Error with the same kinds as the non-streaming calls.
func (c *Client) PostStream(ctx context.Context, path string, body any) (*StreamResponse, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancelCause(ctx)
	tr := &Trace{}
	req, err := http.NewRequestWithContext(tr.attach(ctx), http.MethodPost, c.BaseURL+path, bytes.NewReader(b))
	if err != nil {
		cancel(nil)
		return nil, &Error{Kind: KindBadRequest, Message: "invalid base URL"}
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Content-Type", "application/json")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	start := time.Now()
	if err := c.wait(ctx); err != nil {
		cancel(nil)
		c.observe(start, err)
		return nil, err
	}
	start = time.Now()
	sr, err := c.sendStream(ctx, cancel, req, tr)
	c.observe(start, err)
	return sr, err
}

// sendStream sends a streaming request and waits for the response headers.
func (c *Client) sendStream(ctx context.Context, cancel context.CancelCauseFunc, req *http.Request, tr *Trace) (*StreamResponse, error) {
	hc := *c.httpClient(ctx)
	timeout := hc.Timeout
	hc.Timeout = 0 // the body may legitimately take much longer than the connection timeout
	var timer *time.Timer
	if timeout > 0 {
		timer = time.AfterFunc(timeout, func() { cancel(errResponseTimeout) })
	}
	start := time.Now()
	res, err := hc.Do(req)
	fail := failure{err: err, host: requestHost(req.URL), proxy: proxyFor(&hc, req), trace: tr, elapsed: time.Since(start)}
	if timer != nil && !timer.Stop() {
		// The timer fired: the context is cancelled, so the body is unusable
		// even if headers arrived at the last moment.
		if err == nil {
			res.Body.Close()
		}
		cancel(nil)
		return nil, &Error{Kind: KindUnavailable, Message: timeoutMessage(tr, fail.elapsed, hostOnly(fail.host))}
	}
	if err != nil {
		cancel(nil)
		return nil, &Error{Kind: KindUnavailable, Message: describeTransportError(fail)}
	}
	if res.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(res.Body, maxErrorBodyBytes))
		res.Body.Close()
		cancel(nil)
		e := statusError(res.StatusCode, raw)
		e.RetryAfter = parseRetryAfter(res.Header.Get("Retry-After"), time.Now())
		c.learn(ctx, e)
		return nil, e
	}
	return &StreamResponse{
		Body:        &cancelOnClose{ReadCloser: res.Body, cancel: cancel},
		ContentType: res.Header.Get("Content-Type"),
		Status:      res.StatusCode,
	}, nil
}

type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelCauseFunc
}

func (c *cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel(nil)
	return err
}
