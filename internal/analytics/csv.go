package analytics

import (
	"encoding/csv"
	"io"
	"strconv"
	"time"
)

// DailyCSVHeader is the header row of the daily CSV export.
var DailyCSVHeader = []string{"date", "answers", "conversations", "no_context", "refused", "moderation_blocked", "moderation_flagged"}

// WriteDailyCSV writes the daily table as CSV (RFC 4180, one row per UTC
// day). The columns are counts only, so no cell can carry content or
// identities, and none starts with a formula character.
func WriteDailyCSV(w io.Writer, days []Day) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(DailyCSVHeader); err != nil {
		return err
	}
	n := func(v int64) string { return strconv.FormatInt(v, 10) }
	for _, d := range days {
		if err := cw.Write([]string{d.Date.Format(time.DateOnly), n(d.Answers), n(d.Conversations), n(d.NoContext),
			n(d.Refused), n(d.Blocked), n(d.Flagged)}); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}
