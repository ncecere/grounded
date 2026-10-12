# syntax=docker/dockerfile:1
#
# Multi-arch build: the web UI and the Go binary are built on the build
# platform and cross-compiled for the target (no emulation for the slow
# steps). The UI is embedded in the binary (web/embed.go).

FROM --platform=$BUILDPLATFORM node:26-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/ ./
COPY api/ /api/
RUN npm run build && test -f dist/index.html

FROM --platform=$BUILDPLATFORM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT=unknown
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath \
    -ldflags "-s -w -X github.com/ncecere/grounded/internal/buildinfo.Version=${VERSION} -X github.com/ncecere/grounded/internal/buildinfo.Commit=${COMMIT}" \
    -o /out/grounded ./cmd/grounded

# Distroless: no shell or package manager; runs as a non-root user (65532)
# and works with a read-only root filesystem.
FROM gcr.io/distroless/static-debian12:nonroot
ARG VERSION=dev
ARG COMMIT=unknown
LABEL org.opencontainers.image.title="grounded" \
      org.opencontainers.image.description="Grounded: an open-source, multi-tenant RAG and agents platform" \
      org.opencontainers.image.source="https://github.com/ncecere/grounded" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}"
COPY --from=build /out/grounded /grounded
USER 65532:65532
EXPOSE 8080 9090
ENTRYPOINT ["/grounded"]
CMD ["api"]
