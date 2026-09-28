package public

import (
	"bytes"
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Pepper rotation for publishable keys (docs/operations/rotate-keys.md):
// with API_KEY_PEPPER_PREVIOUS set, a key whose digest was made with the
// previous pepper still works and is re-hashed with the current pepper on
// that use. Every digest records its pepper's id (pepper_id).

func (s *Service) peppers() secrets.Peppers { return secrets.NewPeppers(s.Pepper, s.PreviousPepper) }

// verifyKey checks a presented key against a stored digest under the
// current or previous pepper.
func (s *Service) verifyKey(k Key, raw string) (secrets.PepperMatch, []byte) {
	return s.peppers().Verify(k.SecretHash, func(pepper []byte) []byte { return HashKey(pepper, raw) })
}

// markPepper finishes a key's rotation on use: a digest under the previous
// pepper is replaced (audited, once per key), and a digest from before
// pepper ids is labelled with the current pepper's id.
func (s *Service) markPepper(ctx context.Context, k Key, match secrets.PepperMatch, rehash []byte) error {
	cur := s.peppers().CurrentID()
	if match != secrets.MatchPrevious {
		if bytes.Equal(k.PepperID, cur) {
			return nil
		}
		_, err := s.q.RehashPublishableKey(ctx, dbgen.RehashPublishableKeyParams{ID: k.ID, SecretHash: k.SecretHash, PepperID: cur, OldHash: k.SecretHash})
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		n, err := q.RehashPublishableKey(ctx, dbgen.RehashPublishableKeyParams{ID: k.ID, SecretHash: rehash, PepperID: cur, OldHash: k.SecretHash})
		if err != nil || n == 0 {
			return err // n == 0: a concurrent request re-hashed it
		}
		return audit.Record(ctx, q, audit.Entry{
			ActorKind: audit.ActorSystem, TeamID: k.TeamID, Action: "agent.publishable_key_pepper_rehash",
			TargetType: "publishable_key", TargetID: k.ID.String(), Metadata: map[string]any{"agentId": k.AgentID.String()},
		})
	})
}
