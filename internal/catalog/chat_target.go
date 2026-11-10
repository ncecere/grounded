package catalog

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ChatTarget is a chat model with a client for its connection.
type ChatTarget struct {
	Model  dbgen.Model
	Client *gateway.Client
	// ConnectionRevision binds an acquired pacing slot to the current settings.
	// It is not an artifact identity: credential-only rotation may reuse cache.
	ConnectionRevision int64
}

// ErrChatModelUnusable is returned when a chat model or its connection is
// disabled (or the model is not a chat model).
var ErrChatModelUnusable = apperr.New(503, "model_unavailable", "The agent's chat model is disabled or unavailable. Ask a platform admin.")

// ChatTarget returns a client for an enabled chat model. Callers check
// classification ceilings themselves.
func (s *Service) ChatTarget(ctx context.Context, modelID uuid.UUID) (ChatTarget, error) {
	m, err := s.q.GetModel(ctx, modelID)
	if err != nil {
		return ChatTarget{}, notFound(err, ErrChatModelUnusable)
	}
	if m.Kind != KindChat || !m.Enabled {
		return ChatTarget{}, ErrChatModelUnusable
	}
	conn, err := s.q.GetConnection(ctx, m.ConnectionID)
	if err != nil {
		return ChatTarget{}, err
	}
	if !conn.Enabled {
		return ChatTarget{}, ErrChatModelUnusable
	}
	cl, err := s.observedClient(conn, KindChat)
	if err != nil {
		return ChatTarget{}, err
	}
	return ChatTarget{Model: m, Client: cl, ConnectionRevision: conn.Revision}, nil
}

// ListUsableChatModels returns the chat models teams may choose for agents:
// enabled, on an enabled connection. Any signed-in user may list them
// (names and capabilities only; no connection details).
func (s *Service) ListUsableChatModels(ctx context.Context) ([]dbgen.Model, error) {
	return s.q.ListUsableChatModels(ctx)
}
