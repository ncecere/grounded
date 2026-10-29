package httpapi

import "strings"

// bearerToken follows RFC 9110 §11.1 and RFC 6750 §2.1: the scheme is
// case-insensitive and separated from the case-sensitive token by one or more
// spaces. Do not accept tabs, embedded whitespace or multiple credentials.
func bearerToken(header string) (string, bool) {
	if len(header) > 512 {
		return "", false
	}
	scheme, token, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	token = strings.TrimLeft(token, " ")
	if token == "" || strings.ContainsAny(token, " \t\r\n,") {
		return "", false
	}
	return token, true
}
