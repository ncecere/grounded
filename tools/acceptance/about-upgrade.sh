#!/usr/bin/env bash
# Source-bound #34 rehearsal using the ordinary upgrade harness. Builds only
# local history; no registry baseline, credentials or production resources.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
BASE=b6f523ac628255387808c40c00c06b77ca87aef2 # v0.7.0, the previous release
: "${RUN_ID:?unique disposable RUN_ID required}"
[[ "$RUN_ID" =~ ^[a-zA-Z0-9-]+$ ]] || exit 2
WORK=$(mktemp -d)
OLD_IMAGE=grounded-about-upgrade-$RUN_ID-old
NEW_IMAGE=grounded-about-upgrade-$RUN_ID-new
cleanup() {
 status=$?
 rm -rf "$WORK"
 docker image rm "$OLD_IMAGE" "$NEW_IMAGE" >/dev/null 2>&1 || true
 exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
git -C "$ROOT" archive "$BASE" | tar -x -C "$WORK"
# API compatibility, not an old UI audit. Supply current built embedded assets.
mkdir -p "$WORK/web/dist"
cp -a "$ROOT/web/dist/." "$WORK/web/dist/"
# Exercise the actual old codec. A release before #34 decodes requests with
# DisallowUnknownFields, so a save that carries a note is refused (never kept
# and later published), while a stored configuration that has one is read and
# re-serialized without it (an old binary neither fails nor shows it). Configs
# without a note no longer carry the key (omitempty), so their saves are
# unaffected; that half is TestConfigWithoutNoteIsUnchanged in the new tree.
cat > "$WORK/internal/agents/about_legacy_test.go" <<'GO'
package agents
import ("encoding/json"; "strings"; "testing")
func TestLegacyOwnershipNote(t *testing.T) {
 var c map[string]any
 if err := json.Unmarshal(DefaultConfig().JSON(), &c); err != nil { t.Fatal(err) }
 c["ownershipNote"] = "PRIVATE NEW FIELD"
 raw, _ := json.Marshal(c)
 if _, err := ParseConfig(raw); err == nil { t.Fatal("a pre-#34 API accepted a save carrying ownershipNote") }
 if out := DecodeConfig(raw).JSON(); strings.Contains(string(out), "PRIVATE NEW FIELD") { t.Fatal("a pre-#34 binary re-serialized a stored note") }
 delete(c, "ownershipNote")
 raw, _ = json.Marshal(c)
 if _, err := ParseConfig(raw); err != nil { t.Fatalf("a save without a note was refused: %v", err) }
}
GO
export GOMAXPROCS=4 GOFLAGS=-p=2
(cd "$WORK" && go test -count=1 ./internal/agents -run '^TestLegacyOwnershipNote$')
(cd "$WORK" && CGO_ENABLED=0 go build -trimpath -o "$WORK/old" ./cmd/grounded)
(cd "$ROOT" && CGO_ENABLED=0 go build -trimpath -o "$WORK/new" ./cmd/grounded)
# The existing harness expects the image entrypoint to be /grounded.
printf 'FROM scratch\nCOPY old /grounded\nENTRYPOINT ["/grounded"]\n' > "$WORK/Dockerfile"
docker build --network=none -q -t "$OLD_IMAGE" "$WORK"
printf 'FROM scratch\nCOPY new /grounded\nENTRYPOINT ["/grounded"]\n' > "$WORK/Dockerfile"
docker build --network=none -q -t "$NEW_IMAGE" "$WORK"
export OLD_IMAGE NEW_IMAGE
# Feature unused: no new statement links or ownership note are authored here.
# Do not infer cross-version draft-note round-trip coverage from ordinary writes.
bash "$ROOT/deploy/kubernetes/scripts/upgrade-test.sh"
