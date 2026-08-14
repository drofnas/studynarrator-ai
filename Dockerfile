# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:26.7.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /workspace

RUN apt-get update \
  && apt-get install --yes --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/fake-speaches/package.json apps/fake-speaches/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/persistence/package.json packages/persistence/package.json
COPY packages/rendering/package.json packages/rendering/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/speaches-adapter/package.json packages/speaches-adapter/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.base.json tsconfig.json tsconfig.tools.json ./
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages packages
RUN npm run build --workspace @studynarrator/web \
  && npm run build --workspace @studynarrator/server

FROM ${NODE_IMAGE} AS runtime

ARG STUDYNARRATOR_VERSION=0.1.0
ARG STUDYNARRATOR_SOURCE_REVISION=unknown
ARG STUDYNARRATOR_SOURCE_URL=https://github.com/drofnas/studynarrator-ai

LABEL org.opencontainers.image.title="StudyNarrator" \
  org.opencontainers.image.description="Local study-guide authoring and speech rendering Web application" \
  org.opencontainers.image.version="${STUDYNARRATOR_VERSION}" \
  org.opencontainers.image.revision="${STUDYNARRATOR_SOURCE_REVISION}" \
  org.opencontainers.image.source="${STUDYNARRATOR_SOURCE_URL}" \
  org.opencontainers.image.licenses="Apache-2.0"

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates ffmpeg tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 studynarrator \
  && useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin studynarrator \
  && install --directory --owner=10001 --group=10001 --mode=0750 /data /app/apps/server/node_modules

WORKDIR /app
COPY --from=build --chown=10001:10001 /workspace/apps/server/dist apps/server/dist
COPY --from=build --chown=10001:10001 /workspace/apps/web/dist apps/web/dist
COPY --from=build --chown=10001:10001 /workspace/apps/server/node_modules/express apps/server/node_modules/express
COPY --from=build --chown=10001:10001 /workspace/apps/server/node_modules/better-sqlite3 apps/server/node_modules/better-sqlite3
COPY --chown=10001:10001 LICENSE ACKNOWLEDGMENTS.md ./

ENV NODE_ENV=production \
  STUDYNARRATOR_DATA_DIR=/data \
  STUDYNARRATOR_DISTRIBUTION=docker-web \
  STUDYNARRATOR_LISTEN_HOST=0.0.0.0 \
  STUDYNARRATOR_PORT=4310 \
  STUDYNARRATOR_REQUIRE_WEB_DIST=true \
  STUDYNARRATOR_SOURCE_REVISION=${STUDYNARRATOR_SOURCE_REVISION} \
  STUDYNARRATOR_WEB_DIST=/app/apps/web/dist

EXPOSE 4310
VOLUME ["/data"]
USER 10001:10001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4310/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
