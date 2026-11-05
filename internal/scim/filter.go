package scim

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// Filter is the one comparison SCIM clients send to find a resource: attr eq "value" (RFC 7644 §3.4.2.2). Anything else is
// refused as invalidFilter; a filter is never turned into a query.
type Filter struct {
	Attr  string // lower case: username, externalid, id, emails.value, displayname
	Value string
}

var filterRe = regexp.MustCompile(`^\s*([A-Za-z][A-Za-z0-9.]*(?:\[[^\]]*\])?(?:\.[A-Za-z]+)?)\s+(?i:eq)\s+"((?:[^"\\]|\\.)*)"\s*$`)

// emailAttr matches emails.value and emails[type eq "work"].value (Okta and Entra).
var emailAttr = regexp.MustCompile(`^emails(\[\s*type\s+eq\s+"[a-z]+"\s*\])?\.value$`)

// ParseFilter reads a filter for a resource with the given attributes (lower case); "" is no filter.
func ParseFilter(raw string, allowed ...string) (*Filter, *Error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	m := filterRe.FindStringSubmatch(raw)
	if m == nil {
		return nil, &Error{Status: http.StatusBadRequest, Type: "invalidFilter", Detail: `only filters of the form attribute eq "value" are supported`}
	}
	attr := strings.ToLower(m[1])
	if emailAttr.MatchString(attr) {
		attr = "emails.value"
	}
	value, err := strconv.Unquote(`"` + m[2] + `"`)
	if err != nil {
		return nil, &Error{Status: http.StatusBadRequest, Type: "invalidFilter", Detail: "the filter's value is not a valid string"}
	}
	for _, a := range allowed {
		if a == attr {
			return &Filter{Attr: attr, Value: value}, nil
		}
	}
	return nil, &Error{Status: http.StatusBadRequest, Type: "invalidFilter", Detail: "filtering on " + m[1] + " is not supported"}
}

// Page is startIndex (1-based) and count (at most MaxPage; 0 asks for the total only).
type Page struct {
	Start, Count int
}

// ParsePage reads startIndex and count; out-of-range values are clamped as RFC 7644 §3.4.2.4 says.
func ParsePage(startIndex, count string) Page {
	p := Page{Start: 1, Count: MaxPage}
	if n, err := strconv.Atoi(startIndex); err == nil && n > 1 {
		p.Start = n
	}
	if n, err := strconv.Atoi(count); err == nil {
		p.Count = min(max(n, 0), MaxPage)
	}
	return p
}
