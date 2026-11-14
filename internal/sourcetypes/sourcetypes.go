// Package sourcetypes is the registry of data source types (ADR-0008, ADR-0035): what each type is called and what it
// can do. The rest of the code asks the registry about a capability instead of comparing a source's type with a name,
// so a new type needs no edit outside its own package.
//
// The two types the product has always had, upload and web, are registered here. A connector registers its type from
// its own package (internal/connector), at start-up. The registry holds no behaviour: how a type validates its
// settings and syncs is the connector's.
package sourcetypes

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"sync"
)

// The built-in types.
const (
	Upload = "upload"
	Web    = "web"
)

// Permissions says where a type's document permissions come from.
type Permissions string

const (
	// PermissionsNone: the type reports none, so an editor may restrict the source by hand.
	PermissionsNone Permissions = "none"
	// PermissionsProvider: the type reports each document's permissions, and the source refuses a hand-set restriction.
	PermissionsProvider Permissions = "provider"
)

// Capabilities are what a source type can do.
type Capabilities struct {
	// Uploads: people add files to the source by uploading them.
	Uploads bool
	// Sync: the source fetches its own content, on a schedule or on request.
	Sync bool
	// WebPages: its documents are web pages. A page is identified by its address, only its main content is kept,
	// repeated blocks are left out by default, and its links can be checked.
	WebPages bool
	// Permissions is where document permissions come from.
	Permissions Permissions
	// Shared: a platform admin can make a shared source of this type.
	Shared bool
}

// Field is one credential a type needs (a token, a client secret). Its value is stored encrypted and never read back.
type Field struct {
	Key   string
	Label string
	Help  string
	// Secret values are masked as they are typed. A field that is not secret (a client ID) is still stored encrypted.
	Secret   bool
	Required bool
}

// Type describes one source type.
type Type struct {
	Key         string
	Name        string
	Description string
	Capabilities
	// BuiltIn types are on unless a platform admin turns them off; every other type is off until turned on.
	BuiltIn bool
	// ConfigSchema is the JSON Schema of the type's settings, from which its form is built (nil for the built-in
	// types, which have their own pages). The form shows an object's properties that are a string (an enum makes a
	// choice, "x-multiline": true a text area), a boolean, an integer or number, or a list of strings; "title" is
	// the label, "description" the help, "default" the starting value and "required" what must be filled. JSON
	// objects have no order, so "x-order" lists the properties in the order to show them. The connector's own
	// Config validation is what counts: the schema only draws the form.
	ConfigSchema json.RawMessage
	// Credentials are the credentials the type needs (none for the built-in types).
	Credentials []Field
}

var keyRE = regexp.MustCompile(`^[a-z][a-z0-9_]{1,39}$`)

// validKey reports whether key can name a type (the same pattern as the data_sources.type check).
func validKey(key string) bool { return keyRE.MatchString(key) }

var (
	mu    sync.RWMutex
	types = map[string]Type{
		Upload: {
			Key: Upload, Name: "Upload", Description: "Files added by hand or through the API", BuiltIn: true,
			Capabilities: Capabilities{Uploads: true, Permissions: PermissionsNone, Shared: true},
		},
		Web: {
			Key: Web, Name: "Website", Description: "Public web pages, fetched by the crawler", BuiltIn: true,
			Capabilities: Capabilities{Sync: true, WebPages: true, Permissions: PermissionsNone, Shared: true},
		},
	}
)

// Register adds a type. It panics on an invalid or duplicate key: registration happens at start-up, and a mistake
// there is a programming error.
func Register(t Type) {
	if !validKey(t.Key) {
		panic(fmt.Sprintf("sourcetypes: invalid key %q", t.Key))
	}
	if t.Name == "" {
		panic(fmt.Sprintf("sourcetypes: type %q has no name", t.Key))
	}
	if t.Permissions == "" {
		t.Permissions = PermissionsNone
	}
	if len(t.ConfigSchema) > 0 && !json.Valid(t.ConfigSchema) {
		panic(fmt.Sprintf("sourcetypes: type %q has an invalid settings schema", t.Key))
	}
	mu.Lock()
	defer mu.Unlock()
	if _, dup := types[t.Key]; dup {
		panic(fmt.Sprintf("sourcetypes: type %q registered twice", t.Key))
	}
	types[t.Key] = t
}

// Get returns a registered type.
func Get(key string) (Type, bool) {
	mu.RLock()
	defer mu.RUnlock()
	t, ok := types[key]
	return t, ok
}

// Of returns the capabilities of a source's type. A type this build does not know (a source made by a build that had
// another connector) has none, so its source is inert: nothing uploads to it and nothing syncs it.
func Of(key string) Capabilities {
	t, _ := Get(key)
	return t.Capabilities
}

// All lists the registered types: the built-in ones first, then the others by name.
func All() []Type {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]Type, 0, len(types))
	for _, t := range types {
		out = append(out, t)
	}
	slices.SortFunc(out, func(a, b Type) int {
		if a.BuiltIn != b.BuiltIn {
			if a.BuiltIn {
				return -1
			}
			return 1
		}
		if a.BuiltIn { // upload before web, as everywhere else
			return compare(a.Key, b.Key)
		}
		if c := compare(a.Name, b.Name); c != 0 {
			return c
		}
		return compare(a.Key, b.Key)
	})
	return out
}

func compare(a, b string) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// Keys lists the registered types' keys in All's order.
func Keys() []string {
	all := All()
	out := make([]string, len(all))
	for i, t := range all {
		out[i] = t.Key
	}
	return out
}
