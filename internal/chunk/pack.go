package chunk

import (
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
)

// unit is a span of one block placed in a chunk.
type unit struct {
	b          *block
	start, end int
	tokens     int
	overlap    bool // repeated from the previous chunk
}

func (u unit) sticky() bool { return u.b.kind == kindHeading }

// leadTok is the cost of the block's lead if a chunk starts with u.
func (u unit) leadTok() int {
	if u.start > 0 {
		return u.b.leadTok
	}
	return 0
}

// trailTok is the cost of the block's trail if a chunk ends with u.
func (u unit) trailTok() int {
	if u.end < len(u.b.text) {
		return u.b.trailTok
	}
	return 0
}

// splitter holds the options and the chunk being packed.
type splitter struct {
	max, overlap int
	counter      TokenCounter
	parallel     bool // counter is known to be safe for concurrent use
	sepTok       int  // estimated cost of the "\n\n" between blocks

	cur    []unit
	base   int // estimated tokens of cur, excluding the last unit's trail
	body   int // units in cur that are neither headings nor overlap
	drafts [][]unit
}

func newSplitter(opts Options) *splitter {
	_, builtin := opts.Counter.(*cl100kCounter)
	sp := &splitter{max: opts.MaxTokens, overlap: opts.OverlapTokens, counter: opts.Counter, parallel: builtin}
	sp.sepTok = sp.count("\n\n")
	return sp
}

func (sp *splitter) count(s string) int { return sp.counter.Count(s) }

// prepare counts every block once (in parallel for the built-in counter).
func (sp *splitter) prepare(blocks []*block) {
	forEach(len(blocks), sp.parallel, func(i int) {
		b := blocks[i]
		b.tokens = sp.count(b.text)
		if b.lead != "" {
			b.leadTok = sp.count(b.lead)
		}
		if b.trail != "" {
			b.trailTok = sp.count(b.trail)
		}
		// Repeating a header/fence that eats most of the budget is worse
		// than not repeating it.
		if 2*(b.leadTok+b.trailTok) > sp.max {
			b.lead, b.trail, b.leadTok, b.trailTok = "", "", 0, 0
		}
	})
}

// pack groups blocks into draft chunks.
func (sp *splitter) pack(blocks []*block) [][]unit {
	for _, b := range blocks {
		if b.brk {
			sp.sectionBreak()
		}
		whole := unit{b: b, end: len(b.text), tokens: b.tokens}
		switch {
		case sp.cost(whole) <= sp.max:
			sp.push(whole)
		case b.tokens <= sp.max && sp.body > 0:
			sp.add(whole) // keep the block intact in a new chunk
		default:
			for _, pc := range sp.refine(b, span{0, len(b.text)}, 0, sp.max-b.leadTok-b.trailTok, nil) {
				sp.add(unit{b: b, start: pc.start, end: pc.end, tokens: pc.tokens})
			}
		}
	}
	if len(sp.cur) > 0 {
		sp.emit()
	}
	return sp.drafts
}

// cost estimates the tokens of cur with u appended.
func (sp *splitter) cost(u unit) int {
	c := u.tokens + u.trailTok()
	if len(sp.cur) == 0 {
		return c + u.leadTok()
	}
	c += sp.base
	if last := sp.cur[len(sp.cur)-1]; last.b != u.b {
		c += last.trailTok() + sp.sepTok + u.leadTok()
	}
	return c
}

func (sp *splitter) push(u unit) {
	sp.base = sp.cost(u) - u.trailTok()
	sp.cur = append(sp.cur, u)
	if !u.overlap && !u.sticky() {
		sp.body++
	}
}

func (sp *splitter) emit() {
	sp.drafts = append(sp.drafts, sp.cur)
	sp.cur, sp.base, sp.body = nil, 0, 0
}

// sectionBreak ends the chunk before a level 1-3 heading. Headings with no
// body yet stay and carry into the new section's chunk.
func (sp *splitter) sectionBreak() {
	if sp.body > 0 {
		sp.emit()
	}
}

// add appends u, closing chunks and splitting u as needed.
func (sp *splitter) add(u unit) {
	for {
		if sp.cost(u) <= sp.max {
			sp.push(u)
			return
		}
		switch {
		case sp.body > 0:
			sp.closeFor(u)
		case len(sp.cur) > 0 && sp.cur[0].overlap:
			sp.cur, sp.base = nil, 0 // overlap is optional; drop it
		case len(sp.cur) > 0 && u.sticky():
			sp.emit() // consecutive headings with no body in between
		default:
			if sp.splitInto(u) {
				return
			}
			sp.emit() // the headings in cur leave no room for any body
		}
	}
}

// closeFor ends the current chunk because next does not fit. Trailing
// headings move to the next chunk; otherwise the next chunk starts with
// overlap unless next is a heading.
func (sp *splitter) closeFor(next unit) {
	k := len(sp.cur)
	for k > 0 && sp.cur[k-1].sticky() {
		k--
	}
	done, carry := sp.cur[:k:k], sp.cur[k:]
	sp.drafts = append(sp.drafts, done)
	sp.cur, sp.base, sp.body = nil, 0, 0
	for _, u := range carry {
		sp.push(u)
	}
	if len(carry) == 0 && sp.overlap > 0 && !next.sticky() {
		// Shrink the overlap so next still fits after it where possible.
		budget := min(sp.overlap, sp.max-sp.cost(next)-sp.sepTok)
		for _, u := range sp.overlapFrom(done, budget) {
			sp.push(u)
		}
	}
}

// splitInto places as much of u as fits in the room left in cur (which holds
// only headings, or nothing). It reports false when nothing fits and cur is
// not empty.
func (sp *splitter) splitInto(u unit) bool {
	room := sp.max - (sp.cost(u) - u.tokens - u.trailTok()) - u.b.trailTok
	if room < 1 {
		if len(sp.cur) > 0 {
			return false
		}
		room = 1
	}
	pieces := sp.refine(u.b, span{u.start, u.end}, 0, room, nil)
	if len(pieces) == 0 {
		return true
	}
	mk := func(pc piece) unit { return unit{b: u.b, start: pc.start, end: pc.end, tokens: pc.tokens} }
	i := 0
	for ; i < len(pieces) && sp.cost(mk(pieces[i])) <= sp.max; i++ {
		sp.push(mk(pieces[i]))
	}
	if i == 0 {
		if len(sp.cur) > 0 {
			return false
		}
		sp.push(mk(pieces[0])) // indivisible: a single rune over the limit
		i = 1
	}
	for _, pc := range pieces[i:] {
		sp.add(mk(pc))
	}
	return true
}

// overlapFrom returns up to budget tokens of the trailing sentences or lines
// of units, stopping at a heading.
func (sp *splitter) overlapFrom(units []unit, budget int) []unit {
	var rev []unit
	used := 0
	for i := len(units) - 1; i >= 0 && budget > 0; i-- {
		u := units[i]
		segs := overlapSegments(u.b, span{u.start, u.end})
		if len(segs) == 0 {
			break
		}
		first, tok := len(segs), 0
		for j := len(segs) - 1; j >= 0; j-- {
			n := sp.count(u.b.text[segs[j].start:segs[j].end])
			if used+n > budget {
				break
			}
			used, tok, first = used+n, tok+n, j
		}
		if first == len(segs) {
			break
		}
		rev = append(rev, unit{b: u.b, start: segs[first].start, end: segs[len(segs)-1].end, tokens: tok, overlap: true})
		if first > 0 {
			break
		}
	}
	for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
		rev[i], rev[j] = rev[j], rev[i]
	}
	return rev
}

// assemble renders units as Markdown.
func assemble(units []unit) string {
	var sb strings.Builder
	for i, u := range units {
		sameAsPrev := i > 0 && units[i-1].b == u.b
		if i > 0 {
			sep := "\n\n"
			if prev := units[i-1]; sameAsPrev && u.start >= prev.end {
				if j := u.b.text[prev.end:u.start]; strings.TrimSpace(j) == "" {
					sep = j
				}
			}
			sb.WriteString(sep)
		}
		if !sameAsPrev && u.start > 0 {
			sb.WriteString(u.b.lead)
		}
		sb.WriteString(u.b.text[u.start:u.end])
		if (i == len(units)-1 || units[i+1].b != u.b) && u.end < len(u.b.text) {
			sb.WriteString(u.b.trail)
		}
	}
	return strings.TrimRight(strings.TrimLeft(sb.String(), "\n"), " \t\n")
}

// finish renders drafts, counts them, and repairs any whose true count
// exceeds the limit (token counts of joined text are not exactly additive).
func (sp *splitter) finish(drafts [][]unit, paginated bool) []Chunk {
	contents := make([]string, len(drafts))
	for i, d := range drafts {
		contents[i] = assemble(d)
	}
	tokens := make([]int, len(drafts))
	forEach(len(drafts), sp.parallel, func(i int) { tokens[i] = sp.count(contents[i]) })
	out := make([]Chunk, 0, len(drafts))
	for i, d := range drafts {
		if tokens[i] <= sp.max {
			out = sp.appendChunk(out, d, contents[i], tokens[i], paginated)
		} else {
			out = sp.repair(out, d, paginated)
		}
	}
	for i := range out {
		out[i].Ordinal = i
	}
	return out
}

func (sp *splitter) appendChunk(out []Chunk, units []unit, content string, tokens int, paginated bool) []Chunk {
	if strings.TrimSpace(content) == "" {
		return out
	}
	c := Chunk{Content: content, HeadingPath: headingPath(units), Tokens: tokens}
	if paginated {
		c.PageStart, c.PageEnd = pageRange(units)
	}
	return append(out, c)
}

// repair splits an over-limit draft: first by dropping overlap, then between
// units, and finally by tokens.
func (sp *splitter) repair(out []Chunk, units []unit, paginated bool) []Chunk {
	content := assemble(units)
	n := sp.count(content)
	if n <= sp.max {
		return sp.appendChunk(out, units, content, n, paginated)
	}
	k := 0
	for k < len(units) && units[k].overlap {
		k++
	}
	if k > 0 && k < len(units) {
		return sp.repair(out, units[k:], paginated)
	}
	mid := len(units) / 2
	for d := 0; d < len(units); d++ {
		for _, j := range [2]int{mid + d, mid - d} {
			if j >= 1 && j < len(units) && !units[j-1].sticky() {
				out = sp.repair(out, units[:j:j], paginated)
				return sp.repair(out, units[j:], paginated)
			}
		}
	}
	path := headingPath(units)
	var ps, pe int
	if paginated {
		ps, pe = pageRange(units)
	}
	for _, pc := range sp.hardSplit(content, span{0, len(content)}, sp.max, nil) {
		out = append(out, Chunk{
			Content:     content[pc.start:pc.end],
			HeadingPath: append(make([]string, 0, len(path)), path...),
			PageStart:   ps,
			PageEnd:     pe,
			Tokens:      pc.tokens,
		})
	}
	return out
}

// headingPath is the path of the first non-heading unit, i.e. the path in
// effect after any headings that open the chunk.
func headingPath(units []unit) []string {
	p := units[len(units)-1].b.path
	for _, u := range units {
		if !u.sticky() {
			p = u.b.path
			break
		}
	}
	return append(make([]string, 0, len(p)), p...)
}

func pageRange(units []unit) (int, int) {
	lo, hi := 0, 0
	for i, u := range units {
		a, b := u.b.pageAt(u.start), u.b.pageAt(max(u.start, u.end-1))
		if a > b {
			a, b = b, a
		}
		if i == 0 || a < lo {
			lo = a
		}
		if i == 0 || b > hi {
			hi = b
		}
	}
	return lo, hi
}

// forEach calls fn for 0..n-1, spread over GOMAXPROCS goroutines when
// parallel is set.
func forEach(n int, parallel bool, fn func(i int)) {
	workers := runtime.GOMAXPROCS(0)
	if !parallel || workers < 2 || n < 2*workers {
		for i := 0; i < n; i++ {
			fn(i)
		}
		return
	}
	var next atomic.Int64
	var wg sync.WaitGroup
	for range workers {
		wg.Go(func() {
			for {
				i := int(next.Add(1) - 1)
				if i >= n {
					return
				}
				fn(i)
			}
		})
	}
	wg.Wait()
}
