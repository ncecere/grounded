#!/usr/bin/env bash
# Source-bound #34 rehearsal using the ordinary upgrade harness. Builds only
# local history; no registry baseline, credentials or production resources.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
BASE=a55dc5e50ab011092ddf6f480891aa3828bf462d
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
# Exercise the actual old codec with a new authored field. Its save payload
# must discard the unknown note, never carry it into a later publication.
cat > "$WORK/internal/agents/about_legacy_test.go" <<'GO'
package agents
import ("encoding/json"; "testing")
func TestLegacyOwnershipNoteIsNotRepublished(t *testing.T) {
 raw := DefaultConfig().JSON()
 var c map[string]any
 if err := json.Unmarshal(raw, &c); err != nil { t.Fatal(err) }
 c["ownershipNote"] = "PRIVATE NEW FIELD"
 raw, _ = json.Marshal(c)
 parsed, err := ParseConfig(raw)
 if err != nil { t.Fatal(err) }
 var saved map[string]any
 if err := json.Unmarshal(parsed.JSON(), &saved); err != nil { t.Fatal(err) }
 if _, exists := saved["ownershipNote"]; exists { t.Fatal("legacy save retained a new authored field") }
}
GO
export GOMAXPROCS=4 GOFLAGS=-p=2
(cd "$WORK" && go test -count=1 ./internal/agents -run '^TestLegacyOwnershipNoteIsNotRepublished$')
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
