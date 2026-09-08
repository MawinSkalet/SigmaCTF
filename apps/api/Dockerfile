FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS artifacts
RUN apt-get update && apt-get install -y --no-install-recommends gcc-x86-64-linux-gnu libc6-dev-amd64-cross python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY challenges /src/challenges
COPY scripts/generate-artifacts.py /src/scripts/generate-artifacts.py
RUN python3 scripts/generate-artifacts.py \
    && x86_64-linux-gnu-gcc challenges/static/mewing-vault.c -o apps/api/artifacts/mewing-vault -O0 -s \
    && mkdir -p /src/pwn && cp challenges/pwn-sigma-overflow/overflow.c /src/overflow.c \
    && x86_64-linux-gnu-gcc /src/overflow.c -o apps/api/artifacts/sigma-overflow -O0 -fno-stack-protector -fno-pie -no-pie -fcf-protection=none -Wl,--build-id=none -Wl,-z,noexecstack
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=apps/api --ignore-scripts
COPY apps/api apps/api
COPY --from=artifacts /src/apps/api/artifacts apps/api/artifacts
USER node
EXPOSE 4000
CMD ["node","apps/api/src/main.mjs"]
