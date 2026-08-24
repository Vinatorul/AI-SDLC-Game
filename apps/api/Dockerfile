FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages packages
RUN pnpm --filter @ai-sdlc/api build

FROM node:24-bookworm-slim AS runtime

ENV DATABASE_PATH=/data/game.sqlite
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV PORT=8787

WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
RUN mkdir /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "dist/server.js"]
