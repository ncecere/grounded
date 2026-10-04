package agents

import (
	"slices"
	"testing"
)

// The re-test's weak chips are dropped, useful ones kept (v0.4.2 US2-08).
func TestWeakSuggestionsAreDropped(t *testing.T) {
	answer := "Undergraduates can borrow up to 30 items for 4 weeks; graduate students can borrow up to 100 items for 16 weeks [1]. " +
		"You can renew online at library.example.edu/account, unless someone else has requested the item [2]."
	for q, drop := range map[string]bool{
		// Answered already, in its own words.
		"How do I renew my books if someone has already requested the item?": true,
		"Can graduate students borrow items for 16 weeks?":                   true,
		// About the documents.
		"Which specific document defines the roles eligible to extend a guest Wi-Fi pass?": true,
		"What do the sources say about late fees?":                                         true,
		"Is there more in the knowledge base about fines?":                                 true,
		// Useful follow-ups.
		"What are the late fees for overdue items?":                               false,
		"Can I renew items online more than once?":                                false,
		"How do I borrow from another library?":                                   false,
		"What documents do I need to get a card?":                                 false,
		"¿Cuánto cuesta una multa por retraso?":                                   false,
		"图书馆周末开放吗？":                                                               false,
		"What is the maximum number of books I can borrow as a graduate student?": false, // a synonym: the prompt's job
	} {
		got := answeredAlready(q, answer) || aboutTheSources(q)
		if got != drop {
			t.Errorf("%q dropped = %v, want %v", q, got, drop)
		}
	}
	reply := "1. How do I renew my books if someone has already requested the item?\n2. What are the late fees for overdue items?\n" +
		"3. Which document lists the loan periods?"
	if got := parseSuggestions(reply, "How long can I keep a book?", answer, nil); !slices.Equal(got, []string{"What are the late fees for overdue items?"}) {
		t.Errorf("parseSuggestions = %q", got)
	}
}

func TestSameWord(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{{"item", "items", true}, {"requested", "request", true}, {"student", "students", true}, {"fees", "fines", false}, {"late", "later", true}} {
		if got := sameWord(c.a, c.b); got != c.want {
			t.Errorf("sameWord(%q, %q) = %v", c.a, c.b, got)
		}
	}
}
