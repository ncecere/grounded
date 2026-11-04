package agents

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/displaytext"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
)

// About is an explicit safe projection, never a serialized settings object (ADR0030).
type About struct {
	Router           bool       `json:"router,omitempty"`
	ModelLabel       string     `json:"modelLabel"`
	Audience         string     `json:"audience"`
	StrictlyGrounded bool       `json:"strictlyGrounded"`
	OwnershipNote    string     `json:"ownershipNote"`
	SourceCount      int32      `json:"sourceCount"`
	SourcesLimited   bool       `json:"sourcesLimited"`
	LastProcessedAt  *time.Time `json:"lastProcessedAt,omitempty"`
	PassageJudging   string     `json:"passageJudging"`
	ClaimChecks      string     `json:"claimChecks"`
	Moderation       string     `json:"moderation"`
	Retention        string     `json:"retention"`
}

func validOwnershipNote(note string) bool {
	lower := strings.ToLower(note)
	if len([]rune(note)) > 500 || displaytext.Validate(note, "invalid_note", "Ownership note") != nil || strings.ContainsAny(note, "<>") {
		return false
	}
	for _, unsafe := range []string{"//", "www.", "javascript:", "data:", "mailto:"} {
		if strings.Contains(lower, unsafe) {
			return false
		}
	}
	return true
}

// about uses only published configuration and metadata. Withholding facts does
// not change the existing profile routes' disabled-agent behavior.
func (s *Service) about(ctx context.Context, r resolved) *About {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if r.agent.Status != StatusActive || r.team.Status != "active" || len(r.config.KBs) > MaxKBs {
		return nil
	}
	p, err := s.evaluate(ctx, s.q, r.team, &r.version.ChatModelID, r.config.KBIDs(), r.grant)
	if err != nil || len(p.Violations) > 0 {
		return nil
	}
	a := &About{ModelLabel: "Configured chat model (identity not disclosed)", Audience: r.grant,
		StrictlyGrounded: r.config.StrictlyGrounded, PassageJudging: "disabled", ClaimChecks: "disabled", Moderation: "disabled"}
	if validOwnershipNote(r.config.OwnershipNote) {
		a.OwnershipNote = r.config.OwnershipNote
	}
	stats, err := s.q.AssistantAboutSources(ctx, dbgen.AssistantAboutSourcesParams{TeamID: r.team.ID, KBIDs: r.config.KBIDs()})
	if err != nil {
		return nil
	}
	a.SourceCount = min(stats.SourceCount, 500)
	a.SourcesLimited = stats.SourceCount > 500
	if stats.LastProcessedAt.After(time.Unix(0, 0)) {
		a.LastProcessedAt = &stats.LastProcessedAt
	}
	level, err := s.q.ClassificationByRank(ctx, p.Rank)
	if err != nil {
		return nil
	}
	a.Retention = "Signed-in conversations: no automatic classification expiry configured."
	if level.ConversationRetentionDays != nil {
		a.Retention = fmt.Sprintf("Signed-in conversations: %d days under current classification policy.", *level.ConversationRetentionDays)
	}
	a.Retention += fmt.Sprintf(" Anonymous conversations: %d hours. Deletion runs periodically; legal holds can extend retention, including requested deletions. Provider retention is unknown.", level.AnonymousRetentionHours)
	if r.config.Router {
		a.Router = true
		a.ModelLabel = "Router — delegates answers to another permitted assistant"
		a.PassageJudging, a.ClaimChecks, a.Moderation = "unknown", "unknown", "unknown"
	} else {
		s.aboutChecks(ctx, r.config, r.grant, a)
	}
	return a
}

func (s *Service) aboutChecks(ctx context.Context, c Config, audience string, a *About) {
	if s.SystemOne != nil {
		st, err := s.SystemOne.Load(ctx)
		if err != nil {
			a.PassageJudging = "unknown"
			a.ClaimChecks = "unknown"
		} else if st.ModelID != nil {
			var o systemone.Override
			if c.SystemOne != nil {
				o = *c.SystemOne
			}
			if st.Settings.Judging.Effective(o).Enabled {
				a.PassageJudging = "enabled"
			}
			if st.Settings.Citations.Effective(o).Enabled {
				a.ClaimChecks = "enabled"
			}
		}
	}
	if s.Moderation != nil {
		plan, err := s.Moderation.Plan(ctx, audience, c.Moderation)
		if err != nil {
			a.Moderation = "unknown"
		} else if plan.Active(moderation.StageInput) || plan.Active(moderation.StageOutput) {
			a.Moderation = "enabled"
		}
	}
}
