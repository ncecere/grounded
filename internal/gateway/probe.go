package gateway

import (
	"context"
	"io"
	"net/http"
	"time"
)

// GetJSON GETs path (relative to the base URL) and decodes the JSON
// response into out, with the same errors as the other calls. `grounded
// doctor` uses it for OIDC discovery documents.
func (c *Client) GetJSON(ctx context.Context, path string, out any) error {
	return c.do(ctx, http.MethodGet, path, nil, out)
}

// Reach GETs path and returns the HTTP status of whatever answered: only a
// failure to get a response is an error (an *Error whose message names the
// cause, as for the other calls). The body is discarded. `grounded doctor
// --probe` uses it to time the network path to any URL.
func (c *Client) Reach(ctx context.Context, path string) (int, error) {
	tr := &Trace{}
	req, err := http.NewRequestWithContext(tr.attach(ctx), http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return 0, &Error{Kind: KindBadRequest, Message: "invalid URL"}
	}
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	hc := c.httpClient(ctx)
	start := time.Now()
	res, err := hc.Do(req)
	if err != nil {
		return 0, &Error{Kind: KindUnavailable, Message: describeTransportError(failure{
			err: err, host: requestHost(req.URL), proxy: proxyFor(hc, req), trace: tr, elapsed: time.Since(start),
		})}
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
	return res.StatusCode, nil
}
