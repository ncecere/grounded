// Email templates: plain text plus simple, accessible HTML with the
// instance name, a link to the item and a link to the notification
// settings.

package notify

import (
	"bytes"
	"embed"
	htmltemplate "html/template"
	"strings"
	texttemplate "text/template"
)

//go:embed templates/*.tmpl
var templateFS embed.FS

var (
	textTmpl = texttemplate.Must(texttemplate.ParseFS(templateFS, "templates/email.txt.tmpl"))
	htmlTmpl = htmltemplate.Must(htmltemplate.ParseFS(templateFS, "templates/email.html.tmpl"))
)

// SettingsPath is the app page where people choose their notifications.
const SettingsPath = "/settings/notifications"

// Site is what email templates need to know about this deployment.
type Site struct {
	Instance string // INSTANCE_NAME
	AppURL   string // APP_URL, the origin links are built from
}

// Content is one rendered event, before it is addressed.
type Content struct {
	Type      Type
	Title     string
	Body      string
	Link      string // app path
	Mandatory bool
}

// Rendered is an email's subject and bodies.
type Rendered struct {
	Subject string
	Text    string
	HTML    string
}

type emailData struct {
	Instance, Title, Body, Label string
	Paragraphs                   []string
	LinkURL, SettingsURL         string
	Mandatory                    bool
}

// Render builds an email for c. Links are absolute (APP_URL + path).
func Render(site Site, c Content) (Rendered, error) {
	d := emailData{
		Instance: site.Instance, Title: oneLine(c.Title), Body: strings.TrimSpace(c.Body),
		SettingsURL: site.AppURL + SettingsPath, Mandatory: c.Mandatory, Label: string(c.Type),
	}
	if def, ok := Lookup(c.Type); ok {
		d.Label = def.Label
	}
	if c.Link != "" {
		d.LinkURL = site.AppURL + c.Link
	}
	for _, p := range strings.Split(d.Body, "\n\n") {
		if p = strings.TrimSpace(p); p != "" {
			d.Paragraphs = append(d.Paragraphs, p)
		}
	}
	var text, html bytes.Buffer
	if err := textTmpl.Execute(&text, d); err != nil {
		return Rendered{}, err
	}
	if err := htmlTmpl.Execute(&html, d); err != nil {
		return Rendered{}, err
	}
	return Rendered{Subject: "[" + oneLine(site.Instance) + "] " + d.Title, Text: text.String(), HTML: html.String()}, nil
}
