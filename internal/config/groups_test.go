package config

import (
	"reflect"
	"strings"
	"testing"
)

func TestGroupsClaimAndDevGroups(t *testing.T) {
	c, err := LoadFrom("", env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.OIDC.GroupsClaim != "groups" || c.DevAuthGroups != nil {
		t.Fatalf("defaults: claim %q, dev groups %v", c.OIDC.GroupsClaim, c.DevAuthGroups)
	}
	c, err = LoadFrom("", env(map[string]string{
		"OIDC_GROUPS_CLAIM": "roles",
		"DEV_AUTH_GROUPS":   " Alex = registrar-staff, library ; blair=library;casey=",
	}))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string][]string{"alex": {"registrar-staff", "library"}, "blair": {"library"}, "casey": {}}
	if c.OIDC.GroupsClaim != "roles" || !reflect.DeepEqual(c.DevAuthGroups, want) {
		t.Fatalf("claim %q, dev groups %#v", c.OIDC.GroupsClaim, c.DevAuthGroups)
	}
	if _, err := LoadFrom("", env(map[string]string{"DEV_AUTH_GROUPS": "alex"})); err == nil || !strings.Contains(err.Error(), "DEV_AUTH_GROUPS") {
		t.Fatalf("malformed DEV_AUTH_GROUPS: %v", err)
	}
}

func TestGroupsClaimRequiredWithOIDC(t *testing.T) {
	c := Defaults()
	c.AppURL, c.OIDC.Issuer, c.OIDC.ClientID, c.OIDC.ClientSecret = "https://rag.example.edu", "https://idp", "id", "secret"
	c.OIDC.GroupsClaim = ""
	found := false
	for _, e := range c.validateSignIn() {
		found = found || strings.Contains(e.Error(), "OIDC_GROUPS_CLAIM")
	}
	if !found {
		t.Fatal("an empty OIDC_GROUPS_CLAIM is not reported")
	}
}
