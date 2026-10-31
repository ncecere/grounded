# Private contextual prompt construction v2 (#21)

This narrowly scoped implementation note supplements contextual-chunks.md §7
and Proposed ADR-0028. Neither the feature nor that ADR is accepted by this note.
The private `PromptVersion` is now **2**; the fixed system instruction/recognition
marker is unchanged. Old private snapshots are unsupported and old cache keys
cannot be reused. No published profile migration is implied.

## Metadata planning and derived input fitting

Estimates still read passage token counts and heading paths, not source text.
Unit grouping and all operational limits are unchanged. `CallInputMax` remains
the per-unit metadata ceiling, with the same 25% local counting margin;
its fixed overhead now explicitly includes the same 16 chat-framing tokens
that actual admission already reserved. There is no guessed delimiter inflation
and no price invention.

Before computing keys or retaining a profile's current artifact plan, generation
builds the usual bounded derived fields, then counts the **complete escaped**
messages plus framing. If they exceed the unit's un-margined metadata ceiling,
it halves the longest derived field in bytes (stable ties: section, opening,
path, title), on a rune boundary, with a visible cut marker. Small remnants are
removed. Each candidate, including joins, cut markers and delimiter escaping,
is recounted; no assumption about token additivity or monotonicity is needed.
Fields of an already-fitting prompt are byte-for-byte unchanged.

The empty prompt is below the metadata ceiling (which includes the empty frame,
title/path allowances and slack). Each cut strictly reduces a field's byte
length; the count of candidates is logarithmic in the four already bounded
derived lengths; total temporary memory is linear in those lengths. Fitting does not fetch any source
text or call a model. Existing bounded source reads, unit limits and cancellation
checkpoints remain in place.

Consequently every planned actual local reservation, including the same margin,
is at most its advertised per-unit ceiling; summing bounds the document plan.
Configured-price estimates use those local quantities, not external tokenization
or invoice guarantees. Retries remain paid attempts, not free work.

Only the generation inputs change. Original chunks, citation heading paths,
full text, viewer content and parent hashes remain unchanged. Keys hash the
fitted fields and construction version, so identical current plans may still
share artifacts; per-profile retention and once-only settlement are unchanged.
Adversarial/escape-heavy inputs can lose more descriptive material. This is a
deliberate planning bound, not a retrieval-quality claim.

Capacity is still independently checked before admission and after waits.
Tests retain a raw escaped above-activation-floor direct-call rejection, plus
the fitted prompt's exact-fit/one-token-below and post-admission-wait revocation
boundaries. The metadata regression is supplemented by actual fake-wire and
reservation checks, Unicode/short joins/multiple passages/large-field cases and
a bounded fuzz property. Final integration/CI and owner acceptance remain separate.
