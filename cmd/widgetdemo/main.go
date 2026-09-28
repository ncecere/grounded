// Command widgetdemo serves a sample page that embeds the Grounded widget, for
// the Phase 4 exit criterion (docs/phase4-publishing.md §6). Add its origin
// (http://127.0.0.1:8095 by default) to the publishable key's allowed
// origins.
//
//	go run ./cmd/widgetdemo -grounded http://127.0.0.1:8080 -agent <uuid> -key pk_…
package main

import (
	"flag"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

var page = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Example University — Office of the Registrar</title>
<style>
  body { margin: 0; font: 16px/1.6 Georgia, serif; color: #222; background: #fafaf7; }
  header { background: #243c5a; color: #fff; padding: 24px 40px; }
  header h1 { margin: 0; font-size: 28px; }
  main { max-width: 720px; margin: 32px auto; padding: 0 24px; }
  .note { font: 14px system-ui, sans-serif; background: #fff; border: 1px solid #ddd; padding: 12px 16px; border-radius: 8px; }
  code { font-size: 13px; }
</style>
</head>
<body>
<header><h1>Office of the Registrar</h1><p>Example University (a demo page on another origin)</p></header>
<main>
  <h2>Transcripts and records</h2>
  <p>Order official transcripts, check enrolment dates and find registration deadlines. Questions? Use the chat button in the corner.</p>
  <p class="note">This page embeds the Grounded widget from <code>{{.Grounded}}</code> for agent <code>{{.Agent}}</code>
  with a publishable key. Its origin must be in the key's allowed origins.</p>
</main>
<script src="{{.Grounded}}/widget.js" data-agent="{{.Agent}}" data-key="{{.Key}}" data-position="{{.Position}}" async></script>
</body>
</html>
`))

func main() {
	addr := flag.String("addr", "127.0.0.1:8095", "listen address")
	grounded := flag.String("grounded", envOr("GROUNDED_URL", "http://127.0.0.1:8080"), "Grounded base URL (GROUNDED_URL)")
	agent := flag.String("agent", os.Getenv("WIDGET_AGENT"), "public agent ID (WIDGET_AGENT)")
	key := flag.String("key", os.Getenv("WIDGET_KEY"), "publishable key pk_… (WIDGET_KEY)")
	position := flag.String("position", "bottom-right", "bottom-right or bottom-left")
	flag.Parse()
	if *agent == "" || *key == "" {
		fmt.Fprintln(os.Stderr, "widgetdemo: -agent and -key are required (or WIDGET_AGENT and WIDGET_KEY)")
		os.Exit(2)
	}
	data := struct{ Grounded, Agent, Key, Position string }{strings.TrimRight(*grounded, "/"), *agent, *key, *position}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := page.Execute(w, data); err != nil {
			log.Printf("render: %v", err)
		}
	})
	srv := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Printf("widget demo on http://%s (Grounded %s, agent %s)", *addr, data.Grounded, data.Agent)
	log.Fatal(srv.ListenAndServe())
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
