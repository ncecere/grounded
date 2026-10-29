// Package jsonfield preserves JSON field presence where an explicit null has
// different semantics from an omitted member.
package jsonfield

import "encoding/json"

// NullableInt64 is an integer or explicit null. Present is false only when a
// containing object omitted the member; a plain *int64 cannot distinguish that
// omission from null. MarshalJSON emits just the number/null, never this wrapper.
type NullableInt64 struct {
	Value   *int64
	Present bool
}

func (n *NullableInt64) UnmarshalJSON(data []byte) error {
	var value *int64
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	n.Value, n.Present = value, true
	return nil
}

func (n NullableInt64) MarshalJSON() ([]byte, error) { return json.Marshal(n.Value) }
