-- Agent templates (v0.6.0, C4): the ones a platform admin saved. The built-in ones are in internal/agents.

-- name: ListAgentTemplates :many
SELECT * FROM agent_templates ORDER BY lower(name);

-- name: GetAgentTemplate :one
SELECT * FROM agent_templates WHERE id = $1;

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
