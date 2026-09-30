# Offensive Combat: one build, two images.
#   server  Node game server (WebSocket, sessions, rules)
#   web     nginx serving the built game and proxying /ws to the server
# Usually started together with docker compose (see docker-compose.yml and docs/DEPLOY.md).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS server
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
CMD ["node", "build/server.mjs"]

FROM nginx:1.27-alpine AS web
COPY deploy/nginx/docker.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
