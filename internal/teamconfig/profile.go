package teamconfig

import (
	"strings"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/displaytext"
	"github.com/ncecere/grounded/internal/teams"
)

func referenceName(s string) bool {
	return len(s) > 0 && len(s) <= 100 && strings.TrimSpace(s) == s && displaytext.Validate(s, "invalid_reference", "Reference") == nil
}

func agentProfile(a Agent) error {
	if utf8.RuneCountInString(a.Name) > 80 || utf8.RuneCountInString(a.Description) > 500 || utf8.RuneCountInString(a.WelcomeMessage) > 1000 || len(a.StarterQuestions) > 6 {
		return domainError()
	}
	if teams.ValidateSlug(a.Slug) != nil {
		return domainError()
	}
	if a.Status != "active" && a.Status != "disabled_by_team" && a.Status != "disabled_by_platform" {
		return domainError()
	}
	if _, err := agents.NormalizeAccent(a.AccentColor); err != nil {
		return domainError()
	}
	for _, q := range a.StarterQuestions {
		if strings.TrimSpace(q) == "" || utf8.RuneCountInString(q) > 200 {
			return domainError()
		}
	}
	return nil
}
