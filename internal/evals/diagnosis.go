// Why a question passed or failed (docs/evaluations.md §2, §4): each
// expected document as the run found it (in the knowledge base or not,
// deleted since, the rank it came back at, beyond k when a deeper search
// found it), and why a question wasn't scored.

package evals

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Kinds of expected document.
const (
	ItemDocument = "document"
	ItemURL      = "url"
	ItemFilename = "filename"
)

// States of an expected document in the knowledge base.
const (
	// StateIndexed: a document of the knowledge base matches it.
	StateIndexed = "indexed"
	// StateNotIndexed: none does, and none did in the question's earlier
	// runs (a typo, or a document not added yet).
	StateNotIndexed = "not_indexed"
	// StateDeleted: a picked document, or one an earlier run found, that's
	// gone.
	StateDeleted = "deleted"
)

// DeepSearch is how many results a retrieval check looks through, in a
// second search, for the rank of an expected document that isn't in the top
// k ("found at #11"). The pass or fail is still the top k's.
const DeepSearch = 50

// ExpectedItem is one expected document of a question as a run (or the
// question form's check) found it.
type ExpectedItem struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
	Title string `json:"title,omitempty"`
	State string `json:"state"`
	// DocumentID and SourceID are a document that matches it (indexed).
	DocumentID *uuid.UUID `json:"documentId,omitempty"`
	SourceID   *uuid.UUID `json:"sourceId,omitempty"`
	// Rank is the passage rank a matching document first came back at
	// (retrieval), beyond k when Diagnosis.Depth is set.
	Rank *int `json:"rank,omitempty"`
}

// Items lists the expected documents one by one: documents, URLs, filenames.
func (e Expected) Items() []ExpectedItem {
	out := make([]ExpectedItem, 0, e.Count())
	for _, id := range e.DocumentIDs {
		out = append(out, ExpectedItem{Kind: ItemDocument, Value: id.String()})
	}
	for _, u := range e.URLs {
		out = append(out, ExpectedItem{Kind: ItemURL, Value: u})
	}
	for _, f := range e.Filenames {
		out = append(out, ExpectedItem{Kind: ItemFilename, Value: f})
	}
	return out
}

// want is the item alone as expected documents.
func (it ExpectedItem) want() Expected {
	switch it.Kind {
	case ItemDocument:
		id, err := uuid.Parse(it.Value)
		if err != nil {
			return Expected{}
		}
		return Expected{DocumentIDs: []uuid.UUID{id}}
	case ItemURL:
		return Expected{URLs: []string{it.Value}}
	}
	return Expected{Filenames: []string{it.Value}}
}

// key identifies the item across runs (filenames case aside).
func (it ExpectedItem) key() string {
	if it.Kind == ItemFilename {
		return it.Kind + ":" + strings.ToLower(it.Value)
	}
	return it.Kind + ":" + it.Value
}

// Diagnosis is what a run found about a question's expected documents. It
// is stored with the result's scores (eval_results.scores), next to a full
// answer's AnswerScores.
type Diagnosis struct {
	Expected []ExpectedItem `json:"expected,omitempty"`
	// Missing is why the question wasn't scored: MissingNotIndexed or
	// MissingDeleted ("" when an expected document is in the knowledge base).
	Missing string `json:"missing,omitempty"`
	// K is the results per search the run scored (retrieval).
	K int `json:"k,omitempty"`
	// Depth is how many results the second search for ranks looked through
	// (0: there was none).
	Depth int `json:"depth,omitempty"`
}

// Why a question wasn't scored.
const (
	MissingNotIndexed = "not_indexed"
	MissingDeleted    = "deleted"
)

// storedScores is eval_results.scores: a full answer's scores (nil for a
// retrieval check) and the diagnosis, in one JSON object.
type storedScores struct {
	*AnswerScores
	Diagnosis
}

// encodeScores writes a result's scores and diagnosis.
func encodeScores(sc *AnswerScores, d Diagnosis) json.RawMessage {
	raw, _ := json.Marshal(storedScores{AnswerScores: sc, Diagnosis: d})
	return raw
}

// decodeScores reads them; results stored before the diagnosis have none.
func decodeScores(raw []byte) (*AnswerScores, Diagnosis) {
	var st storedScores
	if len(raw) <= 2 || json.Unmarshal(raw, &st) != nil {
		return nil, Diagnosis{}
	}
	return st.AnswerScores, st.Diagnosis
}

// missingReason says why none of the items is in the knowledge base
// ("" when one is): deleted when one of them was there before.
func missingReason(items []ExpectedItem) string {
	reason := MissingNotIndexed
	for _, it := range items {
		switch it.State {
		case StateIndexed:
			return ""
		case StateDeleted:
			reason = MissingDeleted
		}
	}
	return reason
}

// rankItems sets the rank of each item without one: the first document of
// docs matching it (docs in rank order).
func rankItems(items []ExpectedItem, docs []Doc) {
	for i := range items {
		if items[i].Rank != nil {
			continue
		}
		if r := items[i].want().Rank(docs); r > 0 {
			items[i].Rank = &r
		}
	}
}

// match finds a document of the sources matching each item, in one query
// for all of them (a whole set's items too): found[i] says whether one
// does, and the item gets its ID, source and title.
func (s *Service) match(ctx context.Context, sources []uuid.UUID, items []ExpectedItem) ([]bool, error) {
	found := make([]bool, len(items))
	if len(items) == 0 {
		return found, nil
	}
	p := dbgen.MatchExpectedItemsParams{SourceIds: sources, DocumentIds: make([]uuid.UUID, len(items)),
		Urls: make([]string, len(items)), UrlPrefixes: make([]string, len(items)), Filenames: make([]string, len(items))}
	for i, it := range items {
		p.DocumentIds[i], p.Urls[i], p.UrlPrefixes[i], p.Filenames[i] = it.matchKey()
	}
	rows, err := s.q.MatchExpectedItems(ctx, p)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		i := int(r.Idx) - 1
		if i < 0 || i >= len(items) {
			continue
		}
		found[i] = true
		items[i].DocumentID, items[i].SourceID, items[i].Title = &r.ID, &r.SourceID, firstOf(r.Title, r.Filename, r.URL)
	}
	return found, nil
}

// matchKey is the item as MatchExpectedItems takes it: exactly one of a
// document ID, an exact URL (no trailing slash), a URL prefix or a
// lower-cased filename (the others zero). An item that can't match (a
// malformed document ID) has none.
func (it ExpectedItem) matchKey() (doc uuid.UUID, url, prefix, filename string) {
	docs, urls, prefixes, names := it.want().existence()
	switch {
	case len(docs) > 0:
		doc = docs[0]
	case len(urls) > 0:
		url = urls[0]
	case len(prefixes) > 0:
		prefix = prefixes[0]
	case len(names) > 0:
		filename = names[0]
	}
	return doc, url, prefix, filename
}

// seenBefore are the items the question's earlier results found in the
// knowledge base, with their titles, by key.
func (s *Service) seenBefore(ctx context.Context, caseID uuid.UUID) (map[string]string, error) {
	rows, err := s.q.ListCaseResults(ctx, dbgen.ListCaseResultsParams{CaseID: uuid.NullUUID{UUID: caseID, Valid: true}, Lim: 20})
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, r := range rows {
		_, d := decodeScores(r.EvalResult.Scores)
		for _, it := range d.Expected {
			if _, ok := out[it.key()]; !ok && it.State == StateIndexed {
				out[it.key()] = it.Title
			}
		}
	}
	return out, nil
}

// diagnose finds each expected document of a question in the run's
// knowledge bases: indexed, deleted (picked from the knowledge base, which
// the form checks, or found by an earlier run) or never indexed.
func (x *executor) diagnose(ctx context.Context, cs Case) (Diagnosis, error) {
	d := Diagnosis{Expected: cs.Want.Items(), K: x.t.cfg.ResultsPerSearch}
	found, err := x.s.match(ctx, x.sources, d.Expected)
	if err != nil {
		return d, err
	}
	before, err := x.s.seenBefore(ctx, cs.ID)
	if err != nil {
		return d, err
	}
	for i := range d.Expected {
		it := &d.Expected[i]
		title, seen := before[it.key()]
		switch {
		case found[i]:
			it.State = StateIndexed
		case it.Kind == ItemDocument || seen:
			it.State = StateDeleted
		default:
			it.State = StateNotIndexed
		}
		if it.Title == "" && seen {
			it.Title = title
		}
	}
	d.Missing = missingReason(d.Expected)
	return d, nil
}

// snippetChars is how much of a passage a retrieval result keeps.
const snippetChars = 300

// shortSnippet is the start of a passage, on one line.
func shortSnippet(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= snippetChars {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:snippetChars])) + "…"
}

func firstOf(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
