-- A decided team request keeps the classification the reviewer approved (#140). The reviewer may change what was asked for, and the
-- requester's page showed the requested level, not the one their team got.
--
-- Expand only (ADR-0013), and metadata-only (#195): a column with a constant default, so the previous release's code, which never writes
-- it, keeps working, and no row is rewritten or updated. The migration holds its ACCESS EXCLUSIVE lock on team_requests for the length of
-- the catalog change, not of a scan of the table and the audit log, as an UPDATE of existing rows in the same transaction would.
--
-- There is no backfill, not here and not in a later migration (that would only move the same long lock). '' means "the level is not
-- recorded": a request approved before this release, or by a previous release's pod running next to this one. The service resolves it when
-- it reads the request, from what the approval recorded in the audit log (an indexed lookup: target_type 'team_request', the request's
-- id, newest first), else the team's level now, else the level asked for (teamrequests, queries/team_requests.sql). Current code writes the
-- approved level itself, so the lookup is only for those older rows, and a row never needs repair.

-- +goose Up
ALTER TABLE team_requests ADD COLUMN approved_classification text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE team_requests DROP COLUMN approved_classification;
