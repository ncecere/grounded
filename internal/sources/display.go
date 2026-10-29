package sources

import "github.com/ncecere/grounded/internal/displaytext"

// validateNewText checks the raw identity before normalization. Updates check
// an explicitly supplied name separately so unrelated legacy updates still work.
func validateNewText(name, description string) error {
	if err := displaytext.Validate(name, "invalid_name", "Name"); err != nil {
		return err
	}
	return validateText(name, description)
}
