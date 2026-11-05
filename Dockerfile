# DeepSeek Harness as an evaluation service.
#
# The container runs AutoEval's hub server, which exposes the run protocol
# Harbor speaks (`POST /v1/runs`, `/step`, `/cancel`) and drives this harness
# through its Python SDK. Both halves live in one image: the harness builds its
# CLI into `apps/cli/lib`, and the SDK spawns that CLI per run.
#
# The build runs here rather than being copied in because `lib/` is generated
# output and the repository does not carry it.
FROM node:24-bookworm-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip ca-certificates git ripgrep \
      build-essential make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@11.28.5 --activate
WORKDIR /workspace

# Dependency layer: manifests only, so a source change does not re-install.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY patches ./patches
COPY apps ./apps
COPY packages ./packages
COPY vendor ./vendor
COPY native ./native
COPY scripts ./scripts
COPY python ./python
RUN pnpm install --frozen-lockfile

# Build the harness CLI and every package it resolves at runtime.
FROM deps AS builder
COPY . .
RUN pnpm run build

# AutoEval owns the HTTP entry point and the SDK bridge.
FROM builder AS runtime
COPY --from=autoeval . /opt/autoeval/
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -e /opt/autoeval \
 && /opt/venv/bin/pip install --no-cache-dir -e /workspace/python/sdk
ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONPATH=/opt/autoeval/src \
    DSH_BIN=/workspace/apps/cli/lib/bin.js \
    TARGET=DSH \
    DSH_INITIALIZE_TIMEOUT=300
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4).status == 200 else 1)"
CMD ["python3", "-m", "autoeval.benchmarks.hub_server", "--host", "0.0.0.0", "--port", "8080"]
