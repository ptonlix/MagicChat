FROM golang:1.25-alpine AS build

WORKDIR /src/server

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.22

RUN addgroup -S app && adduser -S app -G app && \
  apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=build /out/server /app/server
COPY server/migrations /app/migrations
COPY api-docs /app/api-docs
COPY server/config.example.yaml /app/config.example.yaml

RUN mkdir -p /app/config /app/log && chown -R app:app /app

USER app

EXPOSE 20080

ENTRYPOINT ["/app/server"]
