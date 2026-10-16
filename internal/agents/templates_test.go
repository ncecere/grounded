package agents

import (
	"encoding/json"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// What a template deliberately does not carry from an agent's configuration (templates.go: TemplateConfig). Every other field is carried.
var templateLeavesOut = []string{"KBs", "Filters", "Audience", "Tools", "Routable"}

// mutate changes v to a value that differs from its current one, so a field that is copied can be told from one that is reset.
func mutate(v reflect.Value) {
	switch v.Kind() {
	case reflect.String:
		v.SetString(v.String() + "-changed")
	case reflect.Bool:
		v.SetBool(!v.Bool())
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v.SetInt(v.Int() + 7)
	case reflect.Float32, reflect.Float64:
		v.SetFloat(v.Float() + 0.5)
	case reflect.Pointer:
		if v.IsNil() {
			v.Set(reflect.New(v.Type().Elem()))
		}
		mutate(v.Elem())
	case reflect.Slice:
		elem := reflect.New(v.Type().Elem()).Elem()
		mutate(elem)
		v.Set(reflect.Append(v, elem))
	case reflect.Map:
		if v.IsNil() {
			v.Set(reflect.MakeMap(v.Type()))
		}
		key, val := reflect.New(v.Type().Key()).Elem(), reflect.New(v.Type().Elem()).Elem()
		mutate(key)
		mutate(val)
		v.SetMapIndex(key, val)
	case reflect.Array:
		mutate(v.Index(0))
	case reflect.Uint8:
		v.SetUint(v.Uint() + 1)
	case reflect.Struct:
		for i := range v.NumField() {
			if f := v.Field(i); f.CanSet() {
				mutate(f)
			}
		}
	}
}

// A template carries how an agent answers and nothing about what it answers from or who may use it. This fails when a field is added to
// Config that TemplateConfig neither copies nor is listed in templateLeavesOut: the person adding it has to decide.
func TestTemplateConfigClassifiesEveryField(t *testing.T) {
	def := reflect.ValueOf(DefaultConfig())
	poison := DefaultConfig()
	pv := reflect.ValueOf(&poison).Elem()
	for i := range pv.NumField() {
		mutate(pv.Field(i))
		if reflect.DeepEqual(pv.Field(i).Interface(), def.Field(i).Interface()) {
			t.Fatalf("test bug: Config.%s was not changed by the mutation", pv.Type().Field(i).Name)
		}
	}
	got := reflect.ValueOf(TemplateConfig(poison))
	for i := range pv.NumField() {
		name := pv.Type().Field(i).Name
		carried := reflect.DeepEqual(got.Field(i).Interface(), pv.Field(i).Interface())
		reset := reflect.DeepEqual(got.Field(i).Interface(), def.Field(i).Interface())
		listed := slices.Contains(templateLeavesOut, name)
		switch {
		case carried && listed:
			t.Errorf("Config.%s is listed as left out of templates but TemplateConfig carries it", name)
		case !carried && !listed:
			t.Errorf("Config.%s is neither carried by TemplateConfig nor listed in templateLeavesOut: decide whether a template should hold it", name)
		case !carried && !reset:
			t.Errorf("Config.%s is left out but not reset to its default (got %v)", name, got.Field(i).Interface())
		}
	}
}

// The concrete case the owner decided: instructions and settings travel; knowledge bases, tools, filters and a public audience do not.
func TestTemplateConfigDropsWhatItMust(t *testing.T) {
	model := uuid.New()
	c := DefaultConfig()
	c.Instructions = "Be brief."
	c.ChatModelID = &model
	c.KBs = []KBRef{{KBID: uuid.New()}}
	c.Tools = []uuid.UUID{uuid.New()}
	c.Audience = "public"
	c.StrictlyGrounded = false
	got := TemplateConfig(c)
	if got.Instructions != "Be brief." || got.ChatModelID == nil || *got.ChatModelID != model || got.StrictlyGrounded {
		t.Errorf("settings were not carried: %+v", got)
	}
	if len(got.KBs) != 0 || len(got.Tools) != 0 || got.Audience != "team" {
		t.Errorf("what it answers from or who may use it was carried: kbs %d, tools %d, audience %q", len(got.KBs), len(got.Tools), got.Audience)
	}
	raw := string(got.JSON())
	for _, leaked := range []string{c.KBs[0].KBID.String(), c.Tools[0].String(), "public"} {
		if strings.Contains(raw, leaked) {
			t.Errorf("the template's JSON holds %q: %s", leaked, raw)
		}
	}
}

var accentRE = regexp.MustCompile(`^(#[0-9a-f]{6})?$`)

func TestBuiltInTemplatesAreValid(t *testing.T) {
	if len(builtInTemplates) != 6 {
		t.Fatalf("%d built-in templates, the design has six", len(builtInTemplates))
	}
	ids, names := map[string]bool{}, map[string]bool{}
	for _, tm := range builtInTemplates {
		if !tm.BuiltIn || !regexp.MustCompile(`^[a-z][a-z0-9-]*$`).MatchString(tm.ID) {
			t.Errorf("%q: built-in with a slug ID expected", tm.ID)
		}
		if _, err := uuid.Parse(tm.ID); err == nil {
			t.Errorf("%q: a built-in ID must not parse as a UUID (findTemplate tells them apart)", tm.ID)
		}
		if ids[tm.ID] || names[strings.ToLower(tm.Name)] {
			t.Errorf("%q: duplicate ID or name", tm.ID)
		}
		ids[tm.ID], names[strings.ToLower(tm.Name)] = true, true
		if n := len([]rune(tm.Name)); n < 1 || n > 80 {
			t.Errorf("%s: name length %d", tm.ID, n)
		}
		if n := len([]rune(tm.Description)); n < 20 || n > 500 {
			t.Errorf("%s: description length %d", tm.ID, n)
		}
		if n := len([]rune(tm.WelcomeMessage)); n < 1 || n > 1000 {
			t.Errorf("%s: welcome message length %d", tm.ID, n)
		}
		if n := len(tm.StarterQuestions); n < 1 || n > 6 {
			t.Errorf("%s: %d starter questions", tm.ID, n)
		}
		for _, q := range tm.StarterQuestions {
			if n := len([]rune(q)); n < 1 || n > 200 {
				t.Errorf("%s: starter question length %d", tm.ID, n)
			}
		}
		if !accentRE.MatchString(tm.AccentColor) {
			t.Errorf("%s: accent %q", tm.ID, tm.AccentColor)
		}
		c := tm.Config
		if n := len([]rune(c.Instructions)); n < 200 || n > MaxInstructions {
			t.Errorf("%s: instructions length %d", tm.ID, n)
		}
		if c.ChatModelID != nil || len(c.KBs) != 0 || len(c.Tools) != 0 || c.Audience != "team" {
			t.Errorf("%s: a built-in template must not set a model, knowledge bases, tools or an audience: %+v", tm.ID, c)
		}
		// It must be exactly what TemplateConfig would keep, and a configuration the API accepts.
		if !reflect.DeepEqual(TemplateConfig(c), c) {
			t.Errorf("%s: its configuration changes when TemplateConfig is applied", tm.ID)
		}
		if _, err := ParseConfig(c.JSON()); err != nil {
			t.Errorf("%s: its configuration is rejected: %v", tm.ID, err)
		}
	}
}

func TestOverlayConfig(t *testing.T) {
	base := DefaultConfig()
	base.Instructions = "From the template."
	base.RefusalMessage = "Template refusal."
	kb := uuid.New()
	over := json.RawMessage(`{"kbs":[{"kbId":"` + kb.String() + `"}],"refusalMessage":"Mine."}`)
	got, err := ParseConfig(overlayConfig(base, over))
	if err != nil {
		t.Fatal(err)
	}
	if got.Instructions != "From the template." || got.RefusalMessage != "Mine." || len(got.KBs) != 1 || got.KBs[0].KBID != kb {
		t.Errorf("the request must replace only the keys it names: %+v", got)
	}
	for _, none := range []string{"", "null", "  "} {
		got, err := ParseConfig(overlayConfig(base, json.RawMessage(none)))
		if err != nil || got.Instructions != "From the template." {
			t.Errorf("overlay %q: %+v, %v", none, got, err)
		}
	}
	// An unreadable request is passed on as it is, so ParseConfig reports it (400 invalid_config) and the template cannot mask it.
	if _, err := ParseConfig(overlayConfig(base, json.RawMessage(`{"kbs": `))); err == nil {
		t.Error("an unreadable request config was accepted")
	}
	if _, err := ParseConfig(overlayConfig(base, json.RawMessage(`{"nope":1}`))); err == nil {
		t.Error("an unknown key in the request config was accepted")
	}
}
