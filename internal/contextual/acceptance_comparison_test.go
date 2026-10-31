package contextual

import (
	"math"
	"testing"
)

func TestAcceptanceComparisonReportsWorseResultsWithoutAQualityThreshold(t *testing.T) {
	plain, contextual, queries := make([][]float32, 6), make([][]float32, 6), make([][]float32, 6)
	for i := range 6 {
		v := make([]float32, 6)
		v[i] = 1
		plain[i], contextual[i], queries[i] = v, v, v
	}
	contextual[0], contextual[1] = contextual[1], contextual[0]
	report := compareAcceptance(plain, contextual, queries)
	if report.PlainRecallAt1 != 1 || report.ContextualRecallAt1 >= report.PlainRecallAt1 || len(report.Ranks) != 6 {
		t.Fatalf("worse synthetic outcome was hidden: %+v", report)
	}
	if report.Ranks[0].Plain != 1 || report.Ranks[0].Contextual == 1 {
		t.Fatal("rank regression was lost")
	}
}

func TestAcceptanceCorpusFingerprintBindsDocumentsAndExpectedAnswers(t *testing.T) {
	original := acceptanceCorpusSHA256()
	documents := append([]acceptanceDocument(nil), acceptanceDocuments...)
	questions := append([]acceptanceQuestion(nil), acceptanceQuestions...)
	copyDigest := acceptanceCorpusDigest(documents, questions)
	if len(original) != 64 || original != copyDigest {
		t.Fatal("identical corpus copies produced different fingerprints")
	}
	documents[0].Text += " Synthetic changed procedure."
	if original == acceptanceCorpusDigest(documents, questions) {
		t.Fatal("changed document did not invalidate corpus approval")
	}
	documents[0] = acceptanceDocuments[0]
	questions[0].Expected = "library"
	if original == acceptanceCorpusDigest(documents, questions) {
		t.Fatal("changed expected answer did not invalidate corpus approval")
	}
}

func TestAcceptanceComparisonRejectsMalformedVectors(t *testing.T) {
	for _, vectors := range [][][]float32{
		nil, {{1}}, {{0, 0}}, {{1, float32(math.NaN())}}, {{1, float32(math.Inf(1))}},
	} {
		if validateAcceptanceVectors(vectors, 1, 2) == nil {
			t.Errorf("malformed vector was accepted: %v", vectors)
		}
	}
	if err := validateAcceptanceVectors([][]float32{{1, 2}}, 1, 2); err != nil {
		t.Fatal(err)
	}
}
