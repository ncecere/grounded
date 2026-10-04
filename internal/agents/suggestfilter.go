// Weak follow-up suggestions (v0.4.2 US2-08): the prompt asks for questions
// the answer doesn't answer, about the subject rather than the sources,
// and these filters drop what still slips through. Both lean towards
// keeping a question: a missed weak one costs a chip, a dropped good one
// isn't missed.
//
//   - answeredAlready: almost every content word of the suggestion is in
//     the answer ("How do I renew my books if someone has already requested
//     the item?" after an answer saying you can't renew a requested item).
//     Words are compared by letters and digits, any script; a word shorter
//     than four letters or a function word doesn't count.
//   - aboutTheSources: the suggestion asks about the documents themselves
//     ("Which specific document defines the roles …?"). English phrases:
//     the prompt covers other languages.

package agents

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Content-word overlap: a suggestion with at least answeredMinWords content
// words, answeredShare of them in the answer, is answered already.
const (
	answeredMinWords = 3
	answeredShare    = 0.8
	contentWordRunes = 4
	stemRunes        = 5
)

// functionWords are words of four or more letters that say nothing about
// the subject (English; questionWords, of seven languages, count too).
var functionWords = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`about above after again against already also another anything because been before being below
		between both could does doing done during each else even ever every from have having here into just know like made make many
		more most much must need only other over same should some something still such than that their them then there these they
		this those very want were what when where which while whom whose will with within without would your yours tell explain`) {
		functionWords[w] = true
	}
}

// contentWords are the lower-case words of s that carry its subject.
func contentWords(s string) []string {
	var out []string
	for _, w := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if utf8.RuneCountInString(w) >= contentWordRunes && !functionWords[w] && !questionWords[w] {
			out = append(out, w)
		}
	}
	return out
}

// sameWord reports two words that are one with an ending ("item", "items";
// "request", "requested"): one starts the other, or they share their first
// stemRunes letters.
func sameWord(a, b string) bool {
	if strings.HasPrefix(a, b) || strings.HasPrefix(b, a) {
		return true
	}
	ra, rb := []rune(a), []rune(b)
	return len(ra) >= stemRunes && len(rb) >= stemRunes && string(ra[:stemRunes]) == string(rb[:stemRunes])
}

// answeredAlready reports a suggestion whose content words are almost all
// in the answer.
func answeredAlready(q, answer string) bool {
	words := contentWords(q)
	if len(words) < answeredMinWords {
		return false
	}
	have := contentWords(stripMarkers(answer))
	found := 0
	for _, w := range words {
		for _, a := range have {
			if sameWord(w, a) {
				found++
				break
			}
		}
	}
	return float64(found) >= answeredShare*float64(len(words))
}

// sourcesQuestion matches a question about the material rather than the
// subject.
var sourcesQuestion = regexp.MustCompile(`(?i)\b(?:which|what)\s+(?:specific\s+|particular\s+|other\s+)?` +
	`(?:documents?|sources?|passages?|articles?|sections?|pages?)\s+(?:\w+\s+)?` +
	`(?:defines?|says?|states?|lists?|covers?|explains?|describes?|mentions?|outlines?|specif(?:y|ies)|contains?|discuss(?:es)?)\b` +
	`|\bthe\s+(?:sources|passages)\b|\b(?:these|those|your|provided|available)\s+(?:documents|sources|passages|articles)\b` +
	`|\bknowledge\s+base\b|\baccording\s+to\b`)

// aboutTheSources reports a suggestion that asks about the documents.
func aboutTheSources(q string) bool { return sourcesQuestion.MatchString(q) }
