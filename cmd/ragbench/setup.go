package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
)

type commonFlags struct {
	base, state string
}

func (c *commonFlags) register(fs *flag.FlagSet) {
	fs.StringVar(&c.base, "base", "http://127.0.0.1:8081", "Grounded base URL (must equal its APP_URL)")
	fs.StringVar(&c.state, "state", "/tmp/ragbench/state.json", "state file written by setup and upload")
}

func cmdSetup(args []string) error {
	fs := flag.NewFlagSet("setup", flag.ExitOnError)
	var c commonFlags
	var g gatewayFlags
	c.register(fs)
	g.register(fs)
	team := fs.String("team", "bench", "team slug to create")
	docPrefix := fs.String("doc-prefix", "search_document: ", "embedding profile document prefix (nomic task prefix)")
	queryPrefix := fs.String("query-prefix", "search_query: ", "embedding profile query prefix (nomic task prefix)")
	dims := fs.Int("dims", 768, "embedding dimensions")
	maxInput := fs.Int("max-input-tokens", 2048, "model maximum input tokens")
	chunkSize := fs.Int("chunk-size", 512, "profile chunk size in tokens")
	chunkOverlap := fs.Int("chunk-overlap", 64, "profile chunk overlap in tokens")
	topK := fs.Int("top-k", 10, "knowledge base default top-k")
	connName := fs.String("connection-name", "Gateway (bench)", "model connection name")
	rpm := fs.Int("requests-per-minute", 0, "connection request limit per minute (0 = unlimited); set it below the gateway key's limit, e.g. 110 for a 120/min key")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: ragbench setup [flags]\n\nCreates (once) a model connection to the gateway, an embedding model, an\nembedding profile, a team owned by the dev admin, an upload source and a KB.")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	st, err := loadState(c.state)
	if err != nil {
		return err
	}
	st.Base = c.base
	cl, err := newClient(c.base, "admin")
	if err != nil {
		return err
	}
	key := os.Getenv(g.keyEnv)
	if key == "" {
		return fmt.Errorf("$%s is empty; load ai.env first", g.keyEnv)
	}
	if g.url == "" {
		return errors.New("set -gateway-url or $URL")
	}
	s := &setupRun{cl: cl, st: &st, path: c.state}
	conn := map[string]any{"name": *connName, "baseUrl": baseV1(g.url), "apiKey": key, "timeoutSeconds": 120}
	if *rpm > 0 {
		conn["requestsPerMinute"] = *rpm
	}
	if err := s.ensure(&st.ConnectionID, "connection", "connection", "/v1/admin/connections", conn); err != nil {
		return err
	}
	if err := s.test("connection", "/v1/admin/connections/"+st.ConnectionID+"/test"); err != nil {
		return err
	}
	if err := s.ensure(&st.ModelID, "model", "model", "/v1/admin/models", map[string]any{
		"connectionId": st.ConnectionID, "key": "bench-nomic", "displayName": "nomic-embed-text-v1.5 (bench)",
		"kind": "embedding", "upstreamModel": g.model, "dimensions": *dims, "maxInputTokens": *maxInput,
		"maxClassification": "sensitive",
	}); err != nil {
		return err
	}
	if err := s.test("model", "/v1/admin/models/"+st.ModelID+"/test"); err != nil {
		return err
	}
	if err := s.ensure(&st.ProfileID, "profile", "profile", "/v1/admin/embedding-profiles", map[string]any{
		"key": "bench-nomic-768", "name": "nomic 768 (bench)", "modelId": st.ModelID, "storageType": "halfvec",
		"documentPrefix": *docPrefix, "queryPrefix": *queryPrefix, "chunkSize": *chunkSize, "chunkOverlap": *chunkOverlap,
		"isDefault": true,
	}); err != nil {
		return err
	}
	if err := s.ensureTeam(*team); err != nil {
		return err
	}
	if err := s.ensure(&st.SourceID, "source", "source", "/v1/teams/"+st.Team+"/sources", map[string]any{
		"name": "FiQA-2018 corpus", "type": "upload", "classification": "open", "embeddingProfileId": st.ProfileID,
	}); err != nil {
		return err
	}
	if err := s.ensure(&st.KBID, "kb", "KB", "/v1/teams/"+st.Team+"/kbs", map[string]any{
		"name": "FiQA-2018", "embeddingProfileId": st.ProfileID, "topK": *topK,
	}); err != nil {
		return err
	}
	if err := cl.do("PUT", "/v1/teams/"+st.Team+"/kbs/"+st.KBID+"/sources/"+st.SourceID, nil, nil); err != nil {
		return fmt.Errorf("attach source: %w", err)
	}
	fmt.Printf("ready: team=%s source=%s kb=%s (state in %s)\n", st.Team, st.SourceID, st.KBID, c.state)
	return saveState(c.state, st)
}

// setupRun creates the benchmark's resources once, saving the state after
// each.
type setupRun struct {
	cl   *client
	st   *state
	path string
}

// ensure creates a resource when *id is empty: it POSTs body to path, prints
// label and the new ID, and saves it in the state.
func (s *setupRun) ensure(id *string, label, what, path string, body map[string]any) error {
	if *id != "" {
		return nil
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := s.cl.do("POST", path, body, &out); err != nil {
		return fmt.Errorf("create %s: %w", what, err)
	}
	*id = out.ID
	fmt.Println(label, out.ID)
	return saveState(s.path, *s.st)
}

// test runs a connection or model test.
func (s *setupRun) test(what, path string) error {
	var res map[string]any
	if err := s.cl.do("POST", path, nil, &res); err != nil {
		return fmt.Errorf("test %s: %w", what, err)
	}
	if what == "model" {
		fmt.Printf("model test: %v\n", res)
	} else {
		fmt.Println(what + " test ok")
	}
	return nil
}

// ensureTeam creates the team owned by the dev admin (an existing one is
// fine).
func (s *setupRun) ensureTeam(slug string) error {
	if s.st.Team != "" {
		return nil
	}
	if err := s.cl.do("POST", "/v1/admin/teams", map[string]any{
		"slug": slug, "name": "Benchmark team", "maxClassification": "sensitive", "ownerEmail": "admin@localhost",
	}, nil); err != nil {
		var ae *apiError
		if !errors.As(err, &ae) || ae.Status != 409 {
			return fmt.Errorf("create team: %w", err)
		}
	}
	s.st.Team = slug
	return saveState(s.path, *s.st)
}
