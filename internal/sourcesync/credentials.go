package sourcesync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/sourcetypes"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// maxCredential bounds one credential value: a service-account key file is a few kilobytes.
const maxCredential = 16 << 10

// CredentialsAAD binds a source's sealed credentials to the source, so a ciphertext can't be moved to another row.
func CredentialsAAD(sourceID uuid.UUID) []byte {
	return []byte("source_credentials:" + sourceID.String())
}

// Settings are a connector source's settings as a person sends them.
type Settings struct {
	// Config is the type's settings (JSON), validated by the connector.
	Config json.RawMessage
	// Credentials are values by field key. On an update, a key that is sent replaces the stored value, an empty value
	// removes it, and a key that is not sent keeps what is stored.
	Credentials map[string]string
	// Schedule is manual, hourly, daily or weekly ("" keeps the current one; manual for a new source).
	Schedule string
}

// CheckSettings validates a new source's settings without saving anything: the connector's own rules, the credentials
// against the type's fields, and the schedule. It returns the configuration as it is stored.
func CheckSettings(typ string, in Settings) (json.RawMessage, error) {
	c, err := connectorFor(typ)
	if err != nil {
		return nil, err
	}
	cfg, err := normalConfig(c, in.Config)
	if err != nil {
		return nil, err
	}
	if in.Schedule != "" && !ValidSchedule(in.Schedule) {
		return nil, apperr.Invalid("invalid_schedule", "The schedule is manual, hourly, daily or weekly")
	}
	t, _ := sourcetypes.Get(typ)
	return cfg, checkCredentials(t, in.Credentials, true)
}

func normalConfig(c connector.Connector, raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || string(raw) == "null" {
		raw = json.RawMessage(`{}`)
	}
	cfg, err := c.Config(raw)
	var bad *connector.ConfigError
	if errors.As(err, &bad) {
		return nil, apperr.Invalid("invalid_config", bad.Message)
	} else if err != nil {
		return nil, apperr.Invalid("invalid_config", "The settings are not valid for this source type")
	}
	if !json.Valid(cfg) {
		return nil, fmt.Errorf("sourcesync: the connector returned settings that are not JSON")
	}
	return cfg, nil
}

// checkCredentials validates values against the type's fields. complete: every required field must have a value.
func checkCredentials(t sourcetypes.Type, values map[string]string, complete bool) error {
	fields := map[string]sourcetypes.Field{}
	for _, f := range t.Credentials {
		fields[f.Key] = f
	}
	for k, v := range values {
		f, ok := fields[k]
		if !ok {
			return apperr.Invalid("invalid_credentials", fmt.Sprintf("%q is not a credential of this source type", k))
		}
		if len(v) > maxCredential {
			return apperr.Invalid("invalid_credentials", f.Label+" is too long")
		}
	}
	if !complete {
		return nil
	}
	for _, f := range t.Credentials {
		if f.Required && strings.TrimSpace(values[f.Key]) == "" {
			return apperr.Invalid("credentials_missing", f.Label+" is required")
		}
	}
	return nil
}

// seal encrypts a source's credentials (nil when there are none to store).
func (s *Service) seal(sourceID uuid.UUID, values map[string]string) ([]byte, error) {
	if len(values) == 0 {
		return nil, nil
	}
	if s.Box == nil {
		return nil, errNoBox
	}
	plain, err := json.Marshal(values)
	if err != nil {
		return nil, err
	}
	return s.Box.Seal(plain, CredentialsAAD(sourceID))
}

// open decrypts a source's stored credentials (empty when none are stored).
func (s *Service) open(sourceID uuid.UUID, cipher []byte) (map[string]string, error) {
	out := map[string]string{}
	if len(cipher) == 0 {
		return out, nil
	}
	if s.Box == nil {
		return nil, errNoBox
	}
	plain, err := s.Box.Open(cipher, CredentialsAAD(sourceID))
	if err != nil {
		return nil, fmt.Errorf("sourcesync: stored credentials of source %s can't be read: %w", sourceID, err)
	}
	return out, json.Unmarshal(plain, &out)
}

// credentials reads a source's stored credentials.
func (s *Service) credentials(ctx context.Context, q *dbgen.Queries, sourceID uuid.UUID) (map[string]string, dbgen.SourceConnector, error) {
	row, err := q.GetSourceConnector(ctx, sourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil, row, errNoConnector
	} else if err != nil {
		return nil, row, err
	}
	creds, err := s.open(sourceID, row.CredentialsCipher)
	return creds, row, err
}

// merge applies an update to stored credentials: a sent key replaces, an empty value removes.
func merge(stored, update map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range stored {
		out[k] = v
	}
	for k, v := range update {
		if strings.TrimSpace(v) == "" {
			delete(out, k)
		} else {
			out[k] = v
		}
	}
	return out
}

// redact removes credential values from a message before it is stored or shown: a provider's error can repeat what it
// was sent.
func redact(msg string, creds map[string]string) string {
	for _, v := range creds {
		if len(v) >= 6 {
			msg = strings.ReplaceAll(msg, v, "[redacted]")
		}
	}
	if len(msg) > 500 {
		msg = msg[:500] + "…"
	}
	return msg
}
