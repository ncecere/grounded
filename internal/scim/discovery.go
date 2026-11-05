package scim

// The discovery documents (RFC 7644 §4): what this service supports, said plainly so a client doesn't try the rest.

// ServiceProviderConfig says PATCH and filtering are supported; bulk, sorting, password changes and ETags are not.
func ServiceProviderConfig(base string) map[string]any {
	off := map[string]any{"supported": false}
	return map[string]any{
		"schemas":          []string{SchemaSPConfig},
		"documentationUri": "https://github.com/ncecere/grounded/blob/main/docs/operations/scim.md",
		"patch":            map[string]any{"supported": true},
		"bulk":             map[string]any{"supported": false, "maxOperations": 0, "maxPayloadSize": 0},
		"filter":           map[string]any{"supported": true, "maxResults": MaxPage},
		"changePassword":   off,
		"sort":             off,
		"etag":             off,
		"authenticationSchemes": []map[string]any{{
			"type": "oauthbearertoken", "name": "SCIM token", "primary": true,
			"description": "A SCIM token from Admin → SCIM provisioning, sent as Authorization: Bearer scim_…",
		}},
		"meta": map[string]any{"resourceType": "ServiceProviderConfig", "location": base + "/ServiceProviderConfig"},
	}
}

// ResourceTypes lists User and Group.
func ResourceTypes(base string) ListResponse {
	rt := func(name, endpoint, schema string) any {
		return map[string]any{
			"schemas": []string{SchemaResourceType}, "id": name, "name": name, "endpoint": endpoint, "schema": schema,
			"meta": map[string]any{"resourceType": "ResourceType", "location": base + "/ResourceTypes/" + name},
		}
	}
	return List(2, 1, []any{rt("User", "/Users", SchemaUser), rt("Group", "/Groups", SchemaGroup)})
}

func attr(name, typ string, required bool, mutability, uniqueness string, sub ...map[string]any) map[string]any {
	a := map[string]any{
		"name": name, "type": typ, "multiValued": false, "required": required, "caseExact": false,
		"mutability": mutability, "returned": "default", "uniqueness": uniqueness,
	}
	if len(sub) > 0 {
		a["subAttributes"] = sub
	}
	return a
}

func multi(a map[string]any) map[string]any {
	a["multiValued"] = true
	return a
}

// Schemas describes the attributes Grounded keeps; others are accepted and ignored.
func Schemas(base string) ListResponse {
	user := map[string]any{
		"schemas": []string{SchemaSchema}, "id": SchemaUser, "name": "User", "description": "A person who signs in to Grounded",
		"attributes": []map[string]any{
			attr("userName", "string", true, "readWrite", "server"),
			attr("externalId", "string", true, "immutable", "server"),
			attr("displayName", "string", false, "readWrite", "none"),
			attr("name", "complex", false, "readWrite", "none",
				attr("formatted", "string", false, "readWrite", "none"), attr("givenName", "string", false, "readWrite", "none"),
				attr("familyName", "string", false, "readWrite", "none")),
			multi(attr("emails", "complex", true, "readWrite", "none",
				attr("value", "string", true, "readWrite", "none"), attr("type", "string", false, "readWrite", "none"),
				attr("primary", "boolean", false, "readWrite", "none"))),
			attr("active", "boolean", false, "readWrite", "none"),
		},
		"meta": map[string]any{"resourceType": "Schema", "location": base + "/Schemas/" + SchemaUser},
	}
	group := map[string]any{
		"schemas": []string{SchemaSchema}, "id": SchemaGroup, "name": "Group", "description": "A group the SSO group → team rules can use",
		"attributes": []map[string]any{
			attr("displayName", "string", true, "readWrite", "server"),
			attr("externalId", "string", false, "readWrite", "server"),
			multi(attr("members", "complex", false, "readWrite", "none",
				attr("value", "string", true, "immutable", "none"), attr("display", "string", false, "readOnly", "none"))),
		},
		"meta": map[string]any{"resourceType": "Schema", "location": base + "/Schemas/" + SchemaGroup},
	}
	return List(2, 1, []any{user, group})
}
