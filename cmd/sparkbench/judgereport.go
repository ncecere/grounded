package main

import (
	"fmt"
	"sort"
	"strings"
)

// fileStats aggregates one judged answer file.
type fileStats struct {
	model                                                                 string
	n, errs, correct, partial, incorrect, refused, citesExp, expIn, cited int
	invalid                                                               int
	pCorrect, conf, first, firstText, total, out, reason                  []float64
}

func statsOf(js []judgedAnswer) fileStats {
	var s fileStats
	for _, j := range js {
		s.model = j.Model
		s.n++
		if j.Error != "" {
			s.errs++
			continue
		}
		switch j.Verdict {
		case "correct":
			s.correct++
		case "partially":
			s.partial++
		case "incorrect":
			s.incorrect++
		}
		s.pCorrect = append(s.pCorrect, j.Probabilities["correct"])
		s.conf = append(s.conf, j.Confidence)
		s.refused += b2i(j.Refused)
		s.citesExp += b2i(j.CitesExpected)
		s.expIn += b2i(j.ExpectedInSource)
		s.cited += b2i(len(j.Cited) > 0)
		s.invalid += len(j.InvalidCites)
		s.first = append(s.first, j.FirstTokenMs/1000)
		s.firstText = append(s.firstText, j.FirstContentMs/1000)
		s.total = append(s.total, j.TotalMs/1000)
		s.out = append(s.out, float64(j.OutputTokens))
		s.reason = append(s.reason, float64(j.ReasoningTokens))
	}
	return s
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func printJudgeTables(files []string, all map[string][]judgedAnswer) {
	fmt.Println("\n| answers | model | n | errors | correct | partially | incorrect | mean P(correct) | mean confidence | refusals | cites expected page | expected page retrieved | answers with citations | invalid citations |")
	fmt.Println("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
	for _, path := range files {
		s := statsOf(all[path])
		fmt.Printf("| %s | %s | %d | %d | %d | %d | %d | %.2f | %.2f | %d | %d | %d | %d | %d |\n",
			shortPath(path), s.model, s.n, s.errs, s.correct, s.partial, s.incorrect, mean(s.pCorrect), mean(s.conf),
			s.refused, s.citesExp, s.expIn, s.cited, s.invalid)
	}
	fmt.Println("\n| answers | first token p50 / p95 s | first answer text p50 / p95 s | total p50 / p95 s | output tokens mean | reasoning tokens mean |")
	fmt.Println("|---|---:|---:|---:|---:|---:|")
	for _, path := range files {
		s := statsOf(all[path])
		fmt.Printf("| %s | %.1f / %.1f | %.1f / %.1f | %.1f / %.1f | %.0f | %.0f |\n", shortPath(path),
			pct(s.first, 50), pct(s.first, 95), pct(s.firstText, 50), pct(s.firstText, 95), pct(s.total, 50), pct(s.total, 95), mean(s.out), mean(s.reason))
	}
	printPerQuestion(files, all)
}

// printPerQuestion prints each question's verdict per answer file.
func printPerQuestion(files []string, all map[string][]judgedAnswer) {
	byID := map[string]map[string]judgedAnswer{}
	var ids []string
	for _, path := range files {
		for _, j := range all[path] {
			if byID[j.ID] == nil {
				byID[j.ID] = map[string]judgedAnswer{}
				ids = append(ids, j.ID)
			}
			byID[j.ID][path] = j
		}
	}
	sort.Strings(ids)
	fmt.Print("\n| id |")
	for _, p := range files {
		fmt.Printf(" %s |", shortPath(p))
	}
	fmt.Printf("\n|---|%s\n", strings.Repeat("---|", len(files)))
	for _, id := range ids {
		fmt.Printf("| %s |", id)
		for _, p := range files {
			j, ok := byID[id][p]
			fmt.Printf(" %s |", verdictCell(j, ok))
		}
		fmt.Println()
	}
}

func verdictCell(j judgedAnswer, ok bool) string {
	switch {
	case !ok:
		return "–"
	case j.Error != "":
		return "error"
	}
	var flags string
	if j.Refused {
		flags += ", refused"
	}
	if !j.CitesExpected {
		flags += ", no expected cite"
	}
	return fmt.Sprintf("%s (%.2f%s)", j.Verdict, j.Confidence, flags)
}

func shortPath(p string) string {
	p = p[strings.LastIndex(p, "/")+1:]
	return strings.TrimSuffix(strings.TrimPrefix(p, "answers-"), ".jsonl")
}
