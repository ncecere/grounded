package scim

import (
	"encoding/json"
	"testing"
)

func TestParseFilter(t *testing.T) {
	ok := map[string]Filter{
		`userName eq "a@b.edu"`:                     {"username", "a@b.edu"},
		`externalId EQ "00u1"`:                      {"externalid", "00u1"},
		`emails[type eq "work"].value eq "a@b.edu"`: {"emails.value", "a@b.edu"},
		`emails.value eq "q\"uote"`:                 {"emails.value", `q"uote`},
	}
	for raw, want := range ok {
		f, err := ParseFilter(raw, "username", "externalid", "emails.value")
		if err != nil || f == nil || *f != want {
			t.Errorf("%s = %+v %v", raw, f, err)
		}
	}
	for _, raw := range []string{`userName co "a"`, `userName eq "a" and active eq true`, `title eq "x"`, `userName eq a`, `(userName eq "a")`} {
		if _, err := ParseFilter(raw, "username", "externalid", "emails.value"); err == nil || err.Type != "invalidFilter" {
			t.Errorf("%s accepted", raw)
		}
	}
	if f, err := ParseFilter("  ", "username"); f != nil || err != nil {
		t.Error("an empty filter is no filter")
	}
}

func TestParsePage(t *testing.T) {
	for _, c := range []struct {
		start, count string
		want         Page
	}{{"", "", Page{1, 100}}, {"0", "-5", Page{1, 0}}, {"11", "500", Page{11, 100}}, {"x", "10", Page{1, 10}}} {
		if got := ParsePage(c.start, c.count); got != c.want {
			t.Errorf("%q %q = %+v", c.start, c.count, got)
		}
	}
}

func TestPatchUser(t *testing.T) {
	in := userInput{UserName: "a@b.edu", ExternalID: "x", DisplayName: "A", Email: "a@b.edu", Active: true}
	ops, err := decodePatch([]byte(`{"Operations":[
		{"op":"Replace","path":"active","value":"False"},
		{"op":"replace","path":"emails[type eq \"work\"].value","value":"new@b.edu"},
		{"op":"add","value":{"name.givenName":"Ann","name.familyName":"Bee","displayName":"","title":"ignored"}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := patchUser(&in, ops); err != nil {
		t.Fatal(err)
	}
	if in.Active || in.Email != "new@b.edu" || in.display() != "Ann Bee" {
		t.Fatalf("patched %+v (%s)", in, in.display())
	}
	for _, bad := range []string{
		`{"Operations":[{"op":"replace","path":"externalId","value":"y"}]}`,
		`{"Operations":[{"op":"remove","path":"active"}]}`,
		`{"Operations":[{"op":"replace","path":"active","value":"maybe"}]}`,
		`{"Operations":[{"op":"move","path":"active","value":true}]}`,
		`{"Operations":[]}`,
	} {
		ops, err := decodePatch([]byte(bad))
		if err == nil {
			err = patchUser(&in, ops)
		}
		if err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
}

func TestPatchGroup(t *testing.T) {
	ops, _ := decodePatch([]byte(`{"Operations":[
		{"op":"add","path":"members","value":[{"value":"u1"},{"value":"u2"}]},
		{"op":"remove","path":"members[value eq \"u3\"]"},
		{"op":"remove","path":"members","value":[{"value":"u4"}]},
		{"op":"replace","path":"displayName","value":"Staff"}]}`))
	c, err := patchGroup(ops)
	if err != nil || len(c.Add) != 2 || len(c.Remove) != 2 || c.Remove[0] != "u3" || *c.DisplayName != "Staff" || c.Replace != nil {
		t.Fatalf("change %+v %v", c, err)
	}
	ops, _ = decodePatch([]byte(`{"Operations":[{"op":"replace","value":{"members":[{"value":"u9"}],"externalId":"g"}}]}`))
	if c, err = patchGroup(ops); err != nil || c.Replace == nil || len(*c.Replace) != 1 || *c.ExternalID != "g" {
		t.Fatalf("pathless replace %+v %v", c, err)
	}
	ops, _ = decodePatch([]byte(`{"Operations":[{"op":"remove","path":"members"}]}`))
	if c, err = patchGroup(ops); err != nil || c.Replace == nil || len(*c.Replace) != 0 {
		t.Fatalf("remove all %+v %v", c, err)
	}
}

func TestUserInput(t *testing.T) {
	in, err := decodeUser([]byte(`{"userName":"Pat@B.edu","externalId":"p1","name":{"formatted":"Pat Q"}}`))
	if err != nil || !in.Active || in.address() != "pat@b.edu" || in.display() != "Pat Q" || in.check() != nil {
		t.Fatalf("%+v %v", in, err)
	}
	in.UserName = "pat"
	if in.check() == nil {
		t.Error("a user without an email address was accepted")
	}
	var spc map[string]any
	raw, _ := json.Marshal(ServiceProviderConfig("https://x/scim/v2"))
	_ = json.Unmarshal(raw, &spc)
	if spc["bulk"].(map[string]any)["supported"] != false || spc["etag"].(map[string]any)["supported"] != false {
		t.Errorf("service provider config %v", spc)
	}
}
