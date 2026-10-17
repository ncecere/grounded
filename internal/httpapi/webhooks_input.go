package httpapi

import (
	"net/http"
	"strings"

	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/webhooks"
)

// webhookBody is a webhook's body with presence: url, events and enabled are required (OpenAPI WebhookInput), so a missing one is named
// instead of being read as its zero value (a missing enabled used to switch the webhook off). A missing description is left as it is on an update.
type webhookBody struct {
	URL         *string   `json:"url"`
	Description *string   `json:"description"`
	Events      *[]string `json:"events"`
	Enabled     *bool     `json:"enabled"`
}

// input returns the body as a service input, or writes a 400 naming what is missing.
func (b webhookBody) input(w http.ResponseWriter) (webhooks.Input, bool) {
	var missing []string
	if b.URL == nil {
		missing = append(missing, "url")
	}
	if b.Events == nil {
		missing = append(missing, "events")
	}
	if b.Enabled == nil {
		missing = append(missing, "enabled")
	}
	if len(missing) > 0 {
		httpx.Error(w, http.StatusBadRequest, "invalid_webhook", "A webhook needs url, events and enabled; missing: "+strings.Join(missing, ", "))
		return webhooks.Input{}, false
	}
	return webhooks.Input{
		URL: *b.URL, Description: deref(b.Description, ""), KeepDescription: b.Description == nil, Events: *b.Events, Enabled: *b.Enabled,
	}, true
}
