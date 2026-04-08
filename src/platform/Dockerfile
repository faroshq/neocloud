FROM golang:1.26 AS builder

WORKDIR /workspace
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /platform ./cmd/platform
RUN CGO_ENABLED=0 GOOS=linux go build -o /platform-cli ./cmd/cli

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /platform /platform
COPY --from=builder /platform-cli /platform-cli
USER 65532:65532
ENTRYPOINT ["/platform"]
