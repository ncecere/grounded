-- Agent templates (v0.6.0, C4): the ones a platform admin saved. The built-in ones are in internal/agents.

-- name: ListAgentTemplates :many
SELECT * FROM agent_templates ORDER BY lower(name);

-- name: GetAgentTemplate :one
SELECT * FROM agent_templates WHERE id = $1;

-- Template names are unique ignoring case for every script (#140, #195). v0.6.3 enforces that here, in the application, and not with a
-- unique index yet (ADR-0013: a tighter constraint ships one release after the code that writes valid data), so every writer of a name takes
-- this lock first, in its transaction and BEFORE it reads whether the name is free: two writers cannot both see it free.
-- name: LockAgentTemplateNames :exec
SELECT pg_advisory_xact_lock(hashtextextended('grounded.agent_template_names', 0));

-- Whether another template (not except_id; uuid.Nil for a new one) has this name once case is folded by the ICU root collation, which does
-- not depend on the cluster's locale. Uses agent_templates_name_fold_idx (migration 00054).
-- name: AgentTemplateNameTaken :one
SELECT EXISTS (SELECT 1 FROM agent_templates
               WHERE lower(name COLLATE "und-x-icu") = lower(sqlc.arg(name)::text COLLATE "und-x-icu") AND id <> sqlc.arg(except_id)::uuid);

-- name: InsertAgentTemplate :one
INSERT INTO agent_templates (name, description, accent_color, welcome_message, starter_questions, config, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdateAgentTemplate :one
UPDATE agent_templates SET name = $2, description = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteAgentTemplate :one
DELETE FROM agent_templates WHERE id = $1 RETURNING *;

-- Whether a user may create agents at all (an editor, admin or owner of some team): who may see the templates.
-- name: UserCanCreateAgents :one
SELECT EXISTS (SELECT 1 FROM team_members m JOIN teams t ON t.id = m.team_id
               WHERE m.user_id = $1 AND m.role IN ('editor', 'admin', 'owner') AND t.status = 'active');
