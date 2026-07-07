FROM golang:1.25-alpine AS build

WORKDIR /src/goddess-server

COPY goddess-server/go.mod goddess-server/go.sum ./
RUN go mod download

COPY goddess-server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/goddess-server ./cmd/goddess-server

FROM alpine:3.22

RUN addgroup -S app && adduser -S app -G app && \
  apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=build /out/goddess-server /app/goddess-server

RUN chown -R app:app /app

USER app

EXPOSE 20090

ENTRYPOINT ["/app/goddess-server"]
