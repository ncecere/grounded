-- Agent templates (v0.6.0, C4): starting points for a new agent. The built-in templates are in the code (so they follow the release);
-- these rows are the ones a platform admin saved from an agent, shared with every team.
--
-- config is how the agent answers (agents.TemplateConfig): never the knowledge bases, the tools or the audience of the agent it came from.
-- There is no link back to that agent or its team: a template is the platform's, and an agent's deletion must not touch it.

-- +goose Up
CREATE TABLE agent_templates (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    description       text        NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    accent_color      text        NOT NULL DEFAULT '' CHECK (accent_color = '' OR accent_color ~ '^#[0-9a-f]{6}$'),
    welcome_message   text        NOT NULL DEFAULT '' CHECK (length(welcome_message) <= 1000),
    starter_questions text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(starter_questions) <= 6),
    config            jsonb       NOT NULL,
    created_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Names are unique ignoring case, so the picker never shows two that look the same.
CREATE UNIQUE INDEX agent_templates_name_key ON agent_templates (lower(name));

-- +goose Down
DROP TABLE agent_templates;
