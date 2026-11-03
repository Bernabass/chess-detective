# The production image: the Go API with the web app embedded, for any container host
# (docs/DEPLOY.md). Build from the repository root:
#   docker build -t retrograde .
#   docker run --rm -e DATABASE_URL=... retrograde migrate
#   docker run --rm -p 8080:8080 -e DATABASE_URL=... -e BASE_URL=... retrograde

FROM node:24-bookworm-slim AS web
RUN npm install --global pnpm@12.14.0
WORKDIR /src
# vercel.json: vite.config.ts reads the production page headers from it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vercel.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/web/package.json apps/web/
COPY apps/generator/package.json apps/generator/
RUN pnpm install --frozen-lockfile --filter @retrograde/web...
COPY packages/engine packages/engine
COPY apps/web apps/web
RUN pnpm --filter @retrograde/web build

FROM golang:1.27-bookworm AS api
WORKDIR /src
COPY services/api/go.mod services/api/go.sum ./
RUN go mod download
COPY services/api ./
# go:embed can't read outside the module, so the web build is copied in (ARCHITECTURE.md §10.1).
COPY --from=web /src/apps/web/dist ./internal/webui/dist
RUN CGO_ENABLED=0 go build -tags webui -trimpath -ldflags="-s -w" -o /out/retrograde ./cmd/retrograde

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=api /out/retrograde /retrograde
# The puzzle pool, for `retrograde import-puzzles /data/puzzles-v1.jsonl`.
COPY data/puzzles-v1.jsonl /data/puzzles-v1.jsonl
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/retrograde"]
CMD ["serve"]
