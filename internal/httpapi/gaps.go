// The gap report (docs/gaps.md, docs/v0.4.0.md §2): a team's topics for
// its editors, admins and owners (session only; internal/gaps answers 404
// to everyone else), and counts per team for platform admins and auditors.

package httpapi

import (
	"net/http"
	"time"

	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/gaps"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// gapRoutes: a team's gap topics and the platform counts.
func (a *api) gapRoutes() []route {
	const topic = "/v1/teams/{team}/gap-topics/{topicId}"
	return []route{
		{"GET", "/v1/teams/{team}/gap-topics", a.session(a.listGapTopics)},
		{"GET", topic, a.session(a.getGapTopic)},
		{"POST", topic + "/dismiss", a.session(a.dismissGapTopic)},
		{"POST", topic + "/fix", a.session(a.fixGapTopic)},
		{"POST", topic + "/add-source", a.session(a.addGapTopicSource)},
		{"POST", topic + "/evaluations", a.session(a.addGapQuestionToEvaluations)},
		{"GET", "/v1/admin/analytics/gaps", a.admin(a.adminGetGapCounts)},
	}
}

func (a *api) listGapTopics(w http.ResponseWriter, r *http.Request) {
	agent, ok := queryUUID(w, r, "agentId")
	if !ok {
		return
	}
	list, err := a.Gaps.List(r.Context(), a.actor(r), r.PathValue("team"), agent, r.URL.Query().Get("state"))
	if failed(w, r, err) {
		return
	}
	out := apitypes.GapTopicList{Topics: make([]apitypes.GapTopic, len(list.Topics)), Pending: list.Pending, MinAskers: gaps.MinAskers}
	for i, t := range list.Topics {
		out.Topics[i] = toAPIGapTopic(t)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) getGapTopic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "topicId")
	if !ok {
		return
	}
	d, err := a.Gaps.Get(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	out := apitypes.GapTopicDetail{Topic: toAPIGapTopic(d.Topic), SharedQuestions: make([]apitypes.GapSharedQuestion, len(d.Shared))}
	for i, q := range d.Shared {
		out.SharedQuestions[i] = toAPISharedQuestion(q)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) dismissGapTopic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "topicId")
	if !ok {
		return
	}
	var in apitypes.GapTopicDismiss
	if r.ContentLength != 0 && !httpx.Decode(w, r, &in) {
		return
	}
	t, err := a.Gaps.Dismiss(r.Context(), a.actor(r), r.PathValue("team"), id, deref(in.Reason, ""))
	writeGapTopic(w, r, t, err)
}

func (a *api) fixGapTopic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "topicId")
	if !ok {
		return
	}
	t, err := a.Gaps.Fix(r.Context(), a.actor(r), r.PathValue("team"), id)
	writeGapTopic(w, r, t, err)
}

func (a *api) addGapTopicSource(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "topicId")
	if !ok {
		return
	}
	t, err := a.Gaps.AddSource(r.Context(), a.actor(r), r.PathValue("team"), id)
	writeGapTopic(w, r, t, err)
}

func writeGapTopic(w http.ResponseWriter, r *http.Request, t gaps.Topic, err error) {
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIGapTopic(t))
}

func (a *api) addGapQuestionToEvaluations(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "topicId")
	if !ok {
		return
	}
	var in apitypes.GapEvaluationAdd
	if !httpx.Decode(w, r, &in) {
		return
	}
	add := gaps.EvaluationInput{SetID: in.SetId, SharedQuestionID: in.SharedQuestionId, Question: deref(in.Question, ""), Note: deref(in.Note, ""),
		Expected: evals.Expected{DocumentIDs: in.Expected.DocumentIds, URLs: in.Expected.Urls, Filenames: in.Expected.Filenames}}
	if in.MustMention != nil {
		add.MustMention = *in.MustMention
	}
	q, caseID, err := a.Gaps.AddToEvaluations(r.Context(), a.actor(r), r.PathValue("team"), id, add)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, apitypes.GapEvaluationAdded{SharedQuestion: toAPISharedQuestion(q), EvaluationQuestionId: caseID, SetId: in.SetId})
}

func (a *api) adminGetGapCounts(w http.ResponseWriter, r *http.Request) {
	from, to, ok := dateRange(w, r)
	if !ok {
		return
	}
	if to.IsZero() {
		to = time.Now().UTC().Truncate(24 * time.Hour)
	}
	if from.IsZero() {
		from = to.AddDate(0, 0, -29)
	}
	if from.After(to) {
		httpx.Error(w, http.StatusBadRequest, "invalid_range", "from must not be after to")
		return
	}
	teams, err := a.Gaps.Counts(r.Context(), a.actor(r), from, to.AddDate(0, 0, 1))
	if failed(w, r, err) {
		return
	}
	out := apitypes.AdminGapCounts{From: date(from), To: date(to), Teams: make([]apitypes.AdminGapTeam, len(teams))}
	for i, t := range teams {
		out.Teams[i] = apitypes.AdminGapTeam{TeamId: t.TeamID, Slug: t.Slug, Name: t.Name, Questions: t.Questions, Signals: t.Signals}
		out.Questions += t.Questions
	}
	httpx.JSON(w, http.StatusOK, out)
}

func toAPIGapTopic(t gaps.Topic) apitypes.GapTopic {
	return apitypes.GapTopic{
		Id: t.ID, AgentId: t.AgentID, AgentName: t.AgentName, Label: t.Label, State: apitypes.GapTopicState(t.State),
		StateReason: t.StateReason, StateChangedAt: t.StateChangedAt, Questions: t.Questions, Askers: t.Askers, Shared: t.Shared,
		Last30Days: t.Recent, FirstSeen: t.FirstSeen, LastSeen: t.LastSeen, Signals: t.Signals, Reasons: t.Reasons, Trend: t.Trend,
	}
}

func toAPISharedQuestion(q gaps.SharedQuestion) apitypes.GapSharedQuestion {
	out := apitypes.GapSharedQuestion{Id: q.ID, Question: q.Question, AddedToEvaluations: q.EvaluationQuestionID.Valid, CreatedAt: q.CreatedAt}
	if q.FeedbackReason != nil {
		reason := apitypes.FeedbackReason(*q.FeedbackReason)
		out.FeedbackReason = &reason
	}
	return out
}
