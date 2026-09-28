package catalog

import (
	"context"
	"math"

	"github.com/ncecere/grounded/internal/gateway"
)

// Embed embeds texts for the target's profile. When the profile stores fewer
// dimensions than the model produces (outputDimensions, DESIGN.md §10), the
// model's supportsDimensionsParam flag decides how they are shortened: the
// server is sent the OpenAI "dimensions" parameter, or Grounded keeps the first
// dimensions of each vector and L2-renormalises them (Matryoshka truncation).
// A vector of another length is returned unchanged, and the caller's
// dimension check rejects it.
func (t EmbedTarget) Embed(ctx context.Context, input []string, user string) (gateway.EmbedResult, error) {
	req := gateway.EmbedRequest{Model: t.Model.UpstreamModel, Input: input, User: user}
	dims := int(t.Profile.Dimensions)
	shorten := t.Model.Dimensions != nil && dims < int(*t.Model.Dimensions)
	if shorten {
		if c := DecodeCompat(t.Model.Compat); c.SupportsDimensionsParam != nil && *c.SupportsDimensionsParam {
			req.Dimensions = dims
		}
	}
	res, err := t.Client.Embed(ctx, req)
	if err != nil || !shorten {
		return res, err
	}
	for i, v := range res.Vectors {
		if len(v) > dims {
			res.Vectors[i] = Truncate(v, dims)
		}
	}
	return res, nil
}

// Truncate returns the first dims values of v scaled to unit length, as
// Matryoshka embedding models expect. A zero prefix is returned as is.
func Truncate(v []float32, dims int) []float32 {
	out := make([]float32, dims)
	copy(out, v[:dims])
	var sum float64
	for _, x := range out {
		sum += float64(x) * float64(x)
	}
	if sum == 0 {
		return out
	}
	norm := math.Sqrt(sum)
	for i, x := range out {
		out[i] = float32(float64(x) / norm)
	}
	return out
}
