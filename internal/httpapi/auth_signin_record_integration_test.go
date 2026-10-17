package httpapi_test

import (
	"context"
	"testing"
	"time"
)

// "Last sign-in" is when a person last got in: a refused attempt by a suspended account is not a sign-in, and must not move it (QA pass v0.6.0, #145).
func TestRefusedSignInDoesNotRecordALogin(t *testing.T) {
	app := newTestApp(t, nil)
	lastLogin := func() time.Time {
		t.Helper()
		var at time.Time
		if err := app.Pool.QueryRow(context.Background(), "SELECT last_login_at FROM users WHERE email = 'user@localhost'").Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	setStatus := func(status string) {
		t.Helper()
		if _, err := app.Pool.Exec(context.Background(), "UPDATE users SET status = $1 WHERE email = 'user@localhost'", status); err != nil {
			t.Fatal(err)
		}
	}

	app.devLogin("user")
	first := lastLogin()

	setStatus("suspended")
	time.Sleep(50 * time.Millisecond)
	for i := 0; i < 2; i++ {
		if code, body := app.do("POST", "/auth/dev", map[string]string{"account": "user"}, nil); code != 403 || errorCode(body) != "user_suspended" {
			t.Fatalf("suspended sign-in = %d %s", code, body)
		}
	}
	if got := lastLogin(); !got.Equal(first) {
		t.Fatalf("a refused sign-in moved the last sign-in from %s to %s", first, got)
	}

	// Reactivated, the next real sign-in does.
	setStatus("active")
	time.Sleep(50 * time.Millisecond)
	app.devLogin("user")
	if got := lastLogin(); !got.After(first) {
		t.Fatalf("a sign-in after reactivation did not record a login: %s, was %s", got, first)
	}
}
