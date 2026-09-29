-- name: InsertAudit :exec
INSERT INTO audit_log (
    actor_kind, actor_user_id, team_id, action, target_type, target_id,
    before_state, after_state, metadata, request_id, client_ip
) VALUES (
    @actor_kind, @actor_user_id, @team_id, @action, @target_type, @target_id,
    @before_state, @after_state, @metadata, @request_id, @client_ip
);

-- name: ListAudit :many
-- One page of the audit log, newest first, with the actor and the target's
-- name resolved at read time (DESIGN.md §13). live_label is the target's
-- current name ('' when it no longer exists); recorded_label is the last
-- name the log recorded for the same target, used for deleted targets ('' when
-- none). Names are never empty, so '' means unknown.
-- Every target type the code audits is covered here (a test enumerates them);
-- singletons (platform settings, limits, SystemOne settings, moderation
-- policies) always have a live label. parent_* names the object a target
-- belongs to, for linking: a publishable key's agent, a document's source
-- (parent_label '' when the parent no longer exists).
-- action_prefix and exclude_prefix are LIKE-escaped by the caller.
-- group_mapping: the group mapping rules' changes and the memberships they
-- made (metadata.via = 'sso_group_rule'), across action groups.
-- actor_kind: 'system' for the system's entries, 'group_mapping' for the
-- memberships group mapping rules made (the system as the rule).
SELECT a.id, a.occurred_at, a.actor_kind, a.actor_user_id, a.team_id, a.action,
       a.target_type, a.target_id, a.before_state, a.after_state, a.metadata,
       a.request_id, a.client_ip,
       COALESCE(u.email::text, '')::text AS actor_email,
       COALESCE(tm.name, '')::text AS team_name, COALESCE(tm.slug::text, '')::text AS team_slug,
       u.display_name AS actor_display_name,
       k.name AS actor_api_key_name,
       COALESCE(live.label, '')::text AS live_label,
       COALESCE(CASE WHEN live.label IS NULL THEN (
           SELECT COALESCE(h.metadata->>'name', h.after_state->>'name', h.after_state->>'displayName',
                           h.after_state->>'pattern', h.before_state->>'name',
                           h.before_state->>'displayName', h.before_state->>'pattern',
                           CASE WHEN h.target_type = 'data_source' THEN h.metadata->>'sourceName' END)
           FROM audit_log h
           WHERE h.target_type = a.target_type AND h.target_id = a.target_id AND a.target_id <> ''
             AND COALESCE(h.metadata->>'name', h.after_state->>'name', h.after_state->>'displayName',
                          h.after_state->>'pattern', h.before_state->>'name',
                          h.before_state->>'displayName', h.before_state->>'pattern',
                          CASE WHEN h.target_type = 'data_source' THEN h.metadata->>'sourceName' END) IS NOT NULL
           ORDER BY h.id DESC
           LIMIT 1
       ) END, '')::text AS recorded_label,
       (CASE a.target_type WHEN 'publishable_key' THEN 'agent' WHEN 'document' THEN 'data_source' ELSE '' END)::text AS parent_type,
       COALESCE(ids.parent_uuid::text, '')::text AS parent_id,
       COALESCE(CASE a.target_type
           WHEN 'publishable_key' THEN (SELECT pa.name FROM agents pa WHERE pa.id = ids.parent_uuid AND pa.deleted_at IS NULL)
           WHEN 'document' THEN (SELECT ps.name FROM data_sources ps WHERE ps.id = ids.parent_uuid)
       END, '')::text AS parent_label
FROM audit_log a
CROSS JOIN LATERAL (
    SELECT CASE WHEN a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN a.target_id::uuid END AS target_uuid,
           CASE WHEN a.metadata->>'apiKeyId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (a.metadata->>'apiKeyId')::uuid END AS key_uuid,
           CASE WHEN p.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p.raw::uuid END AS parent_uuid
    FROM (SELECT CASE a.target_type WHEN 'publishable_key' THEN a.metadata->>'agentId'
                                    WHEN 'document' THEN a.metadata->>'sourceId' END AS raw) p
) ids
LEFT JOIN users u ON u.id = a.actor_user_id
LEFT JOIN teams tm ON tm.id = a.team_id
LEFT JOIN api_keys k ON a.actor_kind = 'api_key' AND k.id = ids.key_uuid
CROSS JOIN LATERAL (
    SELECT (CASE a.target_type
        WHEN 'team' THEN (SELECT t.name FROM teams t WHERE t.id = ids.target_uuid)
        WHEN 'user' THEN (SELECT COALESCE(NULLIF(x.display_name, ''), x.email::text) FROM users x WHERE x.id = ids.target_uuid)
        WHEN 'data_source' THEN (SELECT s.name FROM data_sources s WHERE s.id = ids.target_uuid)
        WHEN 'document' THEN (SELECT COALESCE(NULLIF(d.title, ''), NULLIF(d.filename, ''), d.url) FROM documents d WHERE d.id = ids.target_uuid)
        WHEN 'knowledge_base' THEN (SELECT kb.name FROM knowledge_bases kb WHERE kb.id = ids.target_uuid)
        WHEN 'agent' THEN (SELECT ag.name FROM agents ag WHERE ag.id = ids.target_uuid AND ag.deleted_at IS NULL)
        WHEN 'api_key' THEN (SELECT ak.name FROM api_keys ak WHERE ak.id = ids.target_uuid)
        WHEN 'model_connection' THEN (SELECT c.name FROM model_connections c WHERE c.id = ids.target_uuid)
        WHEN 'model' THEN (SELECT m.display_name FROM models m WHERE m.id = ids.target_uuid)
        WHEN 'embedding_profile' THEN (SELECT p.name FROM embedding_profiles p WHERE p.id = ids.target_uuid)
        WHEN 'crawl_domain_request' THEN (SELECT r.pattern FROM crawl_domain_requests r WHERE r.id = ids.target_uuid)
        WHEN 'crawl_allowlist' THEN (SELECT w.pattern FROM crawl_allowlist w WHERE w.id = ids.target_uuid)
        WHEN 'team_invite' THEN (SELECT i.email::text FROM team_invites i WHERE i.id = ids.target_uuid)
        WHEN 'classification' THEN (SELECT cl.name FROM classification_levels cl WHERE cl.key = a.target_id)
        WHEN 'publishable_key' THEN (SELECT pk.name FROM publishable_keys pk WHERE pk.id = ids.target_uuid)
        WHEN 'moderation_policy' THEN (CASE a.target_id WHEN 'team' THEN 'Team moderation policy'
                                                        WHEN 'all_authenticated' THEN 'Signed-in users moderation policy'
                                                        WHEN 'public' THEN 'Public moderation policy' END)
        WHEN 'platform_settings' THEN (CASE a.target_id WHEN 'public_agents_enabled' THEN 'Public access' ELSE 'Platform settings' END)
        WHEN 'platform_limits' THEN 'Platform limits'
        WHEN 'cost_settings' THEN 'Cost settings'
        WHEN 'platform_keys' THEN 'Key rotation'
        WHEN 'systemone_settings' THEN 'SystemOne settings'
        WHEN 'parsing_settings' THEN 'Parsing settings'
        WHEN 'retention_settings' THEN 'Retention settings'
        WHEN 'retention' THEN 'Retention run'
        WHEN 'legal_hold' THEN (SELECT 'Legal hold on ' || lh.scope_type || ' ' || lh.scope_label FROM legal_holds lh WHERE lh.id = ids.target_uuid)
        -- Break-glass (ADR-0024): a conversation is never named (its title is content).
        WHEN 'break_glass_session' THEN (SELECT 'Break-glass: ' || bt.name FROM break_glass_sessions bg JOIN teams bt ON bt.id = bg.team_id WHERE bg.id = ids.target_uuid)
        WHEN 'break_glass_settings' THEN 'Break-glass settings'
        WHEN 'sso_group_rule' THEN (SELECT 'Group ' || gr.group_name || ' → ' || grt.name FROM sso_group_rules gr JOIN teams grt ON grt.id = gr.team_id WHERE gr.id = ids.target_uuid)
        WHEN 'evaluation_set' THEN (SELECT es.name FROM eval_sets es WHERE es.id = ids.target_uuid)
        WHEN 'evaluation_run' THEN (SELECT 'Run of ' || ers.name FROM eval_runs er JOIN eval_sets ers ON ers.id = er.set_id WHERE er.id = ids.target_uuid)
        WHEN 'evaluation_settings' THEN 'Evaluations'
        WHEN 'conversation' THEN (SELECT 'Conversation' FROM conversations cv WHERE cv.id = ids.target_uuid)
    END)::text AS label
) live
WHERE (sqlc.narg(team_id)::uuid IS NULL OR a.team_id = sqlc.narg(team_id)::uuid)
  AND (sqlc.narg(before_id)::bigint IS NULL OR a.id < sqlc.narg(before_id)::bigint)
  AND (sqlc.narg(action)::text IS NULL OR a.action = sqlc.narg(action)::text)
  AND (sqlc.narg(action_prefix)::text IS NULL OR a.action LIKE sqlc.narg(action_prefix)::text || '%' ESCAPE '\')
  AND (sqlc.narg(exclude_prefix)::text IS NULL OR a.action NOT LIKE sqlc.narg(exclude_prefix)::text || '%' ESCAPE '\')
  AND (NOT COALESCE(sqlc.narg(group_mapping)::boolean, false)
       OR a.action LIKE 'platform.sso\_rule\_%' ESCAPE '\' OR a.metadata->>'via' = 'sso_group_rule')
  AND (sqlc.narg(actor_user_id)::uuid IS NULL OR a.actor_user_id = sqlc.narg(actor_user_id)::uuid)
  AND (sqlc.narg(actor_kind)::text IS NULL
       OR (a.actor_kind = 'system' AND (sqlc.narg(actor_kind)::text = 'system' OR a.metadata->>'via' = 'sso_group_rule')))
  AND (sqlc.narg(target_type)::text IS NULL OR a.target_type = sqlc.narg(target_type)::text)
  AND (sqlc.narg(occurred_from)::timestamptz IS NULL OR a.occurred_at >= sqlc.narg(occurred_from)::timestamptz)
  AND (sqlc.narg(occurred_to)::timestamptz IS NULL OR a.occurred_at < sqlc.narg(occurred_to)::timestamptz)
ORDER BY a.id DESC
LIMIT @page_size;
