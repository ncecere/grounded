package sourcetypes

import (
	"slices"
	"testing"
)

func TestBuiltInTypes(t *testing.T) {
	up, web := Of(Upload), Of(Web)
	if !up.Uploads || up.Sync || up.WebPages || up.Permissions != PermissionsNone || !up.Shared {
		t.Fatalf("upload: %+v", up)
	}
	if web.Uploads || !web.Sync || !web.WebPages || web.Permissions != PermissionsNone || !web.Shared {
		t.Fatalf("web: %+v", web)
	}
	if got := Keys(); !slices.Equal(got[:2], []string{Upload, Web}) {
		t.Fatalf("built-in types come first, upload then web: %v", got)
	}
}

func TestUnknownTypeIsInert(t *testing.T) {
	if c := Of("gone_connector"); c != (Capabilities{}) {
		t.Fatalf("an unknown type has no capabilities: %+v", c)
	}
	if _, ok := Get("gone_connector"); ok {
		t.Fatal("an unknown type is not registered")
	}
}

func TestRegister(t *testing.T) {
	Register(Type{Key: "zz_test_b", Name: "Beta"})
	Register(Type{Key: "zz_test_a", Name: "Alpha", Capabilities: Capabilities{Sync: true, Permissions: PermissionsProvider}})
	a, ok := Get("zz_test_a")
	if !ok || !a.Sync || a.Permissions != PermissionsProvider || a.BuiltIn {
		t.Fatalf("registered type: %+v %v", a, ok)
	}
	if b, _ := Get("zz_test_b"); b.Permissions != PermissionsNone {
		t.Fatalf("permissions default to none: %q", b.Permissions)
	}
	keys := Keys()
	if ia, ib := slices.Index(keys, "zz_test_a"), slices.Index(keys, "zz_test_b"); ia < 2 || ib != ia+1 {
		t.Fatalf("other types follow the built-in ones, by name: %v", keys)
	}
	for name, bad := range map[string]Type{
		"duplicate":    {Key: "zz_test_a", Name: "Again"},
		"invalid key":  {Key: "Bad-Key", Name: "Bad"},
		"no name":      {Key: "zz_test_c"},
		"bad schema":   {Key: "zz_test_d", Name: "D", ConfigSchema: []byte("{")},
		"built-in key": {Key: Web, Name: "Web again"},
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s: Register should panic", name)
				}
			}()
			Register(bad)
		}()
	}
}
