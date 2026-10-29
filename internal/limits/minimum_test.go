package limits

import (
	"strings"
	"testing"
)

func TestPublicMessageNumericSettingsCannotDisableEveryMessage(t *testing.T) {
	d, _ := Lookup(PublicMessageMaxChars)
	for _, st := range []Setting{{Default: ptr(0)}, {Default: ptr(0), Ceiling: ptr(0)}, {Default: ptr(1), Ceiling: ptr(0)}} {
		if err := ValidateSetting(d, st); err == nil || !strings.Contains(err.Error(), "at least 1") {
			t.Errorf("accepted zero bound %+v: %v", st, err)
		}
	}
	for _, st := range []Setting{{Default: ptr(1)}, {Default: ptr(1), Ceiling: ptr(1)}, {}} {
		if err := ValidateSetting(d, st); err != nil {
			t.Errorf("rejected valid message bound %+v: %v", st, err)
		}
	}
	if err := ValidateOverride(d, Setting{}, ptr(0)); err == nil {
		t.Fatal("accepted zero message-length team override")
	}
	if err := ValidateOverride(d, Setting{}, nil); err != nil {
		t.Fatal("cannot inherit the message bound", err)
	}
	ordinary, _ := Lookup(DataSources)
	if err := ValidateSetting(ordinary, Setting{Default: ptr(0), Ceiling: ptr(0)}); err != nil {
		t.Fatal("zero must still block ordinary resources", err)
	}
}
