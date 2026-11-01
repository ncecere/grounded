package teamconfig

import (
	"encoding/json"
	"reflect"
	"strings"
)

// checkFields is needed because some established domain types have custom
// UnmarshalJSON methods that intentionally accept legacy forms. Those methods
// must not turn unknown nested keys into a validated v1 document.
func checkFields(raw json.RawMessage, t reflect.Type) error {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.Struct:
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) != nil {
			return nil
		} // legacy scalar: domain validator decides
		fields := map[string]reflect.Type{}
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			name := strings.Split(f.Tag.Get("json"), ",")[0]
			if name != "" && name != "-" {
				fields[name] = f.Type
			}
		}
		for k, v := range m {
			ft, ok := fields[k]
			if !ok {
				return domainError()
			}
			if err := checkFields(v, ft); err != nil {
				return err
			}
		}
	case reflect.Slice, reflect.Array:
		var items []json.RawMessage
		if json.Unmarshal(raw, &items) != nil {
			return nil
		}
		for _, v := range items {
			if err := checkFields(v, t.Elem()); err != nil {
				return err
			}
		}
	case reflect.Map:
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) != nil {
			return nil
		}
		for _, v := range m {
			if err := checkFields(v, t.Elem()); err != nil {
				return err
			}
		}
	}
	return nil
}
