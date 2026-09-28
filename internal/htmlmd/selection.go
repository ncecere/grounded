package htmlmd

import (
	"unicode"

	"github.com/PuerkitoBio/goquery"
	xhtml "golang.org/x/net/html"
)

// pruneMainNoise removes site chrome before main-content scoring.
func pruneMainNoise(root *goquery.Selection) {
	root.Find("nav, [role='navigation'], .cookie-banner, .cookie-consent, .advertisement, .sidebar, .social-share, [role='complementary']").Remove()
	root.Find("header, footer, aside, [role='banner'], [role='contentinfo']").Each(func(_ int, s *goquery.Selection) {
		// Article bylines, timestamps and local notes are content, unlike a site
		// banner/footer. Explicit noise classes above still win inside an article.
		localGroup := s.Parent().Is("section, div") && s.Parent().ChildrenFiltered("article").Length() > 1
		if s.ParentsFiltered("article, main, [role='main']").Length() == 0 && !localGroup {
			s.Remove()
		}
	})
}

type contentScore struct{ text, links, prose int }

// scoreContent performs one postorder traversal instead of repeatedly
// materialising candidate text, and scores Unicode characters rather than
// UTF-8 bytes. Whitespace is not evidence.
func scoreContent(nodes []*xhtml.Node) map[*xhtml.Node]contentScore {
	scores := map[*xhtml.Node]contentScore{}
	var walk func(*xhtml.Node) contentScore
	walk = func(n *xhtml.Node) contentScore {
		s := contentScore{}
		if n.Type == xhtml.TextNode {
			for _, r := range n.Data {
				if !unicode.IsSpace(r) {
					s.text++
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			v := walk(c)
			s.text += v.text
			s.links += v.links
			s.prose += v.prose
		}
		if n.Type == xhtml.ElementNode {
			if n.Data == "a" {
				s.links = s.text
			}
			switch n.Data {
			case "p", "pre", "table":
				s.prose = s.text
			}
			scores[n] = s
		}
		return s
	}
	for _, n := range nodes {
		walk(n)
	}
	return scores
}

// selectMain prunes boilerplate and chooses the main content region: the
// outermost nonempty <main>, else the best top-level <article> (expanded to
// its parent when siblings form a thread or listing), else a prose-heavy
// div/section, else the pruned body.
func selectMain(root *goquery.Selection) *goquery.Selection {
	pruneMainNoise(root)
	scores := scoreContent(root.Nodes)
	choose := func(candidates *goquery.Selection, heuristic bool) *goquery.Selection {
		bestScore := -int(^uint(0) >> 1)
		var best *goquery.Selection
		candidates.Each(func(_ int, s *goquery.Selection) {
			v := scores[s.Nodes[0]]
			if v.text == 0 {
				return
			}
			score := v.text - 2*v.links
			if heuristic {
				if v.text < 200 || v.prose < 120 {
					return
				}
				score += v.prose
				if score < 80 {
					return
				}
			}
			if score > bestScore {
				best = s
				bestScore = score
			}
		})
		return best
	}
	// A containing main is stronger context than a single nested article, even
	// for short, link-heavy catalogs and non-Latin pages.
	mains := root.Find("main, [role='main']").FilterFunction(func(_ int, s *goquery.Selection) bool {
		return s.ParentsFiltered("main, [role='main']").Length() == 0
	})
	if best := choose(mains, false); best != nil {
		return best
	}
	articles := root.Find("article").FilterFunction(func(_ int, s *goquery.Selection) bool {
		return s.ParentsFiltered("article").Length() == 0
	})
	candidates := articles
	articles.Each(func(_ int, s *goquery.Selection) {
		if s.Parent().ChildrenFiltered("article").Length() > 1 {
			// Preserve the local thread/list heading and sibling posts as one
			// semantic unit. Do not expand an isolated winner to the whole document.
			candidates = candidates.AddSelection(s.Parent())
		}
	})
	if best := choose(candidates, false); best != nil {
		if parent := best.Parent(); best.Is("article") && parent.ChildrenFiltered("article").Length() > 1 {
			best = parent
		}
		return best
	}
	if best := choose(root.Find("div, section"), true); best != nil {
		return best
	}
	return root
}
