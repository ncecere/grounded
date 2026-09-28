package httpapi

import (
	"fmt"
	"slices"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	"github.com/ncecere/grounded/internal/notify"
)

// The API's NotificationType enum lists exactly the notification catalog.
func TestNotificationTypesMatchCatalog(t *testing.T) {
	doc, err := openapi3.NewLoader().LoadFromFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var spec []string
	for _, v := range doc.Components.Schemas["NotificationType"].Value.Enum {
		spec = append(spec, fmt.Sprint(v))
	}
	var catalog []string
	for _, d := range notify.Catalog() {
		catalog = append(catalog, string(d.Type))
	}
	slices.Sort(spec)
	slices.Sort(catalog)
	if !slices.Equal(spec, catalog) {
		t.Errorf("NotificationType enum %v != catalog %v", spec, catalog)
	}
}
