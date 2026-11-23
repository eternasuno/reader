FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS web-build
WORKDIR /src/web
RUN corepack enable && corepack prepare pnpm@12.9.0 --activate
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM golang:1.27-alpine@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS go-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/embed.go ./web/embed.go
COPY --from=web-build /src/web/dist ./web/dist
RUN mkdir -p /empty-data && chown 65532:65532 /empty-data
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/reader ./cmd/reader

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=go-build /out/reader /reader
COPY --from=go-build --chown=65532:65532 /empty-data /data
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["/reader"]
