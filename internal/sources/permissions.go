package sources

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/access"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Document permissions (B6, #41; docs/specs/document-acls/DESIGN.md): editors and admins manage a restricted document by
// its name, status and permissions; its text is read with their own permissions, like anyone's. A break-glass read is not
// limited by them (it is audited, and exists for this).

// errRestrictedText refuses the text of a restricted document to a reader outside its permissions; the document's name,
// status and permissions stay visible to the source's editors.
var errRestrictedText = apperr.New(http.StatusForbidden, "document_restricted",
	"This document is restricted: only the people and groups it is restricted to can read its text")

// CallerFor is whose document permissions the actor reads with (Anyone when permissions are not wired).
func (s *Service) CallerFor(ctx context.Context, a authz.Actor) (access.Caller, error) {
	if s.Access == nil {
		return access.Anyone(), nil
	}
	return s.Access.For(ctx, a)
}

// viewerParams is the viewer gate's query for a read in scope sc.
func (s *Service) viewerParams(ctx context.Context, a authz.Actor, sc scope, docID uuid.UUID) (dbgen.GetViewerDocumentParams, error) {
	if sc.breakGlass {
		return dbgen.GetViewerDocumentParams{ID: docID, EveryDocument: true, Principals: []string{}}, nil
	}
	caller, err := s.CallerFor(ctx, a)
	if err != nil {
		return dbgen.GetViewerDocumentParams{}, err
	}
	return ViewerDocument(docID, caller), nil
}

// ViewerDocument is the viewer gate's query for a caller.
func ViewerDocument(docID uuid.UUID, caller access.Caller) dbgen.GetViewerDocumentParams {
	return dbgen.GetViewerDocumentParams{ID: docID, Principals: caller.Principals()}
}

// DocumentPassages returns a document's first passages (chunks) in order,
// with the document for the total count. Readers of the source may see them.
func (s *Service) DocumentPassages(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID, limit int32) (dbgen.Document, []dbgen.ListDocumentChunksRow, error) {
	sc, err := s.readAccess(ctx, a, o, breakglass.Read{Kind: breakglass.ReadPassages, TargetType: "document", TargetID: docID.String()})
	if err != nil {
		return dbgen.Document{}, nil, err
	}
	_, _, doc, err := s.lookupDocument(ctx, sc, sourceID, docID)
	if err != nil {
		return doc, nil, err
	}
	view, err := s.viewerParams(ctx, a, sc, docID)
	if err != nil {
		return doc, nil, err
	}
	if !view.EveryDocument && doc.AclPrincipals != nil {
		if caller, err := s.CallerFor(ctx, a); err != nil {
			return doc, nil, err
		} else if !caller.Allows(doc.AclPrincipals) {
			return doc, nil, errRestrictedText
		}
	}
	rows, err := s.q.ListDocumentChunks(ctx, dbgen.ListDocumentChunksParams{DocumentID: docID, PageSize: limit,
		EveryDocument: view.EveryDocument, Principals: view.Principals})
	return doc, rows, err
}
