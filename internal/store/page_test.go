package store

import "testing"

func TestPage(t *testing.T) {
	for _, tc := range []struct {
		rows      []int
		limit     int32
		kept      int
		wantLast  bool
		lastValue int
	}{
		{nil, 3, 0, false, 0},
		{[]int{1, 2}, 3, 2, false, 0},
		{[]int{1, 2, 3}, 3, 3, false, 0},
		{[]int{1, 2, 3, 4}, 3, 3, true, 3},
		{[]int{1}, 0, 0, false, 0},
	} {
		page, last := Page(tc.rows, tc.limit)
		if len(page) != tc.kept || (last != nil) != tc.wantLast || (last != nil && *last != tc.lastValue) {
			t.Errorf("Page(%v, %d) = %v, %v", tc.rows, tc.limit, page, last)
		}
	}
}
