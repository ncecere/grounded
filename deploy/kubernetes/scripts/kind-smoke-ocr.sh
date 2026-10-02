# OCR in the kind smoke test (sourced by kind-smoke.sh, docs/ocr.md): signs
# in as the development admin through the API's port-forward, turns OCR on
# with the grounded-ocr sidecar, uploads the built-in one-page scanned sample
# (internal/ocr/sample.png) to a new source in the Demo team that the fake
# model gateway seeded, and waits until the page's text, read by Tesseract,
# is in its passages.
#
# Uses kc, $api (the port-forward to svc/grounded-api), $repo and
# $kubeconfig from kind-smoke.sh; needs curl and jq.

# smoke_api calls the API as the browser would: APP_URL's host (development
# sign-in is refused for any other), the session cookie and the CSRF token.
smoke_api() { # method path [curl args...]
  local method="$1" path="$2"
  shift 2
  curl -sS -f --retry 3 --retry-connrefused --retry-delay 1 --connect-to "localhost:8080:127.0.0.1:${api}" \
    -b "${kubeconfig}.jar" -c "${kubeconfig}.jar" -H "X-CSRF-Token: ${smoke_csrf:-}" -X "$method" "$@" "http://localhost:8080${path}"
}

smoke_ocr() {
  echo "--- OCR: a scanned page read by the grounded-ocr sidecar"
  local started=$SECONDS
  # The fake gateway's pod seeds the Demo team (and its fake models) first.
  for _ in $(seq 1 90); do
    if kc logs deploy/grounded-fake-models 2>/dev/null | grep -q "Serving the fake model gateway"; then break; fi
    sleep 2
  done
  kc logs deploy/grounded-fake-models | grep -q "Serving the fake model gateway" ||
    { echo "FAIL: grounded demo did not seed the Demo team" >&2; kc logs deploy/grounded-fake-models --tail=40 >&2; return 1; }

  smoke_api POST /auth/dev -H 'Content-Type: application/json' -d '{"account":"admin"}' >/dev/null
  smoke_csrf="$(smoke_api GET /v1/me | jq -r '.data.csrfToken')"

  local revision
  revision="$(smoke_api GET /v1/admin/parsing | jq -r '.data.revision')"
  smoke_api PUT /v1/admin/parsing -H 'Content-Type: application/json' -H "If-Match: \"${revision}\"" \
    -d '{"ocrEnabled":true,"backend":"tesseract","visionModelId":null,"languages":"eng"}' >/dev/null
  echo "OCR on with Tesseract"

  # A source like the demo's (its classification and embedding profile).
  local demo body source doc status=""
  demo="$(smoke_api GET /v1/teams/demo/sources | jq -c '.data[0]')"
  body="$(jq -c '{name: "OCR smoke", type: "upload", classification: .classification, embeddingProfileId: .embeddingProfileId}' <<<"$demo")"
  source="$(smoke_api POST /v1/teams/demo/sources -H 'Content-Type: application/json' -d "$body" | jq -r '.data.id')"
  smoke_api POST "/v1/teams/demo/sources/${source}/documents" -F "files=@${repo}/internal/ocr/sample.png;type=image/png" >/dev/null

  for _ in $(seq 1 90); do
    doc="$(smoke_api GET "/v1/teams/demo/sources/${source}/documents" | jq -c '.data.items[0] // empty')"
    status="$(jq -r '.status // empty' <<<"$doc")"
    case "$status" in ready | failed | skipped) break ;; esac
    sleep 2
  done
  if [ "$status" != ready ]; then
    echo "FAIL: the scanned sample is ${status:-not processed}: $(jq -c '{errorCode, errorMessage, warnings}' <<<"$doc")" >&2
    return 1
  fi
  local text
  text="$(smoke_api GET "/v1/teams/demo/sources/${source}/documents/$(jq -r '.id' <<<"$doc")/passages?limit=5" | jq -r '.data.items[].content')"
  grep -qi "quick brown fox" <<<"$text" || { echo "FAIL: the sample's text is not in its passages: ${text}" >&2; return 1; }
  echo "sample.png: ready, read with OCR ($(jq -c '.ocr' <<<"$doc")) in $((SECONDS - started)) s: $(head -n 3 <<<"$text" | tr '\n' ' ')"
}
