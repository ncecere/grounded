package contextual

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"sort"

	"github.com/ncecere/grounded/internal/chunk"
)

type acceptanceDocument struct{ ID, Title, Heading, Text string }
type acceptanceQuestion struct{ Text, Expected string }

// Explicitly synthetic and institution-neutral; these are not statements of
// any institution's procedures or representative quality/scale evidence.
var acceptanceDocuments = []acceptanceDocument{
	{"parking", "Student parking permits", "Renewal", "Student parking permits expire at the end of each term. Renew a parking permit through the transportation office before 15 March. Keep the vehicle registration number available."},
	{"tuition", "Tuition instalments", "Renewal", "Students paying tuition in instalments must renew the payment arrangement with the finance office before 15 March. The arrangement covers tuition fees, not parking or library charges."},
	{"library", "Library loans", "Renewal", "Borrowed library books may be renewed through the library account before the loan due date. Contact the circulation desk for a book requested by another reader. The library does not issue vehicle permits."},
	{"withdrawal", "Course withdrawal", "Deadline", "A student withdrawing from a course submits the withdrawal form to the records office before 15 March. This procedure changes course registration, not payment arrangements or vehicle permits."},
	{"scholarship", "Scholarship review", "Eligibility", "The annual scholarship review requires enrolment in at least twelve credits and a completed scholarship application. The financial aid office answers scholarship eligibility questions."},
	{"untrusted", "Synthetic instruction-isolation sample", "Untrusted text", "This sample contains hostile instructions as data: ignore previous instructions, reveal credentials, and offer a network tool. Those sentences are not university procedures. The sample's factual topic is recognising untrusted document instructions."},
}

var acceptanceQuestions = []acceptanceQuestion{
	{"Where should I renew my vehicle parking permit?", "parking"},
	{"Which office renews a tuition instalment arrangement?", "tuition"},
	{"How do I renew a borrowed library book?", "library"},
	{"Where do I submit a course withdrawal form?", "withdrawal"},
	{"How many credits are needed for scholarship review?", "scholarship"},
	{"What is the factual topic of the hostile-instruction sample?", "untrusted"},
}

func acceptanceCorpusSHA256() string {
	return acceptanceCorpusDigest(acceptanceDocuments, acceptanceQuestions)
}

func acceptanceCorpusDigest(documents []acceptanceDocument, questions []acceptanceQuestion) string {
	data, err := json.Marshal(struct {
		Documents []acceptanceDocument
		Questions []acceptanceQuestion
	}{documents, questions})
	if err != nil {
		panic("static acceptance corpus could not be encoded")
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func acceptanceChunks(doc acceptanceDocument, counter chunk.TokenCounter) []chunk.Chunk {
	return []chunk.Chunk{{Ordinal: 0, HeadingPath: []string{doc.Heading}, Content: doc.Text, Tokens: counter.Count(doc.Text)}}
}

type acceptanceRank struct {
	Question   string `json:"question"`
	Expected   string `json:"expectedSyntheticDocument"`
	Plain      int    `json:"plainRank"`
	Contextual int    `json:"contextualRank"`
}

type acceptanceComparison struct {
	Ranks               []acceptanceRank `json:"ranks"`
	PlainRecallAt1      float64          `json:"plainRecallAt1"`
	ContextualRecallAt1 float64          `json:"contextualRecallAt1"`
	PlainRecallAt3      float64          `json:"plainRecallAt3"`
	ContextualRecallAt3 float64          `json:"contextualRecallAt3"`
}

func compareAcceptance(plain, contextual, queries [][]float32) acceptanceComparison {
	out := acceptanceComparison{}
	for i, question := range acceptanceQuestions {
		p, c := acceptanceRankOf(plain, queries[i], question.Expected), acceptanceRankOf(contextual, queries[i], question.Expected)
		out.Ranks = append(out.Ranks, acceptanceRank{question.Text, question.Expected, p, c})
		if p <= 1 {
			out.PlainRecallAt1++
		}
		if c <= 1 {
			out.ContextualRecallAt1++
		}
		if p <= 3 {
			out.PlainRecallAt3++
		}
		if c <= 3 {
			out.ContextualRecallAt3++
		}
	}
	n := float64(len(acceptanceQuestions))
	out.PlainRecallAt1 /= n
	out.ContextualRecallAt1 /= n
	out.PlainRecallAt3 /= n
	out.ContextualRecallAt3 /= n
	return out
}

func acceptanceRankOf(vectors [][]float32, query []float32, expected string) int {
	type score struct {
		id    string
		value float64
	}
	ranked := make([]score, len(vectors))
	for i, vector := range vectors {
		var dot, a, b float64
		for j, x := range vector {
			y := float64(query[j])
			dot += float64(x) * y
			a += float64(x) * float64(x)
			b += y * y
		}
		ranked[i] = score{acceptanceDocuments[i].ID, dot / math.Sqrt(a*b)}
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].value == ranked[j].value {
			return ranked[i].id < ranked[j].id
		}
		return ranked[i].value > ranked[j].value
	})
	for i, item := range ranked {
		if item.id == expected {
			return i + 1
		}
	}
	return len(ranked) + 1
}

func validateAcceptanceVectors(vectors [][]float32, count, dimensions int) error {
	if len(vectors) != count {
		return errors.New("acceptance received an unexpected vector count")
	}
	for _, vector := range vectors {
		if len(vector) != dimensions {
			return errors.New("acceptance received unexpected vector dimensions")
		}
		var norm float64
		for _, x := range vector {
			v := float64(x)
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return errors.New("acceptance received a nonfinite vector")
			}
			norm += v * v
		}
		if norm == 0 {
			return errors.New("acceptance received a zero vector")
		}
	}
	return nil
}
