# syntax=docker/dockerfile:1
FROM docker:29.1.3-dind AS docker-tools
FROM aquasec/trivy:0.74.0 AS scanner
FROM node:24.19.0-trixie AS tooling

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    DOCKER_HOST=unix:///docker-socket/docker.sock
WORKDIR /workspace

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ffmpeg xvfb xauth \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker-tools /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-tools /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
COPY --from=scanner /usr/local/bin/trivy /usr/local/bin/trivy

COPY package.json package-lock.json .npmrc .nvmrc .trivy-version ./
RUN test "$(node --version)" = "v$(cat .nvmrc)" \
  && trivy --version | grep -Fx "Version: $(cat .trivy-version)" \
  && npm install --global "$(node -p 'require("./package.json").packageManager')" \
  && chown node:node /workspace
COPY --chown=node:node apps/desktop/package.json apps/desktop/package.json
COPY --chown=node:node apps/fake-speaches/package.json apps/fake-speaches/package.json
COPY --chown=node:node apps/server/package.json apps/server/package.json
COPY --chown=node:node apps/web/package.json apps/web/package.json
COPY --chown=node:node packages/application/package.json packages/application/package.json
COPY --chown=node:node packages/core/package.json packages/core/package.json
COPY --chown=node:node packages/persistence/package.json packages/persistence/package.json
COPY --chown=node:node packages/rendering/package.json packages/rendering/package.json
COPY --chown=node:node packages/runtime/package.json packages/runtime/package.json
COPY --chown=node:node packages/shared-types/package.json packages/shared-types/package.json
COPY --chown=node:node packages/speaches-adapter/package.json packages/speaches-adapter/package.json
USER node
RUN npm ci && node apps/desktop/node_modules/electron/install.js
USER root
RUN npx playwright install --with-deps chromium firefox \
  && chown root:root apps/desktop/node_modules/electron/dist/chrome-sandbox \
  && chmod 4755 apps/desktop/node_modules/electron/dist/chrome-sandbox \
  && git config --system --add safe.directory /workspace
COPY --chown=node:node . .
USER node
RUN mkdir -p .tmp/dev/web
ENTRYPOINT ["xvfb-run", "--auto-servernum"]
CMD ["npm", "run", "verify"]
