package httpapi_test

import (
	"context"
	"strings"
	"testing"
	"time"
)

// TestTodayUsesPlatformZone: the date the model is told and the saved
// answers' day key use the platform's time zone (Admin → Costs settings),
// UTC when it's UTC or a name this build doesn't know (walkthrough fixes,
// docs/v0.4.1.md §8). Kiritimati (UTC+14) and Pago Pago (UTC−11) are always
// on different dates, so the key must change between them.
func TestTodayUsesPlatformZone(t *testing.T) {
	env := newCacheEnv(t, newAgentEnv(t))
	setZone := func(name string) {
		t.Helper()
		if _, err := env.app.Pool.Exec(context.Background(), `UPDATE cost_settings SET time_zone = $1 WHERE singleton`, name); err != nil {
			t.Fatal(err)
		}
	}
	lastPrompt := func() string {
		t.Helper()
		ps := systemPrompts(env.proxy)
		for i := len(ps) - 1; i >= 0; i-- {
			if strings.Contains(ps[i], "Today is") {
				return ps[i]
			}
		}
		t.Fatal("no answer prompt")
		return ""
	}
	today := func(zone string) string {
		t.Helper()
		loc, err := time.LoadLocation(zone)
		if err != nil {
			t.Fatal(err)
		}
		return "Today is " + time.Now().In(loc).Format("Monday, January 2, 2006") + "."
	}
	const question = "Where do students buy a parking permit today?" // "today": the day joins the key

	setZone("Pacific/Kiritimati")
	if _, called := env.ask(t, env.member, question); !called {
		t.Fatal("first answer came from the cache")
	}
	if p := lastPrompt(); !strings.Contains(p, today("Pacific/Kiritimati")) {
		t.Fatalf("Kiritimati prompt, want %q:\n%s", today("Pacific/Kiritimati"), p)
	}
	if _, called := env.ask(t, env.editor, question); called {
		t.Fatal("the same question on the same day wasn't served from the cache")
	}

	// Another date in the platform's zone: a new key, answered live with that date.
	setZone("Pacific/Pago_Pago")
	if _, called := env.ask(t, env.member, question); !called {
		t.Fatal("a saved answer from another day in the platform's zone was reused")
	}
	if p := lastPrompt(); !strings.Contains(p, today("Pacific/Pago_Pago")) {
		t.Fatalf("Pago Pago prompt, want %q:\n%s", today("Pacific/Pago_Pago"), p)
	}

	// UTC, and a zone this build doesn't know (stored before, say): UTC's date.
	for zone, q := range map[string]string{"UTC": "When is the parking office open?", "Nowhere/Unknown": "Is the parking office open now?"} {
		setZone(zone)
		if _, called := env.ask(t, env.member, q); !called {
			t.Fatalf("%s: answer came from the cache", zone)
		}
		if p := lastPrompt(); !strings.Contains(p, today("UTC")) {
			t.Fatalf("%s prompt, want %q:\n%s", zone, today("UTC"), p)
		}
	}
}
