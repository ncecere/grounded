-- A decided team request keeps the classification the reviewer approved (#140). The reviewer may change what was asked for, and the
-- requester's page showed the requested level, not the one their team got.
--
-- Expand only (ADR-0013): a column with a default, so the previous release's code, which never writes it, keeps working; the new code treats
-- '' as "the requested level was approved". Approved requests that exist are filled from what the approval recorded in the audit log, else
-- from the team's level now, else the requested level.

-- +goose Up
ALTER TABLE team_requests ADD COLUMN approved_classification text NOT NULL DEFAULT '';

UPDATE team_requests r
SET approved_classification = COALESCE(
    (SELECT a.after_state->>'classification' FROM audit_log a
      WHERE a.action = 'team_request.approve' AND a.target_id = r.id::text AND a.after_state->>'classification' IS NOT NULL
      ORDER BY a.id DESC LIMIT 1),
    (SELECT t.max_classification FROM teams t WHERE t.id = r.team_id),
    r.classification)
WHERE r.status = 'approved';

-- +goose Down
ALTER TABLE team_requests DROP COLUMN approved_classification;
