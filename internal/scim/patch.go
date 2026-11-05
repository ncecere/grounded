package scim

import (
	"bytes"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

// userBody is a User as clients send it; active may be a boolean or a string ("True", Entra).
type userBody struct {
	UserName    string          `json:"userName"`
	ExternalID  string          `json:"externalId"`
	DisplayName string          `json:"displayName"`
	Name        Name            `json:"name"`
	Emails      []Email         `json:"emails"`
	Active      json.RawMessage `json:"active"`
}

func syntaxError(detail string) *Error {
	return &Error{Status: http.StatusBadRequest, Type: "invalidSyntax", Detail: detail}
}

func decodeStrict(raw []byte, v any) *Error {
	if err := json.Unmarshal(raw, v); err != nil {
		return syntaxError("the request body is not valid JSON for this resource")
	}
	return nil
}

// parseBool reads a boolean sent as JSON true/false or as a string ("True", "false").
func parseBool(raw json.RawMessage) (bool, *Error) {
	var b bool
	if json.Unmarshal(raw, &b) == nil {
		return b, nil
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "true":
			return true, nil
		case "false":
			return false, nil
		}
	}
	return false, invalid("active must be true or false")
}

// primaryEmail is the primary address, else the work address, else the first.
func primaryEmail(es []Email) string {
	for _, e := range es {
		if e.Primary {
			return e.Value
		}
	}
	for _, e := range es {
		if strings.EqualFold(e.Type, "work") {
			return e.Value
		}
	}
	if len(es) > 0 {
		return es[0].Value
	}
	return ""
}

// decodeUser reads a POST or PUT body. A missing active means active.
func decodeUser(raw []byte) (userInput, *Error) {
	var b userBody
	if err := decodeStrict(raw, &b); err != nil {
		return userInput{}, err
	}
	in := userInput{UserName: strings.TrimSpace(b.UserName), ExternalID: strings.TrimSpace(b.ExternalID), DisplayName: b.DisplayName,
		Name: b.Name, Email: primaryEmail(b.Emails), Active: true}
	if len(b.Active) > 0 && !bytes.Equal(b.Active, []byte("null")) {
		active, err := parseBool(b.Active)
		if err != nil {
			return userInput{}, err
		}
		in.Active = active
	}
	return in, nil
}

// PatchOp is one operation of a PATCH (RFC 7644 §3.5.2); op is case-insensitive (Entra sends "Replace").
type PatchOp struct {
	Op    string          `json:"op"`
	Path  string          `json:"path"`
	Value json.RawMessage `json:"value"`
}

type patchBody struct {
	Schemas    []string  `json:"schemas"`
	Operations []PatchOp `json:"Operations"`
}

func decodePatch(raw []byte) ([]PatchOp, *Error) {
	var b patchBody
	if err := decodeStrict(raw, &b); err != nil {
		return nil, err
	}
	if len(b.Operations) == 0 || len(b.Operations) > 1000 {
		return nil, syntaxError("a PATCH needs between 1 and 1000 Operations")
	}
	for i := range b.Operations {
		b.Operations[i].Op = strings.ToLower(strings.TrimSpace(b.Operations[i].Op))
		if o := b.Operations[i].Op; o != "add" && o != "replace" && o != "remove" {
			return nil, &Error{Status: http.StatusBadRequest, Type: "invalidSyntax", Detail: "op must be add, replace or remove"}
		}
	}
	return b.Operations, nil
}

func str(raw json.RawMessage) (string, *Error) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", invalid("the value must be a string")
	}
	return s, nil
}

// patchUser applies a PATCH to a user. externalId can't change once set.
func patchUser(in *userInput, ops []PatchOp) *Error {
	for _, op := range ops {
		if op.Path == "" {
			var attrs map[string]json.RawMessage
			if err := json.Unmarshal(op.Value, &attrs); err != nil {
				return invalid("an operation without a path needs an object of attributes")
			}
			for k, v := range attrs {
				if err := setUserAttr(in, op.Op, k, v); err != nil {
					return err
				}
			}
			continue
		}
		if err := setUserAttr(in, op.Op, op.Path, op.Value); err != nil {
			return err
		}
	}
	return nil
}

var emailPath = regexp.MustCompile(`(?i)^emails(\[\s*type\s+eq\s+"[a-z]+"\s*\])?(\.value)?$`)

// setUserAttr sets one attribute by its path. Removing an attribute clears it; removing active is not allowed.
func setUserAttr(in *userInput, op, path string, v json.RawMessage) *Error {
	if op == "remove" {
		v = json.RawMessage(`""`)
	}
	p := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(path, SchemaUser+":")))
	var err *Error
	switch {
	case p == "active":
		if op == "remove" {
			return invalid("active can't be removed")
		}
		in.Active, err = parseBool(v)
	case p == "username":
		in.UserName, err = str(v)
	case p == "displayname":
		in.DisplayName, err = str(v)
	case p == "name":
		var n Name
		if json.Unmarshal(v, &n) != nil && op != "remove" {
			return invalid("name must be an object")
		}
		in.Name = n
	case p == "name.givenname":
		in.Name.GivenName, err = str(v)
	case p == "name.familyname":
		in.Name.FamilyName, err = str(v)
	case p == "name.formatted":
		in.Name.Formatted, err = str(v)
	case p == "externalid":
		var ext string
		if ext, err = str(v); err == nil && ext != in.ExternalID {
			return &Error{Status: http.StatusBadRequest, Type: "mutability", Detail: "externalId can't change: it links the user to their sign-in"}
		}
	case emailPath.MatchString(p):
		in.Email, err = emailValue(v)
	default:
		// Attributes Grounded doesn't keep (title, department, phone numbers…) are accepted and ignored, as the
		// ServiceProviderConfig and Schemas documents say.
	}
	return err
}

// emailValue reads an address given as a string or as a list of emails.
func emailValue(v json.RawMessage) (string, *Error) {
	var s string
	if json.Unmarshal(v, &s) == nil {
		return s, nil
	}
	var es []Email
	if json.Unmarshal(v, &es) == nil {
		return primaryEmail(es), nil
	}
	return "", invalid("emails must be a list of addresses")
}

// groupBody is a Group as clients send it.
type groupBody struct {
	DisplayName string   `json:"displayName"`
	ExternalID  *string  `json:"externalId"`
	Members     []Member `json:"members"`
}

// groupChange is what a PATCH does to a group: its name and external ID, and members added and removed (or replaced).
type groupChange struct {
	DisplayName, ExternalID *string
	Replace                 *[]string // members replaced by these
	Add, Remove             []string
}

var memberFilter = regexp.MustCompile(`(?i)^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$`)

func memberIDs(v json.RawMessage) ([]string, *Error) {
	var ms []Member
	if err := json.Unmarshal(v, &ms); err != nil {
		var one Member
		if json.Unmarshal(v, &one) != nil || one.Value == "" {
			return nil, invalid("members must be a list of {\"value\": user id}")
		}
		ms = []Member{one}
	}
	out := make([]string, 0, len(ms))
	for _, m := range ms {
		out = append(out, m.Value)
	}
	return out, nil
}

// patchGroup reads a group PATCH.
func patchGroup(ops []PatchOp) (groupChange, *Error) {
	var c groupChange
	for _, op := range ops {
		path := strings.ToLower(strings.TrimSpace(op.Path))
		switch {
		case path == "":
			var b groupBody
			if json.Unmarshal(op.Value, &b) != nil {
				return c, invalid("an operation without a path needs an object of attributes")
			}
			if b.DisplayName != "" {
				c.DisplayName = &b.DisplayName
			}
			if b.ExternalID != nil {
				c.ExternalID = b.ExternalID
			}
			if b.Members != nil {
				ids := make([]string, len(b.Members))
				for i, m := range b.Members {
					ids[i] = m.Value
				}
				if op.Op == "replace" {
					c.Replace = &ids
				} else {
					c.Add = append(c.Add, ids...)
				}
			}
		case path == "displayname":
			s, err := str(op.Value)
			if err != nil {
				return c, err
			}
			c.DisplayName = &s
		case path == "externalid":
			s := ""
			if op.Op != "remove" {
				var err *Error
				if s, err = str(op.Value); err != nil {
					return c, err
				}
			}
			c.ExternalID = &s
		case path == "members":
			if err := c.members(op); err != nil {
				return c, err
			}
		case memberFilter.MatchString(op.Path):
			if op.Op != "remove" {
				return c, invalid("a member filter path can only be removed")
			}
			c.Remove = append(c.Remove, memberFilter.FindStringSubmatch(op.Path)[1])
		default:
			return c, &Error{Status: http.StatusBadRequest, Type: "noTarget", Detail: "unsupported path: " + op.Path}
		}
	}
	return c, nil
}

func (c *groupChange) members(op PatchOp) *Error {
	if op.Op == "remove" && (len(op.Value) == 0 || bytes.Equal(op.Value, []byte("null"))) {
		empty := []string{}
		c.Replace = &empty
		return nil
	}
	ids, err := memberIDs(op.Value)
	if err != nil {
		return err
	}
	switch op.Op {
	case "add":
		c.Add = append(c.Add, ids...)
	case "remove":
		c.Remove = append(c.Remove, ids...)
	default:
		c.Replace = &ids
	}
	return nil
}
