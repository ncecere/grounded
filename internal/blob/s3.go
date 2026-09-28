package blob

// feature/s3/manager is deprecated in favour of feature/s3/transfermanager,
// which is still pre-1.0. The manager remains the stable, supported way to
// stream multipart uploads of unknown length, so it is used deliberately.
//lint:file-ignore SA1019 feature/s3/manager is intentionally used (stable v1 API)

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

const (
	// s3SinglePutMax is the largest known-size object sent with a single
	// PutObject (buffered in memory). Larger or unknown-size bodies are
	// streamed as multipart uploads.
	s3SinglePutMax = 16 << 20
	// s3PartSize and s3Concurrency bound multipart memory use to roughly
	// (s3Concurrency+1) * s3PartSize per in-flight upload.
	s3PartSize    = 8 << 20
	s3Concurrency = 4
	// s3DeleteBatch is the DeleteObjects per-request limit.
	s3DeleteBatch = 1000
)

// S3Config configures [NewS3].
type S3Config struct {
	Endpoint       string // e.g. https://minio.example.edu; empty = AWS default
	Region         string // default "us-east-1"
	Bucket         string // required
	AccessKey      string
	SecretKey      string
	ForcePathStyle bool
	CAFile         string // optional PEM bundle for self-signed endpoints
	Prefix         string // optional key prefix inside the bucket, e.g. "grounded/"
}

// S3 is a [Store] backed by an S3-compatible bucket.
type S3 struct {
	client   *s3.Client
	uploader *manager.Uploader
	bucket   string
	prefix   string // "" or ends with "/"
}

var _ Store = (*S3)(nil)

// NewS3 connects using AWS SDK v2 (github.com/aws/aws-sdk-go-v2/service/s3). It does not create the bucket.
//
// If AccessKey and SecretKey are empty the SDK's default credential chain is
// used (environment, shared config, web identity, instance metadata). NewS3
// makes no network calls; use Ping to verify connectivity.
func NewS3(ctx context.Context, cfg S3Config) (*S3, error) {
	if cfg.Bucket == "" {
		return nil, errors.New("blob: s3: bucket is required")
	}
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	if (cfg.AccessKey == "") != (cfg.SecretKey == "") {
		return nil, errors.New("blob: s3: access key and secret key must be set together")
	}
	prefix := ""
	if cfg.Prefix != "" {
		p := strings.TrimSuffix(cfg.Prefix, "/")
		if !ValidKey(p) {
			return nil, fmt.Errorf("blob: s3: %w: prefix %q", ErrInvalidKey, cfg.Prefix)
		}
		prefix = p + "/"
	}

	httpClient, err := newS3HTTPClient(cfg.CAFile)
	if err != nil {
		return nil, err
	}
	opts := []func(*config.LoadOptions) error{
		config.WithRegion(cfg.Region),
		config.WithHTTPClient(httpClient),
	}
	if cfg.AccessKey != "" {
		opts = append(opts, config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")))
	}
	if cfg.Endpoint != "" {
		// Many S3-compatible stores reject the flexible checksums (aws-chunked
		// trailers) the SDK sends by default; only send checksums when an
		// operation requires them.
		opts = append(opts,
			config.WithRequestChecksumCalculation(aws.RequestChecksumCalculationWhenRequired),
			config.WithResponseChecksumValidation(aws.ResponseChecksumValidationWhenRequired),
		)
	}
	awsCfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("blob: s3: load config: %w", err)
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
		}
		o.UsePathStyle = cfg.ForcePathStyle
	})
	uploader := manager.NewUploader(client, func(u *manager.Uploader) {
		u.PartSize = s3PartSize
		u.Concurrency = s3Concurrency
		u.LeavePartsOnError = false // abort failed multipart uploads
	})
	return &S3{client: client, uploader: uploader, bucket: cfg.Bucket, prefix: prefix}, nil
}

func newS3HTTPClient(caFile string) (*awshttp.BuildableClient, error) {
	c := awshttp.NewBuildableClient()
	if caFile == "" {
		return c, nil
	}
	pem, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("blob: s3: read CA file: %w", err)
	}
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("blob: s3: CA file %s contains no PEM certificates", caFile)
	}
	return c.WithTransportOptions(func(t *http.Transport) {
		if t.TLSClientConfig == nil {
			t.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
		}
		t.TLSClientConfig.RootCAs = pool
	}), nil
}

func (s *S3) objectKey(key string) string { return s.prefix + key }

// Put implements [Store]. Known sizes up to 16 MiB use a single PutObject;
// larger or unknown sizes are streamed as a multipart upload, which is
// aborted (leaving any previous object intact) if the body fails.
func (s *S3) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	if err := checkSize(size); err != nil {
		return err
	}
	in := &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey(key)),
	}
	if contentType != "" {
		in.ContentType = aws.String(contentType)
	}
	body := newExactReader(ctx, r, size)

	if size >= 0 && size <= s3SinglePutMax {
		// Read the whole (small) body first so a short or long body is
		// detected before anything is sent, and so the SDK gets a seekable
		// body it can sign and retry.
		buf := make([]byte, size)
		if _, err := io.ReadFull(body, buf); err != nil {
			return fmt.Errorf("blob: s3: put %q: %w", key, sizeErr(err, size))
		}
		var one [1]byte
		if _, err := io.ReadFull(body, one[:]); err != io.EOF {
			return fmt.Errorf("blob: s3: put %q: %w", key, sizeErr(err, size))
		}
		in.Body = bytes.NewReader(buf)
		in.ContentLength = aws.Int64(size)
		if _, err := s.client.PutObject(ctx, in); err != nil {
			return fmt.Errorf("blob: s3: put %q: %w", key, err)
		}
		return nil
	}

	// Hide any Seek/ReadAt methods of the caller's reader behind exactReader
	// so the uploader streams part by part instead of inspecting the source.
	in.Body = body
	if _, err := s.uploader.Upload(ctx, in); err != nil {
		if errors.Is(err, ErrSizeMismatch) {
			return fmt.Errorf("blob: s3: put %q: %w", key, ErrSizeMismatch)
		}
		return fmt.Errorf("blob: s3: put %q: %w", key, err)
	}
	return nil
}

// sizeErr normalises errors from reading a small body into memory.
func sizeErr(err error, size int64) error {
	switch {
	case err == nil:
		return fmt.Errorf("%w: body longer than declared %d bytes", ErrSizeMismatch, size)
	case errors.Is(err, io.ErrUnexpectedEOF), errors.Is(err, io.EOF):
		return fmt.Errorf("%w: body shorter than declared %d bytes", ErrSizeMismatch, size)
	}
	return err
}

// Get implements [Store]. The returned body streams from S3.
func (s *S3) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	if err := checkKey(key); err != nil {
		return nil, err
	}
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey(key)),
	})
	if err != nil {
		if isS3NotFound(err) {
			return nil, fmt.Errorf("blob: s3: get %q: %w", key, ErrNotFound)
		}
		return nil, fmt.Errorf("blob: s3: get %q: %w", key, err)
	}
	return out.Body, nil
}

// Delete implements [Store].
func (s *S3) Delete(ctx context.Context, key string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey(key)),
	})
	if err != nil && !isS3NotFound(err) {
		return fmt.Errorf("blob: s3: delete %q: %w", key, err)
	}
	return nil
}

// DeletePrefix implements [Store] with ListObjectsV2 pagination and
// DeleteObjects batches of up to 1000 keys.
func (s *S3) DeletePrefix(ctx context.Context, prefix string) error {
	p, err := normalizePrefix(prefix)
	if err != nil {
		return err
	}
	full := s.objectKey(p) + "/"
	pager := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
		Prefix: aws.String(full),
	})
	batch := make([]types.ObjectIdentifier, 0, s3DeleteBatch)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		out, err := s.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.bucket),
			Delete: &types.Delete{Objects: batch, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return fmt.Errorf("blob: s3: delete prefix %q: %w", p, err)
		}
		if n := len(out.Errors); n > 0 {
			e := out.Errors[0]
			return fmt.Errorf("blob: s3: delete prefix %q: %d objects not deleted (first: %s: %s %s)",
				p, n, aws.ToString(e.Key), aws.ToString(e.Code), aws.ToString(e.Message))
		}
		batch = batch[:0]
		return nil
	}
	for pager.HasMorePages() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("blob: s3: delete prefix %q: list: %w", p, err)
		}
		for _, obj := range page.Contents {
			batch = append(batch, types.ObjectIdentifier{Key: obj.Key})
			if len(batch) == s3DeleteBatch {
				if err := flush(); err != nil {
					return err
				}
			}
		}
	}
	return flush()
}

// Ping implements [Store] with HeadBucket, which checks reachability,
// credentials and bucket existence without writing.
func (s *S3) Ping(ctx context.Context) error {
	if _, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)}); err != nil {
		return fmt.Errorf("blob: s3: ping bucket %q: %w", s.bucket, err)
	}
	return nil
}

// isS3NotFound reports whether err means the object does not exist. A
// missing bucket is a configuration error and is deliberately not included.
func isS3NotFound(err error) bool {
	var nsk *types.NoSuchKey
	if errors.As(err, &nsk) {
		return true
	}
	var nf *types.NotFound
	if errors.As(err, &nf) {
		return true
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NoSuchKey", "NotFound":
			return true
		case "NoSuchBucket":
			return false
		}
	}
	var respErr *awshttp.ResponseError
	return errors.As(err, &respErr) && respErr.HTTPStatusCode() == http.StatusNotFound
}
