package ingest

import "github.com/google/uuid"

// Blob key layout for a source's files. Team sources live under
// teams/{team}/sources/{src}/; platform-shared sources (no team) under
// platform/sources/{src}/. Each stored version of a document is
// …/docs/{doc}/{uploadId}/original, with parsed.md next to it.

// SourcePrefix returns the key prefix of a source's files.
func SourcePrefix(team uuid.NullUUID, src uuid.UUID) string {
	if !team.Valid {
		return "platform/sources/" + src.String() + "/"
	}
	return "teams/" + team.UUID.String() + "/sources/" + src.String() + "/"
}

// DocumentPrefix returns the key prefix of a document's files.
func DocumentPrefix(team uuid.NullUUID, src, doc uuid.UUID) string {
	return SourcePrefix(team, src) + "docs/" + doc.String() + "/"
}

// NewOriginalKey returns the key for a newly stored version of a document.
func NewOriginalKey(team uuid.NullUUID, src, doc uuid.UUID) string {
	return DocumentPrefix(team, src, doc) + uuid.NewString() + "/original"
}
