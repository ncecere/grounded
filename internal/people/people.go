// Package people is the person a setting or a record names: who changed a
// platform setting, decided a break-glass session or placed a legal hold.
// The services share one type so the API maps it once (#253).
package people

import "github.com/google/uuid"

// Person names someone (zero ID: nobody).
type Person struct {
	ID          uuid.UUID
	DisplayName string
	Email       string
}

// Name is the display name, or the email.
func (p Person) Name() string {
	if p.DisplayName != "" {
		return p.DisplayName
	}
	return p.Email
}

// From builds a Person from a joined user row; a missing user (no ID or no
// email, as after a user is deleted) is nobody.
func From(id uuid.NullUUID, name, email string) Person {
	if !id.Valid || email == "" {
		return Person{}
	}
	return Person{ID: id.UUID, DisplayName: name, Email: email}
}
