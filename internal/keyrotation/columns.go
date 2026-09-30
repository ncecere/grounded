// Package keyrotation rotates the two install-wide secrets
// (docs/phase5-deploy.md E10, docs/operations/rotate-keys.md):
//
//   - ENCRYPTION_KEY: Run re-encrypts every stored secret from
//     ENCRYPTION_KEY_PREVIOUS to the current key, column by column, in
//     batches, one transaction per batch. It is idempotent and resumable
//     (values already on the current key are skipped) and safe while the app
//     serves, because readers accept both keys until the previous one is
//     removed. It is audited as a system action with counts only.
//   - API_KEY_PEPPER: key digests can't be re-hashed without the key, so
//     internal/apikeys and internal/public re-hash each key on its next use
//     while API_KEY_PEPPER_PREVIOUS is set. PepperReport lists the keys that
//     are not yet on the current pepper.
package keyrotation

import (
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/mcpclient"
)

// Column is one column of internal/secrets ciphertexts, in a table keyed by
// a uuid "id", with the associated data each value is sealed with.
type Column struct {
	Table, Column string
	AAD           func(id uuid.UUID) []byte
}

// Name is "table.column".
func (c Column) Name() string { return c.Table + "." + c.Column }

func (c Column) table() string { return pgx.Identifier{c.Table}.Sanitize() }
func (c Column) col() string   { return pgx.Identifier{c.Column}.Sanitize() }

// Columns is every column that holds encrypted secrets. Other secrets
// (SMTP, OIDC, captcha, S3) come from the environment and are rotated
// there. A test fails if the schema gains a ciphertext column that is not
// listed here.
var Columns = []Column{
	{Table: "model_connections", Column: "api_key_ciphertext", AAD: catalog.ConnectionAAD},
	{Table: "mcp_servers", Column: "auth_value_cipher", AAD: mcpclient.ServerAAD},
}
