-- Document permissions (B6, #41; docs/specs/document-acls/DESIGN.md).

-- name: CallerIdentity :one
-- A person's identity for their principals: sign-in subject, SCIM externalId, email (verified per the claims or SCIM),
-- the latest sign-in claims, the groups seen at sign-in, and the SCIM groups they are in (display name and externalId).
SELECT u.status, u.oidc_subject, u.scim_external_id, u.email::text AS email, u.claims,
       COALESCE((SELECT g.groups FROM sso_user_groups g WHERE g.user_id = u.id), '{}'::text[])::text[] AS sso_groups,
       ARRAY(SELECT x FROM scim_group_members m JOIN scim_groups sg ON sg.id = m.group_id,
                  LATERAL unnest(ARRAY[sg.display_name, sg.external_id]) AS x
             WHERE m.user_id = u.id AND x IS NOT NULL)::text[] AS scim_groups
FROM users u
WHERE u.id = $1;

-- name: SourceGroupsOf :many
-- The connector groups (source:<source>:<group>) whose expanded members include any of the principals.
SELECT DISTINCT source_id, group_id FROM source_group_members WHERE principal = ANY(sqlc.arg(principals)::text[]);

-- name: SourcesHaveRestricted :one
-- Whether any of the sources has (or had) a restricted document: search then adds the permission condition to candidates.
SELECT COALESCE(bool_or(restricted_documents), false)::boolean FROM data_sources WHERE id = ANY(sqlc.arg(ids)::uuid[]);

-- name: GetDocumentAccessSettings :one
SELECT * FROM document_access_settings WHERE singleton;

-- name: LockDocumentAccessSettings :one
SELECT * FROM document_access_settings WHERE singleton FOR UPDATE;

-- name: SetDocumentAccessSettings :one
UPDATE document_access_settings SET enabled = @enabled, revision = revision + 1, updated_by = @updated_by, updated_at = now()
WHERE singleton RETURNING *;

-- name: CountRestrictedDocuments :one
SELECT count(*) FROM documents WHERE acl_principals IS NOT NULL;

-- name: SetSourceAccess :one
-- A source's restriction set by hand (NULL: unrestricted). The source row is locked by the caller; its documents follow
-- in the same transaction (SetSourceDocumentsAccess), and a document inserted meanwhile waits for the row (the trigger).
UPDATE data_sources SET acl_principals = sqlc.narg(principals)::text[], revision = revision + 1, updated_at = now()
WHERE id = @id RETURNING *;

-- name: SetSourceDocumentsAccess :execrows
UPDATE documents SET acl_principals = sqlc.narg(principals)::text[], updated_at = now()
WHERE source_id = @source_id AND acl_principals IS DISTINCT FROM sqlc.narg(principals)::text[];

-- name: KnownGroups :many
-- Group names seen at sign-in or provisioned by SCIM, for the access picker (names only, lower-cased, at most 500).
SELECT DISTINCT g::text AS name FROM (
    SELECT unnest(groups) AS g FROM sso_user_groups
    UNION
    SELECT lower(display_name) FROM scim_groups
) x
WHERE g <> '' AND (sqlc.arg(prefix)::text = '' OR g LIKE sqlc.arg(prefix)::text || '%')
ORDER BY 1
LIMIT 500;
