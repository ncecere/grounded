package contextual

import "testing"

func TestAdmissionAmountsRoundUpWithoutFloatOrTinyFreeCalls(t *testing.T) {
	for _, tc := range []struct {
		in, out int64
		ip, op  string
		want    string
	}{
		{1, 0, "0.000001", "0", "0.000001"},
		{1, 0, "0", "0", "0.000000"},
		{1000000, 1000000, "0.123456", "2", "2.123456"},
		{3, 2, "0.1", "0.2", "0.000001"},
		{999999, 1, "1", "1", "1.000000"},
	} {
		got, err := admissionAmount(tc.in, tc.out, tc.ip, tc.op)
		if err != nil || got != tc.want {
			t.Errorf("%+v: got %s err=%v, want %s", tc, got, err, tc.want)
		}
	}
	for _, price := range []string{"", "NaN", "Infinity", "-1", "1e6"} {
		if _, err := admissionAmount(1, 1, price, "1"); err == nil {
			t.Errorf("invalid price %q admitted", price)
		}
	}
}

func TestAdmissionRequiresExplicitPositiveCapsWhenEnabled(t *testing.T) {
	if err := validateAdmission(nil, false); err != nil {
		t.Fatal(err)
	}
	if err := validateAdmission(nil, true); err == nil {
		t.Fatal("enabled without explicit admission")
	}
	good := Admission{MaxTokens: 1000, MaxTokensPerDay: 1000, MaxAmount: "1", MaxAmountPerDay: "1", Currency: "USD"}
	if err := validateAdmission(&good, true); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"zero tokens", "large tokens", "zero amount", "negative amount", "currency"} {
		t.Run(field, func(t *testing.T) {
			a := good
			switch field {
			case "zero tokens":
				a.MaxTokens = 0
			case "large tokens":
				a.MaxTokensPerDay = MaxAdmissionTokens + 1
			case "zero amount":
				a.MaxAmount = "0"
			case "negative amount":
				a.MaxAmountPerDay = "-1"
			case "currency":
				a.Currency = "usd"
			}
			if err := validateAdmission(&a, true); err == nil {
				t.Fatal("invalid admission accepted")
			}
		})
	}
}
