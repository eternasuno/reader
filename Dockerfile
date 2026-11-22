FROM node:24-alpine AS web-build
WORKDIR /src/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM golang:1.27-alpine AS go-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/embed.go ./web/embed.go
COPY --from=web-build /src/web/dist ./web/dist
RUN mkdir -p /empty-data && chown 65532:65532 /empty-data
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/reader ./cmd/reader

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go-build /out/reader /reader
COPY --from=go-build --chown=65532:65532 /empty-data /data
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["/reader"]
