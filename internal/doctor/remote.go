// Outbound HTTPS dependencies: the OIDC issuer, the model connections and
// operator-supplied probe URLs. Each request opens a new connection and is
// traced, so a slow phase (DNS, connect, TLS or the server) shows.

package doctor

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/app"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// traced returns a context whose requests use a new connection and are
// traced, bounded by the check timeout.
func (r *runner) traced(ctx context.Context) (context.Context, *gateway.Trace, context.CancelFunc) {
	cctx, cancel := r.ctx(ctx)
	cctx, tr := gateway.WithTrace(gateway.FreshConnection(cctx))
	return cctx, tr, cancel
}

// httpCheck is a check with the duration and phases of a traced request.
func httpCheck(group, name string, start time.Time, tr *gateway.Trace) Check {
	return Check{Group: group, Name: name, Status: OK, DurationMs: millis(time.Since(start)), Timings: toTimings(tr.Timings())}
}

// Algorithms go-oidc verifies ID tokens with.
var oidcAlgs = []string{"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512", "EdDSA"}

type discovery struct {
	Issuer        string   `json:"issuer"`
	JWKSURI       string   `json:"jwks_uri"`
	TokenEndpoint string   `json:"token_endpoint"`
	Algs          []string `json:"id_token_signing_alg_values_supported"`
}

// oidc fetches the issuer's discovery document and its JWKS, the way
// sign-in does (go-oidc).
func (r *runner) oidc(ctx context.Context) {
	issuer := r.cfg.OIDC.Issuer
	if issuer == "" {
		r.add(Check{Group: "oidc", Name: "discovery", Status: Skip, Detail: "OIDC_ISSUER is not set"})
		return
	}
	cctx, tr, cancel := r.traced(ctx)
	defer cancel()
	start := time.Now()
	var d discovery
	err := gateway.New(strings.TrimSuffix(issuer, "/"), "", r.opts.Timeout).GetJSON(cctx, "/.well-known/openid-configuration", &d)
	c := httpCheck("oidc", "discovery", start, tr)
	switch {
	case err != nil:
		c.Status, c.Detail = Fail, issuer+": "+errMessage(err)
	case d.Issuer != issuer:
		c.Status = Fail
		c.Detail = fmt.Sprintf("the document's issuer %q differs from OIDC_ISSUER %q", d.Issuer, issuer)
		c.Fix = "Set OIDC_ISSUER to exactly the issuer the provider reports, including any trailing slash"
	case d.JWKSURI == "" || d.TokenEndpoint == "":
		c.Status, c.Detail = Fail, "the discovery document has no jwks_uri or token_endpoint"
	default:
		c.Detail = issuer + ": " + algSummary(d.Algs)
		if !supportedAlg(d.Algs) {
			c.Status = Fail
			c.Fix = "Configure the provider to sign ID tokens with RS256 (or ES256)"
		}
	}
	r.add(c)
	if c.Status == OK {
		r.jwks(ctx, d.JWKSURI)
	}
}

func algSummary(algs []string) string {
	if len(algs) == 0 {
		return "no signing algorithms listed (RS256 assumed)"
	}
	return "ID tokens signed with " + strings.Join(algs, ", ")
}

func supportedAlg(algs []string) bool {
	if len(algs) == 0 {
		return true
	}
	for _, a := range algs {
		if slices.Contains(oidcAlgs, a) {
			return true
		}
	}
	return false
}

func (r *runner) jwks(ctx context.Context, uri string) {
	cctx, tr, cancel := r.traced(ctx)
	defer cancel()
	start := time.Now()
	var set struct {
		Keys []struct {
			Use string `json:"use"`
		} `json:"keys"`
	}
	// The URL is used exactly as published: a gateway client trims a base
	// URL's trailing slash, and some providers (Authentik) serve the JWKS only
	// at .../jwks/, so pass it as the path of an empty base.
	err := gateway.New("", "", r.opts.Timeout).GetJSON(cctx, uri, &set)
	c := httpCheck("oidc", "JWKS", start, tr)
	switch {
	case err != nil:
		c.Status, c.Detail = Fail, uri+": "+errMessage(err)
	case len(set.Keys) == 0:
		c.Status, c.Detail = Fail, uri+": no keys"
	default:
		c.Detail = fmt.Sprintf("%s: %d key(s)", uri, len(set.Keys))
	}
	r.add(c)
}

// models tests every enabled model connection like the admin "Test
// connection": GET /models, or one SystemOne question for a SystemOne
// service.
func (r *runner) models(ctx context.Context, pool *pgxpool.Pool) {
	if pool == nil {
		r.add(Check{Group: "models", Name: "connections", Status: Skip, Detail: "needs Postgres"})
		return
	}
	box, err := app.NewSecretBox(r.cfg)
	if err != nil {
		r.add(Check{Group: "models", Name: "connections", Status: Fail, Detail: "cannot decrypt connection keys: " + err.Error()})
		return
	}
	cctx, cancel := r.ctx(ctx)
	conns, err := dbgen.New(pool).ListConnections(cctx)
	cancel()
	if err != nil {
		r.add(Check{Group: "models", Name: "connections", Status: Fail, Detail: err.Error()})
		return
	}
	if len(conns) == 0 {
		r.add(Check{Group: "models", Name: "connections", Status: Skip, Detail: "no model connections yet"})
		return
	}
	cat := catalog.NewService(pool, box)
	for _, conn := range conns {
		if !conn.Enabled {
			r.add(Check{Group: "models", Name: conn.Name, Status: Skip, Detail: "disabled"})
			continue
		}
		r.model(ctx, cat, conn)
	}
}

func (r *runner) model(ctx context.Context, cat *catalog.Service, conn dbgen.ListConnectionsRow) {
	cctx, tr, cancel := r.traced(ctx)
	defer cancel()
	start := time.Now()
	res, err := cat.ProbeConnection(cctx, conn.ID)
	c := httpCheck("models", conn.Name, start, tr)
	switch {
	case err != nil:
		c.Status, c.Detail = Fail, conn.BaseURL+": "+err.Error()
	case res.Error != nil:
		c.Status, c.Detail = Fail, conn.BaseURL+": "+res.Error.Message
		if res.Error.Status > 0 {
			c.Detail += fmt.Sprintf(" (HTTP %d)", res.Error.Status)
		}
		switch {
		case res.Error.Kind == gateway.KindNotFound && res.Probe == catalog.ProbeModels:
			// The server answered: reachable. Some moderation endpoints do
			// not serve the OpenAI model list, nor does a SystemOne service
			// before its SystemOne model is added (then it is asked a
			// SystemOne question instead).
			c.Status = Warn
			c.Detail = conn.BaseURL + ": reachable, but GET /models answered 404 (expected if it serves only moderation models, " +
				"or SystemOne before its SystemOne model is added)"
		case res.Error.Kind == gateway.KindRateLimited:
			c.Status = Warn
		}
	case res.Probe == catalog.ProbeSystemOne:
		c.Detail = fmt.Sprintf("%s: SystemOne (%s) answered a test question", conn.BaseURL, res.SystemOneModel)
	default:
		c.Detail = fmt.Sprintf("%s: GET /models, %d model(s)", conn.BaseURL, len(res.Models))
	}
	r.add(c)
}

// probes times a GET to each operator-supplied URL.
func (r *runner) probes(ctx context.Context) {
	for _, u := range r.opts.Probes {
		cctx, tr, cancel := r.traced(ctx)
		start := time.Now()
		status, err := gateway.New(u, "", r.opts.Timeout).Reach(cctx, "")
		c := httpCheck("probe", u, start, tr)
		if err != nil {
			c.Status, c.Detail = Fail, errMessage(err)
		} else {
			c.Detail = fmt.Sprintf("HTTP %d", status)
		}
		cancel()
		r.add(c)
	}
}
