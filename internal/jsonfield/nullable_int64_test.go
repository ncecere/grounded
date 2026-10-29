package jsonfield

import (
	"encoding/json"
	"testing"
)

func TestNullableInt64DistinguishesOmissionNullAndNumbers(t *testing.T) {
	for _, tc := range []struct {
		input, value string
		present      bool
	}{
		{`{}`, `null`, false},
		{`{"n":null}`, `null`, true},
		{`{"n":0}`, `0`, true},
		{`{"n":1}`, `1`, true},
		{`{"n":9007199254740992}`, `9007199254740992`, true},
	} {
		var got struct {
			N NullableInt64 `json:"n"`
		}
		if err := json.Unmarshal([]byte(tc.input), &got); err != nil {
			t.Fatal(err)
		}
		value, err := json.Marshal(got.N)
		if err != nil || got.N.Present != tc.present || string(value) != tc.value {
			t.Errorf("%s = %+v / %s, %v", tc.input, got, value, err)
		}
	}
	for _, raw := range []string{`"1"`, `1.5`, `true`, `{}`, `[]`, `9223372036854775808`} {
		var n NullableInt64
		if err := json.Unmarshal([]byte(raw), &n); err == nil || n.Present {
			t.Errorf("accepted invalid integer %s: %+v", raw, n)
		}
	}
}
