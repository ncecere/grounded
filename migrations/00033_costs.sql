-- Costs and budgets (docs/costs.md, docs/v0.2.0.md §3.3 E2, DESIGN.md §11.3):
--   * cost_settings: the platform's mode (off, track, enforce), display
--     currency, time zone of the budget month and report days, warning
--     threshold and optional default budget. generation is bumped by every
--     change that can move a team's budget state (settings, prices, budgets,
--     extensions), so every process drops its cached spend at once.
--   * model_prices: dated prices per model and ledger unit. Rows are never
--     edited; a mistaken row may be deleted (audited).
--   * team_budgets: a team's mode override, monthly budget and threshold.
--   * budget_extensions: one-off amounts added to one budget month.
--   * usage_rollup: the usage ledger per UTC hour, kind, team, agent, model
--     and channel, rolled up by a periodic job for closed hours;
--     usage_rollup_state records the first hour not rolled yet (NULL: the
--     first run has not backfilled yet).
--   * budget_notices: the threshold and exhausted notifications sent, once
--     per team, month and level.
--   * web_crawls may wait for the team's monthly budget (monthly_budget).
--
-- New tables, plus a wider waiting_reason check: compatible with the
-- previous release (expand/contract, ADR-0013).

-- +goose Up
CREATE TABLE cost_settings (
    singleton      boolean       PRIMARY KEY DEFAULT true CHECK (singleton),
    mode           text          NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'track', 'enforce')),
    -- An ISO 4217 code, for display only (no conversion).
    currency       text          NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    -- An IANA zone name; validated by the application.
    time_zone      text          NOT NULL DEFAULT 'UTC' CHECK (char_length(time_zone) BETWEEN 1 AND 64),
    warn_percent   integer       NOT NULL DEFAULT 80 CHECK (warn_percent BETWEEN 1 AND 100),
    -- The budget of enforced teams without their own (NULL: none).
    default_budget numeric(20,6) CHECK (default_budget >= 0),
    generation     bigint        NOT NULL DEFAULT 1,
    revision       bigint        NOT NULL DEFAULT 1,
    updated_by     uuid          REFERENCES users (id),
    updated_at     timestamptz   NOT NULL DEFAULT now()
);
INSERT INTO cost_settings DEFAULT VALUES;

-- model_id has no foreign key: a deleted model's usage stays in the ledger,
-- and so do its prices, so past spend doesn't change.
CREATE TABLE model_prices (
    id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id       uuid          NOT NULL,
    -- The usage ledger kind priced. Tokens are priced per million, requests
    -- per request.
    unit           text          NOT NULL CHECK (unit IN ('chat_tokens_in', 'chat_tokens_out', 'embed_tokens',
                                                          'systemone_tokens', 'systemone_requests', 'moderation_requests',
                                                          'vision_tokens_in', 'vision_tokens_out')),
    price          numeric(20,6) NOT NULL CHECK (price >= 0),
    -- The first local day (platform time zone) the price applies to.
    effective_from date          NOT NULL,
    created_by     uuid          REFERENCES users (id),
    created_at     timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT model_prices_key UNIQUE (model_id, unit, effective_from)
);

CREATE TABLE team_budgets (
    team_id      uuid          PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
    mode         text          NOT NULL DEFAULT 'inherit' CHECK (mode IN ('inherit', 'off', 'track', 'enforce')),
    -- NULL: the platform default budget.
    amount       numeric(20,6) CHECK (amount >= 0),
    -- NULL: the platform threshold.
    warn_percent integer       CHECK (warn_percent BETWEEN 1 AND 100),
    revision     bigint        NOT NULL DEFAULT 1,
    updated_by   uuid          REFERENCES users (id),
    updated_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE budget_extensions (
    id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    uuid          NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    -- The first day of the budget month it applies to (platform time zone).
    month      date          NOT NULL CHECK (extract(day FROM month) = 1),
    amount     numeric(20,6) NOT NULL CHECK (amount > 0),
    reason     text          NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
    created_by uuid          REFERENCES users (id),
    created_at timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX budget_extensions_team_month_idx ON budget_extensions (team_id, month);

CREATE TABLE usage_rollup (
    hour     timestamptz NOT NULL,
    kind     text        NOT NULL,
    team_id  uuid,
    agent_id uuid,
    model_id uuid,
    channel  text        NOT NULL DEFAULT '',
    quantity bigint      NOT NULL,
    events   bigint      NOT NULL,
    CONSTRAINT usage_rollup_key UNIQUE NULLS NOT DISTINCT (hour, kind, team_id, agent_id, model_id, channel)
);
CREATE INDEX usage_rollup_team_hour_idx ON usage_rollup (team_id, hour);
CREATE INDEX usage_rollup_hour_idx ON usage_rollup (hour);

CREATE TABLE usage_rollup_state (
    singleton    boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    -- Hours before this are rolled up; NULL until the first run.
    rolled_until timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO usage_rollup_state DEFAULT VALUES;

CREATE TABLE budget_notices (
    team_id    uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    month      date        NOT NULL,
    level      text        NOT NULL CHECK (level IN ('warning', 'exhausted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, month, level)
);

ALTER TABLE web_crawls DROP CONSTRAINT web_crawls_waiting_reason_check;
ALTER TABLE web_crawls ADD CONSTRAINT web_crawls_waiting_reason_check
    CHECK (waiting_reason IN ('', 'concurrent_crawls', 'daily_page_limit', 'maintenance', 'monthly_budget')) NOT VALID;
ALTER TABLE web_crawls VALIDATE CONSTRAINT web_crawls_waiting_reason_check;

-- +goose Down
UPDATE web_crawls SET waiting_reason = '', waiting_until = NULL WHERE waiting_reason = 'monthly_budget';
ALTER TABLE web_crawls DROP CONSTRAINT web_crawls_waiting_reason_check;
ALTER TABLE web_crawls ADD CONSTRAINT web_crawls_waiting_reason_check
    CHECK (waiting_reason IN ('', 'concurrent_crawls', 'daily_page_limit', 'maintenance'));
DROP TABLE budget_notices;
DROP TABLE usage_rollup_state;
DROP TABLE usage_rollup;
DROP TABLE budget_extensions;
DROP TABLE team_budgets;
DROP TABLE model_prices;
DROP TABLE cost_settings;
