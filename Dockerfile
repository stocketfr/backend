# syntax=docker/dockerfile:1.7

FROM node:22-bookworm AS build

WORKDIR /app
# ca-certificates and openssl are already present in node:22-bookworm; the
# only setup step is to activate the project's pinned pnpm.
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN sed -i 's#../packages#packages#g' pnpm-workspace.yaml pnpm-lock.yaml
# Cache the pnpm content-addressable store across builds. Combined with the
# GHA layer cache this keeps unchanged dependencies off the wire.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY src ./src
COPY drizzle ./drizzle
COPY drizzle.config.ts tsconfig.json tsconfig.build.json ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @stocket/types barrels \
  && pnpm --filter @stocket/types build \
  && pnpm run build \
  && rm -rf /tmp/stocket-api \
  && pnpm deploy --prod --legacy --filter=@stocket/api /tmp/stocket-api \
  && cp -a dist drizzle drizzle.config.ts /tmp/stocket-api/

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=build /tmp/stocket-api ./

# Run as the unprivileged node user shipped with the base image. The photos
# module writes under ./uploads, so that directory must exist and be owned
# by node before dropping privileges.
RUN mkdir -p uploads && chown -R node:node uploads
USER node

EXPOSE 4000

# Node-based healthcheck so we don't have to add curl. Probes the liveness
# endpoint (not /ready) — DB hiccups shouldn't restart the container, that's
# a separate concern. `compose up --wait` on the droplet blocks on this.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health-check/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/effect/main.cjs"]
