package systemone

import (
	"fmt"
	"math"
	"strconv"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
)

// Question types of the SystemOne API.
const (
	TypeNoul   = "noul"   // yes/no: the probability of yes
	TypeChoice = "choice" // one of named options, with a distribution
	TypeScore  = "score"  // a position on ordered levels
)

// Question is one typed question. Instructions and criteria may be strings
// or structured values; Grounded only sends strings.
type Question struct {
	Type         string `json:"type"`
	Instructions string `json:"instructions"`
	// Criteria: noul {"true": …, "false": …} (optional); choice
	// {option: description}; score [level, …] from lowest to highest.
	Criteria any `json:"criteria,omitempty"`
}

// Noul is a yes/no question; yes and no ("" = omitted) describe what each
// answer means.
func Noul(instructions, yes, no string) Question {
	q := Question{Type: TypeNoul, Instructions: instructions}
	if yes != "" || no != "" {
		q.Criteria = map[string]string{"true": yes, "false": no}
	}
	return q
}

// Score rates the state on ordered levels (2-10), lowest first.
func Score(instructions string, levels ...string) Question {
	return Question{Type: TypeScore, Instructions: instructions, Criteria: levels}
}

// Choice picks one of the options (option -> description).
func Choice(instructions string, options map[string]string) Question {
	return Question{Type: TypeChoice, Instructions: instructions, Criteria: options}
}

// Request is the body of POST /v1/systemone.
type Request struct {
	State     any                 `json:"state"`
	Model     string              `json:"model"`
	Questions map[string]Question `json:"questions"`
}

// Answer is one typed answer. Noul answers carry Noul; choice answers
// Choice, Probabilities and Confidence; score answers Score, Probabilities
// (by level index) and Confidence.
type Answer struct {
	Type          string             `json:"type"`
	Noul          *float64           `json:"noul,omitempty"`
	Choice        string             `json:"choice,omitempty"`
	Score         *float64           `json:"score,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
	Confidence    *float64           `json:"confidence,omitempty"`
}

// Usage is the token count of one request.
type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// Response is the body of a successful answer.
type Response struct {
	Model   string            `json:"model"`
	Answers map[string]Answer `json:"answers"`
	Usage   Usage             `json:"usage"`
}

// Noul returns a validated noul answer (0 when absent).
func (r Response) Noul(id string) float64 {
	if a, ok := r.Answers[id]; ok && a.Noul != nil {
		return *a.Noul
	}
	return 0
}

// Score returns a validated score answer (0 when absent).
func (r Response) Score(id string) float64 {
	if a, ok := r.Answers[id]; ok && a.Score != nil {
		return *a.Score
	}
	return 0
}

// Path is the endpoint relative to a connection's base URL: a base ending
// in the version (https://judge.example.edu/v1) gets /systemone, any other
// base /v1/systemone.
func Path(base string) string { return catalog.SystemOnePath(base) }

// badResponse is an answer the client could not accept.
func badResponse(format string, args ...any) error {
	return &gateway.Error{Kind: gateway.KindBadResponse, Message: "SystemOne: " + fmt.Sprintf(format, args...)}
}

// tolerance absorbs rounding in probabilities reported as 1.0000001.
const tolerance = 1e-6

func unit(v float64) (float64, bool) {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < -tolerance || v > 1+tolerance {
		return 0, false
	}
	return min(max(v, 0), 1), true
}

// Validate checks that the response answers every question with the
// question's type and in range, and clamps rounding errors. Answers to
// questions that were not asked are ignored.
func Validate(qs map[string]Question, res *Response) error {
	if res.Answers == nil {
		return badResponse("the response has no answers")
	}
	for id, q := range qs {
		a, ok := res.Answers[id]
		if !ok {
			return badResponse("no answer for %q", id)
		}
		if a.Type != q.Type {
			return badResponse("answer %q has type %q, expected %q", id, a.Type, q.Type)
		}
		if err := validateAnswer(id, q, &a); err != nil {
			return err
		}
		res.Answers[id] = a
	}
	return nil
}

func validateAnswer(id string, q Question, a *Answer) error {
	switch q.Type {
	case TypeNoul:
		if a.Noul == nil {
			return badResponse("answer %q has no noul", id)
		}
		v, ok := unit(*a.Noul)
		if !ok {
			return badResponse("answer %q is out of range", id)
		}
		a.Noul = &v
	case TypeScore:
		levels, _ := q.Criteria.([]string)
		if a.Score == nil || math.IsNaN(*a.Score) || *a.Score < -tolerance || *a.Score > float64(len(levels)-1)+tolerance {
			return badResponse("answer %q has no score in range", id)
		}
		v := min(max(*a.Score, 0), float64(len(levels)-1))
		a.Score = &v
		for k := range a.Probabilities {
			if n, err := strconv.Atoi(k); err != nil || n < 0 || n >= len(levels) {
				return badResponse("answer %q has an unknown level %q", id, k)
			}
		}
	case TypeChoice:
		opts, _ := q.Criteria.(map[string]string)
		if _, ok := opts[a.Choice]; !ok {
			return badResponse("answer %q chose an unknown option", id)
		}
	}
	return nil
}
