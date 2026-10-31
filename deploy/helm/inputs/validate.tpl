{{ if .Values.ocr }}
{{ $_ := required "ocrImage is required with OCR" .Values.ocrImage }}
{{ end }}
{{ if .Values.ingress }}
{{ $_ := required "ingressClass is required with ingress" .Values.ingressClass }}
{{ $_ := required "tlsSecret is required with ingress" .Values.tlsSecret }}
{{ if ne .Values.appURL (printf "https://%s" .Values.ingressHost) }}
{{ fail "appURL must equal https://ingressHost when ingress is enabled" }}
{{ end }}
{{ end }}
