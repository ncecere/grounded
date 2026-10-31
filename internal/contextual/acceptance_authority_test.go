package contextual

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

const acceptanceStateRoot = "/home/user/.local/state/grounded-issue21"
const acceptancePurpose = "issue21-synthetic-acceptance"

type acceptanceGrant struct {
	ID              string
	Purpose         string
	DevelopmentOnly bool
	SourceSHA       string
	CorpusSHA256    string
	Config          acceptanceConfig
	Expires         time.Time
	KeyFile         string
	ReportFile      string
}

var acceptanceSHA = regexp.MustCompile("^[0-9a-f]{40}$")

func acceptanceSource(ctx context.Context) (string, error) {
	head, err := exec.CommandContext(ctx, "git", "rev-parse", "HEAD").Output()
	if err != nil {
		return "", errors.New("source_unavailable")
	}
	dirty, err := exec.CommandContext(ctx, "git", "status", "--porcelain", "--untracked-files=all").Output()
	if err != nil || len(dirty) != 0 {
		return "", errors.New("source_dirty")
	}
	return strings.TrimSpace(string(head)), nil
}

func loadAcceptanceGrant(path string) (acceptanceGrant, error) {
	var g acceptanceGrant
	data, err := acceptanceReadPrivate(path, 16384)
	if err != nil {
		return g, errors.New("grant_private_file")
	}
	if !acceptanceUniqueJSON(data) {
		return g, errors.New("grant_json")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&g) != nil || d.Decode(new(any)) != io.EOF {
		return g, errors.New("grant_json")
	}
	return g, nil
}

func validateAcceptanceGrant(ctx context.Context, g acceptanceGrant, source func(context.Context) (string, error), now time.Time, testLoopback bool) error {
	id, err := uuid.Parse(g.ID)
	if err != nil || id.String() != g.ID || id.Version() != 4 || g.Purpose != acceptancePurpose || !g.DevelopmentOnly {
		return errors.New("grant_identity")
	}
	sha, err := source(ctx)
	if err != nil || !acceptanceSHA.MatchString(g.SourceSHA) || sha != g.SourceSHA || g.CorpusSHA256 != acceptanceCorpusSHA256() {
		return errors.New("grant_source_or_corpus")
	}
	if !now.Before(g.Expires) || g.Expires.After(now.Add(24*time.Hour)) {
		return errors.New("grant_expiry")
	}
	u, err := url.Parse(g.Config.Endpoint)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || u.RawPath != "" || strings.Contains(u.Path, "..") {
		return errors.New("grant_endpoint")
	}
	if u.Scheme != "https" && !(testLoopback && u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return errors.New("grant_https")
	}
	if g.Config.Currency != "USD" {
		return errors.New("grant_currency")
	}
	for _, value := range []string{g.Config.Limits.Amount, g.Config.Limits.InputPrice, g.Config.Limits.OutputPrice, g.Config.Limits.EmbeddingPrice} {
		if !acceptanceCanonicalMoney(value) {
			return errors.New("grant_amount")
		}
	}
	amount, _ := new(big.Rat).SetString(g.Config.Limits.Amount)
	if amount.Sign() <= 0 || amount.Cmp(big.NewRat(5, 1)) >= 0 {
		return errors.New("grant_amount")
	}
	if g.KeyFile == g.ReportFile {
		return errors.New("grant_paths")
	}
	if err := acceptancePrivateParent(g.KeyFile); err != nil {
		return errors.New("grant_paths")
	}
	if err := acceptancePrivateParent(g.ReportFile); err != nil {
		return errors.New("grant_paths")
	}
	if _, err := os.Lstat(g.ReportFile); !os.IsNotExist(err) {
		return errors.New("report_exists")
	}
	return nil
}

func acceptanceCanonicalMoney(s string) bool {
	if !acceptanceDecimal(s) {
		return false
	}
	whole, _, _ := strings.Cut(s, ".")
	if len(whole) > 1 && whole[0] == '0' {
		return false
	}
	r, ok := new(big.Rat).SetString(s)
	return ok && r.Sign() >= 0 && r.Cmp(big.NewRat(1000000, 1)) <= 0
}

// JSON last-key-wins behavior is inappropriate for spending authority.
func acceptanceUniqueJSON(data []byte) bool {
	d := json.NewDecoder(bytes.NewReader(data))
	var value func(int) bool
	value = func(depth int) bool {
		if depth > 8 {
			return false
		}
		token, err := d.Token()
		if err != nil {
			return false
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return true
		}
		seen := map[string]bool{}
		switch delimiter {
		case '{':
			for d.More() {
				key, err := d.Token()
				name, ok := key.(string)
				if err != nil || !ok || seen[strings.ToLower(name)] {
					return false
				}
				seen[strings.ToLower(name)] = true
				if !value(depth + 1) {
					return false
				}
			}
		case '[':
			for d.More() {
				if !value(depth + 1) {
					return false
				}
			}
		default:
			return false
		}
		closing, err := d.Token()
		return err == nil && ((delimiter == '{' && closing == json.Delim('}')) || (delimiter == '[' && closing == json.Delim(']')))
	}
	return value(0) && d.Decode(new(any)) == io.EOF
}
