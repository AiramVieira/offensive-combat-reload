# Offensive Combat: one build, two images.
#   server  Bun game server (WebSocket, sessions, rules)
#   web     nginx serving the built game and proxying /ws to the server
# Usually started together with docker compose (see docker-compose.yml and docs/DEPLOY.md).

FROM oven/bun:1.4-alpine AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4-alpine AS server
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production && bun pm cache rm
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
COPY server/migrations ./server/migrations
USER bun
EXPOSE 8787
CMD ["bun", "build/server.js"]

FROM nginx:1.27-alpine AS web
COPY deploy/nginx/docker.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
