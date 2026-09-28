package agents

import "testing"

func TestChatOutcome(t *testing.T) {
	cases := []struct {
		ans  Answer
		want string
	}{
		{Answer{}, OutcomeOK},
		{Answer{Refused: true}, OutcomeNoAnswer},
		{Answer{NoContext: true}, OutcomeNoAnswer},
		{Answer{Moderation: &ModerationEvent{}}, OutcomeModerated},
		{Answer{Moderation: &ModerationEvent{}, ErrorCode: "moderation_blocked"}, OutcomeModerated},
		{Answer{ErrorCode: ErrCodeModelBusy}, OutcomeModelBusy},
		{Answer{ErrorCode: ErrCodeAborted}, OutcomeAborted},
		{Answer{ErrorCode: ErrCodeModelUnavailable}, OutcomeError},
		{Answer{ErrorCode: ErrCodeIncompleteAnswer, Refused: true}, OutcomeError},
	}
	for _, tc := range cases {
		if got := chatOutcome(&tc.ans); got != tc.want {
			t.Errorf("chatOutcome(%+v) = %s, want %s", tc.ans, got, tc.want)
		}
	}
}
