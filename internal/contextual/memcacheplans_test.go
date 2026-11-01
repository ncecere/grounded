package contextual

import (
	"context"

	"github.com/google/uuid"
)

type memPlanKey struct{ document, profile uuid.UUID }

func (m *memStore) RetainCachePlan(_ context.Context, p CachePlan) error {
	if err := validateCachePlan(p); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.versions[p.DocumentID] > p.Version {
		return cachePlanStopped()
	}
	m.versions[p.DocumentID] = p.Version
	for key, old := range m.plans {
		if key.document == p.DocumentID && old.Version != p.Version {
			delete(m.plans, key)
		}
	}
	p.Keys = append([][32]byte(nil), p.Keys...)
	m.plans[memPlanKey{p.DocumentID, p.ProfileID}] = p
	m.prunePlansLocked(p.DocumentID)
	return nil
}

func (m *memStore) prunePlansLocked(document uuid.UUID) {
	keep := map[[32]byte]bool{}
	for key, plan := range m.plans {
		if key.document == document && plan.Version == m.versions[document] {
			for _, key := range plan.Keys {
				keep[key] = true
			}
		}
	}
	for key := range m.cache {
		if key.document == document && !keep[key.key] {
			delete(m.cache, key)
		}
	}
}

func (m *memStore) cachePlanAllowsLocked(e CacheEntry) bool {
	p, ok := m.plans[memPlanKey{e.DocumentID, e.ProfileID}]
	if !ok || p.SourceID != e.SourceID || p.Version != e.Version || m.versions[e.DocumentID] != e.Version {
		return false
	}
	for _, key := range p.Keys {
		if key == e.Key {
			return true
		}
	}
	return false
}
