package boilerplate

// Grouping a source's near-duplicate blocks into clusters, in bounded memory
// and time (DESIGN.md §5.5, #23). The input is a stream of documents, each
// with its eligible blocks and their sketches; it is read three times:
//
//  1. a count-min sketch of the band keys of every block counts, per key, how
//     many blocks carry it (an over-estimate, never an under-estimate);
//  2. the blocks with a band key that is frequent enough to belong to a
//     cluster of Threshold documents are kept as candidates;
//  3. the clusters of the candidates are counted by the documents that
//     contain any of their blocks.
//
// A cluster of T documents has a band key in at least T/Bands of them: every
// block of the cluster agrees with the cluster's first block on a whole band
// (that is how it was found), and the first block has Bands bands. So no
// cluster that reaches T documents is lost by the first pass.
//
// The result is a function of the set of blocks and documents: not of the
// order they are streamed in, nor of timing.

import (
	"cmp"
	"slices"
)

// FuzzyBlock is one eligible block of a document.
type FuzzyBlock struct {
	Hash   int64
	Sketch Sketch
}

// FuzzyDoc is one document's eligible blocks (distinct hashes). Ref is the
// caller's reference, returned for a cluster's canonical document.
type FuzzyDoc struct {
	Ref    int
	Blocks []FuzzyBlock
}

// DocStream calls yield for each document, in the order that decides which
// document keeps a cluster's copy (the caller sorts by shortest URL), and
// stops when yield returns false. It may be called more than once.
type DocStream func(yield func(FuzzyDoc) bool) error

// Limits bound the work of Clusters.
type Limits struct {
	// Candidates is the most candidate blocks that are compared.
	Candidates int
	// Comparisons is the most sketch comparisons made.
	Comparisons int
	// CountMinBits is the size of each of the count-min sketch's rows: 1<<bits
	// counters.
	CountMinBits uint
}

// DefaultLimits: at most 4 x 2^21 x 4 bytes = 32 MB of counters, 100,000
// candidates (a few tens of MB with their sketches and buckets) and 20
// million comparisons (a second or two).
var DefaultLimits = Limits{Candidates: 100_000, Comparisons: 20_000_000, CountMinBits: 21}

// Cluster is a group of near-duplicate blocks that is boilerplate.
type Cluster struct {
	Center  int64   // the block that started it: the most frequent, then the lowest hash
	Members []int64 // every block of it, the center included, by hash
	Docs    int     // documents that contain any member
	First   int     // Ref of the first document in the stream that does
}

// Clusters finds the clusters of at least two blocks that are in at least
// threshold documents. exceeded reports that a limit was hit: then nothing
// is returned and the caller classifies by exact hashes only, as it would
// without near-duplicate matching.
func Clusters(stream DocStream, threshold int, lim Limits) (clusters []Cluster, exceeded bool, err error) {
	cm := newCountMin(lim.CountMinBits)
	if err := stream(func(d FuzzyDoc) bool {
		for _, b := range d.Blocks {
			for j := range Bands {
				cm.add(b.Sketch.Band(j))
			}
		}
		return true
	}); err != nil {
		return nil, false, err
	}
	cands, exceeded, err := candidates(stream, cm, uint32((threshold+Bands-1)/Bands), lim.Candidates)
	if err != nil || exceeded || len(cands) < 2 {
		return nil, exceeded, err
	}
	groups, exceeded := group(cands, lim.Comparisons)
	if exceeded || len(groups) == 0 {
		return nil, exceeded, nil
	}
	clusters, err = count(stream, groups, threshold)
	return clusters, false, err
}

type candidate struct {
	hash   int64
	sketch Sketch
	docs   int // documents that contain exactly this block
}

// candidates collects the blocks with a band key in at least need blocks,
// by decreasing document count, then hash.
func candidates(stream DocStream, cm *countMin, need uint32, limit int) ([]candidate, bool, error) {
	seen := map[int64]int{}
	var list []candidate
	exceeded := false
	err := stream(func(d FuzzyDoc) bool {
		for _, b := range d.Blocks {
			if i, ok := seen[b.Hash]; ok {
				list[i].docs++
				continue
			}
			hot := false
			for j := 0; j < Bands && !hot; j++ {
				hot = cm.estimate(b.Sketch.Band(j)) >= need
			}
			if !hot {
				continue
			}
			if len(list) >= limit {
				exceeded = true
				return false
			}
			seen[b.Hash] = len(list)
			list = append(list, candidate{hash: b.Hash, sketch: b.Sketch, docs: 1})
		}
		return true
	})
	slices.SortFunc(list, func(a, b candidate) int {
		return cmp.Or(cmp.Compare(b.docs, a.docs), cmp.Compare(a.hash, b.hash))
	})
	return list, exceeded, err
}

// group clusters the candidates (sorted): each block not yet in a cluster
// starts one with the later blocks whose sketch is similar to its own. Only
// clusters of two or more blocks are returned.
func group(cands []candidate, maxComparisons int) ([]Cluster, bool) {
	buckets := map[uint64][]int32{}
	for i, c := range cands {
		for j := range Bands {
			k := c.sketch.Band(j)
			buckets[k] = append(buckets[k], int32(i))
		}
	}
	taken := make([]bool, len(cands))
	var out []Cluster
	comparisons := 0
	for i, c := range cands {
		if taken[i] {
			continue
		}
		taken[i] = true
		members := []int64{c.hash}
		for j := range Bands {
			k := c.sketch.Band(j)
			kept := buckets[k][:0]
			for _, n := range buckets[k] {
				if taken[n] {
					continue
				}
				if comparisons++; comparisons > maxComparisons {
					return nil, true
				}
				if Similar(c.sketch, cands[n].sketch) {
					taken[n] = true
					members = append(members, cands[n].hash)
					continue
				}
				kept = append(kept, n)
			}
			buckets[k] = kept
		}
		if len(members) > 1 {
			slices.Sort(members)
			out = append(out, Cluster{Center: c.hash, Members: members})
		}
	}
	return out, false
}

// count fills in the documents of each cluster (those that contain any of
// its blocks, and the first of them in the stream) and keeps the clusters
// that reach threshold.
func count(stream DocStream, clusters []Cluster, threshold int) ([]Cluster, error) {
	of := map[int64]int{}
	for i, c := range clusters {
		for _, h := range c.Members {
			of[h] = i
		}
	}
	last := make([]int, len(clusters)) // the stream position of the last document counted
	pos := 0
	err := stream(func(d FuzzyDoc) bool {
		pos++
		for _, b := range d.Blocks {
			i, ok := of[b.Hash]
			if !ok || last[i] == pos {
				continue
			}
			last[i] = pos
			if clusters[i].Docs == 0 {
				clusters[i].First = d.Ref
			}
			clusters[i].Docs++
		}
		return true
	})
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(clusters, func(c Cluster) bool { return c.Docs < threshold }), nil
}

// countMin is a count-min sketch: estimate never returns less than the
// number of add calls for the key.
type countMin struct {
	rows [4][]uint32
	bits uint
}

func newCountMin(bits uint) *countMin {
	c := &countMin{bits: bits}
	for i := range c.rows {
		c.rows[i] = make([]uint32, 1<<bits)
	}
	return c
}

func (c *countMin) slot(row int, key uint64) uint64 {
	return mix(key+uint64(row)*0x9e3779b97f4a7c15) >> (64 - c.bits)
}

func (c *countMin) add(key uint64) {
	for i := range c.rows {
		c.rows[i][c.slot(i, key)]++
	}
}

func (c *countMin) estimate(key uint64) uint32 {
	est := ^uint32(0)
	for i := range c.rows {
		est = min(est, c.rows[i][c.slot(i, key)])
	}
	return est
}
