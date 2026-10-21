# Stage 1: Build SSR Frontend
FROM oven/bun:1.4.3-alpine AS frontend-builder
WORKDIR /app/static/admin

COPY static/admin/package.json static/admin/bun.lock ./
RUN bun install --frozen-lockfile

COPY static/admin ./
RUN bun run build

# Stage 2: Build Backend
FROM golang:1.27-alpine AS backend-builder
WORKDIR /app

# Version injection
ARG APP_VERSION=dev

RUN go install github.com/knadh/stuffbin/stuffbin@latest
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .

# Copy built admin dist from frontend-builder
COPY --from=frontend-builder /app/static/admin/dist ./static/admin/dist

# Build binary with version injection
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -o listmonk -ldflags="-s -w -X 'main.calVersion=${APP_VERSION}'" ./cmd

# Pack static assets
RUN /go/bin/stuffbin -a stuff -in listmonk -out listmonk \
    config.toml.sample \
    schema.sql queries:/queries permissions.json \
    static/public:/public \
    static/admin/views:/admin/views \
    static/admin/partials:/admin/partials \
    static/admin/dist:/admin/static \
    static/admin/i18n.txt:/admin/i18n.txt \
    static/email-templates \
    i18n:/i18n

# Stage 3: Final Runtime Image
FROM alpine:latest
WORKDIR /listmonk

RUN apk --no-cache add ca-certificates tzdata shadow su-exec
COPY --from=backend-builder /app/listmonk .
COPY config.toml.sample config.toml
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

EXPOSE 9000

# What this build contains; the ops dashboard shows it on the version.
COPY CHANGELOG.md /app/CHANGELOG.md

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "./listmonk --install --idempotent --yes && ./listmonk --upgrade --yes && ./listmonk"]
