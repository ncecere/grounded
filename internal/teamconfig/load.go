package teamconfig

import (
	"context"
	"strings"

	"github.com/google/uuid"
)

// foldKey is how a kind's identity compares: names and slugs case-insensitively, as the unique indexes compare them;
// webhook URLs exactly.
func foldKey(kind, key string) string {
	if kind == KindWebhook {
		return key
	}
	return strings.ToLower(key)
}

func (l *loader) loadSources(ctx context.Context, d *Document) error {
	srcs, err := l.q.ExportConfigurationSources(ctx, uuid.NullUUID{UUID: l.team, Valid: true})
	if err != nil {
		return err
	}
	if len(srcs) > MaxResources {
		return errUnsupported
	}
	delegated := l.actor.Delegated()
	for _, s := range srcs {
		var reason string
		switch {
		case s.Contextual:
			reason = "it has contextual chunks switched on, which files do not carry yet"
		case s.Rank > s.CeilingRank:
			reason = "its classification is above what the team is approved for"
		case delegated && !s.DirectRetrieve:
			reason = "its classification does not allow access through API keys"
		}
		out := Source{Name: s.Name, Description: s.Description, Type: s.Type, Classification: s.Classification, EmbeddingProfile: s.Profile, Status: s.Status, OCREnabled: s.OcrEnabled}
		if reason == "" && strictJSON(s.Boilerplate, &out.Boilerplate) != nil {
			reason = "its repeated-block settings cannot be read"
		}
		if reason == "" {
			reason = webSettings(s.Type, s.Config, &out)
		}
		if reason != "" {
			if err := l.refuse(KindSource, s.Name, reason); err != nil {
				return err
			}
			continue
		}
		d.Sources = append(d.Sources, out)
	}
	return nil
}

// webSettings fills a web source's crawl rules (lists never null) and says why a source's settings cannot be carried.
func webSettings(typ string, raw []byte, out *Source) string {
	if typ != "web" {
		if string(raw) != "{}" {
			return "it has settings files do not carry"
		}
		return ""
	}
	out.Web = newWebConfig()
	if strictJSON(raw, out.Web) != nil {
		return "its crawl settings cannot be read"
	}
	for _, list := range []*[]string{&out.Web.URLs, &out.Web.IncludePrefixes, &out.Web.Exclude, &out.Web.Tags} {
		if *list == nil {
			*list = []string{}
		}
	}
	return ""
}

func (l *loader) loadSourcesKBs(ctx context.Context, d *Document) (map[uuid.UUID]string, error) {
	if err := l.loadSources(ctx, d); err != nil {
		return nil, err
	}
	rows, err := l.q.ExportConfigurationKBs(ctx, l.team)
	if err != nil {
		return nil, err
	}
	if len(rows)+len(d.Sources) > MaxResources {
		return nil, errUnsupported
	}
	names := map[uuid.UUID]string{}
	index := map[string]int{}
	for _, k := range rows {
		names[k.ID] = k.Name
		index[k.Name] = len(d.KnowledgeBases)
		d.KnowledgeBases = append(d.KnowledgeBases, KnowledgeBase{Name: k.Name, Description: k.Description, EmbeddingProfile: k.Profile, TopK: k.TopK, VectorWeight: number(k.VectorWeight), KeywordWeight: number(k.KeywordWeight), Sources: []SourceRef{}})
	}
	links, err := l.q.ExportConfigurationLinks(ctx, l.team)
	if err != nil {
		return nil, err
	}
	if len(links) > MaxSequenceItems {
		return nil, errUnsupported
	}
	broken := map[string]bool{}
	for _, link := range links {
		if link.ForeignTeam || link.Rank > link.CeilingRank || (l.actor.Delegated() && !link.DirectRetrieve) {
			if err := l.refuse(KindKnowledgeBase, link.Kb, "it searches a source a file cannot name or the caller cannot reach"); err != nil {
				return nil, err
			}
			broken[link.Kb] = true
			continue
		}
		ns := "team"
		if link.Shared {
			ns = "platform"
		}
		i := index[link.Kb]
		d.KnowledgeBases[i].Sources = append(d.KnowledgeBases[i].Sources, SourceRef{Namespace: ns, Name: link.Name})
	}
	if len(broken) > 0 {
		kept := d.KnowledgeBases[:0]
		for _, k := range d.KnowledgeBases {
			if !broken[k.Name] {
				kept = append(kept, k)
			}
		}
		d.KnowledgeBases = kept
	}
	return names, nil
}
