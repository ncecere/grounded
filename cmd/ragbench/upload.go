package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"sync"
	"time"
)

type uploadResult struct {
	Filename string `json:"filename"`
	Status   string `json:"status"`
	Error    *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func cmdUpload(args []string) error {
	fs := flag.NewFlagSet("upload", flag.ExitOnError)
	var c commonFlags
	c.register(fs)
	data := fs.String("data", "/tmp/ragbench/fiqa", "BEIR dataset directory (corpus.jsonl, queries.jsonl, qrels/)")
	split := fs.String("split", "test", "qrels split whose judged documents are always kept with -max-docs")
	maxDocs := fs.Int("max-docs", 0, "upload at most this many documents (judged ones first, then seeded random distractors); 0 = all")
	perRequest := fs.Int("per-request", 100, "files per upload request (Grounded allows at most 100)")
	workers := fs.Int("workers", 2, "concurrent upload requests")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: ragbench upload [flags]\n\nUploads one <doc id>.txt per corpus entry (title + text) to the source\ncreated by setup. Re-running is safe: unchanged files are skipped by Grounded.")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	st, err := loadState(c.state)
	if err != nil {
		return err
	}
	if st.SourceID == "" {
		return errors.New("run setup first")
	}
	qr, err := loadQrels(*data, *split)
	if err != nil {
		return err
	}
	all, err := loadCorpus(*data)
	if err != nil {
		return err
	}
	docs, empty := selectDocs(all, qr, *maxDocs)
	log.Printf("corpus: %d entries, %d empty (not uploaded: Grounded rejects empty files), uploading %d", len(all), empty, len(docs))
	cl, err := newClient(c.base, "admin")
	if err != nil {
		return err
	}
	path := "/v1/teams/" + st.Team + "/sources/" + st.SourceID + "/documents"
	type batch struct{ docs []beirDoc }
	jobs := make(chan batch)
	counts := map[string]int{}
	var mu sync.Mutex
	var firstErr error
	var wg sync.WaitGroup
	start := time.Now()
	done := 0
	for w := 0; w < max(*workers, 1); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for b := range jobs {
				res, err := uploadBatch(cl, path, b.docs)
				mu.Lock()
				if err != nil && firstErr == nil {
					firstErr = err
				}
				for _, r := range res {
					counts[r.Status]++
					if r.Error != nil {
						log.Printf("upload %s: %s: %s", r.Filename, r.Error.Code, r.Error.Message)
					}
				}
				done += len(b.docs)
				if (done/len(b.docs))%50 == 0 {
					log.Printf("uploaded %d/%d (%.0f docs/s)", done, len(docs), float64(done)/time.Since(start).Seconds())
				}
				mu.Unlock()
			}
		}()
	}
	for i := 0; i < len(docs); i += *perRequest {
		mu.Lock()
		stop := firstErr != nil
		mu.Unlock()
		if stop {
			break
		}
		jobs <- batch{docs[i:min(i+*perRequest, len(docs))]}
	}
	close(jobs)
	wg.Wait()
	end := time.Now()
	if firstErr != nil {
		return firstErr
	}
	if counts["created"]+counts["replaced"] > 0 || st.UploadStart.IsZero() {
		st.UploadStart, st.UploadEnd, st.Uploaded, st.IngestDone = start, end, len(docs), time.Time{}
	}
	fmt.Printf("uploaded %d documents in %s (%.0f docs/s): %v\n", len(docs), end.Sub(start).Round(time.Millisecond), float64(len(docs))/end.Sub(start).Seconds(), counts)
	return saveState(c.state, st)
}

func uploadBatch(cl *client, path string, docs []beirDoc) ([]uploadResult, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, d := range docs {
		w, err := mw.CreateFormFile("files", docFilename(d.ID))
		if err != nil {
			return nil, err
		}
		if _, err := w.Write([]byte(docText(d))); err != nil {
			return nil, err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}
	payload := buf.Bytes()
	var out []uploadResult
	for attempt := 1; ; attempt++ {
		req, err := http.NewRequest("POST", cl.base+path, bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", mw.FormDataContentType())
		err = cl.send(req, &out)
		var ae *apiError
		if err == nil || attempt >= 5 || (errors.As(err, &ae) && ae.Status < 500 && ae.Status != 429) {
			return out, err
		}
		log.Printf("upload attempt %d failed: %v; retrying", attempt, err)
		time.Sleep(time.Duration(attempt) * 2 * time.Second)
	}
}

func cmdWait(args []string) error {
	fs := flag.NewFlagSet("wait", flag.ExitOnError)
	var c commonFlags
	c.register(fs)
	every := fs.Duration("every", 15*time.Second, "poll interval")
	progress := fs.String("progress", "/tmp/ragbench/ingest-progress.csv", "CSV of progress samples (empty = none)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: ragbench wait [flags]\n\nPolls the source's document counts until nothing is pending or processing,\nthen prints ingest throughput measured from the first upload.")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	st, err := loadState(c.state)
	if err != nil {
		return err
	}
	if st.SourceID == "" {
		return errors.New("run setup and upload first")
	}
	cl, err := newClient(c.base, "admin")
	if err != nil {
		return err
	}
	var csv *os.File
	if *progress != "" {
		if csv, err = os.OpenFile(*progress, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err != nil {
			return err
		}
		defer csv.Close()
	}
	type counts struct {
		Total, Pending, Processing, Ready, Failed, Skipped, Chunks, Bytes int64
	}
	var src struct {
		Documents counts `json:"documents"`
	}
	for {
		if err := cl.do("GET", "/v1/teams/"+st.Team+"/sources/"+st.SourceID, nil, &src); err != nil {
			log.Printf("poll: %v", err)
			time.Sleep(*every)
			continue
		}
		d := src.Documents
		el := time.Since(st.UploadStart)
		rate := float64(d.Ready+d.Failed+d.Skipped) / el.Minutes()
		log.Printf("ready=%d failed=%d skipped=%d pending=%d processing=%d chunks=%d (%.0f docs/min since first upload)",
			d.Ready, d.Failed, d.Skipped, d.Pending, d.Processing, d.Chunks, rate)
		if csv != nil {
			fmt.Fprintf(csv, "%s,%d,%d,%d,%d,%d,%d,%d\n", time.Now().Format(time.RFC3339), d.Total, d.Ready, d.Failed, d.Skipped, d.Pending, d.Processing, d.Chunks)
		}
		if d.Pending == 0 && d.Processing == 0 && d.Total > 0 {
			st.IngestDone = time.Now()
			fmt.Printf("done: %d ready, %d failed, %d skipped, %d chunks in %s (%.0f docs/min)\n",
				d.Ready, d.Failed, d.Skipped, d.Chunks, el.Round(time.Second), rate)
			return saveState(c.state, st)
		}
		time.Sleep(*every)
	}
}
